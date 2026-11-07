"""Nudge rules: when to show one, and what it says (docs/CONTRACT.md §6; B4/B5/B11).

tick() is called roughly once a second from main.py's background loop. It
reads the session's current snapshot plus the small amount of bookkeeping
session.py keeps (cooldown, "away" confirmation, relevant-domains, the
long-stretch clock) and decides whether to show, or keep showing, a nudge.

Decision rules, straight from the contract:
  - uncertain sites never cause a nudge.
  - no nudges during a break or when there's no session (session.py already
    clears/blocks this; tick() only runs logic for "studying").
  - only one nudge on screen at a time.
  - a site marked relevant is never nudged again this session.
  - camera silence for 15s -> camera becomes "unknown", in any session state.
"""

import time

NORMAL_SECONDS = {
    "unrelated_tab": 120,
    "phone": 90,
    "cooldown": 180,
    "away": 60,
    "long_stretch": 50 * 60,
}
DEMO_SECONDS = {
    "unrelated_tab": 8,
    "phone": 6,
    "cooldown": 15,
    "away": 5,
    "long_stretch": 3 * 60,
}
CAMERA_SILENCE_MS = 15_000  # same in both modes (contract §6)

# 4-5 friendly, non-shaming variations per reason, rotated so three nudges
# in a row never repeat (B11).
WORDINGS = {
    "unrelated_tab": [
        "Ready to get back to {goal}?",
        "Still with {goal}? Your next step is right there whenever you are.",
        "No rush — {goal} will be waiting when you're ready.",
        "Just a friendly nudge: {goal} is still the plan for today.",
        "Checking in — back to {goal} when it feels right?",
    ],
    "phone": [
        "Phone break? Totally fine — just a nudge that {goal} is still waiting.",
        "No judgment here, just a gentle reminder about {goal}.",
        "Whenever you're ready, {goal} will be right here.",
        "Just a friendly ping — back to it whenever you are.",
        "Scrolling happens — {goal} isn't going anywhere.",
    ],
    "long_stretch": [
        "You've been at it a while — a short break might feel good.",
        "Nice focus! Maybe stretch your legs for a minute?",
        "That's a long stretch of work — a quick breather could help.",
        "You've earned a short break, if you want one.",
        "Still going strong — remember, breaks are part of the plan too.",
    ],
}


def now_ms() -> int:
    return int(time.time() * 1000)


def _wording(session, reason: str, goal: str) -> str:
    options = WORDINGS[reason]
    index = session._wording_index.get(reason, 0)
    session._wording_index[reason] = index + 1
    return options[index % len(options)].format(goal=goal or "your goal")


def record_camera_heartbeat(session) -> None:
    """Call this on every camera_state message, so camera silence can be detected."""
    session._last_camera_at = now_ms()


def tick(session) -> bool:
    """Evaluates the timing rules once. Returns True if the snapshot changed
    (so main.py knows to broadcast session_update)."""
    now = now_ms()
    state = session.state
    changed = False

    # Camera silence -> unknown. Runs in any session state, per the contract.
    # Uses camera_went_silent(), not set_camera(): losing signal isn't the
    # same as vision reporting the phone was put down or the student is back.
    if (
        state["status"] != "idle"
        and session._last_camera_at is not None
        and state["camera"]["state"] != "unknown"
        and now - session._last_camera_at >= CAMERA_SILENCE_MS
    ):
        session.camera_went_silent()
        changed = True

    if state["status"] != "studying":
        return changed

    demo = state["demo_mode"]
    seconds = DEMO_SECONDS if demo else NORMAL_SECONDS
    camera = state["camera"]

    # Away long enough to count — enables the reentry-on-return rule in
    # session.set_camera(), which fires once they come back.
    if camera["state"] == "away" and not session._away_confirmed:
        if now - camera["since"] >= seconds["away"] * 1000:
            session._away_confirmed = True

    if state["active_nudge"] is not None:
        return changed  # only one nudge on screen at a time

    cooldown_ok = (
        session._last_nudge_cleared_at is None
        or now - session._last_nudge_cleared_at >= seconds["cooldown"] * 1000
    )
    if not cooldown_ok:
        return changed

    goal = state["goal"]

    # Phone takes priority — it's the distraction the browser can't see.
    if camera["state"] == "phone_in_hand" and now - camera["since"] >= seconds["phone"] * 1000:
        session.fire_nudge("phone", _wording(session, "phone", goal))
        return True

    activity = state["activity"]
    if (
        activity["label"] == "unrelated"
        and activity["since"] is not None
        and not session.is_marked_relevant(activity["domain"])
        and now - activity["since"] >= seconds["unrelated_tab"] * 1000
    ):
        session.fire_nudge(
            "unrelated_tab", _wording(session, "unrelated_tab", goal), domain=activity["domain"]
        )
        return True

    if (
        session._study_segment_started_at is not None
        and now - session._study_segment_started_at >= seconds["long_stretch"] * 1000
    ):
        session.fire_nudge("long_stretch", _wording(session, "long_stretch", goal))
        session._study_segment_started_at = now  # restart the clock for the next one
        return True

    return changed
