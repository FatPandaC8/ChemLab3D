import assert from "node:assert/strict";
import * as THREE from "three";
import {
  ExperimentEngine,
  getExperiment,
  type ExperimentId,
} from "../src/lab/experiments.ts";
import {
  InteractionController,
  HAND_REGION_MIN,
  HAND_REGION_SIZE,
  HAND_Y_WORLD_PER_UNIT,
  type ReleaseReason,
} from "../src/interaction.ts";
import {
  INTERACTION_BOUNDS,
  type InteractionScene,
  type SceneObject,
} from "../src/scene.ts";
import type { Point3 } from "../src/types.ts";

const OPEN_PINCH = 0.3;
const CLOSED_PINCH = 0.02;

function landmarks(
  centerX: number,
  centerY: number,
  pinch: number,
  span = 1,
  asym = false,
): Point3[] {
  const points: Point3[] = Array.from({ length: 21 }, () => ({
    x: centerX,
    y: centerY,
    z: 0,
  }));
  points[0] = { x: centerX, y: centerY + 0.15 * span, z: 0 };
  // Knuckles are the aiming anchor; keep their average on the aim point.
  points[5] = { x: centerX - 0.05 * span, y: centerY, z: 0 };
  points[9] = { x: centerX - (0.05 * span) / 3, y: centerY, z: 0 };
  points[13] = { x: centerX + (0.05 * span) / 3, y: centerY, z: 0 };
  points[17] = { x: centerX + 0.05 * span, y: centerY, z: 0 };
  if (asym) {
    // Thumb travels to a stationary index, the common real-world pinch.
    const indexX = centerX + 0.02 * span;
    points[8] = { x: indexX, y: centerY, z: 0 };
    points[4] = { x: indexX - pinch * span, y: centerY, z: 0 };
  } else {
    points[4] = { x: centerX - (pinch * span) / 2, y: centerY, z: 0 };
    points[8] = { x: centerX + (pinch * span) / 2, y: centerY, z: 0 };
  }
  return points;
}

function rawHandForWorld(x: number, y: number): {
  centerX: number;
  centerY: number;
} {
  const nx =
    (x - INTERACTION_BOUNDS.minX) /
    (INTERACTION_BOUNDS.maxX - INTERACTION_BOUNDS.minX);
  const mirroredX = HAND_REGION_MIN + nx * HAND_REGION_SIZE;
  return { centerX: 1 - mirroredX, centerY: 0.5 - y / HAND_Y_WORLD_PER_UNIT };
}

class FakeLabScene implements InteractionScene {
  readonly cursor = new THREE.Vector3();
  readonly objects: SceneObject[] = [];
  held: SceneObject | null = null;
  hovered: SceneObject | null = null;

  add(
    id: string,
    name: string,
    x: number,
    y: number,
    z: number,
    grabbable = true,
  ): SceneObject {
    const mesh = new THREE.Object3D();
    mesh.position.set(x, y, z);
    const object: SceneObject = {
      id,
      name,
      mesh,
      restY: y,
      grabbable,
    };
    this.objects.push(object);
    return object;
  }

  setCursor(x: number, z: number, y = 0): void {
    this.cursor.set(x, y, z);
  }

  setCursorVisible(): void {}

  pickAtCursor(): SceneObject | null {
    if (this.held) {
      return null;
    }
    let best: { object: SceneObject; distance: number } | null = null;
    for (const object of this.objects) {
      if (object.grabbable === false) {
        continue;
      }
      const distance = Math.hypot(
        this.cursor.x - object.mesh.position.x,
        this.cursor.y - object.mesh.position.y,
      );
      if (distance < 0.8 && (!best || distance < best.distance)) {
        best = { object, distance };
      }
    }
    return best?.object ?? null;
  }

  setHovered(object: SceneObject | null): void {
    this.hovered = object;
  }

  setHeld(object: SceneObject | null): void {
    this.held = object;
  }
}

