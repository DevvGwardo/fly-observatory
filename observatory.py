"""A signed, full-connectome LIF reservoir with an explicitly trained task adapter.

This is NOT a validated model of natural fly behavior. Input is task bearing,
encoded into premotor relay cells; output is a ridge decoder of descending cells.
One owner thread advances the reservoir, regardless of the number of viewers.
"""
from __future__ import annotations

import math
import os
import queue
import threading
import time
from pathlib import Path

import numpy as np
from broadcast import BroadcastDirector
from scenarios import FieldScenario

DATA_DIR = Path(os.environ.get("FLY_DATA_DIR", str(Path.home() / "fly-data")))
DT = 0.02
ARENA_RADIUS = 9.0


def wrap_angle(angle):
    return (angle + math.pi) % (2 * math.pi) - math.pi


def teacher(bearing, velocity):
    return float(np.clip(1.8 * bearing - 0.35 * velocity, -1, 1))


def integrate(body, command, dt=DT):
    """Only neural command changes heading. Speed/collision are explicit adapters."""
    x, z, heading, velocity = body
    velocity = 0.75 * velocity + 0.25 * float(np.clip(command, -1, 1)) * 2.4
    heading = wrap_angle(heading + velocity * dt)
    nx, nz = x + math.cos(heading) * 1.4 * dt, z + math.sin(heading) * 1.4 * dt
    # Physics stops the body at the glass; it never auto-turns it.
    if math.hypot(nx, nz) <= ARENA_RADIUS - 0.55:
        x, z = nx, nz
    return [x, z, heading, velocity]


class Connectome:
    def __init__(self, data_dir=DATA_DIR):
        import torch
        self.torch = torch
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        torch.manual_seed(17)
        with np.load(data_dir / "brain.npz", allow_pickle=False) as meta:
            self.n = len(meta["ids"])
            self.positions = meta["positions"].copy()
            self.sides = meta["side"].copy()
            self.desc = np.flatnonzero(meta["superclass"] == "descending_neuron")
        if len(self.desc) < 10:
            raise ValueError("Connectome has no usable descending-neuron population.")
        with np.load(data_dir / "weights.npz", allow_pickle=False) as weights:
            rows = np.repeat(np.arange(self.n, dtype=np.int32), np.diff(weights["indptr"]))
            cols = weights["indices"].copy()
            values = weights["data"].copy()
        self.edges = len(values)
        # Inbound absolute normalization retains inhibitory signs. Documented
        # reservoir scaling, not the electrophysiology of the original dataset.
        norms = np.bincount(cols, weights=np.abs(values), minlength=self.n)
        values /= np.maximum(norms[cols], 1e-9)
        # Input route chosen from actual wiring to descending output neurons.
        self.encoder_ids = np.unique(rows[np.isin(cols, self.desc)])
        rng = np.random.default_rng(17)
        encoder = rng.choice([-1.0, 1.0], (len(self.encoder_ids), 2)).astype(np.float32)
        self.encoder = torch.tensor(encoder, device=self.device)
        self.enc_idx = torch.tensor(self.encoder_ids.astype(np.int64), device=self.device)
        self.desc_idx = torch.tensor(self.desc.astype(np.int64), device=self.device)
        self.W = torch.sparse_coo_tensor(
            torch.tensor(np.stack([cols, rows]).astype(np.int64), device=self.device),
            torch.tensor(values, device=self.device),
            (self.n, self.n),
            check_invariants=False,
        ).coalesce()
        del rows, cols, values, norms
        valid = np.flatnonzero(
            np.isfinite(self.positions).all(axis=1)
            & (np.linalg.norm(np.nan_to_num(self.positions), axis=1) > 0)
        )
        self.valid_count = len(valid)
        # Stable sample; every displayed point refers to a real, identifiable cell.
        self.sample = np.sort(rng.choice(valid, min(16000, len(valid)), replace=False))
        self.sample_idx = torch.tensor(self.sample, device=self.device)
        self.left_idx = torch.tensor(np.flatnonzero(self.sides == "L"), device=self.device)
        self.right_idx = torch.tensor(np.flatnonzero(self.sides == "R"), device=self.device)
        self.left_size, self.right_size = len(self.left_idx), len(self.right_idx)
        self.reset()

    def reset(self):
        t = self.torch
        self.v = t.full((self.n,), 0.7, device=self.device)
        self.spikes = t.zeros(self.n, device=self.device)
        self.trace = t.zeros(self.n, device=self.device)
        self.last_drive = 0.0

    def step(self, bearing, velocity, recurrent=True):
        t = self.torch
        with t.no_grad():
            recurrent_drive = t.sparse.mm(self.W, self.spikes[:, None]).flatten() * 1.2 if recurrent else t.zeros_like(self.spikes)
            self.v.mul_(0.8).add_(0.14).add_(recurrent_drive)
            features = t.tensor([bearing / math.pi, velocity / 2.4], device=self.device)
            self.v[self.enc_idx] += 0.4 * (self.encoder @ features) + 0.08
            self.spikes = (self.v >= 1.0).float()
            self.v *= 1.0 - self.spikes
            self.trace.mul_(0.7).add_(self.spikes)
            return self.trace[self.desc_idx].cpu().numpy()

    def activity(self):
        s = self.spikes
        # All figures are measured, converted to population-mean Hz at DT.
        return {
            "left_hz": round(float(s[self.left_idx].sum().cpu()) / max(1, self.left_size) / DT, 2),
            "right_hz": round(float(s[self.right_idx].sum().cpu()) / max(1, self.right_size) / DT, 2),
            "population_hz": round(float(s.sum().cpu()) / self.n / DT, 2),
            "spikes": int(s.sum().cpu()),
            "hot": np.flatnonzero(s[self.sample_idx].cpu().numpy()).tolist(),
        }

    def geometry(self):
        p = self.positions[self.sample].astype(np.float64)
        all_p = self.positions[np.isfinite(self.positions).all(axis=1) & (np.linalg.norm(np.nan_to_num(self.positions), axis=1) > 0)]
        center = (all_p.min(axis=0) + all_p.max(axis=0)) / 2
        # Uniform scale preserves recorded coordinates, including the ventral cord.
        scale = float(np.ptp(all_p, axis=0).max())
        p = (p - center) / scale * 7.0
        return {
            "positions": np.round(p, 4).tolist(),
            "side": np.where(self.sides[self.sample] == "L", 0, 1).tolist(),
            "neuron_indices": self.sample.tolist(),
            "source": "MaleCNS v1.0, stored EM coordinates; uniformly scaled",
            "positioned_neurons": self.valid_count,
            "displayed_neurons": len(self.sample),
        }


