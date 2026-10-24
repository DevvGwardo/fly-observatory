import math
import unittest

from broadcast import PHASES
from observatory import Observatory
from scenarios import FieldScenario, SCENARIOS
from server import Command


class Brain:
    def reset(self):
        pass


class ScenarioTests(unittest.TestCase):
    def test_every_field_has_a_broadcast_chapter_and_valid_geometry(self):
        fields = set(SCENARIOS) - {"lab"}
        self.assertEqual(fields, {p["scenario"] for p in PHASES if "scenario" in p})
        for name in fields:
            spec = SCENARIOS[name]
            self.assertLess(math.hypot(*spec["spawn"][:2]), 8.45)
            for x, z in spec["resources"]:
                self.assertLess(math.hypot(x, z), 8)
            for x, z, radius in spec["obstacles"]:
                self.assertLess(math.hypot(x, z) + radius + .42, 8.45)

    def test_fields_never_manufacture_heading_or_turn_velocity(self):
        for name in SCENARIOS:
            world = FieldScenario(name)
            body = [.05, .05, .7, .32]
            for _ in range(100):
                world.sense(body) if world.active else None
                body = world.advance(body, .02)
            self.assertEqual(body[2:], [.7, .32])

    def test_cue_calculation_does_not_move_body(self):
        for name in SCENARIOS:
            if name == "lab":
                continue
            world = FieldScenario(name)
            body = world.spec["spawn"].copy()
            before = body.copy()
            angle = world.sense(body)
            self.assertEqual(body, before)
            self.assertTrue(math.isfinite(angle))
            self.assertLessEqual(abs(angle), math.pi)

    def test_food_visits_require_proximity_and_dwell(self):
        world = FieldScenario("orchard")
        for _ in range(100):
            world.advance([-4, -1, 0, 0], .02)
        self.assertEqual(world.visited, 0)
        for _ in range(21):
            world.advance([-1, 0, 0, 0], .02)
        self.assertEqual(world.visited, 1)
        self.assertEqual(world.snapshot()["score"], 100)
        self.assertEqual(world.goal(), [3, 2])
        for _ in range(50):
            world.advance([-1, 0, 0, 0], .02)
        self.assertEqual(world.visited, 1)

    def test_single_source_cannot_be_farmed_for_fake_rewards(self):
        world = FieldScenario("plume")
        for _ in range(500):
            world.advance([-5, 1, 0, 0], .02)
        self.assertEqual(world.visited, 1)
        self.assertTrue(world.complete)
        self.assertEqual(world.snapshot()["score"], 100)

    def test_odor_cue_uses_field_samples_not_goal_direction(self):
        world = FieldScenario("plume")
        body = [3, 1, math.pi, 0]
        expected = world.sense(body)
        world.goal = lambda: [100, -100]
        self.assertEqual(world.sense(body), expected)
        self.assertGreater(world.odor, 0)
        self.assertLessEqual(world.odor, 1)

    def test_collision_contact_is_latched(self):
        world = FieldScenario("maze")
        x, z, radius = world.spec["obstacles"][0]
        for _ in range(50):
            body = world.advance([x, z, 1.2, .7], .02)
            self.assertGreaterEqual(math.dist(body[:2], (x, z)) + 1e-9, radius + .42)
        self.assertEqual(world.collisions, 1)
        self.assertEqual(body[2:], [1.2, .7])

    def test_spider_requires_a_measured_danger_zone_exit(self):
        world = FieldScenario("spider")
        world.advance([-4, -1, 0, 0], .02)
        self.assertEqual(world.escapes, 0)
        world.advance([-7, -1, 0, 0], .02)
        self.assertEqual(world.escapes, 1)
        for _ in range(50):
            world.advance([-7, -1, 0, 0], .02)
        self.assertEqual(world.escapes, 1)

    def test_swatter_switches_cue_priority_by_proximity(self):
        world = FieldScenario("picnic")
        world.threat = [0, 0]
        world.sense([0, 1, 0, 0])
        self.assertEqual(world.mode, "evade")
        world.sense([-6, -1, 0, 0])
        self.assertEqual(world.mode, "seek")

    def test_shelter_reduces_external_wind(self):
        outside, inside = FieldScenario("wind"), FieldScenario("wind")
        outside.advance([-5, -5, 0, 0], .02)
        inside.advance([-1, 3, 0, 0], .02)
        self.assertAlmostEqual(inside.wind[0] / outside.wind[0], .18)

    def test_route_progress_requires_actual_proximity_and_does_not_reward_it(self):
        world = FieldScenario("maze")
        body = world.spec["spawn"].copy()
        world.sense(body)
        self.assertEqual(world.waypoint, 0)
        world.sense([-3, -3.4, 0, 0])
        self.assertEqual(world.waypoint, 1)
        self.assertEqual((world.visited, world.snapshot()["score"]), (0, 0))

    def test_route_waypoints_stay_outside_collision_geometry(self):
        spec = SCENARIOS["maze"]
        for route in spec["routes"]:
            for x, z in route:
                self.assertLess(math.hypot(x, z), 6.9)
                for ox, oz, radius in spec["obstacles"]:
                    self.assertGreater(math.dist((x, z), (ox, oz)), radius + .42)

    def test_scenario_selection_is_validated_and_takes_over(self):
        sim = Observatory(broadcast=True)
        sim.sim_time, sim.seq = 25, 1250
        sim.command(Command(action="scenario", value="orchard").model_dump())
        sim.apply_commands(Brain())
        self.assertFalse(sim.director.enabled)
        self.assertEqual(sim.world.id, "orchard")
        self.assertEqual(sim.body, SCENARIOS["orchard"]["spawn"])
        self.assertEqual((sim.sim_time, sim.seq), (25, 1250))
        for value in ("unknown", True, None):
            with self.assertRaises(ValueError):
                Command(action="scenario", value=value)

    def test_return_to_lab_and_manual_targets_clear_field_rules(self):
        sim = Observatory()
        sim.set_scenario("spider", Brain())
        sim.set_scenario("lab", Brain())
        self.assertEqual((sim.world.id, sim.mode, sim.automatic), ("lab", "seek", True))
        sim.set_scenario("wind", Brain())
        sim.command({"action": "target", "x": 2, "z": 1})
        sim.apply_commands(Brain())
        self.assertEqual(sim.world.id, "lab")
        self.assertEqual(sim.target, [2, 1])
