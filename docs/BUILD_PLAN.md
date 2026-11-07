# PLocked Build Plan

Three people, four phases, five checkpoints. Each phase ends with a checkpoint the whole team verifies together before moving on.

The plan uses checkpoints instead of clock times because we don't know how long every task takes. As a rough guide, if you have 24 hours: Phase 0 ≈ 1–2 h, Phase 1 ≈ 10 h, Phase 2 ≈ 6 h, Phase 3 ≈ 4 h, with sleep and buffer around it. **If you're behind, cut from the "Nice to have" lists, never from integration or demo time.**

Read first: `docs/CONTRACT.md` (the rules) and `docs/ARCHITECTURE.md` (how it fits together).

---

## Roles

| Role | Owns | Their part is "done" when... |
| --- | --- | --- |
| **Brain** | `backend/`, `extension/` | The backend makes the right nudge decisions from real tab and camera messages |
| **Eyes** | `vision/`, the physical setup | The camera reliably reports present / away / phone in hand, and the projector and camera are mounted |
| **Face** | `app/`, the demo script, the pitch | A judge can watch the desk and understand what's happening without explanation |

---

## Phase 0 — Set up together (everyone, one laptop)

Goal: everyone can run something, and everyone builds to the same contract.

| # | Task | Who | Done when |
| --- | --- | --- | --- |
| 0.1 | Everyone reads `CONTRACT.md` together; change anything you disagree with now | All | All three say "I can build to this" |
| 0.2 | Install the Claude desktop app; clone the repo (download a copy) | All | Each person sees the repo files in Claude Code |
| 0.3 | Get an Anthropic API key; each person copies `.env.example` to `.env` and pastes it in | Brain | `.env` exists on each laptop and is **not** on GitHub |
| 0.4 | Backend skeleton: `/health`, `/event`, `/state`, `/ws` with a fake session state | Brain | `localhost:8000/health` shows `{"ok": true}` in a browser |
| 0.5 | `fake_events.py`: replays the demo story (relevant tab → unrelated tab → phone → back) | Brain | Running it makes the backend print each message |
| 0.6 | Hardware check: GoPro webcam mode works on the demo laptop (or USB webcam backup), projector shows the laptop screen over HDMI | Eyes | A camera window opens in Python; the projector shows a test page |
| 0.7 | App skeleton: two pages (`/` and `/desk`) that print the latest `session_update` | Face | Desk page shows the goal text from the fake session |
| 0.8 | Create a group chat for "contract changes" announcements | Face | Chat exists |

**✅ Checkpoint 0:** Backend runs. The app shows the fake goal. A camera window opens. Everything is pushed to GitHub.

---

## Phase 1 — Build in parallel

Everyone works in their own folder, testing against fake messages (`fake_events.py` and `shared/examples/`). Do the **Must have** list top to bottom before touching **Nice to have**.

### Brain — `backend/` and `extension/`

**Must have**

| # | Task | Done when |
| --- | --- | --- |
| B1 | Session state: handles `start_session`, `step_done`, `break`, `resume`, `park`, `end_session`; sends `session_update` on every change and every 5 s | Clicking through the actions with a test script changes `/state` correctly |
| B2 | Relevance check: goal + domain + title → `relevant` / `unrelated` / `uncertain` via Claude; answers saved (cached) by goal + domain + title | Java docs → relevant, Instagram → unrelated, a vague page → uncertain; the same page twice makes only one AI call |
| B3 | If the AI fails or is slow (over 5 s), label the site `uncertain` and send an `error` | Turning off Wi-Fi doesn't crash anything |
| B4 | Nudge rules from Contract §6, with demo mode | With demo mode on, Instagram for 8 s produces `active_nudge`; uncertain sites never do |
| B5 | Phone rule: `phone_in_hand` for 6 s (demo) → nudge with reason `phone` | `fake_events.py` phone scene produces a nudge |
| B6 | `dismiss` and `relevant` handling; `relevant` sites never nudged again this session | Marking Instagram relevant stops its nudges |
| B7 | `reentry` message after a nudge clears, a break ends, or the student returns from away | Fake "back to work" scene produces a `reentry` |
| B8 | Camera silence for 15 s → camera `unknown`, browser rules keep working | Stopping vision doesn't break nudges |
| B9 | Chrome extension: reports active tab domain + title + focus; polls `/state` and only sends during a session | Switching tabs during a session shows `tab_change` in the backend log; nothing is sent when idle |
| B10 | Task breakdown: `plan` → `plan_result` with 3–5 steps | Typing "Finish my Java assignment" returns sensible steps |
| B11 | Nudge wording: 4–5 friendly variations per reason, rotated | Three nudges in a row use different wording |
| B15 | Ignore `camera_state` outside `studying`; no camera nudges while the camera is `unknown` | Sending camera examples while idle changes nothing in `/state` |