/** Same XZ/height rule as the real ChemistryScene. */
function targetAt(
  position: { x: number; y: number; z: number },
  target: { id: string; x: number; y: number; z: number },
): string | null {
  const distance = Math.hypot(position.x - target.x, position.z - target.z);
  return distance <= 1.15 && position.y >= -0.2 && position.y <= target.y + 2.4
    ? target.id
    : null;
}

function checkPrecipitationStateMachine(): void {
  const engine = new ExperimentEngine();
  let snapshot = engine.start("precipitation");
  assert.equal(snapshot.phase, "running");
  assert.equal(snapshot.stepIndex, 0);
  assert.equal(snapshot.canInteract, true);
  assert.equal(snapshot.totalSteps, 2);

  // Wrong order is feedback, not progress.
  let result = engine.attemptTransfer("h2so4", "beaker");
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "wrong-reagent");
  assert.equal(engine.getSnapshot().stepIndex, 0);

  // Wrong vessel is feedback, not progress.
  result = engine.attemptTransfer("bacl2", "flask");
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "wrong-target");
  assert.equal(engine.getSnapshot().stepIndex, 0);

  // Releasing in empty space is feedback, not progress.
  result = engine.attemptTransfer("bacl2", null);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "wrong-target");
  assert.equal(engine.getSnapshot().stepIndex, 0);

  // Correct first step.
  result = engine.attemptTransfer("bacl2", "beaker");
  assert.equal(result.accepted, true);
  assert.equal(result.isFinal, false);
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.phase, "animating");
  assert.equal(snapshot.stepIndex, 1);
  assert.equal(snapshot.canInteract, false);

  // A second release before the pour finishes is rejected.
  const blocked = engine.attemptTransfer("h2so4", "beaker");
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.reason, "not-running");

  snapshot = engine.finishStep();
  assert.equal(snapshot.phase, "running");
  assert.equal(snapshot.stepIndex, 1);
  assert.equal(snapshot.completed, false);

  // Correct final step only triggers on its own validated transfer.
  result = engine.attemptTransfer("h2so4", "beaker");
  assert.equal(result.accepted, true);
  assert.equal(result.isFinal, true);
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.phase, "animating");
  assert.equal(snapshot.stepIndex, 2);
  assert.equal(snapshot.completed, false, "complete only after the reaction");

  snapshot = engine.finishStep();
  assert.equal(snapshot.phase, "complete");
  assert.equal(snapshot.completed, true);
  assert.equal(snapshot.progress, 1);
  assert.equal(snapshot.feedback.tone, "complete");

  // Nothing can advance after completion.
  result = engine.attemptTransfer("h2so4", "beaker");
  assert.equal(result.accepted, false);

  // Restart resets all experiment state and the scene can be rebuilt from it.
  snapshot = engine.restart();
  assert.equal(snapshot.phase, "running");
  assert.equal(snapshot.stepIndex, 0);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.progress, 0);
}

function checkLimestoneStateMachine(): void {
  const engine = new ExperimentEngine();
  engine.start("limestone");
  let result = engine.attemptTransfer("hcl", "flask");
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "wrong-reagent");

  result = engine.attemptTransfer("caco3", "beaker");
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "wrong-target");

  result = engine.attemptTransfer("caco3", "flask");
  assert.equal(result.accepted, true);
  assert.equal(result.isFinal, false);
  engine.finishStep();

  result = engine.attemptTransfer("hcl", "flask");
  assert.equal(result.accepted, true);
  assert.equal(result.isFinal, true);
  const snapshot = engine.finishStep();
  assert.equal(snapshot.completed, true);
  assert.equal(
    getExperiment("limestone" as ExperimentId).effect,
    "bubbles",
  );
}

