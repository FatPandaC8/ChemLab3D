import * as THREE from "three";
import {
  PinchGestureRecognizer,
  type GestureState,
} from "./gesture";
import type { TrackedHand } from "./handTracking";
import {
  INTERACTION_BOUNDS,
  type InteractionScene,
  type SceneObject,
} from "./scene";
import type { Point2, Point3 } from "./types";

/** Grace period before tracking loss drops an object and resets the gesture. */
const TRACKING_LOSS_GRACE_MS = 300;
/** How long the cursor remains at its last position after tracking is lost. */
const CURSOR_HIDE_DELAY_MS = 450;
/** How long the "Released <object>" confirmation stays visible. */
const RELEASE_MESSAGE_MS = 1200;

/** Hand coordinates are mapped from this central region of the webcam image. */
export const HAND_REGION_MIN = 0.15;
export const HAND_REGION_MAX = 0.85;
export const HAND_REGION_SIZE = HAND_REGION_MAX - HAND_REGION_MIN;

/**
 * Vertical hand travel (normalized image units) to world units. Image y grows
 * downward, so the mapping uses (0.5 - y): hand higher on screen → +Y.
 */
export const HAND_Y_WORLD_PER_UNIT = 5.5;
/**
 * Relative palm-span growth to world Z. A ratio of 1 means the hand is at the
 * same apparent distance as when the object was grabbed; a larger ratio means
 * the hand moved closer to the camera, which is +Z in this scene.
 */
export const HAND_DEPTH_WORLD_PER_RATIO = 3.2;

/**
 * Palm-span ratio limits. They keep noisy landmarks from saturating depth and
 * keep the object inside the workspace.
 */
export const DEPTH_RATIO_MIN = 0.55;
export const DEPTH_RATIO_MAX = 1.8;

/** Highest point the held object's center may reach. */
export const MAX_OBJECT_Y = 3;

/** The cursor ring floats slightly above the ground plane. */
const CURSOR_FLOOR_Y = 0.05;

const THUMB_TIP = 4;
const INDEX_TIP = 8;
const WRIST = 0;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const RING_MCP = 13;
const PINKY_MCP = 17;

/**
 * Knuckle joints used as the aiming anchor. Unlike the fingertips, these do not
 * move when the thumb and index close, so pinching cannot drag the cursor off
 * the object the user was aiming at.
 */
const PALM_ANCHOR_INDICES = [
  INDEX_MCP,
  MIDDLE_MCP,
  RING_MCP,
  PINKY_MCP,
] as const;

export type InteractionTone = "idle" | "hover" | "held" | "released";

export type ReleaseReason = "user" | "lost" | "reset";

export interface InteractionEvents {
  onGrab?: (object: SceneObject) => void;
  onRelease?: (
    object: SceneObject,
    position: ObjectPosition,
    reason: ReleaseReason,
  ) => void;
}

export interface ObjectPosition {
  x: number;
  y: number;
  z: number;
}

export interface InteractionSnapshot {
  gesture: GestureState;
  pinchRatio: number | null;
  selectedName: string | null;
  hoveredName: string | null;
  /** Held object's current world position, for debugging. */
  objectPosition: ObjectPosition | null;
  /** Mapped hand/cursor position in world space, for debugging. */
  cursorPosition: ObjectPosition | null;
  /** Current depth applied while carrying, in world units. */
  depthOffset: number;
  /** Palm span relative to the span recorded at grab time. */
  palmRatio: number | null;
  /** Short human-readable interaction message for the scene overlay. */
  status: string;
  tone: InteractionTone;
  cursorVisible: boolean;
}

/**
 * Owns the interaction state: cursor mapping, grabbing, moving, dropping, and
 * recovery from temporary tracking loss. The gesture recognizer only reports
 * pinch transitions; this class decides what they mean for the scene.
 *
 * Coordinate mapping while a pinch is active:
 * - hand X (mirrored)  → world X
 * - hand Y (image up)  → world Y
 * - palm-span ratio    → world Z (larger span = closer = +Z)
 *
 * The object is moved by the change in the mapped hand position, not snapped
 * to it: the offset recorded at grab time is preserved on all three axes.
 */
