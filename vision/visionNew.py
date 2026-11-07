"""FlowDesk camera module: simulation, laptop webcam, or GoPro webcam.

Opt-in only. No video is saved or sent to the backend.
Camera states are imperfect estimates, not proof of distraction.
"""
import argparse
import json
import math
from pathlib import Path
from urllib.request import urlretrieve
import time
from collections import deque
from urllib.request import Request, urlopen
from urllib.error import URLError


def post_event(url, payload):
    request = Request(url, data=json.dumps(payload).encode("utf-8"),
                      headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=2) as response:
            return 200 <= response.status < 300
    except (URLError, TimeoutError, OSError) as exc:
        print(f"Backend not available: {exc}")
        return False


def event(session_id, presence, phone_visible, possible_held):
    return {
        "type": "camera.state",
        "session_id": session_id,
        "data": {
            "presence": presence,
            "phone_visible": phone_visible,
            "phone_held_estimate": possible_held,
        },
    }


def deliver(payload, args):
    print(json.dumps(payload))
    if args.backend:
        post_event(args.backend.rstrip("/") + "/api/camera", payload)


def run_demo(args):
    print("Simulation: no webcam or AI downloads required. Ctrl+C to quit.")
    samples = [
        ("present", False, False),
        ("present", True, False),
        ("present", True, True),
        ("away", False, False),
    ]
    try:
        while True:
            for presence, visible, held in samples:
                deliver(event(args.session_id, presence, visible, held), args)
                time.sleep(2)
    except KeyboardInterrupt:
        print("Stopped")


def phone_close_to_hand(phone_box, wrist, frame_width, frame_height):
    """Rough 2D proximity of a hand landmark to a phone; not proof of phone use."""
    x1, y1, x2, y2 = phone_box
    x, y = wrist
    if x <= 0 or y <= 0:
        return False
    # Distance between wrist and nearest point on phone box.
    nearest_x = min(max(x, x1), x2)
    nearest_y = min(max(y, y1), y2)
    distance = math.hypot(x - nearest_x, y - nearest_y)
    threshold = max(35, 0.065 * math.hypot(frame_width, frame_height))
    return distance < threshold


