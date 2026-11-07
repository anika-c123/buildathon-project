"""PLocked Vision (Eyes): local phone/hand tracking and contract-v1 camera events.

Camera is opt-in. No frames are saved or sent; only estimated state is posted.
Usage: python vision.py --camera 1 --draw --backend http://127.0.0.1:8000
"""
import argparse
import json
import math
import time
from collections import deque
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen, urlretrieve


MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
             "hand_landmarker/float16/1/hand_landmarker.task")


def event(state, confidence):
    """Exact PLocked contract v1 camera_state envelope (no image data)."""
    return {
        "v": 1,
        "source": "vision",
        "type": "camera_state",
        "data": {"state": state, "confidence": round(max(0.0, min(1.0, confidence)), 2)},
        "timestamp": int(time.time() * 1000),
    }


def post_event(base_url, payload):
    req = Request(base_url.rstrip("/") + "/event",
                  data=json.dumps(payload).encode("utf-8"),
                  headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=1.5) as response:
            return 200 <= response.status < 300
    except (URLError, TimeoutError, OSError):
        return False


def deliver(payload, args):
    print(json.dumps(payload))
    if args.backend and not post_event(args.backend, payload) and args.verbose_backend:
        print("Backend unavailable (will retry at next heartbeat/change)")


def run_demo(args):
    """Send already-confirmed sample states to test backend integration.

    The real camera loop enforces the 2-second stability requirement.
    """
    print("Simulated camera states; Ctrl+C to quit. No camera used.")
    states = ("present", "phone_in_hand", "present", "away")
    try:
        for state in states:
            print(f"Simulating stable state: {state}")
            payload = event(state, 0.85)
            deliver(payload, args)
            time.sleep(args.interval)
            deliver(event(state, 0.85), args)
    except KeyboardInterrupt:
        print("Stopped")


def phone_close_to_hand(phone_box, hand_points, width, height):
    x1, y1, x2, y2 = phone_box
    threshold = max(35, 0.065 * math.hypot(width, height))
    for x, y in hand_points:
        if x <= 0 or y <= 0:
            continue
        nx, ny = min(max(x, x1), x2), min(max(y, y1), y2)
        if math.hypot(x - nx, y - ny) < threshold:
            return True
    return False


class StableState:
    """Commit a new candidate state only after it remains unchanged for >= hold_sec."""
    def __init__(self, hold_sec):
        self.hold_sec = hold_sec
        self.confirmed = None
        self.candidate = None
        self.candidate_since = None

    def update(self, observed, now):
        if observed != self.candidate:
            self.candidate = observed
            self.candidate_since = now
        if self.candidate != self.confirmed and now - self.candidate_since >= self.hold_sec:
            self.confirmed = self.candidate
            return True
        return False


