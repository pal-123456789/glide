// tracker.js — the ONLY module that touches the camera and MediaPipe.
// Everything else consumes the normalized signal object it emits, which keeps
// the rest of the app testable and swappable (Demo Mode feeds the same shape).
//
// Loads @mediapipe/tasks-vision from CDN at runtime (the sandbox has no network,
// but the user's browser does). After first load the service worker caches these
// assets so Glide runs offline. The camera frame NEVER leaves the device — all
// inference is local WASM.

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const WASM = `${CDN}/wasm`;
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Landmark indices (MediaPipe FaceMesh canonical): nose tip is 1.
const NOSE_TIP = 1;

/**
 * Signal shape emitted each frame:
 * {
 *   ok: boolean,          // face detected this frame
 *   nx, ny: number,       // normalized nose position [0,1] (head pointer)
 *   blinkL, blinkR: number,   // eye-closed scores [0,1]
 *   jawOpen: number,      // [0,1]
 *   browUp: number,       // [0,1]
 *   t: number,            // timestamp ms
 * }
 */
export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.video = null;
    this.stream = null;
    this.running = false;
    this._raf = null;
    this._onSignal = null;
    this._lastVideoTime = -1;
  }

  onSignal(cb) {
    this._onSignal = cb;
  }

  /** Dynamically import the vision bundle (kept out of the static import graph
   *  so the app shell loads even if the CDN is momentarily unreachable). */
  async _loadVision() {
    const vision = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`);
    return vision;
  }

  async init(onProgress = () => {}) {
    onProgress('Loading face model…');
    const vision = await this._loadVision();
    const { FaceLandmarker, FilesetResolver } = vision;
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,       // gives us blink/jaw/brow scores
      outputFacialTransformationMatrixes: false,
    });
    onProgress('Model ready');
    return true;
  }

  /** Request the webcam and start the detection loop. */
  async start(videoEl) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support camera access.');
    }
    this.video = videoEl;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this._loop();
  }

  _blend(list, name) {
    if (!list) return 0;
    const c = list.find((b) => b.categoryName === name);
    return c ? c.score : 0;
  }

  _loop() {
    if (!this.running) return;
    const now = performance.now();
    // Only run inference on a fresh video frame.
    if (this.video.currentTime !== this._lastVideoTime) {
      this._lastVideoTime = this.video.currentTime;
      let result = null;
      try {
        result = this.landmarker.detectForVideo(this.video, now);
      } catch (e) {
        // transient decode error; skip this frame
      }
      if (result && result.faceLandmarks && result.faceLandmarks.length) {
        const lm = result.faceLandmarks[0];
        const nose = lm[NOSE_TIP];
        const bs = result.faceBlendshapes?.[0]?.categories;
        const signal = {
          ok: true,
          nx: nose.x,
          ny: nose.y,
          blinkL: this._blend(bs, 'eyeBlinkLeft'),
          blinkR: this._blend(bs, 'eyeBlinkRight'),
          jawOpen: this._blend(bs, 'jawOpen'),
          browUp: this._blend(bs, 'browInnerUp'),
          t: now,
        };
        this._onSignal && this._onSignal(signal);
      } else {
        this._onSignal && this._onSignal({ ok: false, t: now });
      }
    }
    this._raf = requestAnimationFrame(() => this._loop());
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop()); // releases the camera
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }
}