**Nice to have**
- `summary` with an AI-written one-line note (B12)
- `long_stretch` break prompt (B13)
- A small debug page at `localhost:8000/debug` showing the live state (B14)

### Eyes — `vision/` and hardware

**Must have**

| # | Task | Done when |
| --- | --- | --- |
| E1 | Read frames from the camera with OpenCV at a steady rate | Video window runs smoothly for 5 minutes |
| E2 | Person / hands in frame → `present`; empty desk → `away` | Walking away and back flips the state correctly |
| E3 | Phone detection with a pretrained YOLO model (cell phone class) | A phone held over the desk is boxed in the preview window |
| E4 | Phone-in-hand rule: phone detected **and** raised or moving / near a hand, not flat and still on the desk | Phone lying on the desk = `present`; picking it up = `phone_in_hand` |
| E5 | Smoothing: a state must hold about 2 s before it's reported | Brief glitches don't flip the state |
| E6 | Send `camera_state` to `POST /event` on change + every 5 s heartbeat | Backend log shows the messages |
| E7 | A preview window with the current state written on it (for debugging; easy to turn off) | Visible during testing; off for the demo |
| E8 | If the backend is down, keep running and retry quietly | Restarting the backend doesn't crash vision |
| E9 | Mount the camera above the desk and the projector aimed at a fixed zone; mark positions with tape | Setup can be taken down and rebuilt in under 5 minutes |
| E10 | Test under bright and dim lighting with a real notebook and phone | Works in both, or you know which lighting to ask for |
| E13 | Check `/state` every 2 s; open the camera only during `studying`, release it otherwise | Starting a session turns the preview on within a few seconds; break and end session turn it off; nothing is sent while idle |
| E14 | Test releasing and reopening the GoPro 10 times in a row; if it's unreliable, switch to the discard-frames fallback and tell the team | The result is decided |

**Nice to have**
- Writing-motion detection (E11)
- A calibration step that remembers the desk area (E12)

### Face — `app/`

**Must have**

| # | Task | Done when |
| --- | --- | --- |
| F1 | `connection.js`: connects to `/ws`, reconnects automatically if it drops, and a `sendAction(action, fields)` helper that posts to `/event` | Restarting the backend: the app reconnects by itself |
| F2 | Control screen: goal box → "Suggest steps" (`plan`) → editable step list → minutes + demo mode toggle → Start | Starting a session changes `status` to `studying` |
| F3 | Desk view: current step in large text, time as a shrinking bar (not digits), progress dots for steps | Readable from 1 m away when projected |
| F4 | Nudge card on the desk with three buttons: Back to work (`dismiss`), Break, This is relevant | Each button sends the right action |
| F5 | Welcome-back cue: shows `reentry.message` for 8 s | Appears after a nudge clears |
| F6 | Parking lot: one tap opens a text box; saved thoughts listed small at the edge | `park` messages appear in the list |
| F7 | Step done button + small celebration animation | Progress fills and the next step appears |
| F8 | Break screen and end-of-session summary screen | Both display from the example files |
| F9 | Desk design: dark background, light text, big type, calm colors (red is fine for a nudge, kept gentle) | Looks good projected in a bright room |
| F10 | Works with the backend off: shows "Connecting…" instead of crashing | Tested |
| F13 | Small, calm "camera on" dot on the desk view, per the contract rule | It appears after starting a session and disappears on break |

**Nice to have**
- Gentle animation when a nudge appears (F11)
- A growing-plant progress visual (F12)

**✅ Checkpoint 1:** Each part works against fake messages. Run `fake_events.py` and watch the desk view go through the whole story with no real camera or extension.

---

## Phase 2 — Integrate (swap fake for real, one at a time)

Start this as soon as Checkpoint 1 passes. Don't wait to polish. Do it at one desk, together.