def run_camera(args):
    try:
        import cv2
        import mediapipe as mp
        import numpy as np
        from ultralytics import YOLO
    except ImportError as exc:
        raise SystemExit("Install dependencies: python -m pip install -r requirements.txt") from exc

    print("Loading pretrained AI models (first run can download weights)...")
    objects = YOLO("yolo11n.pt")
    model_file = Path(__file__).with_name("hand_landmarker.task")
    if not model_file.exists():
        print("Downloading MediaPipe hand model (once)...")
        urlretrieve(MODEL_URL, model_file)

    options = mp.tasks.vision.HandLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model_file)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.35,
        min_hand_presence_confidence=0.35,
        min_tracking_confidence=0.4,
    )
    landmarker = mp.tasks.vision.HandLandmarker.create_from_options(options)
    capture = cv2.VideoCapture(args.camera, cv2.CAP_AVFOUNDATION)
    if not capture.isOpened():
        landmarker.close()
        raise SystemExit(f"Cannot open camera {args.camera}; try another index or --demo")

    stable = StableState(args.hold_seconds)
    last_timestamp = -1
    start_time = time.monotonic()
    last_sent = 0.0
    last_reported_state = None
    latest = ("unknown", False, False)
    last_boxes = []
    last_points = []
    last_phone_center = None
    recent_phone_motion_at = float("-inf")
    frame_counter = 0
    failed_frames = 0
    print("Camera running. Press Q in preview or Ctrl+C in terminal to quit.")

    try:
        while True:
            ok, frame = capture.read()
            if not ok or frame is None:
                failed_frames += 1
                if failed_frames >= 15:
                    print("Camera connection lost after 15 failed reads")
                    break
                time.sleep(0.2)
                continue
            failed_frames = 0
            frame_counter += 1
            height, width = frame.shape[:2]
            now = time.monotonic()

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

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB,
                                    data=np.ascontiguousarray(rgb))
                timestamp_ms = max(last_timestamp + 1, int((now - start_time) * 1000))
                last_timestamp = timestamp_ms
                result = landmarker.detect_for_video(mp_image, timestamp_ms)
                points = []
                for landmarks in result.hand_landmarks:
                    for idx in (0, 1, 4, 5, 8, 9, 12, 13, 17):
                        p = landmarks[idx]
                        points.append((p.x * width, p.y * height))

                # Approximation: a phone close to a hand is a *candidate* for holding.
                # Motion gives extra evidence, but a stationary phone held in front of
                # the camera can be missed. Desk-plane calibration would improve this.
                near_hand = any(phone_close_to_hand(box, points, width, height)
                                for box in phones)
                if phones:
                    # Use largest detected phone, roughly stable for single-phone setups.
                    box = max(phones, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
                    center = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
                    if last_phone_center is not None:
                        motion = math.dist(center, last_phone_center)
                        if motion > 0.025 * math.hypot(width, height):
                            recent_phone_motion_at = now
                    last_phone_center = center
                else:
                    last_phone_center = None

                recently_moved = now - recent_phone_motion_at <= args.motion_window
                # If motion is required, a near-hand stationary phone won't count.
                likely_held = near_hand and (recently_moved or not args.require_motion)
                if likely_held:
                    raw_state = "phone_in_hand"
                elif people or points:
                    raw_state = "present"
                else:
                    # Only infer 'away' from an empty view if explicitly enabled:
                    # hands can be out of view while someone is still at the desk.
                    raw_state = "away" if args.empty_means_away else "unknown"

                latest = (raw_state, bool(phones), near_hand)
                last_boxes, last_points = phones, points
                changed = stable.update(raw_state, now)
                if changed:
                    print(f"Confirmed after {args.hold_seconds:.1f}s: {stable.confirmed}")

            # Report confirmed state on transition, plus a heartbeat every 5s.
            # Contract states are present, away, phone_in_hand only.
            # During an unknown observation, do not invent a state. The
            # backend's 15s no-messages timeout will mark camera unknown.
            if stable.confirmed in ("present", "away", "phone_in_hand") and latest[0] != "unknown":
                state_changed = stable.confirmed != last_reported_state
                if state_changed or now - last_sent >= args.interval:
                    # Confidence is a conservative heuristic, not a calibrated
                    # statistical probability. Adjust after lighting tests.
                    confidence = 0.8 if stable.confirmed == "phone_in_hand" else 0.7
                    deliver(event(stable.confirmed, confidence), args)
                    last_reported_state = stable.confirmed
                    last_sent = now

            if not args.no_window:
                if args.draw:
                    for x1, y1, x2, y2 in last_boxes:
                        cv2.rectangle(frame, (int(x1), int(y1)),
                                      (int(x2), int(y2)), (0, 220, 220), 2)
                    for x, y in last_points:
                        cv2.circle(frame, (int(x), int(y)), 5, (0, 255, 0), -1)
                display_state = stable.confirmed or f"checking {latest[0]}..."
                cv2.putText(frame, f"State: {display_state}  Phone: {latest[1]}  Near hand: {latest[2]}",
                            (15, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (0, 255, 0), 2)
                cv2.imshow("FlowDesk Vision (Q to quit)", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    except KeyboardInterrupt:
        print("Stopped")
    finally:
        capture.release()
        landmarker.close()
        if not args.no_window:
            cv2.destroyAllWindows()


def main():
    parser = argparse.ArgumentParser(description="FlowDesk local camera detection")
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--camera", type=int, default=1, help="Camera index")
    parser.add_argument("--backend", default=None, help="Backend base URL, e.g. http://127.0.0.1:8000")
    parser.add_argument("--interval", type=float, default=5.0, help="Heartbeat seconds (contract: 5)")
    parser.add_argument("--hold-seconds", type=float, default=2.0, help="Seconds to confirm any changed state")
    parser.add_argument("--every", type=int, default=5, help="Process each Nth frame")
    parser.add_argument("--motion-window", type=float, default=1.2,
                        help="Seconds recent phone movement still counts")
    parser.add_argument("--require-motion", action="store_true",
                        help="Require phone movement as well as hand proximity (more conservative)")
    parser.add_argument("--empty-means-away", action="store_true",
                        help="Treat empty frame as away; only for calibrated full-desk view")
    parser.add_argument("--verbose-backend", action="store_true")
    parser.add_argument("--no-window", action="store_true")
    parser.add_argument("--draw", action="store_true")
    args = parser.parse_args()
    if args.every < 1 or args.interval <= 0 or args.hold_seconds < 0:
        parser.error("--every >= 1, --interval > 0 and --hold-seconds >= 0 required")
    if args.demo:
        run_demo(args)
    else:
        run_camera(args)


if __name__ == "__main__":
    main()
