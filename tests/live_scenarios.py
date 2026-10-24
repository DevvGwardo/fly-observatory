"""Optional real-network controls check. Changes worlds; run before going live."""
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scenarios import SCENARIOS

BASE = "http://127.0.0.1:8932"


def state():
    with urllib.request.urlopen(BASE + "/api/state", timeout=5) as response:
        return json.load(response)


def command(**payload):
    request = urllib.request.Request(BASE + "/api/control", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)


def wait_for(predicate):
    end = time.monotonic() + 8
    while time.monotonic() < end:
        frame = state()
        assert frame["status"] == "ready", frame.get("message")
        if predicate(frame):
            return frame
        time.sleep(.04)
    raise AssertionError("Control change did not arrive")


def main():
    report = {}
    original = state()
    assert original["status"] == "ready"
    try:
        for name in SCENARIOS:
            if name == "lab":
                continue
            command(action="scenario", value=name)
            initial = wait_for(lambda f: f["scenario"]["id"] == name and not f["paused"])
            assert not initial["broadcast"]["enabled"] and not initial["muted"]
            time.sleep(1.2)
            live = state()
            assert live["seq"] > initial["seq"]
            assert all(math.isfinite(v) for v in live["body"])
            assert math.hypot(*live["body"][:2]) <= 8.45002
            assert live["metrics"] == original["metrics"]
            assert live["spikes"] > 0
            command(action="pause", value=True)
            paused = wait_for(lambda f: f["paused"])
            time.sleep(.6)
            held = state()
            for key in ("body", "target", "sim_time"):
                assert held[key] == paused[key], (name, key)
            assert held["scenario"] == paused["scenario"]
            command(action="pause", value=False)
            wait_for(lambda f: not f["paused"])
            command(action="mute", value=True)
            muted = wait_for(lambda f: f["muted"])
            time.sleep(.6)
            control = state()
            assert control["body"][2] == muted["body"][2]
            assert control["command"] == 0 and control["spikes"] == 0 and not control["hot"]
            command(action="mute", value=False)
            wait_for(lambda f: not f["muted"])
            report[name] = {"pause_frozen": True, "muted_heading_frozen": True,
                            "neural_spikes": live["spikes"], "score": live["scenario"]["score"]}
            print("PASS", name, flush=True)
        for payload in ({"action": "scenario", "value": "not-a-world"},
                        {"action": "scenario", "value": True}):
            try:
                command(**payload)
            except urllib.error.HTTPError as error:
                assert error.code == 422
            else:
                raise AssertionError("Unknown world was accepted")
    finally:
        command(action="broadcast", value=True)
        wait_for(lambda f: f["broadcast"]["enabled"] and not f["paused"] and f["scenario"]["id"] == "lab")
    (ROOT / "artifacts" / "field-controls-check.json").write_text(json.dumps(report, indent=2) + "\n")
    print("PASS: all field controls and original decoder metrics", flush=True)


if __name__ == "__main__":
    main()
