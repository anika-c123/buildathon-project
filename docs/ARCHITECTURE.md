# How PLocked's Software Fits Together

PLocked is four small programs running on one laptop. They never talk to each other directly. They all talk through the **backend**, which is the only part that makes decisions.

```
   SENDERS (report what they see)            DECIDER                 SHOWER
 ┌──────────────────────────┐
 │ Chrome extension (Brain) │──tab_change──┐
 │ "which site is open?"    │              │
 └──────────────────────────┘              ▼
 ┌──────────────────────────┐      ┌───────────────────┐      ┌──────────────────────┐
 │ Vision (Eyes)            │─────▶│ Backend (Brain)   │─────▶│ App (Face)           │
 │ "at desk? phone in hand?"│camera│ · session state   │ live │ · control screen     │
 └──────────────────────────┘_state│ · AI relevance    │updates│   on the laptop      │
                                   │ · nudge rules     │ /ws  │ · desk view on the   │
 ┌──────────────────────────┐      │ · task breakdown  │      │   projector          │
 │ App buttons (Face)       │─────▶│ · summary         │      └──────────────────────┘
 │ start, done, break, park │user_ └─────────┬─────────┘
 └──────────────────────────┘action          │ site name + title only
                                             ▼
                                   ┌───────────────────┐
                                   │ AI service (Claude)│
                                   └───────────────────┘
```

**The simple version:** the extension and camera are reporters, the backend is the referee, and the app is the scoreboard.

---

## The four programs

### 1. Backend — the referee (Brain, `backend/`)

A Python program that runs in the background. It:

- **Remembers the session:** the goal, the steps, which step you're on, the timer, the parked thoughts.
- **Asks the AI about each website:** "The goal is *Finish my Java assignment*. The page is *youtube.com — Java Tutorial for Beginners*. Relevant, unrelated, or uncertain?" It saves each answer so it never asks twice.
- **Applies the nudge rules:** how long something has lasted, whether a nudge was shown recently, whether you're on a break.
- **Tells the app what to show** by sending it the full current picture every time something changes.

Built with **FastAPI**, a popular Python toolkit for making small web servers, and the **Anthropic API** (how code talks to Claude).

### 2. Chrome extension — the browser reporter (Brain, `extension/`)

A small add-on loaded into Chrome. When you switch tabs, it sends the site name and tab title to the backend. Only during a session, and never the full web address or page contents.

### 3. Vision — the camera reporter (Eyes, `vision/`)

A Python program that watches the camera feed and decides, a few times a second, whether you're **present**, **away**, or holding a **phone**. It sends only that one word (plus how sure it is), never pictures.

Built with **OpenCV** (reads the camera) and **YOLO** (a ready-made AI that recognizes everyday objects, including cell phones and people).

### 4. App — the scoreboard (Face, `app/`)

A web page with two screens:

- **Control screen** (`localhost:5173/`, on the laptop): type the goal, edit steps, start and end the session, see the summary.
- **Desk view** (`localhost:5173/desk`, full-screen on the projector): the current step, the shrinking time bar, progress, nudges, the welcome-back cue, and the parking lot.

The app doesn't decide anything. It draws whatever the backend's latest message says, and turns button presses into messages.

Built with **React** (a toolkit for building web screens) and **Vite** (a tool that runs it locally and refreshes it as you edit).

---

## One moment, step by step: "I open Instagram"

1. You switch to an Instagram tab.
2. The **extension** posts `tab_change` → `{domain: "instagram.com", title: "Instagram"}`.
3. The **backend** checks its saved answers. It hasn't seen this one, so it asks the AI, which says **unrelated**. It saves that answer.
4. The backend starts a timer. Nothing happens yet.
5. 120 seconds later (8 in demo mode), you're still there and no nudge was shown recently, so the backend sets `active_nudge` and sends a `session_update`.
6. The **app's desk view** receives it and shows "Ready to get back to your Java assignment?" on the desk.
7. You go back to your assignment tab. The extension reports it, the backend clears the nudge and sends a `reentry`, and the desk shows "Welcome back — you were on step 2."

The phone works the same way, except step 2 comes from **vision** (`camera_state: phone_in_hand`) and no AI call is needed.

---

## Folder layout

```
buildathon-project/
├── CLAUDE.md              Briefing Claude Code reads every session
├── README.md              How to run everything
├── .env.example           Template for the AI password (copy to .env)
├── docs/
│   ├── CONTRACT.md        The rules everyone builds to
│   ├── ARCHITECTURE.md    This file
│   ├── BUILD_PLAN.md      Who does what, in what order
│   └── STARTER_PROMPTS.md First messages to give Claude Code
├── shared/examples/       One example file for every message type
├── backend/               Brain
│   ├── main.py            The server: /event, /state, /ws, /health
│   ├── session.py         Session state
│   ├── relevance.py       AI check + saved answers
│   ├── nudges.py          Timing rules and nudge wording
│   ├── ai.py              Task breakdown + summary
│   ├── fake_events.py     Sends pretend messages for testing
│   └── requirements.txt   List of Python add-ons to install
├── extension/             Brain
│   ├── manifest.json      Tells Chrome what the extension is
│   └── background.js      Watches tabs, posts tab_change
├── vision/                Eyes
│   ├── camera.py          Main loop: read camera → detect → send
│   ├── detect.py          Present / away / phone-in-hand logic
│   └── requirements.txt
└── app/                   Face
    └── src/
        ├── connection.js  Live connection to the backend + sendAction()
        ├── Control.jsx    Laptop control screen
        └── Desk.jsx       Projector view
```

Files inside each role's folder are suggestions. The owner can organize their folder however they like, as long as it follows the contract.

---

## Running it all

Four windows, one per program. Claude Code can start each for you if you ask "start my part."

| Window | Folder | Start command |
| --- | --- | --- |
| 1 | `backend/` | `uvicorn main:app --port 8000 --reload` |
| 2 | `vision/` | `python camera.py` |
| 3 | `app/` | `npm run dev` |
| 4 | Chrome | Load `extension/` once at `chrome://extensions` → Developer mode → Load unpacked |

Then open `localhost:5173` on the laptop and drag `localhost:5173/desk` to the projector screen in full-screen.
