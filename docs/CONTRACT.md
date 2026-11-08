# PLocked Team Contract

This is the agreement that lets three people build three parts at the same time without breaking each other's work. If your part follows this file, it will plug into the others.

**The golden rule:** you can build your part however you like *inside* your folder. What you can't change on your own is anything in this file: the addresses, the message shapes, and the timings.

---

## 1. Who owns what

| Folder | Owner | Others may... |
| --- | --- | --- |
| `backend/`, `extension/` | **Brain** | Read only |
| `vision/` | **Eyes** | Read only |
| `app/` | **Face** | Read only |
| `docs/`, `shared/`, `CLAUDE.md`, `README.md`, `.gitignore`, `.env.example` | **Everyone, by agreement** | Change only after telling the team |

If you need something changed in someone else's folder, ask them. Don't edit it yourself, even if it's a one-line fix.

---

## 2. Addresses (where things live on the laptop)

Everything runs on one laptop. "localhost" just means "this computer."

| What | Address | Owner |
| --- | --- | --- |
| Backend | `http://localhost:8000` | Brain |
| Live updates for the app | `ws://localhost:8000/ws` | Brain |
| Control app (laptop screen) | `http://localhost:5173/` | Face |
| Desk view (projector, full-screen) | `http://localhost:5173/desk` | Face |

### Backend doors ("endpoints")

An endpoint is a specific door on the backend that a program knocks on.

| Door | Who uses it | What it does |
| --- | --- | --- |
| `POST /event` | Extension, Vision, App | Send one message (format below). Reply: `{"ok": true}`, or an error with status 400 if the message is malformed. |
| `GET /state` | Extension, App, anyone debugging | Returns the current session snapshot (same as `session_update` data). |
| `WS /ws` | App only | A live connection. On connect, the backend immediately sends a `session_update`, then pushes every outgoing message as it happens. |
| `GET /health` | Anyone | Returns `{"ok": true}` if the backend is running. |

**In plain English:** everyone *sends* by posting to `/event`. Only the app *listens* on the live connection. This keeps the extension and camera code simple: they just send and forget.

