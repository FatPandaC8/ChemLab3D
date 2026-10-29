import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LAB_CONFIG } from "./config";

export class CameraController {
  public readonly controls: OrbitControls;
  private readonly defaultPosition: THREE.Vector3;
  private readonly defaultTarget: THREE.Vector3;
  private isResetting = false;
  private resetT = 0;
  private readonly resetDuration = 0.6;
  private readonly startPos = new THREE.Vector3();
  private readonly startTarget = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
  ) {
    this.defaultPosition = new THREE.Vector3(
      LAB_CONFIG.camera.defaultPosition.x,
      LAB_CONFIG.camera.defaultPosition.y,
      LAB_CONFIG.camera.defaultPosition.z,
    );
    this.defaultTarget = new THREE.Vector3(
      LAB_CONFIG.camera.defaultTarget.x,
      LAB_CONFIG.camera.defaultTarget.y,
      LAB_CONFIG.camera.defaultTarget.z,
    );

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = LAB_CONFIG.camera.dampingFactor;
    this.controls.minDistance = LAB_CONFIG.camera.minDistance;
    this.controls.maxDistance = LAB_CONFIG.camera.maxDistance;
    this.controls.maxPolarAngle = LAB_CONFIG.camera.maxPolarAngle;
    this.controls.target.copy(this.defaultTarget);
    this.controls.update();
  }

  public setEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.controls.enabled;
  }

  public update(dt: number): void {
    if (this.isResetting) {
      this.resetT += dt / this.resetDuration;
      const t = Math.min(1, this.resetT);
      // easeOutCubic
      const factor = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this.startPos, this.defaultPosition, factor);
      this.controls.target.lerpVectors(this.startTarget, this.defaultTarget, factor);
      if (t >= 1) {
        this.isResetting = false;
        this.camera.position.copy(this.defaultPosition);
        this.controls.target.copy(this.defaultTarget);
      }
    }
    this.controls.update();
  }

  public resetCamera(): void {
    this.startPos.copy(this.camera.position);
    this.startTarget.copy(this.controls.target);
    this.resetT = 0;
    this.isResetting = true;
  }

  public dispose(): void {
    this.controls.dispose();
  }
}
