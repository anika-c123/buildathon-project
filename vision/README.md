# FlowDesk Vision — hand detection fix

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

Events are sent to `/api/camera` with the original `camera.state` JSON structure.

**Caveat:** `phone_held_estimate` is based on 2D proximity between hand landmarks and phone bounding boxes. It is not a verified indication of phone use. `presence` may be `unknown` if the camera can't see hands or the person. Video is not saved or uploaded by this script. Enable monitoring only with the user's consent and only during an active session.

Do not commit `.venv/`, `*.pt`, or `*.task` to GitHub.
