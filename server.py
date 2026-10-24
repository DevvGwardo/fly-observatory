from contextlib import asynccontextmanager
import asyncio
import json
import math
import queue
import os
import sys
from pathlib import Path
from time import monotonic
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, model_validator
import uvicorn

from observatory import Observatory
from scenarios import SCENARIOS

ROOT = Path(__file__).resolve().parent
runner = Observatory(broadcast=os.environ.get("FLY_BROADCAST", "1") == "1")


async def supervise():
    """Let launchd recover a failed simulation, rather than serving dead frames."""
    while True:
        await asyncio.sleep(1)
        if runner.latest().get("status") == "error":
            print(runner.latest()["message"], file=sys.stderr, flush=True)
            os._exit(1)


@asynccontextmanager
async def lifespan(app):
    runner.start()
    monitor = asyncio.create_task(supervise()) if os.environ.get("FLY_SUPERVISED") == "1" else None
    try:
        yield
    finally:
        if monitor:
            monitor.cancel()
        runner.stop()


app = FastAPI(lifespan=lifespan)


class Command(BaseModel):
    action: Literal["target", "mode", "automatic", "pause", "mute", "reset", "broadcast", "scenario"]
    value: bool | str | None = None
    x: float | None = None
    z: float | None = None

    @model_validator(mode="after")
    def valid(self):
        if self.action == "target":
            if self.x is None or self.z is None or not math.isfinite(self.x) or not math.isfinite(self.z):
                raise ValueError("Target needs finite x and z")
            if math.hypot(self.x, self.z) > 8:
                raise ValueError("Target must be inside the habitat")
        elif self.action == "mode":
            if self.value not in ("seek", "evade"):
                raise ValueError("Unknown task")
        elif self.action == "scenario":
            if not isinstance(self.value, str) or self.value not in SCENARIOS:
                raise ValueError("Unknown scenario")
        elif self.action in ("pause", "mute", "automatic", "broadcast"):
            if not isinstance(self.value, bool):
                raise ValueError("Expected a boolean")
        return self


@app.get("/api/state")
async def state():
    return runner.latest()


@app.get("/api/geometry")
async def geometry():
    if runner.geometry_data is None:
        raise HTTPException(503, "Connectome geometry is still loading")
    return runner.geometry_data


@app.post("/api/control")
async def control(cmd: Command, request: Request):
    # Loopback does not mean arbitrary web pages may control the exhibit.
    origin = request.headers.get("origin")
    if origin and origin != f"{request.url.scheme}://{request.headers.get('host')}":
        raise HTTPException(403, "Cross-origin control is not allowed")
    try:
        runner.command(cmd.model_dump())
    except queue.Full:
        raise HTTPException(429, "Control queue is full")
    return {"queued": True}


@app.get("/api/stream")
async def stream(request: Request):
    async def events():
        previous = None
        last_message = 0.0
        while not await request.is_disconnected():
            frame = runner.latest()
            payload = json.dumps(frame, allow_nan=False)
            now = monotonic()
            # SSE comments do not reach onmessage. Identical paused frames still
            # need a visible heartbeat so the viewer can distinguish a quiet
            # simulator from an interrupted connection.
            if payload != previous or now - last_message >= 1:
                previous = payload
                last_message = now
                yield f"data: {payload}\n\n"
            else:
                yield ": keepalive\n\n"
            await asyncio.sleep(0.05)
    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)


if (ROOT / "dist" / "assets").exists():
    app.mount("/assets", StaticFiles(directory=ROOT / "dist" / "assets"), name="assets")


@app.get("/")
@app.get("/stream")
async def index():
    if not (ROOT / "dist" / "index.html").exists():
        raise HTTPException(503, "Run npm install && npm run build first")
    return FileResponse(ROOT / "dist" / "index.html")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8932, log_level="warning", timeout_graceful_shutdown=5)