def stimulus_sequence(length, seed):
    """Independent, smoothly changing task signals for fit and held-out validation."""
    rng = np.random.default_rng(seed)
    state = np.zeros(2)
    goal = np.zeros(2)
    for i in range(length):
        if i % 40 == 0:
            goal = rng.uniform([-math.pi, -2.4], [math.pi, 2.4])
        state += (goal - state) * 0.12
        yield float(state[0]), float(state[1])


def calibrate(brain, progress=lambda _: None):
    """Fit only the decoder. Connectome weights remain frozen throughout."""
    def collect(length, seed):
        brain.reset()
        xs, ys = [], []
        for i, (bearing, velocity) in enumerate(stimulus_sequence(length + 60, seed)):
            x = brain.step(bearing, velocity)
            if i >= 60:
                xs.append(x)
                ys.append(teacher(bearing, velocity))
            if i % 100 == 0:
                progress(f"Calibrating task decoder · {seed}:{i}/{length + 60}")
        return np.asarray(xs, dtype=np.float64), np.asarray(ys)

    X, y = collect(2100, 17)
    Xv, yv = collect(650, 81)
    mean, std = X.mean(axis=0), X.std(axis=0)
    keep = std > 0.025
    if keep.sum() < 5:
        raise RuntimeError("Descending neurons did not respond to this encoder.")
    A = (X[:, keep] - mean[keep]) / std[keep]
    B = (Xv[:, keep] - mean[keep]) / std[keep]
    ym = float(y.mean())
    # Thin SVD once; tune the decoder penalty on separate signals.
    U, singular, Vt = np.linalg.svd(A, full_matrices=False)
    best = None
    for penalty in (0.1, 1, 10, 100, 1000, 10000):
        w = Vt.T @ ((singular / (singular**2 + penalty)) * (U.T @ (y - ym)))
        pred = B @ w + ym
        score = float(1 - np.mean((pred - yv)**2) / max(np.var(yv), 1e-9))
        if best is None or score > best[0]:
            best = score, penalty, w
    score, penalty, w = best
    # Verify with a second signal sequence, untouched by penalty selection.
    Xt, yt = collect(650, 129)
    prediction = ((Xt[:, keep] - mean[keep]) / std[keep]) @ w + ym
    test_score = float(1 - np.mean((prediction - yt)**2) / max(np.var(yt), 1e-9))
    if not np.isfinite(test_score) or test_score < 0.4:
        raise RuntimeError(f"Neural decoder failed held-out validation (R²={test_score:.3f}). No fake controller will be substituted.")

    def decode(x):
        return float(np.clip(((x[keep] - mean[keep]) / std[keep]) @ w + ym, -1, 1))

    brain.reset()
    return decode, {"validation_r2": round(score, 3), "test_r2": round(test_score, 3), "penalty": penalty,
                    "decoder_cells": int(keep.sum()), "training_samples": len(X)}


