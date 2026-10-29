import assert from "node:assert/strict";
import * as THREE from "three";
import {
  PinchGestureRecognizer,
  PINCH_CLOSE_THRESHOLD,
  PINCH_CONFIRM_MS,
  PINCH_RELEASE_THRESHOLD,
} from "../src/gesture.ts";
import { OneEuroFilter } from "../src/filter.ts";
import {
  DEPTH_RATIO_MAX,
  DEPTH_RATIO_MIN,
  HAND_DEPTH_WORLD_PER_RATIO,
  HAND_REGION_MIN,
  HAND_REGION_SIZE,
  HAND_Y_WORLD_PER_UNIT,
  InteractionController,
  MAX_OBJECT_Y,
  mapHandAnchorToWorld,
  measurePalmAnchor,
} from "../src/interaction.ts";
import {
  INTERACTION_BOUNDS,
  type SceneObject,
  type SceneView,
} from "../src/scene.ts";
import type { Point3 } from "../src/types.ts";

const OPEN_PINCH = 0.3;
const CLOSED_PINCH = 0.02;
const BETWEEN_PINCH = 0.06;

/**
 * Build a synthetic 21-landmark hand.
 *
 * `span` scales the whole hand around its center, which is how the palm-span
 * depth signal responds to apparent hand size. `pinch` is the thumb–index
 * separation before that scaling, so the pinch ratio stays constant as the
 * hand appears closer or farther.
 */
function landmarks(
  options: {
    centerX?: number;
    centerY?: number;
    pinch?: number;
    span?: number;
    z?: number;
    /**
     * Move only the thumb to meet a stationary index, which is what happens in
     * a real pinch. The fingertip midpoint shifts, but the knuckle anchor must
     * not.
     */
    asym?: boolean;
  } = {},
): Point3[] {
  const centerX = options.centerX ?? 0.5;
  const centerY = options.centerY ?? 0.5;
  const pinch = options.pinch ?? CLOSED_PINCH;
  const span = options.span ?? 1;
  const z = options.z ?? 0;
  const asym = options.asym ?? false;

  const points: Point3[] = Array.from({ length: 21 }, () => ({
    x: centerX,
    y: centerY,
    z,
  }));
  points[0] = { x: centerX, y: centerY + 0.15 * span, z };
  // The four knuckles are the aiming anchor, so keep their average exactly on
  // (centerX, centerY). They stay fixed while the thumb and index move.
  points[5] = { x: centerX - 0.05 * span, y: centerY, z };
  points[9] = { x: centerX - (0.05 * span) / 3, y: centerY, z };
  points[13] = { x: centerX + (0.05 * span) / 3, y: centerY, z };
  points[17] = { x: centerX + 0.05 * span, y: centerY, z };
  if (asym) {
    const indexX = centerX + 0.02 * span;
    points[8] = { x: indexX, y: centerY, z };
    points[4] = { x: indexX - pinch * span, y: centerY, z };
  } else {
    points[4] = { x: centerX - (pinch * span) / 2, y: centerY, z };
    points[8] = { x: centerX + (pinch * span) / 2, y: centerY, z };
  }
  return points;
}

/** Inverse of the controller's X/Y mapping, for aiming tests at a world point. */
function rawHandForWorld(
  x: number,
  y: number,
): { centerX: number; centerY: number } {
  const nx =
    (x - INTERACTION_BOUNDS.minX) /
    (INTERACTION_BOUNDS.maxX - INTERACTION_BOUNDS.minX);
  const mirroredX = HAND_REGION_MIN + nx * HAND_REGION_SIZE;
  return {
    centerX: 1 - mirroredX,
    centerY: 0.5 - y / HAND_Y_WORLD_PER_UNIT,
  };
}

function assertPosition(
  actual: { x: number; y: number; z: number } | null,
  expected: { x: number; y: number; z: number },
): void {
  assert.ok(actual, "expected a held object position");
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, "x mismatch");
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, "y mismatch");
  assert.ok(Math.abs(actual.z - expected.z) < 1e-9, "z mismatch");
}

