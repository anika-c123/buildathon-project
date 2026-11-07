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

Each person works only in their own folder — never change another role's folder, even for a one-line fix, without asking that person first. Shared files (`docs/`, `shared/`, `CLAUDE.md`, `README.md`, `.gitignore`, `.env.example`) change only after the whole team agrees.

## How the parts talk

The full rules live in [`docs/CONTRACT.md`](docs/CONTRACT.md) — that file is the source of truth; read it before building anything that sends or receives a message. Short version:

- Everyone **sends** by `POST`ing to `http://localhost:8000/event`. Only the app **listens**, over a WebSocket (a connection that stays open so the backend can push updates the instant something changes, like a live group chat for programs) at `ws://localhost:8000/ws`.
- Every message shares one envelope, including a version number so everyone can tell if the shape ever changes:

```json
{ "v": 1, "source": "extension | vision | app | backend", "type": "tab_change | camera_state | user_action | session_update | reentry | plan_result | summary | error", "data": {}, "timestamp": 0 }
```

- `data` differs per `type` — see `docs/CONTRACT.md` and the ready-made example of every message in `shared/examples/`.
- `user_action` covers every button in the app: `plan`, `start_session`, `step_done`, `dismiss`, `relevant`, `break`, `resume`, `park`, `end_session`.
- There's no separate `nudge` message — the current nudge, if any, lives inside `session_update.active_nudge`.

Adding a new optional field or message type is fine without a team meeting. Changing or removing something needs all three of you to agree first (contract §7).

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