export class InteractionController {
  private readonly gesture = new PinchGestureRecognizer();
  /** Mapped hand position. x/y are absolute; z is relative to grab depth. */
  private readonly handWorld = new THREE.Vector3();
  private readonly grabOffset = new THREE.Vector3();
  private readonly heldWorld = new THREE.Vector3();
  private readonly heldPosition: ObjectPosition = { x: 0, y: 0, z: 0 };
  private readonly cursorPosition: ObjectPosition = { x: 0, y: 0, z: 0 };
  private readonly snapshot: InteractionSnapshot = {
    gesture: "Idle",
    pinchRatio: null,
    selectedName: null,
    hoveredName: null,
    objectPosition: null,
    cursorPosition: null,
    depthOffset: 0,
    palmRatio: null,
    status: "No hand",
    tone: "idle",
    cursorVisible: false,
  };
  private held: SceneObject | null = null;
  private hovered: SceneObject | null = null;
  private releasedName: string | null = null;
  private releasedAt = 0;
  private lostSince: number | null = null;
  private pinchRatio: number | null = null;
  private palmSpan = 0;
  private grabPalmSpan = 0;
  private cursorVisible = false;

  constructor(
    private readonly scene: InteractionScene,
    private readonly events: InteractionEvents = {},
  ) {}

  /** Drop any held object and hide interaction feedback immediately. */
  reset(): void {
    this.dropHeldObject(undefined, "reset");
    this.gesture.cancel(true);
    this.pinchRatio = null;
    this.cursorVisible = false;
    this.lostSince = null;
    this.hovered = null;
    this.releasedName = null;
    this.palmSpan = 0;
    this.handWorld.set(0, 0, 0);
    this.snapshot.cursorPosition = null;
    this.snapshot.depthOffset = 0;
    this.snapshot.palmRatio = null;
    this.scene.setHovered(null);
    this.scene.setCursorVisible(false);
  }

  /** Current interaction state, used by the diagnostics HUD and dev bridge. */
  getSnapshot(): Readonly<InteractionSnapshot> {
    return this.snapshot;
  }

  update(hand: TrackedHand | null, nowMs: number): Readonly<InteractionSnapshot> {
    if (!hand) {
      return this.updateWithoutHand(nowMs);
    }

    const thumbTip = hand.landmarks[THUMB_TIP];
    const indexTip = hand.landmarks[INDEX_TIP];
    if (!thumbTip || !indexTip) {
      return this.updateWithoutHand(nowMs);
    }

    this.lostSince = null;
    const anchor = measurePalmAnchor(hand.landmarks) ?? {
      x: (thumbTip.x + indexTip.x) / 2,
      y: (thumbTip.y + indexTip.y) / 2,
    };
    this.mapHand(hand, anchor);
    // Aiming uses the screen-space cursor; depth is relative to the grab.
    this.handWorld.z = 0;
    this.moveCursor();

    const gesture = this.gesture.update(hand.landmarks, nowMs);
    this.pinchRatio = gesture.pinchRatio;

    if (gesture.released) {
      this.dropHeldObject(nowMs, "user");
    }

    // Refresh the candidate before handling the grab so the object picked on
    // the confirmation frame matches what the cursor is over on that frame.
    if (this.held) {
      this.handWorld.z = this.depthOffset();
      this.moveHeldObject();
      this.hovered = null;
      this.scene.setHovered(null);
    } else {
      this.hovered = this.scene.pickAtCursor();
      this.scene.setHovered(this.hovered);
    }

    if (gesture.grabbed && !this.held) {
      this.tryGrab();
    }

    return this.writeSnapshot(nowMs);
  }

  private updateWithoutHand(nowMs: number): Readonly<InteractionSnapshot> {
    if (this.lostSince === null) {
      this.lostSince = nowMs;
    }
    const lostFor = nowMs - this.lostSince;

    if (lostFor >= TRACKING_LOSS_GRACE_MS) {
      if (this.held) {
        this.dropHeldObject(undefined, "lost");
      }
      this.gesture.cancel(true);
      this.pinchRatio = null;
      this.releasedName = null;
    }

    if (lostFor >= CURSOR_HIDE_DELAY_MS && this.cursorVisible) {
      this.cursorVisible = false;
      this.hovered = null;
      this.scene.setHovered(null);
      this.scene.setCursorVisible(false);
    }

    return this.writeSnapshot(nowMs);
  }

