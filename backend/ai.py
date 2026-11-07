"""One-off AI calls: task breakdown and the end-of-session note (B10/B12).

Unlike relevance.py's per-tab check, these aren't cached — each is asked
once, when the student clicks "Suggest steps" or ends a session. Both fail
soft: if the AI is slow, errors, or returns something unusable, fall back
to a reasonable default instead of blocking the demo.
"""

import asyncio
import os

from anthropic import AsyncAnthropic

TIMEOUT_SECONDS = 8
MODEL = "claude-haiku-5-5"

FALLBACK_STEPS = [
    "Figure out exactly what's needed",
    "Do the main work",
    "Check it over",
    "Submit / wrap up",
]

_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set — copy .env.example to .env and paste in a real key"
            )
        _client = AsyncAnthropic(api_key=api_key)
    return _client


def _text_of(response) -> str:
    """The response's first text block. Claude can also return non-text
    blocks (e.g. a ThinkingBlock) before the actual answer, so content[0]
    isn't always it."""
    for block in response.content:
        if getattr(block, "type", None) == "text":
            return block.text.strip()
    raise ValueError("response had no text block")


async def _ask(prompt: str, max_tokens: int) -> str:
    client = _get_client()
    response = await asyncio.wait_for(
        client.messages.create(model=MODEL, max_tokens=max_tokens, messages=[{"role": "user", "content": prompt}]),
        timeout=TIMEOUT_SECONDS,
    )
    return _text_of(response)


async def break_into_steps(goal: str) -> list[str]:
    """Splits a goal into 3-5 short, concrete steps, in order."""
    prompt = (
        f'Split this student goal into 3 to 5 short, concrete steps, in order: "{goal}"\n'
        "Reply with ONLY the steps, one per line. No numbering, no extra text."
    )
    try:
        # Generous headroom: if Claude reasons before answering, that
        # thinking also counts against max_tokens, which can otherwise
        # truncate the actual steps mid-sentence.
        text = await _ask(prompt, max_tokens=600)
        steps = [line.strip("-*0123456789. \t") for line in text.splitlines()]
        steps = [step for step in steps if step]
        if 3 <= len(steps) <= 5:
            return steps
        print(f"[ai] plan breakdown returned {len(steps)} usable steps, expected 3-5; using the fallback")
    except Exception as exc:
        print(f"[ai] plan breakdown failed ({exc}); using the fallback")
    return FALLBACK_STEPS


async def write_summary_note(goal: str, steps_done: int, steps_total: int, nudges: int, minutes_studied: int) -> str:
    """One warm, encouraging sentence about how the session went."""
    prompt = (
        f'A student just finished a study session. Goal: "{goal}". They completed '
        f"{steps_done} of {steps_total} steps in about {minutes_studied} minute(s), with "
        f"{nudges} gentle nudge(s) along the way. Write exactly one short, warm, encouraging "
        "sentence about the session. Never shaming, no matter how it went. Reply with ONLY that sentence."
    )
    try:
        note = await _ask(prompt, max_tokens=300)  # same thinking-tokens headroom as above
        if note:
            return note
    except Exception as exc:
        print(f"[ai] summary note failed ({exc}); using a plain fallback")
    return (
        "Finished every step — nice work!"
        if steps_total and steps_done == steps_total
        else f"Good session — {steps_done}/{steps_total} steps done."
    )
