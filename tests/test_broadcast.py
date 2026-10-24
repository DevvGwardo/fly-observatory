import unittest
from pathlib import Path

from broadcast import BroadcastDirector, CYCLE_SECONDS, PHASES, TRIAL_BODY, phase_at
from observatory import Observatory
from server import Command
from service import definition


class StubBrain:
    def __init__(self): self.resets = 0
    def reset(self): self.resets += 1


class BroadcastTests(unittest.TestCase):
    def test_phase_boundaries_and_endless_wrap(self):
        start = 0
        for index, phase in enumerate(PHASES):
            self.assertEqual(phase_at(start)[1], index)
            self.assertEqual(phase_at(start + phase["duration"] - .02)[1], index)
            start += phase["duration"]
        self.assertEqual(start, CYCLE_SECONDS)
        self.assertEqual(phase_at(CYCLE_SECONDS)[:2], (1, 0))
        self.assertEqual(phase_at(CYCLE_SECONDS * 1000)[:2], (1000, 0))

    def test_brain_off_and_restored_trials_are_matched(self):
        sim, brain = Observatory(broadcast=True), StubBrain()
        start = 0
        trials = {}
        for phase in PHASES:
            sim.director.elapsed = start
            state = sim.director.apply(sim, brain)
            if phase["id"] in ("control", "restore"):
                trials[phase["id"]] = (sim.body.copy(), sim.target.copy(), sim.muted)
            self.assertEqual(state["phase_id"], phase["id"])
            start += phase["duration"]
        self.assertEqual(trials["control"][:2], trials["restore"][:2])
        self.assertEqual(trials["control"][0], TRIAL_BODY)
        self.assertTrue(trials["control"][2])
        self.assertFalse(trials["restore"][2])

    def test_director_does_not_reset_or_steer_within_a_trial(self):
        sim, brain = Observatory(broadcast=True), StubBrain()
        sim.director.apply(sim, brain)
        sim.body = [1, 2, 1.2, .3]
        resets = brain.resets
        sim.director.elapsed = 4
        sim.director.apply(sim, brain)
        self.assertEqual(sim.body, [1, 2, 1.2, .3])
        self.assertEqual(brain.resets, resets)

    def test_manual_target_takes_over_from_director(self):
        sim, brain = Observatory(broadcast=True), StubBrain()
        sim.command({"action": "target", "x": 2, "z": 1})
        sim.apply_commands(brain)
        self.assertFalse(sim.director.enabled)
        self.assertEqual(sim.target, [2, 1])

    def test_pause_keeps_director_and_restart_rewinds_it(self):
        sim, brain = Observatory(broadcast=True), StubBrain()
        sim.director.elapsed = 25
        sim.command({"action": "pause", "value": True})
        sim.apply_commands(brain)
        self.assertTrue(sim.director.enabled)
        self.assertEqual(sim.director.elapsed, 25)
        sim.command({"action": "reset"})
        sim.apply_commands(brain)
        self.assertTrue(sim.director.enabled)
        self.assertEqual(sim.director.elapsed, 0)
        self.assertFalse(sim.paused)

    def test_enabling_director_resumes_and_rewinds(self):
        sim, brain = Observatory(), StubBrain()
        sim.paused = True
        sim.director.elapsed = 50
        sim.command({"action": "broadcast", "value": True})
        sim.apply_commands(brain)
        self.assertTrue(sim.director.enabled)
        self.assertFalse(sim.paused)
        self.assertEqual(sim.director.elapsed, 0)
        with self.assertRaises(ValueError):
            Command(action="broadcast", value="seek")

    def test_service_is_local_owned_and_recovers(self):
        config = definition(Path("/example/fly-showcase"), Path("/example/python"), Path("/example/home"))
        self.assertTrue(config["RunAtLoad"])
        self.assertTrue(config["KeepAlive"])
        self.assertEqual(config["ThrottleInterval"], 30)
        self.assertEqual(config["EnvironmentVariables"]["FLY_SUPERVISED"], "1")
        self.assertEqual(config["EnvironmentVariables"]["FLY_BROADCAST"], "1")
        self.assertEqual(config["ProgramArguments"][-1], "/example/fly-showcase/server.py")
        self.assertEqual(config["ProgramArguments"][:2], ["/usr/bin/caffeinate", "-i"])


if __name__ == "__main__":
    unittest.main()