function checkThresholds(): void {
  assert.ok(PINCH_CLOSE_THRESHOLD < PINCH_RELEASE_THRESHOLD);
  const recognizer = new PinchGestureRecognizer();
  const open = landmarks({ pinch: OPEN_PINCH });
  const closed = landmarks({ pinch: CLOSED_PINCH });
  const between = landmarks({ pinch: BETWEEN_PINCH });

  let update = recognizer.update(open, 0);
  assert.equal(update.state, "Idle");
  assert.equal(update.grabbed, false);

  update = recognizer.update(closed, 10);
  assert.equal(update.state, "Pinching");
  assert.equal(update.grabbed, false);

  update = recognizer.update(between, 50);
  assert.equal(update.state, "Pinching");

  update = recognizer.update(closed, 110);
  assert.equal(update.state, "Holding");
  assert.equal(update.grabbed, true);

  const heldBetween = recognizer.update(between, 150);
  assert.equal(heldBetween.state, "Holding");
  assert.equal(heldBetween.released, false);

  const released = recognizer.update(open, 200);
  assert.equal(released.state, "Idle");
  assert.equal(released.released, true);

  const stillReleased = recognizer.update(between, 250);
  assert.equal(stillReleased.state, "Idle");

  const repinch = recognizer.update(closed, 300);
  assert.equal(repinch.state, "Pinching");

  // Confirmation timing is honored exactly.
  const early = new PinchGestureRecognizer();
  early.update(closed, 0);
  assert.equal(early.update(closed, PINCH_CONFIRM_MS - 1).grabbed, false);
  assert.equal(early.update(closed, PINCH_CONFIRM_MS).grabbed, true);

  // After tracking loss, another grab requires opening the hand first.
  const reacquire = new PinchGestureRecognizer();
  reacquire.update(closed, 0);
  reacquire.update(closed, 100);
  reacquire.cancel(true);
  update = reacquire.update(closed, 200);
  assert.equal(update.state, "Idle");
  update = reacquire.update(open, 300);
  assert.equal(update.state, "Idle");
  update = reacquire.update(closed, 400);
  assert.equal(update.state, "Pinching");
  update = reacquire.update(closed, 500);
  assert.equal(update.grabbed, true);

  console.log("gesture: thresholds, confirmation, hysteresis, re-arm OK");
}

function checkFilter(): void {
  const filter = new OneEuroFilter(2, 0.5);
  let result = 0;
  const inputs = [0.5, 0.505, 0.495, 0.502, 0.498, 0.504, 0.496, 0.501];
  for (let i = 0; i < inputs.length; i += 1) {
    result = filter.filter(inputs[i]!, i * 33);
  }
  assert.ok(Number.isFinite(result));
  assert.ok(Math.abs(result - 0.5) < 0.01);

  const step = new OneEuroFilter(2, 0.5);
  step.filter(0, 0);
  const midway = step.filter(1, 33);
  assert.ok(midway > 0 && midway < 1);
  const moved = step.filter(1, 66);
  assert.ok(moved > midway);
  step.reset();
  assert.equal(step.filter(0.25, 5000), 0.25);
  console.log("filter: smoothing, step response, reset OK");
}

class FakeScene {
  cursor = new THREE.Vector3();
  visible = false;
  hovered: SceneObject | null = null;
  held: SceneObject | null = null;
  target: SceneObject | null = null;
  target2: SceneObject | null = null;
  forcedPick: SceneObject | null = null;
  pickCalls = 0;

  makeObject(name: string, x: number, y: number, z: number): SceneObject {
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.position.set(x, y, z);
    return { name, mesh, material, restY: y };
  }

  setCursor(
    x: number,
    z: number,
    y = 0,
    _screenX?: number,
    _screenY?: number,
  ): void {
    this.cursor.set(x, y, z);
    this.visible = true;
  }

  setCursorVisible(visible: boolean): void {
    this.visible = visible;
  }

