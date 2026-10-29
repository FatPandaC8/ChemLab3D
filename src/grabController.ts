/**
 * GrabController — physics-based grab/move/release for held instruments.
 *
 * Handles:
 * - Damped position interpolation (exponential decay, deltaTime-dependent)
 * - Lift animation on grab (easeOutCubic, 150ms)
 * - Tilt based on velocity
 * - Spring wobble while held
 * - Proximity-based pour tilt when over target vessel
 * - Smooth return-to-home on release
 * - Tracking loss grace period
 */
import * as THREE from "three";
import { LAB_CONFIG } from "./config";
import type { SceneObject } from "./scene";

export type GrabPhase =
  | "idle"
  | "lifting"
  | "held"
  | "returning"
  | "pouring";

export interface GrabTarget {
  /** World position of the target vessel's mouth */
  position: THREE.Vector3;
  /** Id of the target vessel */
  id: string;
}

/** Callback called by GrabController on significant lifecycle events */
export interface GrabControllerEvents {
  /** Called every frame while object is grabbed, with the current world target position */
  onMove?: (object: SceneObject, worldPos: THREE.Vector3) => void;
  /** Called when object is fully returned to rest */
  onReturned?: (object: SceneObject) => void;
  /** Called while held bottle is near a pour target */
  onPourProgress?: (object: SceneObject, targetId: string, fraction: number) => void;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - Math.min(1, t), 3);
}

export class GrabController {
  private held: SceneObject | null = null;
  private phase: GrabPhase = "idle";

  // Smooth damped position
  private readonly currentPos = new THREE.Vector3();
  private readonly targetPos = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly prevPos = new THREE.Vector3();

  // Tilt state (rotation around Z-axis based on velocity X)
  private tiltZ = 0;
  private tiltTarget = 0;

  // Spring wobble (small Y offset)
  private springY = 0;
  private springVelY = 0;
  private time = 0;

  // Lift animation
  private liftElapsed = 0;
  private liftFrom = 0;
  private liftTo = 0;

  // Pour tilt (approach target vessel)
  private pourTilt = 0;
  private nearTargetId: string | null = null;

  // Return-to-home state
  private returnFrom = new THREE.Vector3();
  private returnTo = new THREE.Vector3();
  private returnElapsed = 0;

  // Scale (1.03 when grabbed, back to 1 when not)
  private scaleCurrent = 1;
  private scaleTarget = 1;

  private readonly events: GrabControllerEvents;

  constructor(events: GrabControllerEvents = {}) {
    this.events = events;
  }

  get heldObject(): SceneObject | null {
    return this.held;
  }

  get currentPhase(): GrabPhase {
    return this.phase;
  }

  get isActive(): boolean {
    return this.phase !== "idle";
  }

  get isPouringNear(): boolean {
    return this.pourTilt > 0.1;
  }

  get nearTarget(): string | null {
    return this.nearTargetId;
  }

  /**
   * Start grabbing an object. Call on pinch-confirm.
   * @param object The scene object to grab
   * @param targetWorldPos The hand's current world position (3D)
   */
  grab(object: SceneObject, targetWorldPos: THREE.Vector3): void {
    this.held = object;
    this.phase = "lifting";

    // Initialize positions
    object.mesh.getWorldPosition(this.currentPos);
    this.targetPos.copy(targetWorldPos);
    this.velocity.set(0, 0, 0);
    this.prevPos.copy(this.currentPos);

    // Lift parameters
    this.liftElapsed = 0;
    this.liftFrom = this.currentPos.y;
    this.liftTo = this.currentPos.y + LAB_CONFIG.grab.liftHeight;

    // Reset tilt/spring
    this.tiltZ = 0;
    this.tiltTarget = 0;
    this.springY = 0;
    this.springVelY = 0;
    this.pourTilt = 0;
    this.nearTargetId = null;

    // Scale up slightly
    this.scaleTarget = LAB_CONFIG.grab.scaleOnGrab;
    this.scaleCurrent = 1;
  }

  /**
   * Update the target position each frame while holding.
   * Called with the smoothed hand world position.
   */
  setTargetPosition(pos: THREE.Vector3): void {
    this.targetPos.copy(pos);
    if (this.phase === "idle" || this.phase === "returning") {
      return;
    }
    if (this.phase === "lifting") {
      // Once we've moved enough, switch to held
      // (lift will also transition in update())
    }
  }

