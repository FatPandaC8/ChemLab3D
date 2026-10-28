import type { Point2 } from "./types";

export type GestureState = "Idle" | "Pinching" | "Holding";

export interface GestureUpdate {
  state: GestureState;
  /** Thumb-tip ↔ index-tip distance divided by palm size. */
  pinchRatio: number;
  /** Pinch was confirmed on this frame. */
  grabbed: boolean;
  /** A confirmed pinch was released on this frame. */
  released: boolean;
}

/** Normalized fingertip distance below which a pinch starts. */
export const PINCH_CLOSE_THRESHOLD = 0.32;
/** Normalized fingertip distance above which a pinch releases. */
export const PINCH_RELEASE_THRESHOLD = 0.48;
/** How long the fingertips must stay pinched before a grab is confirmed. */
export const PINCH_CONFIRM_MS = 100;

const THUMB_TIP = 4;
const INDEX_TIP = 8;
const WRIST = 0;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;

/**
 * Two-threshold pinch recognizer.
 *
 * Idle → Pinching when the fingertips close past the close threshold.
 * Pinching → Holding after a short stabilization period.
 * Holding → Idle when the fingertips separate past the release threshold.
 *
 * The gap between the close and release thresholds is the hysteresis band,
 * so the state does not chatter when the fingertips sit near the boundary.
 */
export class PinchGestureRecognizer {
  private state: GestureState = "Idle";
  private pinchingSince = 0;
  private armed = true;
  private ratio = 0;

  private readonly output: GestureUpdate = {
    state: "Idle",
    pinchRatio: 0,
    grabbed: false,
    released: false,
  };

  update(
    landmarks: readonly Point2[],
    nowMs: number,
  ): Readonly<GestureUpdate> {
    let grabbed = false;
    let released = false;

    if (landmarks.length < 21) {
      return this.resetOutput();
    }

    const thumbTip = landmarks[THUMB_TIP];
    const indexTip = landmarks[INDEX_TIP];
    const wrist = landmarks[WRIST];
    const indexMcp = landmarks[INDEX_MCP];
    const middleMcp = landmarks[MIDDLE_MCP];
    const pinkyMcp = landmarks[PINKY_MCP];

    if (
      !thumbTip ||
      !indexTip ||
      !wrist ||
      !indexMcp ||
      !middleMcp ||
      !pinkyMcp
    ) {
      return this.resetOutput();
    }

    const pinchDistance = distance2d(thumbTip, indexTip);
    const palmSize = Math.max(
      distance2d(wrist, middleMcp),
      distance2d(indexMcp, pinkyMcp),
      0.01,
    );
    this.ratio = pinchDistance / palmSize;

    if (!this.armed) {
      if (this.ratio >= PINCH_RELEASE_THRESHOLD) {
        this.armed = true;
      }
    } else {
      switch (this.state) {
        case "Idle":
          if (this.ratio <= PINCH_CLOSE_THRESHOLD) {
            this.state = "Pinching";
            this.pinchingSince = nowMs;
          }
          break;

        case "Pinching":
          if (this.ratio >= PINCH_RELEASE_THRESHOLD) {
            this.state = "Idle";
          } else if (nowMs - this.pinchingSince >= PINCH_CONFIRM_MS) {
            this.state = "Holding";
            grabbed = true;
          }
          break;

        case "Holding":
          if (this.ratio >= PINCH_RELEASE_THRESHOLD) {
            this.state = "Idle";
            released = true;
          }
          break;
      }
    }

    this.output.state = this.state;
    this.output.pinchRatio = this.ratio;
    this.output.grabbed = grabbed;
    this.output.released = released;
    return this.output;
  }

  /**
   * Reset after tracking is lost. With `requireOpen`, the user must open the
   * hand past the release threshold before another pinch can start, which
   * prevents an immediate re-grab when the hand reappears while still closed.
   */
  cancel(requireOpen = false): void {
    this.state = "Idle";
    this.pinchingSince = 0;
    this.armed = !requireOpen;
    this.ratio = 0;
  }

  getState(): GestureState {
    return this.state;
  }

  private resetOutput(): Readonly<GestureUpdate> {
    const released = this.state === "Holding";
    this.cancel(false);
    this.output.state = "Idle";
    this.output.pinchRatio = 0;
    this.output.grabbed = false;
    this.output.released = released;
    return this.output;
  }
}

function distance2d(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
