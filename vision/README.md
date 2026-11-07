# PLocked Vision — hand detection fix

This version replaces whole-body YOLO pose wrist detection with MediaPipe Hand Landmarker, while keeping YOLO phone detection. It is an untested camera integration; detection quality depends on lighting and camera position.

## Mac instructions

Open this folder in VS Code and use a terminal:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python vision.py --demo
python vision.py --camera 0 --draw
```

Try `--camera 1` or `2` if your GoPro uses a different camera index. Press **Q** with the camera window selected to quit.

The first camera run downloads `yolo11n.pt` and `hand_landmarker.task` (requires internet). If the hand model download fails, save Google's MediaPipe Hand Landmarker model as `hand_landmarker.task` next to `vision.py`.

To send events to a locally running backend:

```bash
python vision.py --camera 0 --draw --backend http://127.0.0.1:8000
```

Events are sent as `POST /event`, in the exact `camera_state` shape from `docs/CONTRACT.md` §4: `{"v": 1, "source": "vision", "type": "camera_state", "data": {"state": ..., "confidence": ...}, "timestamp": ...}`.

By default, an empty frame (no person or hands seen for 2 seconds) is reported as `away` — E2's requirement. If your camera only sees part of the desk and hands legitimately leave frame while the student is still there, pass `--no-away-detection` to disable this and let the backend's own 15-second silence timeout handle it instead.

`state` is one of `present`, `away`, `phone_in_hand`. `phone_in_hand` requires the phone to actually move while at least two hand landmarks are on it (not just a phone resting near a hand) — still a 2D heuristic, not a verified indication of phone use, but it should no longer flag a phone sitting flat on the desk. `state` may stay `unknown` locally (not sent — the contract doesn't have an `unknown` camera_state) if the camera can't see hands or a person and `--no-away-detection` is set. Video is not saved or uploaded by this script. Enable monitoring only with the user's consent and only during an active session.

Tuning flags if detection feels off: `--absence-grace` (seconds of nothing seen before `away`, default 2), `--pickup-motion` / `--motion-window` / `--release-grace` (how much phone movement counts as a pickup, and how long contact can hold it). Run `python vision.py --help` for the full list.

Do not commit `.venv/`, `*.pt`, or `*.task` to GitHub.
