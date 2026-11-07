"""PLocked backend: the referee. See docs/CONTRACT.md for the full rules this follows.

Phase 0 skeleton only — no session-state logic yet (that's Phase 1, task B1).
/state always returns the idle example from shared/examples/session_update_idle.json.
"""

import asyncio
import json
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

EXAMPLES_DIR = Path(__file__).resolve().parent.parent / "shared" / "examples"
HEARTBEAT_SECONDS = 5

app = FastAPI()

# The backend's "guest list": who is allowed to talk to it from a browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_example(filename: str) -> dict:
    with open(EXAMPLES_DIR / filename) as f:
        return json.load(f)["data"]


# In-memory session snapshot. Phase 1 will replace this with real state
# that changes as user_action / tab_change / camera_state messages arrive.
state: dict = _load_example("session_update_idle.json")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _envelope(msg_type: str, data: dict) -> dict:
    return {"v": 1, "source": "backend", "type": msg_type, "data": data, "timestamp": _now_ms()}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/state")
def get_state():
    return state


@app.post("/event")
async def post_event(request: Request):
    message = await request.json()
    required = {"v", "source", "type", "data", "timestamp"}
    missing = required - set(message)
    if missing:
        raise HTTPException(status_code=400, detail=f"message is missing fields: {sorted(missing)}")
    print(f"[event] {message['source']} -> {message['type']}: {message['data']}")
    return {"ok": True}


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json(_envelope("session_update", state))
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            await websocket.send_json(_envelope("session_update", state))
    except WebSocketDisconnect:
        pass
