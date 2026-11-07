"""Session state: the backend's single in-memory snapshot (docs/CONTRACT.md §4-6).

This is B1 — session state and the user_action rules. It deliberately does
NOT touch tab_change / camera_state (that's relevance.py, B2, and vision
integration, B8-B9) and there is no nudge system yet (B4-B6), so:
  - `plan` returns a fixed stand-in instead of calling the AI (real version: B10).
  - `dismiss` / `relevant` just clear active_nudge, which is already None,
    because nothing can set it to anything else yet.
"""

import json
import time
from pathlib import Path

EXAMPLES_DIR = Path(__file__).resolve().parent.parent / "shared" / "examples"
DEFAULT_BREAK_MINUTES = 5
DEMO_GOAL = "Finish my Java assignment"
DEMO_STEPS = ["Read the requirements", "Write the insert method", "Test it", "Submit"]


def load_example(filename: str) -> dict:
    with open(EXAMPLES_DIR / filename) as f:
        return json.load(f)["data"]


def now_ms() -> int:
    return int(time.time() * 1000)


class Session:
    """Owns the one session_update snapshot and every user_action rule."""

    def __init__(self):
        self.state = load_example("session_update_idle.json")
        self._breaks = 0

    def snapshot(self) -> dict:
        return self.state

    def set_activity(self, domain: str | None, title: str | None, label: str) -> None:
        """Updates the current tab's label (B2). `since` only resets when the
        domain or label actually changes, so it tracks how long this streak
        has lasted — not every title change on the same page."""
        current = self.state["activity"]
        since = current["since"]
        if current["domain"] != domain or current["label"] != label or since is None:
            since = now_ms()
        self.state["activity"] = {"domain": domain, "title": title, "label": label, "since": since}

    def apply_action(self, action: str, fields: dict):
        """Applies one user_action. Returns (state_changed, extra_message),
        where extra_message is None or (type, data) for a one-off message
        (plan_result / reentry / summary) to send alongside session_update."""
        handler = getattr(self, f"_handle_{action}", None)
        if handler is None:
            print(f"[session] unknown action: {action!r}")
            return False, None
        return handler(fields)

    def _handle_plan(self, fields):
        goal = (fields.get("goal") or "").strip()
        if goal.lower() == DEMO_GOAL.lower():
            steps = DEMO_STEPS
        else:
            steps = [
                "Figure out exactly what's needed",
                "Do the main work",
                "Check it over",
                "Submit / wrap up",
            ]
        return False, ("plan_result", {"steps": steps})

    def _handle_start_session(self, fields):
        steps = [{"text": text, "done": False} for text in fields.get("steps", [])]
        started_at = now_ms()
        minutes = fields.get("minutes", 60)
        self._breaks = 0
        self.state = {
            "status": "studying",
            "goal": fields.get("goal"),
            "steps": steps,
            "current_step": 0 if steps else -1,
            "started_at": started_at,
            "ends_at": started_at + minutes * 60_000,
            "break_ends_at": None,
            "demo_mode": bool(fields.get("demo_mode", False)),
            "parked": [],
            "activity": {"domain": None, "title": None, "label": "unknown", "since": None},
            "camera": {"state": "unknown", "since": None},
            "active_nudge": None,
        }
        return True, None

    def _handle_step_done(self, fields):
        if self.state["status"] not in ("studying", "break"):
            return False, None
        steps = self.state["steps"]
        i = self.state["current_step"]
        if 0 <= i < len(steps):
            steps[i]["done"] = True
            self.state["current_step"] = i + 1 if i + 1 < len(steps) else -1
        return True, None

    def _handle_break(self, fields):
        if self.state["status"] != "studying":
            return False, None
        minutes = fields.get("minutes", DEFAULT_BREAK_MINUTES)
        self.state["status"] = "break"
        self.state["break_ends_at"] = now_ms() + minutes * 60_000
        self._breaks += 1
        return True, None

    def _handle_resume(self, fields):
        if self.state["status"] != "break":
            return False, None
        self.state["status"] = "studying"
        self.state["break_ends_at"] = None
        return True, ("reentry", self._reentry_message())

    def _handle_park(self, fields):
        self.state["parked"].append({"text": fields["text"], "timestamp": now_ms()})
        return True, None

    def _handle_dismiss(self, fields):
        self.state["active_nudge"] = None
        return True, None

    def _handle_relevant(self, fields):
        self.state["active_nudge"] = None
        return True, None

    def _handle_end_session(self, fields):
        if self.state["status"] == "idle":
            return False, None
        summary = self._summary()
        self.state = load_example("session_update_idle.json")
        return True, ("summary", summary)

    def _reentry_message(self) -> dict:
        steps = self.state["steps"]
        i = self.state["current_step"]
        if 0 <= i < len(steps):
            return {
                "message": f"Welcome back — you were on step {i + 1}: {steps[i]['text']}",
                "step_text": steps[i]["text"],
            }
        return {"message": "Welcome back!", "step_text": None}

    def _summary(self) -> dict:
        steps = self.state["steps"]
        started_at = self.state["started_at"] or now_ms()
        steps_done = sum(1 for step in steps if step["done"])
        steps_total = len(steps)
        note = (
            "Finished every step — nice work!"
            if steps_total and steps_done == steps_total
            else f"Good session — {steps_done}/{steps_total} steps done."
        )
        return {
            "minutes_studied": max(0, round((now_ms() - started_at) / 60_000)),
            "steps_done": steps_done,
            "steps_total": steps_total,
            "nudges": 0,  # real counts once nudge rules (B4) exist
            "nudges_dismissed": 0,
            "breaks": self._breaks,
            "parked": [parked["text"] for parked in self.state["parked"]],
            "note": note,
        }
