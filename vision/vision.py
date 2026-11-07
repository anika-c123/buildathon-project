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
from urllib.error import URLError, HTTPError
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



def get_study_status(base_url):
    """Return True for studying, False for any other verified status, None on failure.

    Fail closed: None never grants camera access.
    """
    try:
        req = Request(base_url.rstrip("/") + "/state",
                      headers={"Accept": "application/json"})
        with urlopen(req, timeout=1.5) as response:
            payload = json.load(response)
        if not isinstance(payload, dict):
            return None
        # Contract GET /state returns a direct snapshot, not an event envelope.
        status = payload.get("status")
        if status in ("studying", "idle", "break", "ended"):
            return status == "studying"
        return None
    except (URLError, TimeoutError, OSError, ValueError, TypeError):
        return None


def open_camera(cv2, index):
    cap = cv2.VideoCapture(index, cv2.CAP_AVFOUNDATION)
    if not cap.isOpened():
        cap.release()
        return None
    return cap


def stress_test_reopen(cv2, index, cycles=10):
    """Deliberately open/read/close N times; never run AI or save frames."""
    passed = 0
    for i in range(cycles):
        cap = open_camera(cv2, index)
        ok = False
        if cap is not None:
            try:
                # Retry briefly for USB/virtual webcam initialization.
                for _ in range(8):
                    ret, frame = cap.read()
                    if ret and frame is not None:
                        ok = True
                        break
                    time.sleep(0.15)
            finally:
                cap.release()
        passed += int(ok)
        print(f"GoPro reopen trial {i+1}/{cycles}: {'PASS' if ok else 'FAIL'}")
        time.sleep(0.35)
    print(f"Result: {passed}/{cycles} successful opens with frames")
    if passed != cycles:
        print("Reopening is unreliable. Consider --discard-on-idle as a fallback."
              " NOTE: that mode keeps the camera physically open when not studying.")
    return passed == cycles


def reset_trackers(args):
    """No detection state survives between sessions."""
    return (
        StableState(args.hold_seconds),
        PresenceTracker(args.absence_grace),
        PhoneHeldTracker(motion_fraction=args.pickup_motion,
                         motion_window=args.motion_window,
                         release_grace=args.release_grace),
    )

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


def finger_contact(phone_box, hands, width, height):
    """Require multiple fingers near/inside phone, not just a nearby wrist.

    Returns a heuristic contact candidate; 2-D landmarks cannot prove contact.
    """
    x1, y1, x2, y2 = phone_box
    margin = 0.018 * math.hypot(width, height)
    for hand in hands:
        # Thumb/index/middle/ring/pinky fingertips and base joints.
        ids = (4, 8, 12, 16, 20, 5, 9, 13, 17)
        close = sum(x1 - margin <= hand[i][0] <= x2 + margin and
                    y1 - margin <= hand[i][1] <= y2 + margin for i in ids)
        if close >= 2:
            return True
    return False


class PresenceTracker:
    """Allow short detector misses before proposing away.

    Away is only meaningful with a calibrated camera view.
    """
    def __init__(self, absence_grace=2.0):
        self.absence_grace = absence_grace
        self.last_seen = None
        self.started = None

    def observe(self, person_or_hands, now, empty_means_away):
        if self.started is None:
            self.started = now
        if person_or_hands:
            self.last_seen = now
            return "present"
        if not empty_means_away:
            return "unknown"
        since = self.last_seen if self.last_seen is not None else self.started
        return "away" if now - since >= self.absence_grace else "unknown"


