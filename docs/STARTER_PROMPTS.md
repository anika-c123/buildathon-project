# Starter Prompts for Claude Code

Copy-paste these as your first messages in Claude Code. Each one points Claude at the contract so it builds the right thing. Send them one at a time and let Claude finish each before the next.

**Every work session, start with:**

> Pull the latest changes from GitHub, then tell me in plain English what my teammates changed since last time.

**Every time something works, end with:**

> Commit and push my changes with a clear message. Only include files in my folder.

---

## First hour — whoever sets up (usually Brain)

> Read CLAUDE.md, docs/CONTRACT.md, and docs/ARCHITECTURE.md. Then set up the backend skeleton in backend/: a FastAPI server on port 8000 with the four endpoints from the contract (/health, /event, /state, /ws), allowing requests from localhost:5173 and Chrome extensions. /state should return the idle session from shared/examples/session_update_idle.json for now. Add requirements.txt. Explain each step in plain English before you do it, then start the server and show me that /health works.

> Now write backend/fake_events.py. It should replay the demo story from docs/BUILD_PLAN.md by posting the example messages in shared/examples/ to /event, a few seconds apart, and print what it sends. Run it to show me it works.

---

## Brain — backend and extension

**Prompt 1: session state**

> I'm the Brain. Read docs/CONTRACT.md sections 4–6. Build the session state in backend/: handle every user_action in the contract, keep the session_update snapshot exactly in the contract's shape, and push it to everyone connected to /ws whenever it changes and every 5 seconds. Test it by sending the action examples from shared/examples/ and showing me /state after each one.

**Prompt 2: AI relevance check**

> Add the relevance check in backend/relevance.py. When a tab_change arrives during a session, ask Claude (using the ANTHROPIC_API_KEY from .env) whether the domain and title fit the goal: relevant, unrelated, or uncertain. Send only the goal, domain, and title — never anything else. Save answers by goal + domain + title so the same page is never checked twice. If the AI takes over 5 seconds or fails, use uncertain and send an error message. Show me three test results: Java docs, Instagram, and a vague page.

**Prompt 3: nudge rules**

> Add the nudge rules in backend/nudges.py exactly as in contract section 6, with the normal and demo-mode timings. Include phone nudges, cooldown, dismiss, "this is relevant", reentry messages, and camera silence → unknown. Write 4–5 friendly wordings per nudge reason and rotate them — never shaming. Then run fake_events.py and show me each nudge decision as it happens.

**Prompt 4: Chrome extension**

> Build the Chrome extension in extension/ (Manifest V3). It should report the active tab's domain (not the full address) and title, plus whether Chrome is focused, by posting tab_change to localhost:8000/event. It should check /state every 5 seconds and only send while status is studying or break. Then walk me through loading it in Chrome step by step.

**Prompt 5: steps and summary**

> Add the plan action (AI splits the goal into 3–5 short steps, returned as plan_result) and the end-of-session summary from the contract, with a one-sentence encouraging note written by the AI.

---

## Eyes — camera and hardware

**Prompt 1: camera feed**

> I'm the Eyes. Read CLAUDE.md and docs/CONTRACT.md section 4 (camera_state). In vision/, write a Python program that opens my camera with OpenCV and shows a live preview window. Help me find the right camera number if I have more than one. Add requirements.txt and explain how to install and run it in plain English.

**Prompt 2: present / away / phone**

> Add detection in vision/detect.py using a pretrained YOLO model (the ultralytics package) that already knows "person" and "cell phone". Decide each frame: present (person or hands visible), away (desk empty), or phone_in_hand (a phone that's raised or moving, not lying flat and still on the desk). Draw the current state and boxes on the preview window. Explain how the phone-in-hand rule works so I can tune it.

**Prompt 3: smoothing and sending**

> Add smoothing so a state must hold for about 2 seconds before it counts. Then send camera_state messages to localhost:8000/event exactly as in the contract: when the state changes, and every 5 seconds as a heartbeat. If the backend isn't running, keep going and retry quietly. Never save or send any images. Test it against the backend and show me the messages arriving.

**Prompt 4: setup checklist**

> Write vision/SETUP.md: a step-by-step checklist for mounting the camera and projector, connecting the GoPro in webcam mode (with a USB webcam backup), and checking lighting. Keep it short enough to follow under pressure at the venue.

---

## Face — app and projector view

**Prompt 1: app skeleton and connection**

> I'm the Face. Read CLAUDE.md, docs/CONTRACT.md, and docs/ARCHITECTURE.md. In app/, create a React app with Vite that runs on port 5173 with two pages: / (control screen) and /desk (projector view). Write src/connection.js: it connects to ws://localhost:8000/ws, keeps the latest session_update, reconnects automatically if the connection drops, and has a sendAction(action, fields) helper that posts user_action messages to /event. Show "Connecting…" when the backend is off. Explain each step in plain English.

**Prompt 2: control screen**

> Build the control screen: a goal text box, a "Suggest steps" button (sends plan, fills in the steps from plan_result), an editable step list, a minutes box, a demo mode toggle, and a Start button (sends start_session). While studying, show End session. After the session, show the summary. Test it using the example files in shared/examples/ if the backend isn't ready.

**Prompt 3: desk view**

> Build the desk view for the projector: dark background, large light text, calm colors (red is okay for a nudge, as long as it still feels gentle). Show the current step big, time as a shrinking bar instead of numbers, and progress dots for the steps. When active_nudge is set, show it as a gentle card with three buttons: Back to work (dismiss), Break, and This is relevant. Show reentry messages for 8 seconds. Add a step done button with a small celebration animation, a break screen, and a one-tap parking lot (park action) with saved thoughts listed small at the edge. It must be readable from a meter away.

**Prompt 4: test with fake data**

> Run the app with the backend and fake_events.py together, and check every screen against the examples in shared/examples/. List anything that doesn't match the contract.

---

## When something's wrong

> Something isn't working: [describe what you see]. Read docs/CONTRACT.md and figure out whether the problem is in my part or in the messages another part sends. Don't change files outside my folder — if it's someone else's part, tell me exactly what to tell them.

> I want to change the contract: [describe]. Tell me whether this is an "adding" change or a "changing" change under contract section 7, and what I need to tell the team.