The backend must allow requests from `http://localhost:5173` and from Chrome extensions (this setting is called CORS: the backend's guest list of who may talk to it).

---

## 3. The message envelope

Every message, in both directions, has the same outer shape:

```json
{
  "v": 1,
  "source": "extension",
  "type": "tab_change",
  "data": { },
  "timestamp": 1762540000000
}
```

| Field | Meaning |
| --- | --- |
| `v` | Contract version. Always `1` unless the team agrees on a breaking change. |
| `source` | Who sent it: `extension`, `vision`, `app`, or `backend`. |
| `type` | What kind of message (lists below). |
| `data` | The details, different for each type. |
| `timestamp` | When it happened, in milliseconds since 1970. In JavaScript: `Date.now()`. In Python: `int(time.time() * 1000)`. |

Ready-made example of every message: `shared/examples/`.

---

## 4. Messages sent TO the backend

### `tab_change` — from the extension

Sent when the active tab changes, the page title changes, or Chrome gains or loses focus.

```json
{ "domain": "youtube.com", "title": "Java Tutorial for Beginners", "focused": true }
```

- `domain`: the site name only (e.g. `youtube.com`). **Never the full web address.**
- `title`: the text shown on the tab.
- `focused`: `false` when the user switched away from Chrome. Then `domain` and `title` may be `null`.
- **Privacy:** the extension checks `GET /state` about every 5 seconds and sends `tab_change` only when `status` is `"studying"` or `"break"`. When there's no session, it sends nothing.

### `camera_state` — from vision

```json
{ "state": "phone_in_hand", "confidence": 0.82 }
```

- `state`: exactly one of `present`, `away`, `phone_in_hand`.
- `confidence`: 0 to 1, how sure the detector is.
- Send when the state changes (after it has held steady for about 2 seconds, so it doesn't flicker), **and** at least every 5 seconds as a heartbeat ("still here") — while the camera is open, i.e. only during `studying` (see below).
- If the backend hears nothing from vision for 15 seconds while `studying`, it treats the camera as `unknown` and carries on with the browser alone. **A camera hiccup never breaks PLocked.**
- Vision checks `GET /state` every 2 seconds. It opens the camera and sends `camera_state` only while `status` is `"studying"`. During `idle`, `break`, and `ended`, it releases the camera, sends nothing, and keeps checking.
- When a session starts or a break ends, vision reopens the camera within a few seconds. Until its first message arrives, the backend shows the camera as `unknown`. That's expected, not an error.
- The backend ignores any `camera_state` received while `status` isn't `"studying"`.
- Vision never saves or sends images. Frames are analyzed and immediately discarded.
- Fallback, only if reopening the GoPro proves unreliable: vision may keep the connection open but must discard every frame unread outside `studying`. Eyes decides this after testing and tells the team.

### `user_action` — from the app

Every button press in the app is one `user_action`. The `action` field says which.

| `action` | Extra fields | What the backend does |
| --- | --- | --- |
| `plan` | `goal` | Asks the AI to split the goal into 3–5 steps, replies with `plan_result` |
| `start_session` | `goal`, `steps` (list of text), `minutes`, `demo_mode` (true/false) | Starts studying |
| `step_done` | — | Marks the current step done, moves to the next |
| `dismiss` | `nudge_id` | Hides the nudge, starts the cooldown |
| `relevant` | `nudge_id` | Hides the nudge and treats this site as on-task for the rest of the session |
| `break` | `minutes` (optional, default 5) | Pauses: no nudges during the break |
| `resume` | — | Ends the break, sends a `reentry` |
| `park` | `text` | Adds a thought to the "later" list |
| `end_session` | — | Ends the session, sends a `summary` |
| `set_display` | any of `theme` (`"dark"`/`"light"`), `showTimer`, `showTree`, `showQuote` (true/false) — only send the ones changing | Updates the desk's display settings, replies with `display_settings`. Not part of a session — survives `start_session`/`end_session`. |

Example:

```json
{ "action": "start_session", "goal": "Finish my Java assignment", "steps": ["Read the requirements", "Write the insert method", "Test it", "Submit"], "minutes": 60, "demo_mode": true }
```

---

## 5. Messages sent FROM the backend (to the app, over `/ws`)

### `session_update` — the full picture

The backend sends the **whole** current state every time anything changes, plus every 5 seconds. The app just draws whatever the latest one says. It never has to work anything out itself.

```json
{
  "status": "studying",
  "goal": "Finish my Java assignment",
  "steps": [
    { "text": "Read the requirements", "done": true },
    { "text": "Write the insert method", "done": false },
    { "text": "Test it", "done": false },
    { "text": "Submit", "done": false }
  ],
  "current_step": 1,
  "started_at": 1762540000000,
  "ends_at": 1762543600000,
  "break_ends_at": null,
  "demo_mode": true,
  "parked": [ { "text": "Email my TA", "timestamp": 1762540300000 } ],
  "activity": { "domain": "docs.oracle.com", "title": "HashMap (Java SE 21)", "label": "relevant", "since": 1762540500000 },
  "camera": { "state": "present", "since": 1762540100000 },
  "active_nudge": null
}
```

| Field | Values |
| --- | --- |
| `status` | `idle` (no session), `studying`, `break`, `ended` |
| `current_step` | Index of the step being worked on, counting from 0. `-1` when all are done. |
| `activity.label` | `relevant`, `unrelated`, `uncertain`, or `unknown` (not checked yet, or Chrome not focused) |
| `camera.state` | `present`, `away`, `phone_in_hand`, or `unknown` (no camera messages for 15 s) |
| `active_nudge` | `null`, or `{ "id": "n3", "reason": "unrelated_tab", "message": "Ready to get back to your Java assignment?" }` |

`active_nudge.reason` is one of `unrelated_tab`, `phone`, `long_stretch` (time for a break). The app shows `message` exactly as given. The backend writes the wording and rotates it so it doesn't feel repetitive.

The desk view shows a small "camera on" dot when `status` is `"studying"` and `camera.state` is not `"unknown"` — the one visible sign that PLocked is watching.

### `reentry` — welcome back

Sent when the student returns from a nudge, a break, or being away. The app shows it for about 8 seconds.

```json
{ "message": "Welcome back — you were on step 2: Write the insert method", "step_text": "Write the insert method" }
```

### `plan_result` — the AI's suggested steps

```json
{ "steps": ["Read the requirements", "Write the insert method", "Test it", "Submit"] }
```

### `summary` — end of session

```json
{ "minutes_studied": 52, "steps_done": 3, "steps_total": 4, "nudges": 3, "nudges_dismissed": 1, "breaks": 1, "parked": ["Email my TA"], "note": "Strong session — you got back on track quickly after each detour." }
```

### `error` — something went wrong

```json
{ "message": "AI service didn't respond; treating the site as uncertain." }
```

### `display_settings` — the desk's current display settings

Sent right after connecting (so a freshly-opened screen, on any device, sees the current choice immediately), and again whenever `set_display` changes something. Every open screen — the laptop and the desk view, even on a different device on the same network — gets the same values. Not part of `session_update`: it isn't reset when a session starts or ends.

```json
{ "theme": "dark", "showTimer": true, "showTree": true, "showQuote": true }
```

---

## 6. Timings (when nudges happen)

The backend owns these numbers. Demo mode makes everything happen within seconds on stage.

| Rule | Normal | Demo mode |
| --- | --- | --- |
| Unrelated site before a nudge | 120 s | 8 s |
| Phone in hand before a nudge | 90 s | 6 s |
| Wait between nudges (cooldown) | 180 s | 15 s |
| Away before it counts as away | 60 s | 5 s |
| Long stretch before a break prompt | 50 min | 3 min |
| Camera silence before `unknown` | 15 s | 15 s |

Decision rules:
- `uncertain` sites **never** cause a nudge.
- A phone lying on the desk is not `phone_in_hand`. Only a held phone counts.
- No nudges during a break or when there is no session.
- Only one nudge on screen at a time.
- A site marked `relevant` by the student is never nudged again that session.
- No camera-based nudges (phone or away) while `camera.state` is `"unknown"`.
- A break pauses both nudges and camera watching.

---

## 7. How to change this contract

**Adding** something new (a new optional field, a new message type) is fine without a meeting. In the same commit, update this file and add or update the example in `shared/examples/`, then tell the team in your group chat. Receivers must ignore fields and types they don't recognize, so additions never break anyone.

**Changing or removing** something (renaming a field, changing what a value means, changing an address) needs all three of you to agree first. Then the owner makes the change and everyone updates their part.

---

## 8. Working habits that prevent breakage

- **Start of every work session:** tell Claude Code "pull the latest changes." (Pulling = downloading your teammates' newest work.)
- **Stay in your folder.** Different folders means your saves never collide with someone else's.
- **Save small and often:** "commit and push my changes" after each thing that works. (Commit = save a checkpoint. Push = upload it.)
- **Never push something that won't start.** If your part crashes on launch, fix it first or don't push yet.
- **Test against fake messages** (`backend/fake_events.py` and `shared/examples/`) before testing with real teammates' parts.
- **Never commit the `.env` file.** It holds the AI password. `.gitignore` already blocks it. Copy `.env.example` to `.env` and fill it in on your own laptop.