class PhoneHeldTracker:
    """Latch a likely pickup while hand contact persists, even if phone stops moving.

    Works best with a stationary camera and one phone. Movement alone never
    indicates phone_in_hand; we also require multiple nearby hand landmarks.
    """
    def __init__(self, motion_fraction=0.018, motion_window=3.0,
                 release_grace=1.0):
        self.motion_fraction = motion_fraction
        self.motion_window = motion_window
        self.release_grace = release_grace
        self.last_center = None
        self.last_motion = float('-inf')
        self.last_contact = None
        self.held = False

    def update(self, phones, hands, width, height, now):
        if not phones:
            self.last_center = None
            if self.last_contact is None or now - self.last_contact >= self.release_grace:
                self.held = False
            return self.held, False

        # Largest phone box is a simple single-phone assumption.
        box = max(phones, key=lambda b: (b[2]-b[0])*(b[3]-b[1]))
        center = ((box[0]+box[2])/2, (box[1]+box[3])/2)
        diag = math.hypot(width, height)
        if self.last_center is not None and math.dist(center, self.last_center) > self.motion_fraction * diag:
            self.last_motion = now
        self.last_center = center

        contact = finger_contact(box, hands, width, height)
        if contact:
            self.last_contact = now
            if now - self.last_motion <= self.motion_window:
                self.held = True
        elif self.last_contact is None or now - self.last_contact >= self.release_grace:
            self.held = False
        return self.held, contact


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
    if not args.backend:
        raise SystemExit("E13 requires --backend URL for GET /state."
                         " Use --demo for no-camera testing or --stress-reopen 10 for camera testing.")
    try:
        import cv2
        import mediapipe as mp
        import numpy as np
        from ultralytics import YOLO
    except ImportError as exc:
        raise SystemExit("Install dependencies: python -m pip install -r requirements.txt") from exc

    # E13: first check backend without opening the camera or loading models.
    study = get_study_status(args.backend)
    print("E13 privacy mode: polling GET /state every 2 seconds."
          " Camera opens only after confirmed studying status.")
    objects = None
    landmarker = None
    capture = None
    last_poll = time.monotonic()
    last_status = study
    studying = False
    fallback = args.discard_on_idle
    failure_reopens = 0
    frame_counter = 0
    failed_frames = 0
    preview_open = False
    successful_frames = 0

    def close_preview():
        nonlocal preview_open
        if preview_open:
            cv2.destroyAllWindows()
            preview_open = False

    def close_camera():
        nonlocal capture
        if capture is not None:
            capture.release()
            capture = None
        close_preview()

    try:
        while True:
            now = time.monotonic()
            if now - last_poll >= args.state_poll:
                last_status = get_study_status(args.backend)
                last_poll = now

            should_study = last_status is True
            if not should_study:
                if studying:
                    print("Study session paused/ended or backend unavailable: stopping inference and events.")
                    studying = False
                    close_preview()
                    # privacy baseline: release camera, even on backend failure.
                    if not fallback:
                        close_camera()
                if fallback and capture is not None:
                    # Explicit fallback: still physically open, but never processed/saved/sent.
                    ok, frame = capture.read()
                    del frame
                    if not ok:
                        close_camera()
                        # Do not reopen while idle; try again next study session.
                    time.sleep(0.02)
                else:
                    time.sleep(0.1)
                continue

            if not studying:
                if objects is None:
                    print("Loading models after study session began...")
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
                if capture is None:
                    capture = open_camera(cv2, args.camera)
                    if capture is None:
                        failure_reopens += 1
                        print(f"Cannot reopen camera {args.camera}; retry next poll.")
                        if failure_reopens >= args.reopen_failures and not fallback:
                            fallback = True
                            print("WARNING: switching to discard-on-idle fallback."
                                  " Camera will remain physically OPEN outside studying"
                                  " if a later reopen succeeds. No idle inference/events.")
                        # Never open outside studying, even if reopen fails.
                        time.sleep(args.state_poll)
                        continue
                # An open device is not necessarily a stable camera stream.
                studying = True
                stable, presence_tracker, held_tracker = reset_trackers(args)
                start_time = time.monotonic()
                last_timestamp = -1
                last_sent = 0.0
                last_reported_state = None
                latest = ("unknown", False, False)
                last_boxes, last_points = [], []
                frame_counter = 0
                failed_frames = 0
                successful_frames = 0
                # Model loading may have overlapped with session ending.
                last_status = get_study_status(args.backend)
                last_poll = time.monotonic()
                if last_status is not True:
                    studying = False
                    if not fallback:
                        close_camera()
                    continue
                print("STUDYING: camera active. Q to quit; Ctrl+C to stop.")

            ok, frame = capture.read()
            if not ok or frame is None:
                failed_frames += 1
                if failed_frames >= 15:
                    print("Camera stream failed after 15 reads. Releasing and retrying during studying.")
                    close_camera()
                    studying = False
                    failure_reopens += 1
                    if failure_reopens >= args.reopen_failures and not fallback:
                        fallback = True
                        print("WARNING: reopen unstable; discard-on-idle fallback enabled."
                              " Physical camera stays open while idle if stream is functioning.")
                time.sleep(0.2)
                continue
            failed_frames = 0
            successful_frames += 1
            if successful_frames >= 50:
                failure_reopens = 0
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
                hands = []
                points = []
                for landmarks in result.hand_landmarks:
                    hand = [(p.x * width, p.y * height) for p in landmarks]
                    hands.append(hand)
                    points.extend(hand)

                # E2: recently observed person/hands means present; short
                # detector dropouts do not automatically imply away.
                presence = presence_tracker.observe(
                    people or bool(hands), now, args.empty_means_away
                )

                # E4: phone must move while at least two relevant hand
                # landmarks are near it. After pickup, keep held while contact
                # remains even if the phone itself becomes stationary.
                held, near_hand = held_tracker.update(
                    phones, hands, width, height, now
                )
                raw_state = "phone_in_hand" if held else presence

                latest = (raw_state, bool(phones), near_hand)
                last_boxes, last_points = phones, points
                # Unknown is not a permitted contract event. Hold the last
                # confirmed state during short uncertainty, but do not send
                # new events if evidence is persistently unavailable.
                changed = stable.update(raw_state, now)
                if changed:
                    print(f"Confirmed after {args.hold_seconds:.1f}s: {stable.confirmed}")

            # Check after potentially slow AI inference; do not send events
            # for sessions that ended while inference was running.
            if time.monotonic() - last_poll >= args.state_poll:
                last_status = get_study_status(args.backend)
                last_poll = time.monotonic()
            if last_status is not True:
                continue

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
                preview_open = True
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    except KeyboardInterrupt:
        print("Stopped")
    finally:
        close_camera()
        if landmarker is not None:
            landmarker.close()

