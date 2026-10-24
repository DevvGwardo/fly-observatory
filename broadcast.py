"""An exhibit director, not a steering controller.

Only changes tasks, targets, and clearly labeled trial resets. Neural output
still exclusively determines heading. One server-side clock owns the program.
"""
import json
import math
from pathlib import Path
from scenarios import FieldScenario

PROGRAM = json.loads((Path(__file__).parent / "broadcast-program.json").read_text())
PHASES = PROGRAM["phases"]
CYCLE_SECONDS = sum(phase["duration"] for phase in PHASES)
TRIAL_BODY = [-4.0, -1.0, 0.0, 0.0]


def phase_at(seconds):
    cycle = math.floor((seconds + 1e-8) / CYCLE_SECONDS)
    within = max(0.0, seconds - cycle * CYCLE_SECONDS)
    start = 0
    for index, phase in enumerate(PHASES):
        if within < start + phase["duration"] - 1e-8:
            return cycle, index, phase, max(0.0, within - start), within
        start += phase["duration"]
    return cycle + 1, 0, PHASES[0], 0.0, 0.0


class BroadcastDirector:
    def __init__(self, enabled=False):
        self.enabled = enabled
        self.elapsed = 0.0
        self.previous = None

    def restart(self):
        self.elapsed = 0.0
        self.previous = None

    def apply(self, sim, brain):
        if not self.enabled:
            return {"enabled": False}
        cycle, index, phase, local, within = phase_at(self.elapsed)
        key = (cycle, index)
        if key != self.previous:
            name = phase.get("scenario", "lab")
            if name != sim.world.id or phase["reset"]:
                if name == "lab":
                    sim.world = FieldScenario()
                else:
                    sim.set_scenario(name, brain)
            if phase["reset"]:
                sim.body = sim.world.spec["spawn"].copy() if sim.world.active else TRIAL_BODY.copy()
                sim.acquired = 0.0
            if phase["reset"] or sim.muted != phase["muted"]:
                sim.body[3] = 0.0
                brain.reset()
            sim.mode = phase["mode"]
            sim.muted = phase["muted"]
            self.previous = key
        sim.automatic = phase["target"] != "fixed"
        if sim.world.active:
            sim.automatic = False
            sim.target = sim.world.goal()
        elif phase["target"] == "orbit":
            sim.target = [4.3 * math.cos(self.elapsed * 0.11),
                          3.2 * math.sin(self.elapsed * 0.11)]
        elif phase["target"] == "retarget":
            sim.target = [[3.0, 2.0], [-3.0, 3.0], [0.0, -4.0]][min(2, int(local / 6))].copy()
        else:
            sim.target = phase["point"].copy()
        return {
            "enabled": True, "cycle": cycle + 1, "phase": index,
            "phase_id": phase["id"], "phase_elapsed": round(local, 3),
            "trial_reset": phase["reset"],
            "phase_duration": phase["duration"], "elapsed": round(self.elapsed, 3),
            "cycle_elapsed": round(within, 3), "cycle_duration": CYCLE_SECONDS,
        }