  /**
   * Inform the grab controller that there is or isn't a nearby pour target.
   * Pass null to clear.
   */
  setNearTarget(targetId: string | null, targetWorldPos: THREE.Vector3 | null): void {
    this.nearTargetId = targetId;
    if (!targetId || !targetWorldPos || !this.held) {
      // Smoothly release pour tilt
      return;
    }
  }

  /**
   * Release the held object.
   * @param toRest If true, animate back to restY home; if false, stay in place (pour will handle).
   */
  release(toRest: boolean): SceneObject | null {
    if (!this.held) {
      return null;
    }
    const obj = this.held;

    if (toRest) {
      this.returnFrom.copy(this.currentPos);
      this.returnTo.set(obj.mesh.parent ? obj.mesh.parent.localToWorld(new THREE.Vector3()).x : obj.mesh.position.x, obj.restY, obj.mesh.parent ? obj.mesh.parent.localToWorld(new THREE.Vector3()).z : obj.mesh.position.z);

      // Reconstruct home position in world space
      const home = new THREE.Vector3();
      if (obj.mesh.parent) {
        obj.mesh.parent.updateWorldMatrix(true, false);
        home.copy(this.currentPos); // Will be set by scene's returnToRest
      }

      this.phase = "returning";
      this.returnElapsed = 0;
    } else {
      // Pour handles it — just clean up held state
      this.phase = "idle";
      this.held = null;
    }

    this.scaleTarget = 1;
    this.nearTargetId = null;

    // Do NOT set this.held = null here when returning — keep reference for animation
    if (this.phase !== "returning") {
      this.held = null;
    }

    return obj;
  }

  /**
   * Main update. Call every frame.
   * @param dt deltaTime in seconds
   * @param handWorldPos Current smoothed hand world position (null if tracking lost)
   * @param nearTarget Optional: closest pour target
   */
  update(
    dt: number,
    handWorldPos: THREE.Vector3 | null,
    nearTarget: { id: string; pos: THREE.Vector3 } | null,
  ): void {
    this.time += dt;
    const k = LAB_CONFIG.grab.positionLerpK;
    const lerpFactor = 1 - Math.exp(-k * dt);

    if (this.phase === "idle") {
      return;
    }

    if (this.phase === "returning") {
      this.returnElapsed += dt;
      const t = easeOutCubic(this.returnElapsed / LAB_CONFIG.tracking.returnDuration);
      if (this.held) {
        this.currentPos.lerpVectors(this.returnFrom, this.returnTo, t);
        this.applyTransform(this.held, 0, 1);
        if (t >= 1) {
          this.phase = "idle";
          this.events.onReturned?.(this.held);
          this.held = null;
        }
      } else {
        this.phase = "idle";
      }
      return;
    }

    if (!this.held) {
      this.phase = "idle";
      return;
    }

    // Update target from hand
    if (handWorldPos) {
      this.targetPos.copy(handWorldPos);
    }

    // Lift phase
    if (this.phase === "lifting") {
      this.liftElapsed += dt;
      const liftT = easeOutCubic(this.liftElapsed / LAB_CONFIG.grab.liftDuration);
      const liftY = this.liftFrom + (this.liftTo - this.liftFrom) * liftT;

      // Lerp X/Z toward target
      const xt = this.targetPos.x + (this.currentPos.x - this.targetPos.x) * (1 - lerpFactor);
      const zt = this.targetPos.z + (this.currentPos.z - this.targetPos.z) * (1 - lerpFactor);
      this.currentPos.set(xt, liftY, zt);

      if (this.liftElapsed >= LAB_CONFIG.grab.liftDuration) {
        this.phase = "held";
      }
    } else if (this.phase === "held") {
      // Track velocity for tilt
      const prevX = this.currentPos.x;
      const prevZ = this.currentPos.z;

      // Smooth position towards target
      this.currentPos.lerp(this.targetPos, lerpFactor);

      const velX = (this.currentPos.x - prevX) / Math.max(dt, 0.001);
      const velZ = (this.currentPos.z - prevZ) / Math.max(dt, 0.001);

      // Tilt from velocity
      const tiltMax = LAB_CONFIG.grab.tiltMaxRad;
      this.tiltTarget = -velX * LAB_CONFIG.grab.tiltVelocityScale;
      this.tiltTarget = Math.max(-tiltMax, Math.min(tiltMax, this.tiltTarget));
      this.tiltZ += (this.tiltTarget - this.tiltZ) * Math.min(1, dt * LAB_CONFIG.grab.tiltResponsiveness);

      // Spring wobble on Y
      const springK = LAB_CONFIG.grab.springFrequency;
      const springDamp = 0.85;
      const springForce = -springK * this.springY - springDamp * this.springVelY;
      // Add slight velocity-based perturbation
      const perturbation = Math.hypot(velX, velZ) * 0.02;
      this.springVelY += (springForce + Math.sin(this.time * 8.5) * perturbation * 0.1) * dt;
      this.springY += this.springVelY * dt;
      this.springY = Math.max(-0.05, Math.min(0.05, this.springY));

      // Pour tilt based on proximity to target
      this.updatePourTilt(dt, nearTarget);
    }

    // Scale interpolation
    this.scaleCurrent += (this.scaleTarget - this.scaleCurrent) * Math.min(1, dt * 10);

    // Apply all transforms
    const tiltRad = this.pourTilt > 0.01 ? this.pourTilt : this.tiltZ;
    this.applyTransform(this.held, tiltRad, this.scaleCurrent);

    // Report position for scene updates
    this.events.onMove?.(this.held, this.currentPos);

    // Pour progress callback
    if (this.nearTargetId && this.pourTilt > 0.05) {
      this.events.onPourProgress?.(this.held, this.nearTargetId, this.pourTilt / LAB_CONFIG.pour.pourTiltMaxRad);
    }
  }