function checkGestureToExperimentBridge(): void {
  const scene = new FakeLabScene();
  const bacl2 = scene.add("bacl2", "BaCl2", -2, 0.9, 0);
  scene.add("beaker", "Beaker", 0, 0.8, 0, false);
  const engine = new ExperimentEngine();
  engine.start("precipitation");

  const releases: Array<{
    object: SceneObject;
    reason: ReleaseReason;
    position: { x: number; y: number; z: number };
  }> = [];
  const controller = new InteractionController(scene, {
    onRelease: (object, position, reason) => {
      releases.push({ object, reason, position });
      if (reason !== "user") {
        return;
      }
      const targetId = targetAt(position, {
        id: "beaker",
        x: 0,
        y: 0.8,
        z: 0,
      });
      engine.attemptTransfer(object.id ?? object.name, targetId);
    },
  });

  let now = 0;
  const atReagent = rawHandForWorld(-2, 0.9);
  controller.update(
    {
      landmarks: landmarks(
        atReagent.centerX,
        atReagent.centerY,
        OPEN_PINCH,
        1,
        true,
      ),
      handedness: "Right",
    },
    now,
  );
  now = 10;
  controller.update(
    {
      landmarks: landmarks(
        atReagent.centerX,
        atReagent.centerY,
        CLOSED_PINCH,
        1,
        true,
      ),
      handedness: "Right",
    },
    now,
  );
  now = 140;
  let snapshot = controller.update(
    {
      landmarks: landmarks(
        atReagent.centerX,
        atReagent.centerY,
        CLOSED_PINCH,
        1,
        true,
      ),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.selectedName, "BaCl2");
  assert.equal(scene.held, bacl2);

  // Carry the bottle to the vessel and release the pinch.
  const atTarget = rawHandForWorld(0, 1.1);
  now = 250;
  snapshot = controller.update(
    {
      landmarks: landmarks(
        atTarget.centerX,
        atTarget.centerY,
        CLOSED_PINCH,
        1,
        true,
      ),
      handedness: "Right",
    },
    now,
  );
  assert.equal(snapshot.selectedName, "BaCl2");

  now = 300;
  controller.update(
    {
      landmarks: landmarks(
        atTarget.centerX,
        atTarget.centerY,
        OPEN_PINCH,
        1,
        true,
      ),
      handedness: "Right",
    },
    now,
  );

  assert.equal(releases.length, 1, "one pinch release → one transfer attempt");
  assert.equal(releases[0]?.reason, "user");
  assert.equal(releases[0]?.object, bacl2);
  const state = engine.getSnapshot();
  assert.equal(state.stepIndex, 1);
  assert.equal(state.phase, "animating");

  // Releasing during the animation cannot fire another experiment action.
  now = 350;
  controller.update(
    {
      landmarks: landmarks(atTarget.centerX, atTarget.centerY, OPEN_PINCH),
      handedness: "Right",
    },
    now,
  );
  assert.equal(releases.length, 1);

  // Tracking loss while holding must release the object but never validate a
  // chemistry step.
  engine.restart();
  bacl2.mesh.position.set(-2, 0.9, 0);
  now = 400;
  const atReagentAgain = rawHandForWorld(-2, 0.9);
  controller.update(
    {
      landmarks: landmarks(
        atReagentAgain.centerX,
        atReagentAgain.centerY,
        CLOSED_PINCH,
      ),
      handedness: "Right",
    },
    now,
  );
  now = 650;
  controller.update(
    {
      landmarks: landmarks(
        atReagentAgain.centerX,
        atReagentAgain.centerY,
        CLOSED_PINCH,
      ),
      handedness: "Right",
    },
    now,
  );
  assert.equal(scene.held !== null, true);
  now = 1000;
  controller.update(null, now);
  now = 1400;
  controller.update(null, now);
  assert.equal(releases.length, 2);
  assert.equal(releases[1]?.reason, "lost");
  assert.equal(engine.getSnapshot().stepIndex, 0);
}

checkPrecipitationStateMachine();
checkLimestoneStateMachine();
checkGestureToExperimentBridge();
console.log("experiments: state machine, validation, completion, restart OK");
console.log("integration: pinch → carry → release → experiment step OK");
