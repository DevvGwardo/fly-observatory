"""Optional integration check against the real running exhibit (~5–7 minutes).

Resets the shared exhibit, observes every chapter, and writes measured results.
Run only before broadcasting, not during a live audience session.
"""
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from broadcast import CYCLE_SECONDS, PHASES, TRIAL_BODY
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


def main():
    deadline = time.monotonic() + 160
    while time.monotonic() < deadline:
        try:
            frame = state()
            if frame["status"] == "error":
                raise AssertionError(frame["message"])
            if frame["status"] == "ready":
                break
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            pass
        time.sleep(.3)
    else:
        raise AssertionError("Real network did not become ready")
    command(action="broadcast", value=True)
    command(action="reset")
    report = {}
    deadline = time.monotonic() + CYCLE_SECONDS * 1.8 + 60
    started = False
    while time.monotonic() < deadline:
        frame = state()
        assert frame["status"] == "ready"
        show = frame["broadcast"]
        assert show["enabled"] and not frame["paused"]
        if not started:
            if show["phase_id"] != "signal" or show["elapsed"] > 1:
                time.sleep(.05)
                continue
            started = True
        if show["cycle"] > 1:
            break
        phase = PHASES[show["phase"]]
        if not phase.get("scenario"):
            assert frame["mode"] == phase["mode"]
        assert frame["scenario"]["id"] == phase.get("scenario", "lab")
        assert frame["muted"] == phase["muted"]
        record = report.setdefault(phase["id"], {
            "samples": 0, "initial_distance": frame["distance"],
            "minimum_distance": frame["distance"], "final_distance": frame["distance"],
            "headings": [], "targets": [], "visited": 0, "escapes": 0, "peak_odor": 0,
        })
        record["samples"] += 1
        record["minimum_distance"] = min(record["minimum_distance"], frame["distance"])
        record["final_distance"] = frame["distance"]
        record["headings"].append(frame["body"][2])
        record["visited"] = max(record["visited"], frame["scenario"]["visited"])
        record["escapes"] = max(record["escapes"], frame["scenario"]["escapes"])
        record["peak_odor"] = max(record["peak_odor"], frame["scenario"]["odor"])
        if frame["target"] not in record["targets"]:
            record["targets"].append(frame["target"])
        if record["samples"] == 1:
            print("CHAPTER", phase["id"], "cycle", show["cycle"], flush=True)
            if phase["reset"]:
                initial = SCENARIOS[phase["scenario"]]["spawn"] if phase.get("scenario") else TRIAL_BODY
                assert math.dist(frame["body"][:2], initial[:2]) < .3
        if phase["muted"]:
            assert frame["command"] == 0 and frame["spikes"] == 0 and not frame["hot"]
        time.sleep(.05)
    else:
        raise AssertionError("Automatic program failed to wrap")
    assert set(report) == {phase["id"] for phase in PHASES}
    assert report["signal"]["minimum_distance"] < 1
    assert report["restore"]["minimum_distance"] < 1
    assert report["evade"]["final_distance"] > report["evade"]["initial_distance"] + 1.5
    headings = report["control"]["headings"]
    assert max(headings) - min(headings) < .00001
    assert len(report["retarget"]["targets"]) == 3
    assert report["orchard"]["visited"] >= 1
    assert report["plume"]["peak_odor"] > .025
    assert report["spider"]["escapes"] >= 1
    # Preserve compact measurements, not every polled body pose.
    for record in report.values():
        headings = record.pop("headings")
        record["heading_range"] = round(max(headings) - min(headings), 5)
        record["target_count"] = len(record.pop("targets"))
    (ROOT / "artifacts").mkdir(exist_ok=True)
    (ROOT / "artifacts" / "broadcast-check.json").write_text(json.dumps(report, indent=2) + "\n")
    print("PASS", json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