  private updatePourTilt(dt: number, nearTarget: { id: string; pos: THREE.Vector3 } | null): void {
    if (nearTarget && this.held) {
      this.nearTargetId = nearTarget.id;
      // Calculate distance from current bottle position to target
      const dx = this.currentPos.x - nearTarget.pos.x;
      const dz = this.currentPos.z - nearTarget.pos.z;
      const dist = Math.hypot(dx, dz);
      const trigDist = LAB_CONFIG.pour.triggerDistance;

      if (dist < trigDist) {
        const fraction = 1 - (dist / trigDist);
        const pourTarget = LAB_CONFIG.pour.pourTiltMaxRad * fraction;
        // Approach smoothly
        this.pourTilt += (pourTarget - this.pourTilt) * Math.min(1, dt * 5);
      } else {
        this.pourTilt *= Math.exp(-dt * 4);
      }
    } else {
      // Relax pour tilt
      this.pourTilt *= Math.exp(-dt * 6);
      if (Math.abs(this.pourTilt) < 0.001) {
        this.pourTilt = 0;
        this.nearTargetId = null;
      }
    }
  }

  private applyTransform(object: SceneObject, tiltZ: number, scale: number): void {
    // Apply world position
    const parent = object.mesh.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      const localPos = parent.worldToLocal(this.currentPos.clone());
      object.mesh.position.copy(localPos);
    } else {
      object.mesh.position.copy(this.currentPos);
    }

    // Apply tilt rotation (Z-axis tilt for carry feel)
    // Pour tilt is around Z axis, velocity tilt same
    object.mesh.rotation.z = tiltZ;

    // Scale
    object.mesh.scale.setScalar(scale);
  }

  /** Force reset (e.g. experiment restart) */
  reset(): void {
    if (this.held) {
      // Reset scale and rotation
      this.held.mesh.rotation.set(0, 0, 0);
      this.held.mesh.scale.setScalar(1);
    }
    this.held = null;
    this.phase = "idle";
    this.pourTilt = 0;
    this.tiltZ = 0;
    this.springY = 0;
    this.springVelY = 0;
    this.nearTargetId = null;
  }

  /** Get current world position of held object */
  getCurrentPosition(): THREE.Vector3 {
    return this.currentPos.clone();
  }

  /** Get current tilt angle */
  getCurrentTilt(): number {
    return this.pourTilt > 0.01 ? this.pourTilt : this.tiltZ;
  }
}
