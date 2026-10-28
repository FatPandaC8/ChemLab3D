import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { OneEuroFilter } from "./filter";
import type { Point3 } from "./types";

const LANDMARK_COUNT = 21;
const FILTER_RESET_GAP_MS = 300;
const FILTER_MIN_CUTOFF = 2;
const FILTER_BETA = 0.5;
const THUMB_TIP = 4;
const INDEX_TIP = 8;

export interface TrackedHand {
  /** 21 smoothed landmarks in normalized video coordinates, including z. */
  readonly landmarks: readonly Point3[];
  readonly handedness: string | null;
}

export class CameraAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CameraAccessError";
  }
}

export class HandTracker {
  private stream: MediaStream | null = null;
  private landmarker: HandLandmarker | null = null;
  private readonly overlayContext: CanvasRenderingContext2D | null;
  private readonly filters: OneEuroFilter[];
  private readonly smoothed: Point3[];
  private readonly trackedHand: {
    landmarks: readonly Point3[];
    handedness: string | null;
  };
  private lastHandAt = 0;
  private canvasWidth = 0;
  private canvasHeight = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly overlay: HTMLCanvasElement,
  ) {
    this.overlayContext = overlay.getContext("2d");
    this.filters = Array.from(
      { length: LANDMARK_COUNT * 3 },
      () => new OneEuroFilter(FILTER_MIN_CUTOFF, FILTER_BETA),
    );
    this.smoothed = Array.from({ length: LANDMARK_COUNT }, () => ({
      x: 0,
      y: 0,
      z: 0,
    }));
    this.trackedHand = {
      landmarks: this.smoothed,
      handedness: null,
    };
  }

  get hasCamera(): boolean {
    return this.stream !== null;
  }

  get isModelReady(): boolean {
    return this.landmarker !== null;
  }

  get videoWidth(): number {
    return this.video.videoWidth;
  }

  get videoHeight(): number {
    return this.video.videoHeight;
  }

  get cameraDeviceId(): string | null {
    return this.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? null;
  }

  /** Enumerate video inputs after permission has been granted. */
  async listCameras(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === "videoinput");
    } catch {
      return [];
    }
  }

  async startCamera(deviceId?: string): Promise<void> {
    this.stopCamera();

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraAccessError(
        "This browser does not expose camera access. Use a recent Chrome, Edge, Firefox, or Safari build on localhost or HTTPS.",
      );
    }

    const video: MediaTrackConstraints = deviceId
      ? {
          deviceId: { exact: deviceId },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        }
      : {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video,
      });
    } catch (error) {
      throw new CameraAccessError(describeCameraError(error));
    }

    this.stream = stream;
    this.video.srcObject = stream;

    try {
      await this.video.play();
    } catch (error) {
      this.stopCamera();
      throw new CameraAccessError(
        `The camera opened but the video could not start: ${errorMessage(error)}`,
      );
    }
  }

  async loadModel(): Promise<void> {
    if (this.landmarker) {
      return;
    }

    const baseUrl = import.meta.env.BASE_URL;
    try {
      const fileset = await FilesetResolver.forVisionTasks(
        `${baseUrl}mediapipe/wasm`,
      );
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: `${baseUrl}models/hand_landmarker.task`,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (error) {
      throw new Error(
        `Could not load the local MediaPipe hand model: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Run hand tracking on the current video frame. Call this only when the
   * video has advanced; the timestamp must be monotonically increasing.
   */
  detect(nowMs: number): TrackedHand | null {
    if (
      !this.landmarker ||
      !this.stream ||
      this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      this.video.videoWidth === 0
    ) {
      return null;
    }

    const result = this.landmarker.detectForVideo(this.video, nowMs);
    const rawLandmarks = result.landmarks[0];

    if (!rawLandmarks || rawLandmarks.length < LANDMARK_COUNT) {
      this.clearOverlay();
      return null;
    }

    if (
      this.lastHandAt === 0 ||
      nowMs - this.lastHandAt > FILTER_RESET_GAP_MS
    ) {
      this.resetFilters();
    }
    this.lastHandAt = nowMs;

    this.smoothLandmarks(rawLandmarks, nowMs);
    this.trackedHand.handedness =
      result.handedness[0]?.[0]?.categoryName ?? null;

    this.drawOverlay();
    return this.trackedHand;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.stopCamera();
    this.clearOverlay();
  }

  private smoothLandmarks(
    rawLandmarks: readonly NormalizedLandmark[],
    nowMs: number,
  ): void {
    for (let index = 0; index < LANDMARK_COUNT; index += 1) {
      const raw = rawLandmarks[index];
      const smoothed = this.smoothed[index];
      if (!raw || !smoothed) {
        continue;
      }

      const filterX = this.filters[index * 3];
      const filterY = this.filters[index * 3 + 1];
      const filterZ = this.filters[index * 3 + 2];
      if (!filterX || !filterY || !filterZ) {
        continue;
      }

      smoothed.x = filterX.filter(raw.x, nowMs);
      smoothed.y = filterY.filter(raw.y, nowMs);
      smoothed.z = filterZ.filter(raw.z, nowMs);
    }
  }

  private resetFilters(): void {
    for (const filter of this.filters) {
      filter.reset();
    }
  }

  private drawOverlay(): void {
    const context = this.overlayContext;
    if (!context) {
      return;
    }

    this.syncCanvasSize(context);
    if (this.canvasWidth === 0 || this.canvasHeight === 0) {
      return;
    }

    const width = this.canvasWidth;
    const height = this.canvasHeight;
    context.clearRect(0, 0, width, height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = Math.max(1.5, width / 320);
    context.strokeStyle = "rgba(127, 231, 255, 0.9)";

    context.beginPath();
    for (const connection of HandLandmarker.HAND_CONNECTIONS) {
      const start = this.smoothed[connection.start];
      const end = this.smoothed[connection.end];
      if (!start || !end) {
        continue;
      }
      context.moveTo((1 - start.x) * width, start.y * height);
      context.lineTo((1 - end.x) * width, end.y * height);
    }
    context.stroke();

    const pointRadius = Math.max(2.5, width / 160);
    for (let index = 0; index < LANDMARK_COUNT; index += 1) {
      const point = this.smoothed[index];
      if (!point) {
        continue;
      }
      const isFingertip = index === THUMB_TIP || index === INDEX_TIP;
      context.beginPath();
      context.arc(
        (1 - point.x) * width,
        point.y * height,
        isFingertip ? pointRadius * 1.6 : pointRadius,
        0,
        Math.PI * 2,
      );
      context.fillStyle = isFingertip ? "#ffc86b" : "#f4fbff";
      context.fill();
    }
  }

  private clearOverlay(): void {
    const context = this.overlayContext;
    if (!context) {
      return;
    }
    this.syncCanvasSize(context);
    context.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
  }

  private syncCanvasSize(context: CanvasRenderingContext2D): void {
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (width === this.canvasWidth && height === this.canvasHeight) {
      return;
    }

    this.canvasWidth = width;
    this.canvasHeight = height;
    this.overlay.width = width;
    this.overlay.height = height;
    context.setTransform(1, 0, 0, 1, 0, 0);
  }

  private stopCamera(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.video.srcObject) {
      this.video.srcObject = null;
    }
    this.clearOverlay();
  }
}

function describeCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "Camera permission was denied. Allow camera access for this site in the browser's address bar (lock icon), then retry.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No camera was found. Connect a webcam and retry.";
      case "NotReadableError":
      case "TrackStartError":
        return "The camera is unavailable. It may be in use by another application; close that application and retry.";
      case "OverconstrainedError":
        return "The camera does not support the requested video settings. Try a different camera or browser.";
      case "SecurityError":
        return "Camera access requires a secure context. Open this app on localhost or over HTTPS.";
      default:
        return `The camera could not be opened (${error.name}). ${error.message}`;
    }
  }

  return `The camera could not be opened: ${errorMessage(error)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
