"""Relevance check: does this site fit the goal? (docs/CONTRACT.md §4; B2/B3)

Sends only the goal, domain, and title to Claude — never page contents or
the full web address (CLAUDE.md's privacy rule). Answers are cached by
(goal, domain, title) so the same page is never checked twice. If the AI
is slow (over 5 seconds) or fails for any reason — no API key, no network,
a bad response — this returns "uncertain" without crashing and without
caching that failure, so a later retry can still get a real answer.
"""

import asyncio
import os

from anthropic import AsyncAnthropic

TIMEOUT_SECONDS = 5
MODEL = "claude-haiku-5-5"
VALID_LABELS = {"relevant", "unrelated", "uncertain"}

_cache: dict[tuple[str, str, str], str] = {}
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


def _prompt(goal: str, domain: str, title: str) -> str:
    return (
        f'A student\'s goal is: "{goal}"\n'
        f"They just opened a browser tab — site: {domain}, title: {title}\n"
        "Does this tab fit the goal? Reply with exactly one word:\n"
        "- relevant: directly on-topic for the goal — official docs, tutorials, or "
        "tools for the exact subject/technology named in the goal\n"
        "- unrelated: clearly has nothing to do with the goal (social media, "
        "entertainment, shopping, unrelated topics)\n"
        "- uncertain: same general subject area but doesn't clearly match (wrong "
        "language, wrong specific topic), or a general-purpose tool that could be "
        "used for almost anything (an email inbox, a blank search page)"
    )


async def check_relevance(goal: str, domain: str, title: str) -> tuple[str, str | None]:
    """Returns (label, error_message). error_message is None on success."""
    key = (goal, domain, title)
    if key in _cache:
        return _cache[key], None

    try:
        client = _get_client()
        response = await asyncio.wait_for(
            client.messages.create(
                model=MODEL,
                # Generous for a one-word answer: any reasoning Claude does
                # before answering counts against this too, and too little
                # room here means the budget can run out before any actual
                # text block is produced at all (not just truncated — missing).
                max_tokens=300,
                messages=[{"role": "user", "content": _prompt(goal, domain, title)}],
            ),
            timeout=TIMEOUT_SECONDS,
        )
        label = _text_of(response).lower()
        if label not in VALID_LABELS:
            label = "uncertain"
    except Exception as exc:
        return "uncertain", f"AI relevance check didn't work ({exc}); treating the site as uncertain."

    _cache[key] = label
    return label, None
