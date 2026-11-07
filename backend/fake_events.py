"""Replays the PLocked demo story by POSTing the example messages in shared/examples/
to the backend's /event door, a few seconds apart. Run this while backend/main.py is
running, to see each message arrive without a real extension, camera, or app connected.

Usage: python fake_events.py [--base-url http://localhost:8000]
"""

import argparse
import json
import time
from pathlib import Path

import requests

EXAMPLES_DIR = Path(__file__).resolve().parent.parent / "shared" / "examples"

# (example filename, seconds to wait before sending it) — the demo story from docs/BUILD_PLAN.md
DEMO_STORY = [
    ("action_start.json", 0),  # Type the goal, suggest steps, start the session.
    ("tab_change_relevant.json", 2),  # Open Java docs — relevant, nothing happens.
    ("camera_present.json", 1),  # Writing in the notebook — present, nothing happens.
    ("tab_change_unrelated.json", 2),  # Open Instagram — after a while, a nudge.
    ("tab_change_relevant.json", 3),  # Close it, back to Java docs — welcome back.
    ("camera_phone.json", 2),  # Pick up the phone — after a while, a phone nudge.
    ("camera_present.json", 3),  # Put the phone down.
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()

    print(f"Replaying the demo story against {args.base_url} ...")
    for filename, wait_seconds in DEMO_STORY:
        time.sleep(wait_seconds)
        send(args.base_url, filename)
    print("Done.")


if __name__ == "__main__":
    main()
