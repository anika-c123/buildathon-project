# PLocked

PLocked is a buildathon project: an AI study desk that notices when a student drifts off their goal — on their laptop or their phone — and shows a gentle nudge projected onto the desk, along with a session timer and their progress.

## How to talk to us

Our team is not very technical. Whenever you use a technical term, explain it in plain English the first time. Before running a command or installing something, say in one sentence what it does and why. Prefer the simplest approach that works for a demo.

## The three parts (one folder each)

| Folder | Role | What it does |
| --- | --- | --- |
| `backend/` and `extension/` | Brain | A small program on the laptop that collects messages, asks an AI whether the current website fits the goal, and decides when to nudge. Plus a Chrome add-on that reports which site is open. |
| `vision/` | Eyes | Python + OpenCV code that reads the camera and reports: present, away, or phone in hand. |
| `app/` | Face | A web app for typing the goal, plus the full-screen view shown through the projector (goal, steps, progress, and session timer). |

Each person mostly works in their own folder. Don't change another role's folder unless asked.

## How the parts talk

All parts connect to the backend over a WebSocket (a live connection, like a group chat for programs) at `ws://localhost:8000/ws`.

Every message uses this shape:

```json
{ "source": "extension | vision | backend | app", "type": "tab_change | camera_state | nudge | session_update | user_action", "data": {}, "timestamp": 0 }
```

Examples:
- `tab_change`: `{ "domain": "youtube.com", "title": "Java Tutorial for Beginners" }`
- `camera_state`: `{ "state": "present | away | phone_in_hand", "confidence": 0.85 }`
- `nudge`: `{ "message": "Ready to get back to your Java assignment?" }`
- `user_action`: `{ "action": "dismiss | break | relevant | step_done" }`

If this format needs to change, tell the user so the whole team can agree first.

`backend/fake_events.py` sends pretend messages so each part can be built and tested before the others are ready.

## Rules

- Demo first: one complete working loop beats many half-finished features.
- The AI check labels each site as relevant, unrelated, or uncertain. Save its answers so the same site isn't checked twice.
- Nudge only after something lasts a while, with a cooldown between nudges. Keep a demo mode with very short timings.
- A phone lying on the desk is not a distraction; a phone held for a while is.
- Nudges are friendly and never shaming. No red warning screens.
- Privacy: only watch during a session the student starts. Never save camera video. Only send the site name and page title to the AI, never page contents.
- Keep any API key (the password for the AI service) in a `.env` file, and never commit it to GitHub.
- Timer: the projector view shows a session timer that starts when the student starts a session. It pauses during a break (`user_action: break`) and resumes when they're back. It's calm and encouraging (time focused so far), never a stressful countdown. The timer runs inside the app, so it doesn't need a new message type.

## Demo goal

"Finish my Java assignment" with 4 fixed steps. The session timer runs on the projector throughout. The demo shows: relevant site (quiet) → unrelated site (nudge) → phone in hand (nudge) → back to work (re-entry cue) → step done (progress animation).
