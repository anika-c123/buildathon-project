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


def _prompt(goal: str, domain: str, title: str) -> str:
    return (
        f'A student\'s goal is: "{goal}"\n'
        f"They just opened a browser tab — site: {domain}, title: {title}\n"
        "Does this tab fit the goal? Reply with exactly one word: "
        "relevant, unrelated, or uncertain."
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
                max_tokens=10,
                messages=[{"role": "user", "content": _prompt(goal, domain, title)}],
            ),
            timeout=TIMEOUT_SECONDS,
        )
        label = response.content[0].text.strip().lower()
        if label not in VALID_LABELS:
            label = "uncertain"
    except Exception as exc:
        return "uncertain", f"AI relevance check didn't work ({exc}); treating the site as uncertain."

    _cache[key] = label
    return label, None
