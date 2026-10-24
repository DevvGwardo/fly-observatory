"""Real-world-inspired fields with explicit engineered sensors and game rules.

This module never changes heading or turn velocity. It supplies a task cue to
the neural reservoir, applies labeled external position forces/collisions, and
counts actual proximity events. It is not a biological sensory model.
"""
import json
import math
from pathlib import Path

SCENARIOS = json.loads((Path(__file__).parent / "scenarios.json").read_text())


def unit(x, z):
    length = math.hypot(x, z)
    return (x / length, z / length) if length > 1e-9 else (1.0, 0.0)


class FieldScenario:
    def __init__(self, name="lab"):
        if name not in SCENARIOS:
            raise ValueError("Unknown scenario")
        self.id = name
        self.spec = SCENARIOS[name]
        self.time = 0.0
        self.visited = 0
        self.dwell = 0.0
        self.collisions = 0
        self.contacts = 0
        self.escapes = 0
        self.exposure = 0.0
        self.odor = 0.0
        self.threat = [-1.5, -1.0]
        self.in_danger = False
        self.contact_latched = False
        self.touching = False
        self.event = ""
        self.event_id = 0
        self.event_until = 0.0
        self.mode = "seek"
        self.cue = [0.0, 0.0]
        self.wind = [0.0, 0.0]
        self.waypoint = 0

    @property
    def active(self):
        return self.id != "lab"

    @property
    def complete(self):
        return bool(self.spec["resources"]) and self.visited >= len(self.spec["resources"])

    def goal(self):
        if self.id == "spider":
            return self.threat.copy()
        patches = self.spec["resources"]
        return patches[min(self.visited, len(patches) - 1)].copy() if patches else [3.0, 2.0]

    def concentration(self, x, z):
        sx, sz = self.spec["resources"][0]
        downwind = x - sx
        if downwind < -.5:
            return 0.0
        center = sz + downwind * .12 + .35 * math.sin(self.time * .7 - downwind * .4)
        width = .65 + max(0, downwind) * .14
        pulse = .75 + .25 * math.sin(self.time * 2.1 - downwind)
        return pulse * math.exp(-((z - center) / width)**2 / 2) * math.exp(-max(0, downwind) / 10)

    def sense(self, body):
        """Return the engineered desired bearing, never a motor command."""
        x, z, heading, _ = body
        gx, gz = self.goal()
        vx, vz = unit(gx - x, gz - z)
        if self.id == "maze" and not self.complete:
            route = self.spec["routes"][self.visited]
            if math.dist((x, z), route[self.waypoint]) < .85 and self.waypoint < len(route) - 1:
                self.waypoint += 1
            wx, wz = route[self.waypoint]
            vx, vz = unit(wx - x, wz - z)
        self.mode = "seek"
        danger = self.id == "spider" or self.id == "picnic" and math.dist((x, z), self.threat) < 3.0
        if danger:
            vx, vz = unit(x - self.threat[0], z - self.threat[1])
            self.mode = "evade"
        if self.id == "plume":
            self.odor = self.concentration(x, z)
            if self.odor > .025:
                dx = self.concentration(x + .35, z) - self.concentration(x - .35, z)
                dz = self.concentration(x, z + .35) - self.concentration(x, z - .35)
                vx, vz = unit(dx * 5 - .22, dz * 5 - .0264)
            else:
                # A labeled crosswind casting search, not access to source bearing.
                angle = math.pi + math.sin(self.time * 1.2) * 1.1
                vx, vz = math.cos(angle), math.sin(angle)
        for ox, oz, radius in self.spec["obstacles"]:
            dx, dz = x - ox, z - oz
            distance = math.hypot(dx, dz)
            reach = radius + (.9 if self.id == "maze" else 1.65)
            if distance < reach:
                ux, uz = unit(dx, dz)
                strength = 2.2 * (1 - distance / reach)
                # A tangential component avoids a symmetric head-on deadlock.
                side = 1 if (gx - ox) * dz - (gz - oz) * dx >= 0 else -1
                vx += ux * strength - uz * side * strength * .65
                vz += uz * strength + ux * side * strength * .65
        radius = math.hypot(x, z)
        if radius > 6.9:
            strength = (radius - 6.9) * 1.7
            vx -= x / radius * strength
            vz -= z / radius * strength
        vx, vz = unit(vx, vz)
        self.cue = [x + vx * 2, z + vz * 2]
        angle = math.atan2(vz, vx) - heading
        return (angle + math.pi) % (2 * math.pi) - math.pi

    def announce(self, text):
        self.event = text
        self.event_id += 1
        self.event_until = self.time + 2.4

    def advance(self, body, dt):
        """Environmental physics and event measurement after neural integration."""
        if not self.active:
            return body
        self.time += dt
        result = body.copy()
        x, z = result[:2]
        self.wind = [0.0, 0.0]
        if self.id == "wind":
            sheltered = any(math.dist((x, z), (sx, sz)) < r for sx, sz, r in self.spec["shelters"])
            gain = .18 if sheltered else 1
            self.wind = [(.55 + .45 * math.sin(self.time * .9)) * gain,
                         .25 * math.sin(self.time * .6) * gain]
            x += self.wind[0] * dt
            z += self.wind[1] * dt
        touching = False
        for ox, oz, radius in self.spec["obstacles"]:
            distance = math.hypot(x - ox, z - oz)
            clearance = radius + .42
            if distance < clearance:
                ux, uz = unit(x - ox, z - oz)
                x, z = ox + ux * clearance, oz + uz * clearance
                touching = True
        if touching and not self.touching:
            self.collisions += 1
            self.announce("CONTACT · obstacle collision measured")
        self.touching = touching
        radius = math.hypot(x, z)
        if radius > 8.45:
            x, z = x * 8.45 / radius, z * 8.45 / radius
        result[:2] = [x, z]
        if self.id == "spider":
            vx, vz = unit(x - self.threat[0], z - self.threat[1])
            self.threat[0] += vx * .58 * dt
            self.threat[1] += vz * .58 * dt
        elif self.id == "picnic":
            self.threat = [3.7 * math.sin(self.time * .55), 2.4 * math.cos(self.time * .4)]
        if self.id in ("spider", "picnic"):
            distance = math.dist((x, z), self.threat)
            if distance < 3.2:
                self.exposure += dt
                self.in_danger = True
            if distance < 1.1 and not self.contact_latched:
                self.contacts += 1
                self.contact_latched = True
                self.announce("CLOSE CONTACT · danger-zone entry measured")
            if distance > 4.0 and self.in_danger:
                self.escapes += 1
                self.in_danger = False
                self.announce("ESCAPED · left the threat zone")
            if distance > 2:
                self.contact_latched = False
        if not self.complete and self.spec["resources"]:
            self.dwell = self.dwell + dt if math.dist((x, z), self.goal()) < .9 else 0.0
            if self.dwell >= .4:
                self.visited += 1
                self.waypoint = 0
                self.dwell = 0.0
                noun = "LAMP" if self.id == "porch" else "FOOD PATCH"
                self.announce(f"+100 · {noun} VISITED" + (" · ROUTE COMPLETE" if self.complete else ""))
        return result

    def snapshot(self):
        return {
            "id": self.id, "name": self.spec["name"], "objective": self.spec["objective"],
            "adapter": self.spec["adapter"], "time": round(self.time, 2),
            "cue": self.cue.copy(), "visited": self.visited, "total": len(self.spec["resources"]),
            "complete": self.complete, "collisions": self.collisions, "contacts": self.contacts,
            "escapes": self.escapes, "exposure_seconds": round(self.exposure, 2),
            "odor": round(self.odor, 4), "wind": self.wind.copy(), "threat": self.threat.copy(),
            "score": self.visited * 100 + self.escapes * 25 - self.contacts * 25 - self.collisions * 5,
            "waypoint": self.waypoint,
            "event": self.event if self.time < self.event_until else "", "event_id": self.event_id,
        }
