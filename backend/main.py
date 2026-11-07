"""PLocked backend: the referee. See docs/CONTRACT.md for the full rules this follows.

main.py is just the server (the four doors). The session-state rules live in
session.py (B1).
"""

import asyncio
import time

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from session import Session

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
    for ws_conn in connections:
        try:
            await ws_conn.send_json(message)
        except Exception:
            dead.add(ws_conn)
    connections.difference_update(dead)


@app.on_event("startup")
async def start_heartbeat() -> None:
    asyncio.create_task(_heartbeat_loop())


async def _heartbeat_loop() -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
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
    # tab_change / camera_state are logged above only, for now — B2/B8/B9 will
    # feed them into the session once relevance checking and vision exist.

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