def run_camera(args):
    try:
        import cv2
        import numpy as np
        import mediapipe as mp
        from ultralytics import YOLO
    except ImportError as exc:
        raise SystemExit("Install dependencies first: python -m pip install -r requirements.txt") from exc

    print("Loading pretrained AI models (first run can download weights)...")
    objects = YOLO("yolo11n.pt")
    model_file = Path(__file__).with_name("hand_landmarker.task")
    if not model_file.exists():
        print("Downloading MediaPipe hand model (once)...")
        urlretrieve(
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
            "hand_landmarker/float16/1/hand_landmarker.task",
            model_file,
        )

    BaseOptions = mp.tasks.BaseOptions
    HandLandmarker = mp.tasks.vision.HandLandmarker
    HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
    RunningMode = mp.tasks.vision.RunningMode
    options = HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_file)),
        running_mode=RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.35,
        min_hand_presence_confidence=0.35,
        min_tracking_confidence=0.4,
    )
    hand_landmarker = HandLandmarker.create_from_options(options)
    start_time = time.monotonic()
    last_timestamp = -1

    capture = cv2.VideoCapture(args.camera)
    if not capture.isOpened():
        raise SystemExit(f"Cannot open camera {args.camera}. Try --camera 1, or --demo.")

    recent_present = deque(maxlen=8)
    recent_visible = deque(maxlen=8)
    recent_held = deque(maxlen=8)
    last_emit = 0.0
    last_payload = None
    frame_counter = 0
    latest = ("unknown", False, False)

    print("Camera running. Press Q in preview to quit or Ctrl+C in terminal.")
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                print("Camera stopped returning frames")
                break
            frame_counter += 1
            height, width = frame.shape[:2]

            # Infer every N frames to keep CPU use manageable.
            if frame_counter % args.every == 0:
                detected = objects.predict(frame, conf=0.35, imgsz=640, verbose=False)[0]
                phones = []
                people = False
                for box in detected.boxes:
                    label = detected.names[int(box.cls.item())]
                    if label == "cell phone":
                        phones.append(tuple(float(v) for v in box.xyxy[0].tolist()))
                    elif label == "person":
                        people = True

                # MediaPipe tracks hands even if the person's torso is out of view.
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB,
                                    data=np.ascontiguousarray(rgb))
                timestamp_ms = max(last_timestamp + 1,
                                   int((time.monotonic() - start_time) * 1000))
                last_timestamp = timestamp_ms
                result = hand_landmarker.detect_for_video(mp_image, timestamp_ms)
                hand_points = []
                for landmarks in result.hand_landmarks:
                    # Include wrist, palm, thumb, index, middle finger points.
                    for point_id in (0, 1, 4, 5, 8, 9, 12, 13, 17):
                        landmark = landmarks[point_id]
                        hand_points.append((landmark.x * width, landmark.y * height))

                held = any(phone_close_to_hand(box, point, width, height)
                           for box in phones for point in hand_points)
                visible = bool(phones)
                # For overhead-only shots a person may not be detected.
                # Treat lack of a person as unknown unless the user enabled
                # reliable person-in-frame setup.
                presence = "present" if (people or hand_points) else "unknown"

                recent_present.append(presence == "present")
                recent_visible.append(visible)
                recent_held.append(held)

                smooth_present = sum(recent_present) >= max(2, len(recent_present) // 2 + 1)
                smooth_visible = sum(recent_visible) >= max(2, len(recent_visible) // 2 + 1)
                smooth_held = sum(recent_held) >= max(2, len(recent_held) // 2 + 1)
                latest = ("present" if smooth_present else "unknown", smooth_visible, smooth_held)

                if args.draw:
                    for x1, y1, x2, y2 in phones:
                        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 220, 220), 2)
                    for wx, wy in hand_points:
                        if wx > 0 and wy > 0:
                            cv2.circle(frame, (int(wx), int(wy)), 6, (0, 255, 0), -1)

            now = time.monotonic()
            payload = event(args.session_id, *latest)
            if payload != last_payload or now - last_emit >= args.interval:
                deliver(payload, args)
                last_payload = payload
                last_emit = now

            if not args.no_window:
                cv2.putText(frame, f"Presence: {latest[0]}  Phone: {latest[1]}  Near hand: {latest[2]}",
                            (15, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (0, 255, 0), 2)
                cv2.imshow("FlowDesk Vision (Q to quit)", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    except KeyboardInterrupt:
        print("Stopped")
    finally:
        capture.release()
        hand_landmarker.close()
        if not args.no_window:
            cv2.destroyAllWindows()


def main():
    parser = argparse.ArgumentParser(description="FlowDesk local camera detection")
    parser.add_argument("--demo", action="store_true", help="Use fake states without camera")
    parser.add_argument("--camera", type=int, default=0, help="Camera number; 0 usually laptop webcam")
    parser.add_argument("--backend", default=None, help="Send states to this backend URL, e.g. http://127.0.0.1:8000")
    parser.add_argument("--session-id", default="demo-001", help="Session identifier from FlowDesk app")
    parser.add_argument("--interval", type=float, default=2.0, help="Seconds between repeated reports")
    parser.add_argument("--every", type=int, default=5, help="Analyze every Nth frame")
    parser.add_argument("--no-window", action="store_true", help="Disable camera preview")
    parser.add_argument("--draw", action="store_true", help="Show raw phone and wrist positions on analyzed frames")
    args = parser.parse_args()
    if args.every < 1 or args.interval <= 0:
        parser.error("--every must be >= 1 and --interval must be > 0")
    if args.demo:
        run_demo(args)
    else:
        run_camera(args)


if __name__ == "__main__":
    main()