def main():
    parser = argparse.ArgumentParser(description="FlowDesk local camera detection")
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--stress-reopen", type=int, default=0,
                        help="Open/read/close the camera N times (try 10), without AI or backend")
    parser.add_argument("--state-poll", type=float, default=2.0,
                        help="Seconds between GET /state privacy checks; default 2")
    parser.add_argument("--discard-on-idle", action="store_true",
                        help="Explicit privacy fallback: keep camera open and discard frames during idle/break")
    parser.add_argument("--reopen-failures", type=int, default=3,
                        help="Failed camera opens before enabling discard-on-idle fallback")
    parser.add_argument("--camera", type=int, default=1, help="Camera index")
    parser.add_argument("--backend", default=None, help="Backend base URL, e.g. http://127.0.0.1:8000")
    parser.add_argument("--interval", type=float, default=5.0, help="Heartbeat seconds (contract: 5)")
    parser.add_argument("--hold-seconds", type=float, default=2.0, help="Seconds to confirm any changed state")
    parser.add_argument("--every", type=int, default=5, help="Process each Nth frame")
    parser.add_argument("--motion-window", type=float, default=3.0,
                        help="Seconds after a phone move that contact can count as pickup")
    parser.add_argument("--pickup-motion", type=float, default=0.018,
                        help="Phone movement threshold as fraction of frame diagonal")
    parser.add_argument("--release-grace", type=float, default=1.0,
                        help="Seconds of missing hand contact before releasing held state")
    parser.add_argument("--absence-grace", type=float, default=2.0,
                        help="Seconds with no person/hands before raw away can begin")
    parser.add_argument("--empty-means-away", action="store_true",
                        help="Treat empty frame as away; only for calibrated full-desk view")
    parser.add_argument("--verbose-backend", action="store_true")
    parser.add_argument("--no-window", action="store_true")
    parser.add_argument("--draw", action="store_true")
    args = parser.parse_args()
    if (args.state_poll <= 0 or args.stress_reopen < 0 or args.reopen_failures < 1 or
            args.every < 1 or args.interval <= 0 or args.hold_seconds < 0 or
            args.motion_window <= 0 or args.pickup_motion <= 0 or
            args.release_grace < 0 or args.absence_grace < 0):
        parser.error("Invalid timing/motion options")
    if args.stress_reopen:
        try:
            import cv2
        except ImportError as exc:
            raise SystemExit("Install opencv-python in your venv first") from exc
        success = stress_test_reopen(cv2, args.camera, args.stress_reopen)
        if not success:
            raise SystemExit(1)
    elif args.demo:
        run_demo(args)
    else:
        run_camera(args)


if __name__ == "__main__":
    main()