  /**
   * Map normalized hand coordinates to world X/Y and measure the palm span
   * that drives relative depth. The cursor itself stays on a fixed screen-space
   * plane so aiming does not jump when depth changes.
   */
  private mapHand(hand: TrackedHand, anchor: Point2): void {
    const world = mapHandAnchorToWorld(anchor);
    this.handWorld.set(world.x, world.y, 0);
    this.palmSpan = measurePalmSpan(hand.landmarks);
    this.cursorVisible = true;
  }

  private moveCursor(): void {
    const y = clamp(this.handWorld.y, CURSOR_FLOOR_Y, MAX_OBJECT_Y);
    this.scene.setCursor(this.handWorld.x, 0, y);
  }

  /**
   * Relative depth from the hand's apparent size. MediaPipe z is wrist-relative
   * and not metric, so the palm span is used as a proximity signal and compared
   * with the span recorded at grab time. Larger span → hand closer → +Z.
   */
  private depthOffset(): number {
    if (this.grabPalmSpan <= 0) {
      return 0;
    }
    const ratio = clamp(
      this.palmSpan / this.grabPalmSpan,
      DEPTH_RATIO_MIN,
      DEPTH_RATIO_MAX,
    );
    return (ratio - 1) * HAND_DEPTH_WORLD_PER_RATIO;
  }

  private tryGrab(): void {
    const hovered = this.hovered;
    const target =
      hovered && hovered.grabbable !== false
        ? hovered
        : this.scene.pickAtCursor();
    if (!target || target.grabbable === false) {
      return;
    }

    this.held = target;
    this.hovered = null;
    this.scene.setHovered(null);
    this.releasedName = null;
    this.grabPalmSpan = Math.max(this.palmSpan, 1e-6);
    target.mesh.getWorldPosition(this.heldWorld);
    this.grabOffset.copy(this.heldWorld).sub(this.handWorld);
    this.scene.setHeld(target);
    this.events.onGrab?.(target);
  }

