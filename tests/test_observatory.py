import math
import unittest

import numpy as np

from observatory import Observatory, calibrate, integrate, stimulus_sequence, teacher, wrap_angle
from server import Command


class PhysicsTests(unittest.TestCase):
    def test_brain_off_body_cannot_turn(self):
        body = [0, 0, 0.7, 0]
        for _ in range(200):
            body = integrate(body, 0)
        self.assertAlmostEqual(body[2], 0.7)
        self.assertEqual(body[3], 0)

    def test_neural_command_changes_heading(self):
        body = integrate([0, 0, 0, 0], 1)
        self.assertGreater(body[2], 0)
        self.assertGreater(body[3], 0)

    def test_collision_does_not_invent_a_turn(self):
        body = integrate([8.44, 0, 0, 0], 0)
        self.assertEqual(body[2], 0)
        self.assertLessEqual(math.hypot(*body[:2]), 8.45)

    def test_angles_and_teacher(self):
        self.assertAlmostEqual(wrap_angle(3 * math.pi), -math.pi)
        self.assertGreater(teacher(.3, 0), 0)
        self.assertLess(teacher(-.3, 0), 0)

    def test_independent_calibration_signals(self):
        a = list(stimulus_sequence(100, 17))
        self.assertEqual(a, list(stimulus_sequence(100, 17)))
        self.assertNotEqual(a, list(stimulus_sequence(100, 129)))

    def test_muting_clears_residual_steering(self):
        class StubBrain:
            def reset(self): pass
        sim = Observatory()
        sim.body[3] = 2.0
        sim.command({"action": "mute", "value": True})
        sim.apply_commands(StubBrain())
        self.assertTrue(sim.muted)
        self.assertEqual(sim.body[3], 0)

    def test_readers_do_not_step_the_simulation(self):
        sim = Observatory()
        for _ in range(100):
            self.assertEqual(sim.latest()["status"], "loading")
        self.assertEqual(sim.seq, 0)
        self.assertIsNone(sim.thread)

    def test_restart_restores_initial_experiment(self):
        class StubBrain:
            def reset(self): self.reset_called = True
        brain = StubBrain()
        sim = Observatory()
        sim.mode, sim.paused, sim.muted = "evade", True, True
        sim.seq, sim.sim_time, sim.acquired = 50, 1.0, 0.5
        sim.command({"action": "reset"})
        sim.apply_commands(brain)
        self.assertEqual(sim.body, [-3.0, 0.0, 0.0, 0.0])
        self.assertEqual((sim.mode, sim.paused, sim.muted), ("seek", False, False))
        self.assertEqual((sim.seq, sim.sim_time, sim.acquired), (0, 0, 0))
        self.assertTrue(brain.reset_called)

    def test_controls_validate_inputs(self):
        for bad in [
            {"action": "target", "x": float("nan"), "z": 0},
            {"action": "target", "x": 8, "z": 8},
            {"action": "mode", "value": "invented"},
            {"action": "pause", "value": "seek"},
        ]:
            with self.assertRaises(ValueError):
                Command(**bad)
        self.assertEqual(Command(action="target", x=3, z=1).x, 3)


class DecoderTests(unittest.TestCase):
    def test_decoder_fits_responses_and_reports_independent_score(self):
        class ResponsiveBrain:
            def reset(self): pass
            def step(self, bearing, velocity):
                return np.array([teacher(bearing, velocity), bearing, velocity,
                                 math.sin(bearing), math.cos(bearing), bearing * velocity])
        brain = ResponsiveBrain()
        decode, metrics = calibrate(brain)
        self.assertEqual(metrics["training_samples"], 2100)
        self.assertGreater(metrics["test_r2"], .99)
        self.assertGreater(decode(brain.step(1, 0)), .9)
        self.assertLess(decode(brain.step(-1, 0)), -.9)
        self.assertLess(abs(decode(brain.step(0, 0))), .01)

    def test_nonresponsive_network_stops_without_a_fallback(self):
        class SilentBrain:
            def reset(self): pass
            def step(self, bearing, velocity): return np.zeros(6)
        with self.assertRaisesRegex(RuntimeError, "did not respond"):
            calibrate(SilentBrain())

    def test_unrelated_activity_fails_held_out_validation(self):
        class NoiseBrain:
            rng = np.random.default_rng(900)
            def reset(self): pass
            def step(self, bearing, velocity): return self.rng.normal(size=6)
        with self.assertRaisesRegex(RuntimeError, "No fake controller"):
            calibrate(NoiseBrain())


if __name__ == "__main__":
    unittest.main()