  pickAtCursor(): SceneObject | null {
    this.pickCalls += 1;
    if (this.held) return null;
    if (this.forcedPick) return this.forcedPick;
    // The real scene casts a ray through the cursor, so selection depends on
    // where the cursor appears on screen (x/y), not its depth.
    for (const object of [this.target, this.target2]) {
      if (
        object &&
        Math.hypot(
          this.cursor.x - object.mesh.position.x,
          this.cursor.y - object.mesh.position.y,
        ) < 0.75
      ) {
        return object;
      }
    }
    return null;
  }

  setHovered(object: SceneObject | null): void {
    this.hovered = object;
  }

  setHeld(object: SceneObject | null): void {
    this.held = object;
  }
}

function checkInteraction(): void {
  const scene = new FakeScene();
  const controller = new InteractionController(scene as unknown as SceneView);
  const objectA = scene.makeObject("A", 0, 0.5, 0);
  const objectB = scene.makeObject("B", 1, 0.5, 0.5);
  scene.target = objectA;

  let now = 0;
  const hoverA = rawHandForWorld(0, 0.5);

  // Hover before pinching: the object is under the cursor, nothing is held.
  let snapshot = controller.update(
    {
      landmarks: landmarks({ ...hoverA, pinch: OPEN_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.cursorVisible, true);
  assert.equal(snapshot.gesture, "Idle");
  assert.equal(snapshot.hoveredName, "A");
  assert.equal(snapshot.selectedName, null);
  assert.equal(snapshot.status, "Hovering A");
  assert.equal(snapshot.tone, "hover");
  assert.equal(scene.hovered, objectA);
  assert.equal(scene.held, null);
  assert.ok(Math.abs(scene.cursor.y - 0.5) < 1e-9);

  // Pinch while hovering: grab after the confirmation delay.
  now = 10;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...hoverA, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Pinching");
  assert.equal(snapshot.selectedName, null);

  now = 110;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...hoverA, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Holding");
  assert.equal(snapshot.selectedName, "A");
  assert.equal(snapshot.hoveredName, null);
  assert.equal(snapshot.status, "Holding A");
  assert.equal(snapshot.tone, "held");
  assert.equal(scene.held, objectA);
  // The grab must not snap the object to the hand.
  assertPosition(snapshot.objectPosition, { x: 0, y: 0.5, z: 0 });

  // Horizontal hand movement changes X and leaves Y/Z alone.
  now = 150;
  const left = rawHandForWorld(-1, 0.5);
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...left, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.ok(Math.abs(objectA.mesh.position.x - -1) < 1e-9);
  assert.ok(Math.abs(objectA.mesh.position.y - 0.5) < 1e-9);
  assert.ok(Math.abs(objectA.mesh.position.z - 0) < 1e-9);

  // Vertical hand movement lifts the object off the ground.
  now = 200;
  const up = rawHandForWorld(-1, 1.5);
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...up, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.ok(Math.abs(objectA.mesh.position.x - -1) < 1e-9);
  assert.ok(Math.abs(objectA.mesh.position.y - 1.5) < 1e-9);
  assert.ok(Math.abs(objectA.mesh.position.z - 0) < 1e-9);
  assertPosition(snapshot.objectPosition, { x: -1, y: 1.5, z: 0 });
  assert.ok(objectA.mesh.position.y > objectA.restY);

  // A larger palm span (hand closer to the camera) moves the object toward +Z.
  now = 250;
  controller.update(
    {
      landmarks: landmarks({ ...up, pinch: CLOSED_PINCH, span: 1.5 }),
      handedness: "Right",
    },
    now,
  );
  const nearZ = (1.5 - 1) * HAND_DEPTH_WORLD_PER_RATIO;
  assert.ok(Math.abs(objectA.mesh.position.z - nearZ) < 1e-9);
  assert.ok(objectA.mesh.position.z > 0);
  assert.ok(Math.abs(objectA.mesh.position.x - -1) < 1e-9);
  assert.ok(Math.abs(objectA.mesh.position.y - 1.5) < 1e-9);

  // A smaller palm span (hand farther away) moves it toward -Z.
  now = 300;
  controller.update(
    {
      landmarks: landmarks({ ...up, pinch: CLOSED_PINCH, span: 0.75 }),
      handedness: "Right",
    },
    now,
  );
  const farZ = (0.75 - 1) * HAND_DEPTH_WORLD_PER_RATIO;
  assert.ok(Math.abs(objectA.mesh.position.z - farZ) < 1e-9);
  assert.ok(objectA.mesh.position.z < 0);

  // The lift is clamped to the top of the workspace.
  now = 350;
  const veryHigh = rawHandForWorld(-1, 3.2);
  controller.update(
    {
      landmarks: landmarks({ ...veryHigh, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(objectA.mesh.position.y, MAX_OBJECT_Y);

  // Depth is clamped, and the object stays inside the X/Z bounds.
  now = 400;
  controller.update(
    {
      landmarks: landmarks({ ...veryHigh, pinch: CLOSED_PINCH, span: 2.2 }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(objectA.mesh.position.z, INTERACTION_BOUNDS.maxZ);
  assert.ok(DEPTH_RATIO_MAX > 1 && DEPTH_RATIO_MIN < 1);

  // Release leaves the object at its final 3D position.
  now = 450;
  const finalPosition = objectA.mesh.position.clone();
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...veryHigh, pinch: OPEN_PINCH, span: 2.2 }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Idle");
  assert.equal(snapshot.selectedName, null);
  assert.equal(scene.held, null);
  assert.deepEqual(objectA.mesh.position.toArray(), finalPosition.toArray());
  assert.equal(snapshot.status, "Released A");
  assert.equal(snapshot.tone, "released");
  assert.equal(snapshot.hoveredName, "A");
  assert.equal(snapshot.objectPosition, null);

  // Elevated objects remain selectable: aim at the raised object and re-grab.
  now = 500;
  const elevated = rawHandForWorld(-1, 3);
  controller.update(
    {
      landmarks: landmarks({ ...elevated, pinch: OPEN_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(scene.hovered, objectA);

  now = 550;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...elevated, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Pinching");

  now = 650;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...elevated, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Holding");
  assert.equal(scene.held, objectA);
  assert.deepEqual(objectA.mesh.position.toArray(), finalPosition.toArray());

  // Moving the hand down lowers the elevated object without a snap.
  now = 700;
  const lowered = rawHandForWorld(-1, 2);
  controller.update(
    {
      landmarks: landmarks({ ...lowered, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.ok(Math.abs(objectA.mesh.position.y - 2) < 1e-9);
  assert.ok(Math.abs(objectA.mesh.position.z - finalPosition.z) < 1e-9);

  now = 750;
  controller.update(
    {
      landmarks: landmarks({ ...lowered, pinch: OPEN_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(scene.held, null);

  // Pick up a different object.
  scene.target = null;
  scene.target2 = objectB;
  const hoverB = rawHandForWorld(1, 0.5);
  now = 800;
  controller.update(
    {
      landmarks: landmarks({ ...hoverB, pinch: OPEN_PINCH }),
      handedness: "Right",
    },
    now,
  );
  now = 850;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...hoverB, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Pinching");

  now = 950;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...hoverB, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Holding");
  assert.equal(snapshot.selectedName, "B");
  assert.equal(scene.held, objectB);
  assert.deepEqual(objectB.mesh.position.toArray(), [1, 0.5, 0.5]);

  // Tracking loss: stays held inside the grace period, then drops.
  const bPosition = objectB.mesh.position.clone();
  now = 1000;
  snapshot = controller.update(null, now);
  assert.equal(snapshot.selectedName, "B");
  now = 1299;
  snapshot = controller.update(null, now);
  assert.equal(snapshot.selectedName, "B");
  now = 1301;
  snapshot = controller.update(null, now);
  assert.equal(snapshot.selectedName, null);
  assert.equal(scene.held, null);
  assert.deepEqual(objectB.mesh.position.toArray(), bPosition.toArray());
  assert.equal(snapshot.gesture, "Idle");
  assert.equal(snapshot.status, "Aim at an object");

  // Cursor hides eventually.
  now = 1500;
  snapshot = controller.update(null, now);
  assert.equal(snapshot.cursorVisible, false);
  assert.equal(snapshot.status, "No hand");

  // Reappearing with a closed pinch must not auto-regrab; open then pinch.
  now = 1600;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...hoverB, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.selectedName, null);
  assert.equal(snapshot.gesture, "Idle");

  now = 1700;
  controller.update(
    {
      landmarks: landmarks({ ...hoverB, pinch: OPEN_PINCH }),
      handedness: "Right",
    },
    now,
  );
  now = 1800;
  controller.update(
    {
      landmarks: landmarks({ ...hoverB, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  now = 1900;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...hoverB, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.selectedName, "B");
  assert.equal(scene.held, objectB);

  console.log(
    "interaction: 3D grab, X/Y/Z movement, lift, depth, release, re-grab, loss recovery OK",
  );
}

function checkGrabOffset(): void {
  const scene = new FakeScene();
  const controller = new InteractionController(scene as unknown as SceneView);
  const object = scene.makeObject("Offset", 0.5, 0.6, 0.3);
  scene.target = object;

  const handAtGrab = rawHandForWorld(0, 0.5);
  let now = 0;
  controller.update(
    {
      landmarks: landmarks({ ...handAtGrab, pinch: OPEN_PINCH }),
      handedness: "Right",
    },
    now,
  );
  now = 10;
  controller.update(
    {
      landmarks: landmarks({ ...handAtGrab, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  now = 110;
  const snapshot = controller.update(
    {
      landmarks: landmarks({ ...handAtGrab, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );

  assert.equal(snapshot.selectedName, "Offset");
  // Grabbing off-center must preserve the object's position, not snap it.
  assert.deepEqual(object.mesh.position.toArray(), [0.5, 0.6, 0.3]);

  // Move up, right, and closer: the grab offset survives on all three axes.
  now = 150;
  const moved = rawHandForWorld(1, 1.5);
  controller.update(
    {
      landmarks: landmarks({
        ...moved,
        pinch: CLOSED_PINCH,
        span: 1.5,
      }),
      handedness: "Right",
    },
    now,
  );
  const depth = (1.5 - 1) * HAND_DEPTH_WORLD_PER_RATIO;
  assert.ok(Math.abs(object.mesh.position.x - 1.5) < 1e-9);
  assert.ok(Math.abs(object.mesh.position.y - 1.6) < 1e-9);
  assert.ok(Math.abs(object.mesh.position.z - (0.3 + depth)) < 1e-9);

  // Moving the hand farther than the neutral depth clamps at the near limit.
  now = 200;
  controller.update(
    {
      landmarks: landmarks({
        ...moved,
        pinch: CLOSED_PINCH,
        span: 0.4,
      }),
      handedness: "Right",
    },
    now,
  );
  const farDepth = (DEPTH_RATIO_MIN - 1) * HAND_DEPTH_WORLD_PER_RATIO;
  assert.ok(
    Math.abs(object.mesh.position.z - (0.3 + farDepth)) < 1e-9,
  );

  console.log("interaction: grab offset preserved on X, Y, and Z OK");
}

function checkEmptyPinch(): void {
  const scene = new FakeScene();
  const controller = new InteractionController(scene as unknown as SceneView);
  scene.target = scene.makeObject("A", 0, 0.5, 0);

  const away = rawHandForWorld(2.5, 0.5);
  const over = rawHandForWorld(0, 0.5);

  let now = 0;
  let snapshot = controller.update(
    {
      landmarks: landmarks({ ...away, pinch: OPEN_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.hoveredName, null);
  assert.equal(snapshot.status, "Aim at an object");

  // Pinching in empty space enters Holding but grabs nothing.
  now = 10;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...away, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Pinching");

  now = 110;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...away, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Holding");
  assert.equal(snapshot.selectedName, null);
  assert.equal(scene.held, null);
  assert.equal(snapshot.status, "No object grabbed");

  // Moving over the object while still pinched does not grab retroactively.
  now = 160;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...over, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.hoveredName, "A");
  assert.equal(snapshot.selectedName, null);
  assert.equal(scene.held, null);
  assert.equal(snapshot.status, "No object grabbed");

  // Release, then a fresh pinch over the object works.
  now = 200;
  controller.update(
    {
      landmarks: landmarks({ ...away, pinch: OPEN_PINCH }),
      handedness: "Right",
    },
    now,
  );
  now = 250;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...over, pinch: OPEN_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Idle");
  now = 300;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...over, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Pinching");
  now = 400;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...over, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Holding");
  assert.equal(snapshot.selectedName, "A");
  assert.equal(scene.held, scene.target);

  console.log("interaction: empty pinch, status feedback, re-grab OK");
}

function checkPalmAnchorMapping(): void {
  const hand = landmarks({ centerX: 0.4, centerY: 0.6, span: 1.2 });
  const anchor = measurePalmAnchor(hand);
  assert.ok(anchor, "expected a palm anchor");
  assert.ok(Math.abs(anchor.x - 0.4) < 1e-12);
  assert.ok(Math.abs(anchor.y - 0.6) < 1e-12);

  const mapped = mapHandAnchorToWorld(anchor);
  assert.ok(Math.abs(mapped.y - (0.5 - 0.6) * HAND_Y_WORLD_PER_UNIT) < 1e-12);
  assert.ok(
    Math.abs(
      mapped.x -
        (INTERACTION_BOUNDS.minX +
          ((1 - 0.4 - HAND_REGION_MIN) / HAND_REGION_SIZE) *
            (INTERACTION_BOUNDS.maxX - INTERACTION_BOUNDS.minX)),
    ) < 1e-12,
  );

  // Closing the pinch must not move the anchor, even when only the thumb moves.
  const open = landmarks({ centerX: 0.4, centerY: 0.6, pinch: OPEN_PINCH, asym: true });
  const closed = landmarks({ centerX: 0.4, centerY: 0.6, pinch: CLOSED_PINCH, asym: true });
  const openAnchor = measurePalmAnchor(open)!;
  const closedAnchor = measurePalmAnchor(closed)!;
  assert.ok(Math.abs(openAnchor.x - closedAnchor.x) < 1e-12);
  assert.ok(Math.abs(openAnchor.y - closedAnchor.y) < 1e-12);

  console.log("interaction: stable palm anchor and world mapping OK");
}

function checkAsymmetricPinch(): void {
  const scene = new FakeScene();
  const controller = new InteractionController(scene as unknown as SceneView);
  const object = scene.makeObject("Asym", 0, 0.5, 0);
  scene.target = object;

  const aim = rawHandForWorld(0, 0.5);
  let now = 0;
  let snapshot = controller.update(
    {
      landmarks: landmarks({ ...aim, pinch: OPEN_PINCH, asym: true }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.hoveredName, "Asym");

  // Only the thumb moves; the fingertip midpoint shifts by ~0.28 in image
  // space. The old midpoint mapping lost the object here.
  now = 10;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...aim, pinch: CLOSED_PINCH, asym: true }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Pinching");
  assert.equal(snapshot.hoveredName, "Asym");

  now = 110;
  snapshot = controller.update(
    {
      landmarks: landmarks({ ...aim, pinch: CLOSED_PINCH, asym: true }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.gesture, "Holding");
  assert.equal(snapshot.selectedName, "Asym");
  assert.equal(scene.held, object);

  // Carry with the same asymmetric pinch and confirm the offset is preserved.
  now = 160;
  const moved = rawHandForWorld(0.8, 1.2);
  controller.update(
    {
      landmarks: landmarks({
        ...moved,
        pinch: CLOSED_PINCH,
        asym: true,
        span: 1.4,
      }),
      handedness: "Right",
    },
    now,
  );
  assert.ok(Math.abs(object.mesh.position.x - 0.8) < 1e-9);
  assert.ok(Math.abs(object.mesh.position.y - 1.2) < 1e-9);
  assert.ok(
    Math.abs(
      object.mesh.position.z - (1.4 - 1) * HAND_DEPTH_WORLD_PER_RATIO,
    ) < 1e-9,
  );

  now = 210;
  controller.update(
    {
      landmarks: landmarks({
        ...moved,
        pinch: OPEN_PINCH,
        asym: true,
        span: 1.4,
      }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(scene.held, null);

  console.log("interaction: asymmetric pinch grabs, carries, and releases OK");
}

function checkParentedObject(): void {
  const scene = new FakeScene();
  const controller = new InteractionController(scene as unknown as SceneView);
  const parent = new THREE.Group();
  parent.position.set(1, 0, 0);
  const object = scene.makeObject("Parented", -1, 0.5, 0);
  parent.add(object.mesh);
  scene.forcedPick = object;

  const aim = rawHandForWorld(0, 0.5);
  let now = 0;
  controller.update(
    {
      landmarks: landmarks({ ...aim, pinch: OPEN_PINCH }),
      handedness: "Right",
    },
    now,
  );
  now = 10;
  controller.update(
    {
      landmarks: landmarks({ ...aim, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  now = 110;
  let snapshot = controller.update(
    {
      landmarks: landmarks({ ...aim, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.selectedName, "Parented");

  const world = object.mesh.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(world.x - 0) < 1e-9);
  assert.ok(Math.abs(world.y - 0.5) < 1e-9);

  now = 160;
  const moved = rawHandForWorld(1, 1.5);
  snapshot = controller.update(
    {
      landmarks: landmarks({
        ...moved,
        pinch: CLOSED_PINCH,
        span: 1.5,
      }),
      handedness: "Right",
    },
    now,
  );
  const depth = (1.5 - 1) * HAND_DEPTH_WORLD_PER_RATIO;
  object.mesh.getWorldPosition(world);
  assert.ok(Math.abs(world.x - 1) < 1e-9);
  assert.ok(Math.abs(world.y - 1.5) < 1e-9);
  assert.ok(Math.abs(world.z - depth) < 1e-9);
  assert.ok(Math.abs(object.mesh.position.x - 0) < 1e-9);
  assertPosition(snapshot.objectPosition, { x: 1, y: 1.5, z: depth });

  console.log("interaction: transformed parent uses world-space movement OK");
}

function checkTrackingLossReset(): void {
  const scene = new FakeScene();
  const controller = new InteractionController(scene as unknown as SceneView);
  const object = scene.makeObject("Item", 0, 0.5, 0);
  scene.target = object;

  const atObject = rawHandForWorld(0, 0.5);
  let now = 0;
  controller.update(
    {
      landmarks: landmarks({ ...atObject, pinch: OPEN_PINCH }),
      handedness: "Right",
    },
    now,
  );

  now = 10;
  controller.update(
    {
      landmarks: landmarks({ ...atObject, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );

  now = 120;
  controller.update(
    {
      landmarks: landmarks({ ...atObject, pinch: CLOSED_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(controller.getSnapshot().gesture, "Holding");
  assert.equal(controller.getSnapshot().selectedName, "Item");

  // Hand tracking begins dropping at 150ms
  now = 150;
  controller.update(null, now);
  assert.equal(controller.getSnapshot().selectedName, "Item");

  // Hand lost for > 300ms (150 + 310 = 460ms)
  now = 460;
  controller.update(null, now);
  assert.equal(controller.getSnapshot().selectedName, null);
  // Recognizer must be reset so returning with an open pinch is Idle
  assert.equal(controller.getSnapshot().gesture, "Idle");

  // Re-enter with open hand
  now = 500;
  const snap = controller.update(
    {
      landmarks: landmarks({ ...atObject, pinch: OPEN_PINCH }),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snap.gesture, "Idle");
  assert.equal(snap.selectedName, null);

  console.log("interaction: tracking loss disarms gesture cleanly OK");
}

checkThresholds();
checkFilter();
checkInteraction();
checkGrabOffset();
checkEmptyPinch();
checkPalmAnchorMapping();
checkAsymmetricPinch();
checkParentedObject();
checkTrackingLossReset();
console.log("all logic checks passed");
