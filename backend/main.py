"""PLocked backend: the referee. See docs/CONTRACT.md for the full rules this follows.

main.py is just the server (the four doors). The session-state rules live in
session.py (B1).
"""

import asyncio
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import nudges
import relevance
from session import Session

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

HEARTBEAT_SECONDS = 5
TICK_SECONDS = 1

app = FastAPI()

# The backend's "guest list": who is allowed to talk to it from a browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["*"],
    allow_headers=["*"],
)

session = Session()
connections: set[WebSocket] = set()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _envelope(msg_type: str, data: dict) -> dict:
    return {"v": 1, "source": "backend", "type": msg_type, "data": data, "timestamp": _now_ms()}


async def broadcast(msg_type: str, data: dict) -> None:
    """Pushes one message to every app connected over /ws right now."""
    message = _envelope(msg_type, data)
    dead = set()
    # Iterate a snapshot: a concurrent disconnect's connections.discard()
    # (in the /ws handler's `finally`) must not mutate the set while another
    # broadcast (heartbeat/tick loops can overlap) is iterating over it.
    for ws_conn in list(connections):
        try:
            await ws_conn.send_json(message)
        except Exception:
            dead.add(ws_conn)
    connections.difference_update(dead)


@app.on_event("startup")
async def start_background_loops() -> None:
    asyncio.create_task(_heartbeat_loop())
    asyncio.create_task(_tick_loop())


async def _heartbeat_loop() -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        await broadcast("session_update", session.snapshot())


async def _tick_loop() -> None:
    """Runs the nudge timing rules (B4) about once a second."""
    while True:
        await asyncio.sleep(TICK_SECONDS)
        if nudges.tick(session):
            await broadcast("session_update", session.snapshot())


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/state")
def get_state():
    return session.snapshot()


@app.post("/event")
async def post_event(request: Request):
    message = await request.json()
    required = {"v", "source", "type", "data", "timestamp"}
    missing = required - set(message)
    if missing:
        raise HTTPException(status_code=400, detail=f"message is missing fields: {sorted(missing)}")
    print(f"[event] {message['source']} -> {message['type']}: {message['data']}")

    if message["type"] == "user_action":
        action = message["data"].get("action")
        changed, extra = session.apply_action(action, message["data"])
        if changed:
            await broadcast("session_update", session.snapshot())
        if extra:
            extra_type, extra_data = extra
            await broadcast(extra_type, extra_data)

    elif message["type"] == "tab_change":
        # The extension only sends this during a session (contract §4), but
        # guard anyway in case it arrives late (e.g. right as a session ends).
        if session.snapshot()["status"] in ("studying", "break"):
            data = message["data"]
            domain, title, focused = data.get("domain"), data.get("title"), data.get("focused", True)
            error = None
            if focused and domain:
                if session.is_marked_relevant(domain):
                    label = "relevant"  # never re-checked or re-nudged this session (contract §4)
                else:
                    goal = session.snapshot()["goal"]
                    label, error = await relevance.check_relevance(goal, domain, title)
            else:
                domain, title, label = None, None, "unknown"
            # The AI call above can take seconds; re-check the session is
            # still live, since a concurrent end_session (or a new
            # start_session) could have replaced it entirely while we waited.
            if session.snapshot()["status"] not in ("studying", "break"):
                return {"ok": True}
            session.set_activity(domain, title, label)
            extra = session.clear_nudge_if_back_on_task(domain, label)
            await broadcast("session_update", session.snapshot())
            if error:
                await broadcast("error", {"message": error})
            if extra:
                extra_type, extra_data = extra
                await broadcast(extra_type, extra_data)

    elif message["type"] == "camera_state":
        # Vision only sends this during a session (same rule as tab_change).
        if session.snapshot()["status"] in ("studying", "break"):
            data = message["data"]
            nudges.record_camera_heartbeat(session)
            extra = session.set_camera(data.get("state", "unknown"), data.get("confidence"))
            await broadcast("session_update", session.snapshot())
            if extra:
                extra_type, extra_data = extra
                await broadcast(extra_type, extra_data)

    return {"ok": True}


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    connections.add(websocket)
    await websocket.send_json(_envelope("session_update", session.snapshot()))
    try:
        while True:
            await websocket.receive_text()  # the app never sends; this just waits for a disconnect
    except WebSocketDisconnect:
        pass
    finally:
        connections.discard(websocket)
