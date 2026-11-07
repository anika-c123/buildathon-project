"""Session state: the backend's single in-memory snapshot (docs/CONTRACT.md §4-6).

B1 (session state + user_action) plus the state this session needs to
support B4's nudge rules: who's being watched for a nudge (camera, tab
activity), who's already been marked relevant, and the cooldown/away
bookkeeping nudges.py's tick() reads and writes. `plan` still returns a
fixed stand-in instead of calling the AI (real version: B10).
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
        self._reset_bookkeeping()

    def _reset_bookkeeping(self) -> None:
        self._breaks = 0
        self._nudges_fired = 0
        self._nudges_dismissed = 0
        self._nudge_counter = 0
        self._wording_index: dict[str, int] = {}
        self._active_nudge_domain: str | None = None
        self._relevant_domains: set[str] = set()
        self._last_nudge_cleared_at: int | None = None
        self._last_camera_at: int | None = None
        self._away_confirmed = False
        self._study_segment_started_at: int | None = None

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

    def is_marked_relevant(self, domain: str | None) -> bool:
        """A site the student clicked "this is relevant" on: never nudged
        again this session (docs/CONTRACT.md §4, the `relevant` action)."""
        return domain in self._relevant_domains

    def set_camera(self, cam_state: str, confidence: float | None) -> tuple[str, dict] | None:
        """Updates camera state (B8/B9). Returns an extra ("reentry", data)
        message when this is a return from a confirmed-away stretch, or from
        putting down a phone that had an active nudge up — else None."""
        old = self.state["camera"]
        extra = None
        if old["state"] == "away" and cam_state != "away" and self._away_confirmed:
            extra = ("reentry", self.reentry_message())
        elif (
            old["state"] == "phone_in_hand"
            and cam_state != "phone_in_hand"
            and self.state["active_nudge"]
            and self.state["active_nudge"]["reason"] == "phone"
        ):
            extra = ("reentry", self.reentry_message())
            self.state["active_nudge"] = None
            self._last_nudge_cleared_at = now_ms()
        if cam_state != "away":
            self._away_confirmed = False
        since = old["since"]
        if old["state"] != cam_state or since is None:
            since = now_ms()
        self.state["camera"] = {"state": cam_state, "since": since}
        return extra

    def camera_went_silent(self) -> None:
        """Camera silence -> unknown (contract §6). This is a fallback for
        when vision has stopped reporting, NOT a real observation — so unlike
        set_camera(), it must never trigger the "phone put down" or "back
        from away" reentry logic. We genuinely don't know what happened."""
        self.state["camera"] = {"state": "unknown", "since": now_ms()}

    def clear_nudge_if_back_on_task(self, domain: str | None, label: str) -> tuple[str, dict] | None:
        """Auto-clears an active unrelated_tab nudge (and sends reentry) when
        the student switches back to a relevant tab on their own, without
        pressing a button (docs/ARCHITECTURE.md's walkthrough)."""
        nudge = self.state["active_nudge"]
        if nudge and nudge["reason"] == "unrelated_tab" and label == "relevant":
            extra = ("reentry", self.reentry_message())
            self.state["active_nudge"] = None
            self._active_nudge_domain = None
            self._last_nudge_cleared_at = now_ms()
            return extra
        return None

    def fire_nudge(self, reason: str, message: str, domain: str | None = None) -> dict:
        self._nudge_counter += 1
        self._nudges_fired += 1
        nudge = {"id": f"n{self._nudge_counter}", "reason": reason, "message": message}
        self.state["active_nudge"] = nudge
        self._active_nudge_domain = domain
        return nudge

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
        self._reset_bookkeeping()
        self._study_segment_started_at = started_at
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
        # No nudges during a break (contract §6), and the long-stretch clock pauses.
        self.state["active_nudge"] = None
        self._active_nudge_domain = None
        self._study_segment_started_at = None
        self._breaks += 1
        return True, None

    def _handle_resume(self, fields):
        if self.state["status"] != "break":
            return False, None
        self.state["status"] = "studying"
        self.state["break_ends_at"] = None
        self._study_segment_started_at = now_ms()
        return True, ("reentry", self.reentry_message())

    def _handle_park(self, fields):
        self.state["parked"].append({"text": fields["text"], "timestamp": now_ms()})
        return True, None

    def _handle_dismiss(self, fields):
        self.state["active_nudge"] = None
        self._active_nudge_domain = None
        self._last_nudge_cleared_at = now_ms()
        self._nudges_dismissed += 1
        return True, None

    def _handle_relevant(self, fields):
        if self._active_nudge_domain:
            self._relevant_domains.add(self._active_nudge_domain)
            if self.state["activity"]["domain"] == self._active_nudge_domain:
                self.state["activity"]["label"] = "relevant"
        self.state["active_nudge"] = None
        self._active_nudge_domain = None
        self._last_nudge_cleared_at = now_ms()
        return True, None

    def _handle_end_session(self, fields):
        if self.state["status"] == "idle":
            return False, None
        summary = self._summary()
        self.state = load_example("session_update_idle.json")
        return True, ("summary", summary)

    def reentry_message(self) -> dict:
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
            "nudges": self._nudges_fired,
            "nudges_dismissed": self._nudges_dismissed,
            "breaks": self._breaks,
            "parked": [parked["text"] for parked in self.state["parked"]],
            "note": note,
        }