  private moveHeldObject(): void {
    if (!this.held) {
      return;
    }
    const desiredWorld = this.heldWorld
      .copy(this.handWorld)
      .add(this.grabOffset);
    desiredWorld.x = clamp(desiredWorld.x, INTERACTION_BOUNDS.minX, INTERACTION_BOUNDS.maxX);
    desiredWorld.y = clamp(desiredWorld.y, this.held.restY, MAX_OBJECT_Y);
    desiredWorld.z = clamp(desiredWorld.z, INTERACTION_BOUNDS.minZ, INTERACTION_BOUNDS.maxZ);

    // The chemistry instruments currently sit at the scene root, but converting
    // through the parent keeps the controller correct if an object is grouped
    // under a transformed parent later.
    const parent = this.held.mesh.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(desiredWorld);
    }
    this.held.mesh.position.copy(desiredWorld);
  }

  private dropHeldObject(
    releasedAt?: number,
    reason: ReleaseReason = "user",
  ): void {
    if (!this.held) {
      return;
    }
    if (releasedAt !== undefined) {
      this.releasedName = this.held.name;
      this.releasedAt = releasedAt;
    }
    const dropped = this.held;
    dropped.mesh.getWorldPosition(this.heldWorld);
    const position: ObjectPosition = {
      x: this.heldWorld.x,
      y: this.heldWorld.y,
      z: this.heldWorld.z,
    };
    this.held = null;
    this.grabOffset.set(0, 0, 0);
    this.grabPalmSpan = 0;
    this.handWorld.z = 0;
    this.scene.setHeld(null);
    this.events.onRelease?.(dropped, position, reason);
  }

  private writeSnapshot(nowMs: number): Readonly<InteractionSnapshot> {
    const status = this.describeStatus(nowMs);
    this.snapshot.gesture = this.gesture.getState();
    this.snapshot.pinchRatio = this.pinchRatio;
    this.snapshot.selectedName = this.held?.name ?? null;
    this.snapshot.hoveredName = this.hovered?.name ?? null;
    if (this.held) {
      this.held.mesh.getWorldPosition(this.heldWorld);
      this.heldPosition.x = this.heldWorld.x;
      this.heldPosition.y = this.heldWorld.y;
      this.heldPosition.z = this.heldWorld.z;
      this.snapshot.objectPosition = this.heldPosition;
    } else {
      this.snapshot.objectPosition = null;
    }
    if (this.cursorVisible) {
      this.cursorPosition.x = this.handWorld.x;
      this.cursorPosition.y = this.handWorld.y;
      this.cursorPosition.z = this.handWorld.z;
      this.snapshot.cursorPosition = this.cursorPosition;
    } else {
      this.snapshot.cursorPosition = null;
    }
    this.snapshot.depthOffset = this.held ? this.handWorld.z : 0;
    this.snapshot.palmRatio =
      this.grabPalmSpan > 0 ? this.palmSpan / this.grabPalmSpan : null;
    this.snapshot.status = status.text;
    this.snapshot.tone = status.tone;
    this.snapshot.cursorVisible = this.cursorVisible;
    return this.snapshot;
  }

  private describeStatus(nowMs: number): {
    text: string;
    tone: InteractionTone;
  } {
    if (this.held) {
      return { text: `Holding ${this.held.name}`, tone: "held" };
    }
    if (this.releasedName !== null) {
      if (nowMs - this.releasedAt < RELEASE_MESSAGE_MS) {
        return { text: `Released ${this.releasedName}`, tone: "released" };
      }
      this.releasedName = null;
    }
    if (this.gesture.getState() === "Holding") {
      return { text: "No object grabbed", tone: "idle" };
    }
    if (this.hovered) {
      return { text: `Hovering ${this.hovered.name}`, tone: "hover" };
    }
    if (this.cursorVisible) {
      return { text: "Aim at an object", tone: "idle" };
    }
    return { text: "No hand", tone: "idle" };
  }
}

/**
 * Stable aiming anchor at the centre of the four knuckles. The fingertips are
 * deliberately excluded because closing a pinch moves them and would drag the
 * cursor away from the object being aimed at.
 */
export function measurePalmAnchor(
  landmarks: readonly Point3[],
): Point2 | null {
  let x = 0;
  let y = 0;
  for (const index of PALM_ANCHOR_INDICES) {
    const point = landmarks[index];
    if (!point) {
      return null;
    }
    x += point.x;
    y += point.y;
  }
  const count = PALM_ANCHOR_INDICES.length;
  return { x: x / count, y: y / count };
}

/** Map a normalized palm anchor to the world-space aiming plane. */
export function mapHandAnchorToWorld(anchor: Point2): {
  x: number;
  y: number;
} {
  const mirroredX = 1 - anchor.x;
  const normalizedX = clamp01(
    (mirroredX - HAND_REGION_MIN) / HAND_REGION_SIZE,
  );
  return {
    x:
      INTERACTION_BOUNDS.minX +
      normalizedX * (INTERACTION_BOUNDS.maxX - INTERACTION_BOUNDS.minX),
    y: (0.5 - anchor.y) * HAND_Y_WORLD_PER_UNIT,
  };
}

/**
 * Apparent hand size in normalized landmark space. Both the palm width
 * (index MCP ↔ pinky MCP) and palm length (wrist ↔ middle MCP) scale with
 * distance from the camera; averaging them reduces orientation sensitivity.
 * MediaPipe's landmark z is wrist-relative, not metric, so it is ignored here.
 */
function measurePalmSpan(landmarks: readonly Point3[]): number {
  const wrist = landmarks[WRIST];
  const indexMcp = landmarks[INDEX_MCP];
  const middleMcp = landmarks[MIDDLE_MCP];
  const pinkyMcp = landmarks[PINKY_MCP];
  if (!wrist || !indexMcp || !middleMcp || !pinkyMcp) {
    return 0;
  }
  const width = distance2d(indexMcp, pinkyMcp);
  const length = distance2d(wrist, middleMcp);
  return (width + length) / 2;
}

function distance2d(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