class Observatory:
    def __init__(self, data_dir=DATA_DIR, broadcast=False):
        self.data_dir = data_dir
        self.lock = threading.Lock()
        self.commands = queue.Queue(maxsize=128)
        self.stop_event = threading.Event()
        self.frame = {"status": "loading", "message": "Loading the signed connectome"}
        self.geometry_data = None
        self.thread = None
        self.director = BroadcastDirector(broadcast)
        self.reset_body()

    def reset_body(self):
        self.body = [-3.0, 0.0, 0.0, 0.0]
        self.target = [3.0, 1.0]
        self.mode = "seek"
        self.automatic = True
        self.paused = False
        self.muted = False
        self.sim_time = 0.0
        self.seq = 0
        self.acquired = 0.0
        self.world = FieldScenario()

    def set_scenario(self, name, brain):
        self.world = FieldScenario(name)
        if self.world.active:
            self.body = self.world.spec["spawn"].copy()
            self.target = self.world.goal()
            self.mode, self.automatic, self.muted = "seek", False, False
            self.acquired = 0.0
        else:
            self.body = [-3.0, 0.0, 0.0, 0.0]
            self.target = [3.0, 1.0]
            self.mode, self.automatic, self.muted = "seek", True, False
            self.acquired = 0.0
        brain.reset()

    def start(self):
        if self.thread is None:
            self.thread = threading.Thread(target=self.run, name="fly-connectome-clock", daemon=True)
            self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)

    def latest(self):
        with self.lock:
            return self.frame

    def publish(self, frame):
        with self.lock:
            self.frame = frame

    def command(self, cmd):
        self.commands.put_nowait(cmd)

    def apply_commands(self, brain):
        while not self.commands.empty():
            cmd = self.commands.get_nowait()
            action = cmd["action"]
            if action in ("target", "mode", "automatic", "mute", "scenario"):
                self.director.enabled = False
            if action in ("target", "mode", "automatic"):
                self.world = FieldScenario()
            if action == "target":
                self.target = [float(cmd["x"]), float(cmd["z"])]
                self.automatic = False
            elif action == "mode":
                self.mode = cmd["value"]
            elif action == "automatic":
                self.automatic = cmd["value"]
            elif action == "pause":
                self.paused = cmd["value"]
            elif action == "mute":
                self.muted = cmd["value"]
                # No retained neural steering is allowed in the brain-off control.
                self.body[3] = 0.0
                brain.reset()
            elif action == "reset":
                self.reset_body()
                brain.reset()
                self.director.restart()
            elif action == "broadcast":
                self.director.enabled = cmd["value"]
                if self.director.enabled:
                    self.director.restart()
                    self.paused = False
            elif action == "scenario":
                self.set_scenario(cmd["value"], brain)
                self.paused = False

    def run(self):
        try:
            brain = Connectome(self.data_dir)
            self.geometry_data = brain.geometry()
            self.publish({"status": "calibrating", "message": "Fitting a task adapter, not changing the brain"})
            decode, metrics = calibrate(brain, lambda text: self.publish({"status": "calibrating", "message": text}))
            while not self.stop_event.is_set():
                started = time.perf_counter()
                self.apply_commands(brain)
                broadcast_state = self.director.apply(self, brain)
                if self.automatic and not self.paused and not self.director.enabled:
                    self.target = [4.3 * math.cos(self.sim_time * 0.11),
                                   3.2 * math.sin(self.sim_time * 0.11)]
                bearing = wrap_angle(math.atan2(self.target[1] - self.body[1], self.target[0] - self.body[0]) - self.body[2])
                encoded_bearing = wrap_angle(bearing + (math.pi if self.mode == "evade" else 0))
                if self.world.active and not self.paused:
                    encoded_bearing = self.world.sense(self.body)
                    self.target, self.mode = self.world.goal(), self.world.mode
                    bearing = encoded_bearing
                command = 0.0
                if not self.paused:
                    features = brain.step(encoded_bearing, self.body[3]) if not self.muted else None
                    command = decode(features) if features is not None else 0.0
                    self.body = integrate(self.body, command)
                    self.body = self.world.advance(self.body, DT)
                    self.sim_time += DT
                    self.seq += 1
                    if self.director.enabled:
                        self.director.elapsed += DT
                distance = math.hypot(self.target[0] - self.body[0], self.target[1] - self.body[1])
                if not self.paused and not self.muted and distance < 1.0:
                    self.acquired += DT
                activity = brain.activity()
                elapsed = time.perf_counter() - started
                self.publish({
                    "status": "ready", "seq": self.seq, "body": [round(v, 5) for v in self.body],
                    "broadcast": broadcast_state,
                    "scenario": self.world.snapshot(),
                    "target": self.target.copy(), "mode": self.mode, "automatic": self.automatic,
                    "paused": self.paused, "muted": self.muted, "command": round(command, 4),
                    "bearing": round(bearing, 4), "distance": round(distance, 2),
                    "sim_time": round(self.sim_time, 2), "acquired_seconds": round(self.acquired, 2),
                    "step_ms": round(elapsed * 1000, 1), "device": brain.device,
                    "neurons": brain.n, "synapses": brain.edges, "encoder_cells": len(brain.encoder_ids),
                    "descending_cells": len(brain.desc), "metrics": metrics, **activity,
                })
                self.stop_event.wait(max(0.0, DT - elapsed))
        except Exception as exc:
            self.publish({"status": "error", "message": f"{type(exc).__name__}: {exc}"})
