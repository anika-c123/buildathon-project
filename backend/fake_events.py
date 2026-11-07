"""Replays the PLocked demo story by POSTing the example messages in shared/examples/
to the backend's /event door. Also opens a /ws connection alongside the story and
prints every nudge decision (plus reentry / error / summary / plan_result) as the
backend makes it, so the nudge rules (B4) are visible live, not just in /state.

The waits below are tuned for demo_mode timings (contract §6): long enough to
cross the 8s "unrelated tab" and 6s "phone" thresholds, and to show the 15s
cooldown actually holding the second nudge back.

Usage: python fake_events.py [--base-url http://localhost:8000] [--ws-url ws://localhost:8000/ws]
"""

import argparse
import asyncio
import json
from pathlib import Path

import requests
import websockets

EXAMPLES_DIR = Path(__file__).resolve().parent.parent / "shared" / "examples"

# (example filename, seconds to wait before sending it) — the demo story from docs/BUILD_PLAN.md
DEMO_STORY = [
    ("action_start.json", 0),  # Type the goal, suggest steps, start the session.
    ("tab_change_relevant.json", 2),  # Open Java docs — relevant, nothing happens.
    ("camera_present.json", 1),  # Writing in the notebook — present, nothing happens.
    ("tab_change_unrelated.json", 2),  # Open Instagram — a nudge follows after 8s (demo mode).
    ("tab_change_relevant.json", 10),  # Back to Java docs — clears the nudge, welcome back.
    ("camera_phone.json", 2),  # Pick up the phone — a nudge follows after 6s (demo mode).
    ("camera_present.json", 8),  # Put it down — clears the nudge, welcome back. (Under the 15s camera-silence window.)
    ("action_park.json", 1),  # Jot "email my TA" in the parking lot.
    ("action_step_done.json", 2),  # Mark the current step done.
    ("action_end.json", 1),  # End the session — summary.
]


def send(base_url: str, filename: str) -> None:
    with open(EXAMPLES_DIR / filename) as f:
        message = json.load(f)
    print(f"-> sending {filename}: {message['source']}/{message['type']} {message['data']}")
    response = requests.post(f"{base_url}/event", json=message, timeout=5)
    print(f"   backend replied {response.status_code}: {response.json()}")


async def play_story(base_url: str) -> None:
    for filename, wait_seconds in DEMO_STORY:
        await asyncio.sleep(wait_seconds)
        send(base_url, filename)
    await asyncio.sleep(1)  # give the final session_update/summary time to arrive


async def watch_nudges(ws_url: str, stop: asyncio.Event) -> None:
    """Prints every nudge appearing/clearing, and every reentry/error/summary/plan_result."""
    last_nudge_id = None
    async with websockets.connect(ws_url) as ws:
        while not stop.is_set():
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            message = json.loads(raw)
            msg_type = message["type"]
            if msg_type == "session_update":
                nudge = message["data"]["active_nudge"]
                nudge_id = nudge["id"] if nudge else None
                if nudge_id != last_nudge_id:
                    if nudge:
                        print(f"\n*** NUDGE [{nudge['reason']}] {nudge['message']}\n")
                    else:
                        print("\n*** (nudge cleared)\n")
                    last_nudge_id = nudge_id
            elif msg_type in ("reentry", "error", "summary", "plan_result"):
                print(f"\n*** {msg_type}: {message['data']}\n")


async def main_async(base_url: str, ws_url: str) -> None:
    stop = asyncio.Event()
    watcher = asyncio.create_task(watch_nudges(ws_url, stop))
    print(f"Replaying the demo story against {base_url} (watching {ws_url} for nudges) ...")
    await play_story(base_url)
    stop.set()
    await watcher
    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--ws-url", default="ws://localhost:8000/ws")
    args = parser.parse_args()
    asyncio.run(main_async(args.base_url, args.ws_url))


if __name__ == "__main__":
    main()
