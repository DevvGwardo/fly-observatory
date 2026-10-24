"""Manage this exhibit's own per-user macOS launch agent."""
import argparse
import os
import plistlib
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LABEL = "com.devgwardo.fly-observatory"


def definition(root, python, home):
    return {
        "Label": LABEL,
        "ProgramArguments": ["/usr/bin/caffeinate", "-i", str(python), "-u", str(root / "server.py")],
        "WorkingDirectory": str(root),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 30,
        "ExitTimeOut": 10,
        "ProcessType": "Interactive",
        "EnvironmentVariables": {
            "FLY_BROADCAST": "1", "FLY_SUPERVISED": "1",
            "FLY_DATA_DIR": os.environ.get("FLY_DATA_DIR", str(home / "fly-data")),
            "OPENBLAS_NUM_THREADS": "2", "VECLIB_MAXIMUM_THREADS": "2",
        },
        "StandardOutPath": str(root / "artifacts" / "service.out.log"),
        "StandardErrorPath": str(root / "artifacts" / "service.err.log"),
    }


def launchctl(*args):
    return subprocess.run(["/bin/launchctl", *args], text=True, capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "start", "stop", "disable", "status"])
    action = parser.parse_args().action
    home = Path.home()
    target = home / "Library" / "LaunchAgents" / f"{LABEL}.plist"
    domain = f"gui/{os.getuid()}"
    service = f"{domain}/{LABEL}"
    loaded = launchctl("print", service)
    if action == "status":
        if loaded.returncode:
            print("Fly Observatory is not loaded.")
            return 1
        for line in loaded.stdout.splitlines():
            if line.strip().startswith(("state = ", "pid = ", "last exit code = ", "runs = ")):
                print(line.strip())
        print("Broadcast: http://127.0.0.1:8932/stream")
        return 0
    if action in ("stop", "disable"):
        if action == "disable":
            result = launchctl("disable", service)
            if result.returncode:
                raise SystemExit(result.stderr)
        if not loaded.returncode:
            result = launchctl("bootout", service)
            if result.returncode:
                raise SystemExit(result.stderr)
            deadline = time.monotonic() + 15
            while not launchctl("print", service).returncode:
                if time.monotonic() >= deadline:
                    raise SystemExit("Service is still stopping. Check its status before starting again.")
                time.sleep(.1)
        print("Stopped." if action == "stop" else "Stopped and disabled automatic login startup.")
        return 0
    if action == "install":
        python = Path(os.environ.get("FLY_PYTHON", str(home / "jevlike" / ".venv" / "bin" / "python")))
        if not os.access(python, os.X_OK):
            python = ROOT / ".venv" / "bin" / "python"
        if not os.access(python, os.X_OK):
            raise SystemExit("Python environment unavailable. Follow README.md or set FLY_PYTHON.")
        if not (ROOT / "dist" / "index.html").is_file():
            raise SystemExit("Build the frontend first: npm install && npm run build")
        content = plistlib.dumps(definition(ROOT, python, home))
        if target.exists() and target.read_bytes() != content:
            raise SystemExit(f"Refusing to overwrite a different service configuration: {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
        (ROOT / "artifacts").mkdir(exist_ok=True)
        if not target.exists():
            with target.open("xb") as file:
                file.write(content)
        print(f"Installed {target}")
    if not target.exists():
        raise SystemExit("Install the service first: python service.py install")
    result = launchctl("enable", service)
    if result.returncode:
        raise SystemExit(result.stderr)
    if loaded.returncode:
        result = launchctl("bootstrap", domain, str(target))
        if result.returncode:
            raise SystemExit(result.stderr)
    print("Automatic login startup and crash recovery enabled.")
    print("Broadcast: http://127.0.0.1:8932/stream")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
