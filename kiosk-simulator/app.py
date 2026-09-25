import cv2
import numpy as np
import time
from flask import Flask, render_template, Response, jsonify

app = Flask(__name__)

# Auto-detect available camera
def open_camera():
    for index in range(5):  # Try indexes 0 through 4
        cap = cv2.VideoCapture(index)
        if cap.isOpened():
            print(f"✅ Camera found at index {index}")
            return cap
        cap.release()
    print("❌ No camera found!")
    return None

camera = open_camera()


def apply_nir_simulation(frame):
    """
    Simulates an 850nm NIR camera feed with:
    - CLAHE (Contrast Limited Adaptive Histogram Equalization)
    - False-color OCEAN mapping (dark blue/teal like real NIR sensors)
    - Green vein-edge overlay via Canny edge detection
    - Professional scanner reticle
    Pure OpenCV — no external AI model needed.
    """
    h, w = frame.shape[:2]

    # 1. Grayscale — NIR cameras are inherently monochrome
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # 2. CLAHE — the core algorithm from our research spec
    #    clipLimit=3.5 gives strong local contrast without over-brightening
    clahe = cv2.createCLAHE(clipLimit=3.5, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # 3. False-color map — OCEAN gives a dark teal look like industrial NIR sensors
    color_mapped = cv2.applyColorMap(enhanced, cv2.COLORMAP_OCEAN)

    # 4. Canny edge detection to simulate subcutaneous vein structures
    edges = cv2.Canny(enhanced, 30, 100)

    # 5. Dilate edges slightly so vein lines are visible on screen
    kernel = np.ones((2, 2), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=1)

    # 6. Overlay detected edges in bright green (vein highlight)
    vein_overlay = np.zeros_like(color_mapped)
    vein_overlay[edges > 0] = [0, 255, 100]
    color_mapped = cv2.addWeighted(color_mapped, 1.0, vein_overlay, 0.6, 0)

    # 7. Draw professional scanner reticle in center
    cx, cy = w // 2, h // 2
    radius = min(w, h) // 4
    cv2.circle(color_mapped, (cx, cy), radius, (0, 255, 255), 1)
    cv2.line(color_mapped, (cx - 20, cy), (cx + 20, cy), (0, 255, 255), 1)
    cv2.line(color_mapped, (cx, cy - 20), (cx, cy + 20), (0, 255, 255), 1)

    # 8. Corner bracket markers (like a real biometric scanner)
    b = 30  # bracket arm length
    t = 2   # line thickness
    c = (0, 255, 255)
    cv2.line(color_mapped, (cx-radius, cy-radius), (cx-radius+b, cy-radius), c, t)
    cv2.line(color_mapped, (cx-radius, cy-radius), (cx-radius, cy-radius+b), c, t)
    cv2.line(color_mapped, (cx+radius, cy-radius), (cx+radius-b, cy-radius), c, t)
    cv2.line(color_mapped, (cx+radius, cy-radius), (cx+radius, cy-radius+b), c, t)
    cv2.line(color_mapped, (cx-radius, cy+radius), (cx-radius+b, cy+radius), c, t)
    cv2.line(color_mapped, (cx-radius, cy+radius), (cx-radius, cy+radius-b), c, t)
    cv2.line(color_mapped, (cx+radius, cy+radius), (cx+radius-b, cy+radius), c, t)
    cv2.line(color_mapped, (cx+radius, cy+radius), (cx+radius, cy+radius-b), c, t)

    # 9. Status text overlay
    cv2.putText(color_mapped, "NIR 850nm | CLAHE ACTIVE",
                (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1)
    cv2.putText(color_mapped, "PLACE PALM IN FRAME",
                (cx - 90, cy - radius - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 100), 1)

    return color_mapped


def generate_frames():
    if camera is None:
        # No camera found — serve a styled "No Camera" placeholder frame
        placeholder = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(placeholder, "NO CAMERA DETECTED",
                    (100, 220), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)
        cv2.putText(placeholder, "Connect USB webcam or NIR camera",
                    (80, 270), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 100), 1)
        cv2.putText(placeholder, "Non-compliant device: BLOCKED",
                    (100, 320), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 1)
        cv2.putText(placeholder, "NIR 850nm | CLAHE ACTIVE (SIMULATED)",
                    (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 1)
        ret, buffer = cv2.imencode('.jpg', placeholder)
        frame_bytes = buffer.tobytes()
        while True:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            time.sleep(1)  # 1 FPS — placeholder never changes, no need to burn CPU
        return

    while True:
        success, frame = camera.read()
        if not success:
            break

        # Mirror horizontally for natural feel
        frame = cv2.flip(frame, 1)

        # Apply NIR simulation pipeline
        nir_frame = apply_nir_simulation(frame)

        # Encode as JPEG for streaming
        ret, buffer = cv2.imencode('.jpg', nir_frame)
        frame_bytes = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(1/30)  # Cap at 30 FPS — prevents CPU exhaustion



@app.route('/')
def index():
    return render_template('kiosk.html')


@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/api/kiosk/status')
def status():
    return jsonify({
        "status": "online",
        "camera": "Dual-Lens NIR+RGB Simulator (OpenCV)",
        "hardware_fingerprint": "8A:3F:B2:99:1C:44",
        "clahe_status": "active",
        "wavelength": "850nm simulated",
        "pipeline": "Grayscale → CLAHE → OCEAN ColorMap → Canny Vein Detection"
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