| # | Task | Who | Done when |
| --- | --- | --- | --- |
| 2.1 | Real app ↔ real backend (no fake events) | Brain + Face | Starting a session in the app updates the desk view |
| 2.2 | Real extension → backend | Brain | Switching to Instagram produces a nudge on the desk (demo mode) |
| 2.3 | Real vision → backend | Eyes + Brain | Picking up the phone produces a phone nudge on the desk |
| 2.4 | Full story run, start to finish, 3 times in a row | All | No crashes, no false nudges |
| 2.5 | False-nudge hunt: Java docs, notebook writing, sitting still thinking, phone lying flat | All | None of these cause a nudge |
| 2.6 | Tune timings and wording based on what felt annoying | Brain | Team agrees it feels gentle |
| 2.7 | **Feature freeze** | All | From here on: bug fixes only |

**✅ Checkpoint 2:** The full demo story works live, three times in a row, on the real setup.

---

## Phase 3 — Demo and pitch

| # | Task | Who | Done when |
| --- | --- | --- | --- |
| 3.1 | Demo script: one line per scene, who talks, who drives the laptop, who holds the phone | Face | Written and printed |
| 3.2 | Demo reset: a button or action that puts the backend back to a clean state | Brain | One click resets between runs |
| 3.3 | Lock the physical setup; tape marks for camera, projector, notebook, phone | Eyes | Rebuilds in under 5 minutes |
| 3.4 | Record a backup video of a clean run | Brain | Saved on two laptops |
| 3.5 | 3–4 pitch slides: problem → what exists → what PLocked combines → ADHD-first design | Face | Done |
| 3.6 | Rehearse the full pitch + demo at least 3 times, timed | All | Under the time limit with 30 s spare |
| 3.7 | Practice answers to judge questions (below) | All | Each person can answer any of them |
| 3.8 | Optional: put a sliding lens cover on the GoPro and show it in the demo | Eyes | Decided whether to use it; if so, it's visible closed before a session and open during one |

**✅ Checkpoint 3:** Pitch + demo rehearsed three times. Backup video exists.

---

## Demo story (what the judges see)

1. Type "Finish my Java assignment" → Suggest steps → Start (demo mode on). The desk shows step 1 and the time bar.
2. Open Java docs. Nothing happens; it's relevant.
3. Write in the notebook. Nothing happens; you're present.
4. Open Instagram. After 8 s: "Ready to get back to your Java assignment?" on the desk.
5. Close it. "Welcome back — you were on step 1."
6. Pick up the phone and scroll. After 6 s, a phone nudge appears, even though the laptop is idle. **This is the moment that shows why the camera matters.**
7. Put the phone down, tap the parking lot, jot "email my TA."
8. Mark the step done. Celebration, progress fills. End session → summary.

---

## Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| GoPro webcam mode won't work | USB webcam, or a phone used as a webcam (Camo, Iriun, or iPhone Continuity Camera) |
| Projector washed out by venue light | Dark background, larger text; ask for a dimmer spot; demo the desk view on a second monitor if needed |
| AI service slow or down | Sites become `uncertain` (no nudge); pre-warm the cache by visiting demo sites once before presenting |
| Venue Wi-Fi bad | Phone hotspot; AI answers for the demo sites are already cached |
| Phone detection unreliable | Hold the phone up clearly during the demo; better lighting; lower the confidence threshold |
| Something breaks live | Play the backup video and keep talking |
| Running out of time | Cut Nice to have items, then B10 (use fixed steps), never integration or rehearsal |

---

## Judge questions to prepare for

- **"What if you unplug the camera?"** The browser part keeps working. But you'd lose the phone, which is the distraction no browser extension can see.
- **"How is this different from AI focus extensions?"** Those only see the browser. PLocked also sees the phone and shows nudges where you're looking, which is the desk, not the laptop.
- **"Isn't a camera on your desk creepy?"** PLocked only reads the camera during a session you start. Outside a session it doesn't receive video at all, and the desk shows a dot whenever it's watching. Video is never saved or sent anywhere.
- **"Why ADHD?"** Re-entry, time blindness, and getting started are the moments that break study sessions. PLocked is designed around them. It's study support, not a medical claim.
- **"Would anyone buy this?"** Honest answer: we'd test whether the desk nudge beats a laptop pop-up first. A phone-as-camera, software-only version is the realistic first product.
