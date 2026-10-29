/**
 * The chemistry laboratory view.
 *
 * This is the only module that touches the renderer and the experiment scene
 * graph. It implements the small `InteractionScene` interface used by the hand
 * interaction controller, so the MediaPipe pipeline never knows what a beaker
 * or a reagent bottle is.
 */
import * as THREE from "three";
import type {
  InteractionScene,
  SceneHighlight,
  SceneObject,
} from "../scene";
import {
  buildBeaker,
  buildFlask,
  buildLimestoneModel,
  buildReagentModel,
  buildTestTubeModel,
  centreModel,
  createLabelSprite,
  type ReagentModel,
  type VesselVisual,
} from "./models";
import type { ExperimentDefinition, ExperimentEffect } from "./experiments";

const CURSOR_IDLE = 0x7fe7ff;
const CURSOR_HOVER = 0xffc86b;
const CURSOR_HELD = 0x6fe3a5;
const TARGET_READY = 0x7fe7ff;
const TARGET_NEAR = 0x6fe3a5;
const TARGET_REJECT = 0xff7b7b;

import { CameraController } from "../cameraController";

export interface SceneInstrumentInfo {
  readonly id: string;
  readonly name: string;
  readonly grabbable: boolean;
}

interface InstrumentRecord {
  readonly id: string;
  readonly root: THREE.Group;
  readonly home: THREE.Vector3;
  readonly height: number;
  readonly object: SceneObject;
  readonly halo: THREE.Mesh;
  readonly haloMaterial: THREE.MeshBasicMaterial;
  readonly label: THREE.Sprite;
  readonly vessel: VesselVisual | null;
  canGrab: boolean;
}

interface RestTween {
  readonly record: InstrumentRecord;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  elapsed: number;
  duration: number;
}

interface PourTask {
  readonly record: InstrumentRecord;
  readonly target: InstrumentRecord;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly stream: THREE.Mesh;
  elapsed: number;
  resolved: boolean;
  readonly resolve: () => void;
}

interface ReactionTask {
  readonly vessel: VesselVisual;
  elapsed: number;
  duration: number;
  readonly resolve: () => void;
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export class ChemistryScene implements InteractionScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly container: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly intersections: THREE.Intersection[] = [];
  private readonly pickNdc = new THREE.Vector2();
  private readonly projectedCursor = new THREE.Vector3();
  private readonly cursorPosition = new THREE.Vector3();
  private readonly cursorGroup: THREE.Group;
  private readonly cursorRingMaterial: THREE.MeshBasicMaterial;
  private readonly cursorDotMaterial: THREE.MeshBasicMaterial;
  private readonly cursorRing: THREE.Mesh;
  private readonly resizeObserver: ResizeObserver;
  private readonly instruments: InstrumentRecord[] = [];
  private readonly instrumentByRoot = new Map<THREE.Object3D, InstrumentRecord>();
  private readonly restTweens: RestTween[] = [];
  private readonly pours: PourTask[] = [];
  private readonly reactions: ReactionTask[] = [];
  private readonly disposalRoots: THREE.Object3D[] = [];
  private hovered: SceneObject | null = null;
  private held: SceneObject | null = null;
  private targetId: string | null = null;
  private cursorVisible = false;
  private cursorTone: "idle" | "hover" | "held" = "idle";
  private time = 0;
  private rejectFlashUntil = 0;
  private cameraController: CameraController;
  private readonly heldPrevPos = new THREE.Vector3();
  private heldTiltZ = 0;
  private heldTiltX = 0;
  private heldSpringY = 0;
  private heldSpringVelY = 0;
  private heldPourTilt = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060b11);
    this.scene.fog = new THREE.Fog(0x060b11, 18, 34);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
    this.camera.position.set(0, 4.6, 8.8);
    this.camera.lookAt(new THREE.Vector3(0, 1.0, -0.2));

    this.cameraController = new CameraController(
      this.camera,
      this.renderer.domElement,
    );

    this.buildRoom();
    this.addLights();

    this.cursorGroup = new THREE.Group();
    this.cursorRingMaterial = new THREE.MeshBasicMaterial({
      color: CURSOR_IDLE,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.cursorDotMaterial = new THREE.MeshBasicMaterial({
      color: CURSOR_IDLE,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.cursorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.28, 40),
      this.cursorRingMaterial,
    );
    this.cursorRing.rotation.x = -Math.PI / 2;
    this.cursorRing.renderOrder = 30;
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.045, 20),
      this.cursorDotMaterial,
    );
    dot.rotation.x = -Math.PI / 2;
    dot.renderOrder = 31;
    this.cursorGroup.add(this.cursorRing, dot);
    this.cursorGroup.visible = false;
    this.scene.add(this.cursorGroup);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.showSelectionScene();
  }

  // ---------------------------------------------------------------------
  // InteractionScene
  // ---------------------------------------------------------------------

  setCursor(
    x: number,
    z: number,
    y = 0,
    screenX?: number,
    screenY?: number,
  ): void {
    const renderY = Math.max(y, 0.02);
    this.cursorPosition.set(x, renderY, z);
    this.cursorGroup.position.set(x, renderY, z);
    this.cursorGroup.visible = true;
    this.cursorVisible = true;

    if (screenX !== undefined && screenY !== undefined) {
      // MediaPipe x is 0..1 (video space), mirrored so 1 - screenX maps to display left-to-right
      const mirroredX = 1 - screenX;
      // Convert to Normalized Device Coordinates (NDC) [-1, 1]
      const ndcX = mirroredX * 2 - 1;
      const ndcY = -(screenY * 2 - 1);
      this.pickNdc.set(ndcX, ndcY);
    } else {
      this.projectedCursor.copy(this.cursorPosition).project(this.camera);
      this.pickNdc.set(this.projectedCursor.x, this.projectedCursor.y);
    }
  }

  setCursorVisible(visible: boolean): void {
    this.cursorVisible = visible;
    this.cursorGroup.visible = visible;
  }

  pickAtCursor(): SceneObject | null {
    if (!this.cursorVisible) {
      return null;
    }
    this.raycaster.setFromCamera(this.pickNdc, this.camera);
    this.intersections.length = 0;
    const roots = this.instruments
      .filter((record) => record.canGrab)
      .map((record) => record.root);
    this.raycaster.intersectObjects(roots, true, this.intersections);
    for (const hit of this.intersections) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        const record = this.instrumentByRoot.get(node);
        if (record) {
          return record.object;
        }
        node = node.parent;
      }
    }
    return null;
  }

  setHovered(object: SceneObject | null): void {
    if (this.hovered === object) {
      return;
    }
    if (this.hovered && this.hovered !== this.held) {
      this.applyHighlight(this.hovered, "none");
    }
    this.hovered = object;
    if (object && object !== this.held) {
      this.applyHighlight(object, "hover");
    }
    this.refreshCursorAppearance();
  }

  setHeld(object: SceneObject | null): void {
    if (this.held === object) {
      return;
    }
    if (this.held) {
      this.applyHighlight(this.held, this.held === this.hovered ? "hover" : "none");
      const prevRecord = this.recordForObject(this.held);
      if (prevRecord?.root.children[0]) {
        prevRecord.root.children[0].position.y = 0;
      }
    }
    this.held = object;
    if (object) {
      this.applyHighlight(object, "held");
    }
    this.refreshCursorAppearance();
  }

  // ---------------------------------------------------------------------
  // Scene lifecycle
  // ---------------------------------------------------------------------

  loadExperiment(definition: ExperimentDefinition): void {
    this.clearInstruments();
    const targetKind = definition.id === "precipitation" ? "beaker" : "flask";
    const target =
      targetKind === "beaker"
        ? this.addTarget("beaker", buildBeaker(), 0, 0.1)
        : this.addTarget("flask", buildFlask(), 0, 0.1);
    this.targetId = target.id;

    if (definition.id === "precipitation") {
      this.addReagent("bacl2", buildReagentModel("bacl2"), -2.05, 0.1);
      this.addReagent("h2so4", buildReagentModel("h2so4_dil"), 2.05, 0.1);
      target.vessel?.setTargetHighlight(TARGET_READY, 0.6);
    } else {
      this.addReagent("caco3", buildLimestoneModel(), -2.05, 0.1);
      this.addReagent("hcl", buildReagentModel("hcl_dil"), 2.05, 0.1);
      target.vessel?.setTargetHighlight(TARGET_READY, 0.6);
    }
  }

  showSelectionScene(): void {
    this.clearInstruments();
    const beaker = buildBeaker();
    const testTube = buildTestTubeModel();
    const bottle = buildReagentModel("na2co3");

    if (beaker) {
      const wrapper = new THREE.Group();
      wrapper.add(beaker.group);
      wrapper.position.set(0.2, beaker.height / 2, 0.2);
      const label = createLabelSprite(beaker.label, "glassware", "#6fe3a5");
      label.position.set(0, beaker.height / 2 + 0.42, 0);
      wrapper.add(label);
      this.scene.add(wrapper);
      this.disposalRoots.push(wrapper);
      beaker.setLiquid(0x9bd7ff, 0.26);
    }
    if (testTube) {
      const { wrapper, height } = centreModel(testTube.group);
      wrapper.position.set(-2.0, height / 2, 0);
      const label = createLabelSprite(testTube.title, testTube.subtitle);
      label.position.set(0, height / 2 + 0.26, 0);
      wrapper.add(label);
      this.scene.add(wrapper);
      this.disposalRoots.push(wrapper);
    }
    if (bottle) {
      const { wrapper, height } = centreModel(bottle.group);
      wrapper.position.set(2.0, height / 2, 0);
      const label = createLabelSprite(bottle.title, bottle.subtitle);
      label.position.set(0, height / 2 + 0.42, 0);
      wrapper.add(label);
      this.scene.add(wrapper);
      this.disposalRoots.push(wrapper);
    }

    const sign = createLabelSprite("ChemLab 3D", "choose an experiment", "#ffc86b");
    sign.scale.set(4.0, 1.45, 1);
    sign.position.set(0, 3.55, -5.4);
    this.scene.add(sign);
    this.disposalRoots.push(sign);
  }

  public get liveCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  setCameraControlEnabled(enabled: boolean): void {
    this.cameraController.setEnabled(enabled);
  }

  resetCamera(): void {
    this.cameraController.resetCamera();
  }

  getInstrumentInfo(): SceneInstrumentInfo[] {
    return this.instruments.map((record) => ({
      id: record.id,
      name: record.object.name,
      grabbable: record.object.grabbable !== false,
    }));
  }

  /** Exposed for the dev-only verification hook and UI diagnostics. */
  getInstrumentObject(id: string): SceneObject | null {
    return this.instruments.find((record) => record.id === id)?.object ?? null;
  }

  getInstrumentPosition(id: string): { x: number; y: number; z: number } | null {
    const record = this.instruments.find((item) => item.id === id);
    if (!record) {
      return null;
    }
    return {
      x: record.root.position.x,
      y: record.root.position.y,
      z: record.root.position.z,
    };
  }

  targetUnderHeld(): string | null {
    if (!this.held) {
      return null;
    }
    const record = this.recordForObject(this.held);
    if (!record) {
      return null;
    }
    return this.findTargetAt(record.root.position)?.id ?? null;
  }

  /** Which target, if any, is under a released instrument. */
  findTargetAt(position: THREE.Vector3): InstrumentRecord | null {
    let best: { record: InstrumentRecord; distance: number } | null = null;
    for (const record of this.instruments) {
      if (record.object.grabbable !== false) {
        continue;
      }
      const dx = position.x - record.root.position.x;
      const dz = position.z - record.root.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 1.15) {
        continue;
      }
      const top = record.height + 0.9;
      if (position.y < -0.2 || position.y > top + 1.2) {
        continue;
      }
      if (!best || distance < best.distance) {
        best = { record, distance };
      }
    }
    return best?.record ?? null;
  }

  returnToRest(object: SceneObject): void {
    const record = this.recordForObject(object);
    if (!record) {
      return;
    }
    record.canGrab = true;
    this.restTweens.push({
      record,
      from: record.root.position.clone(),
      to: record.home.clone(),
      elapsed: 0,
      duration: 0.38,
    });
  }

  rejectPlacement(object: SceneObject): void {
    this.returnToRest(object);
    this.rejectFlashUntil = this.time + 0.7;
  }

  /**
   * Animate a reagent bottle over a target vessel. Resolves after the bottle
   * has returned to its bench position. The caller applies the chemistry state
   * via `applyAddition`.
   */
  playPour(object: SceneObject, targetId: string, color: number): Promise<void> {
    const record = this.recordForObject(object);
    const target = this.instruments.find((item) => item.id === targetId);
    if (!record || !target || target.object.grabbable !== false) {
      return Promise.resolve();
    }
    record.canGrab = false;
    const from = record.root.position.clone();
    const to = new THREE.Vector3(
      target.root.position.x,
      target.root.position.y + target.height / 2 + record.height / 2 + 0.35,
      target.root.position.z,
    );
    const streamMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const stream = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.055, 1, 12),
      streamMaterial,
    );
    stream.visible = false;
    this.scene.add(stream);
    return new Promise((resolve) => {
      this.pours.push({
        record,
        target,
        from,
        to,
        stream,
        elapsed: 0,
        resolved: false,
        resolve,
      });
    });
  }

  /** Apply the visual state for a validated experiment step. */
  applyAddition(definition: ExperimentDefinition, completedStep: number): void {
    const target = this.activeTarget();
    if (!target || !target.vessel) {
      return;
    }
    const vessel = target.vessel;
    const color = definition.liquidColors[completedStep] ?? 0xd9f7e5;
    if (definition.id === "precipitation") {
      vessel.setLiquid(color, completedStep === 0 ? 0.34 : 0.58);
      if (completedStep > 0) {
        vessel.startReaction("precipitate");
      }
    } else {
      if (completedStep === 0) {
        vessel.addLimestone();
      } else {
        vessel.setLiquid(color, 0.5);
        vessel.startReaction("bubbles");
      }
    }
  }

  /** Run the reaction animation and resolve after it has been visible. */
  playReaction(effect: ExperimentEffect): Promise<void> {
    const target = this.activeTarget();
    if (!target?.vessel) {
      return Promise.resolve();
    }
    const vessel = target.vessel;
    vessel.startReaction(effect);
    const duration = effect === "bubbles" ? 4.4 : 3.4;
    return new Promise((resolve) => {
      this.reactions.push({ vessel, elapsed: 0, duration, resolve });
    });
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  update(dt: number): void {
    this.time += dt;
    this.cameraController.update(dt);
    this.updateHeldTiltPhysics(dt);
    this.counterRotateBottleLiquid();
    this.updateRestTweens(dt);
    this.updatePours(dt);
    this.updateReactions(dt);
    for (const record of this.instruments) {
      record.vessel?.update(dt);
    }
    this.updateTargetFeedback();
    this.cursorRing.rotation.z += dt * 0.8;
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.scene.traverse((object) => {
      const renderable = object as THREE.Mesh;
      renderable.geometry?.dispose();
      if (Array.isArray(renderable.material)) {
        for (const material of renderable.material) {
          disposeMaterial(material);
        }
      } else if (renderable.material) {
        disposeMaterial(renderable.material);
      }
    });
    this.cameraController.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // ---------------------------------------------------------------------
  // Instrument construction
  // ---------------------------------------------------------------------

  private addReagent(
    id: string,
    model: ReagentModel | null,
    x: number,
    z: number,
  ): InstrumentRecord | null {
    if (!model) {
      return null;
    }
    const { wrapper, height } = centreModel(model.group);
    const root = new THREE.Group();
    root.add(wrapper);
    root.position.set(x, height / 2, z);
    const label = createLabelSprite(model.title, model.subtitle);
    label.position.set(0, height / 2 + 0.42, 0);
    root.add(label);

    const haloMaterial = new THREE.MeshBasicMaterial({
      color: CURSOR_IDLE,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 40), haloMaterial);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -height / 2 + 0.015;
    halo.renderOrder = 4;
    root.add(halo);

    const object: SceneObject = {
      id,
      name: model.title,
      mesh: root,
      restY: height / 2,
      grabbable: true,
      onHighlight: (state) => this.highlightInstrument(haloMaterial, state),
    };
    const record: InstrumentRecord = {
      id,
      root,
      home: root.position.clone(),
      height,
      object,
      halo,
      haloMaterial,
      label,
      vessel: null,
      canGrab: true,
    };
    this.instruments.push(record);
    this.instrumentByRoot.set(root, record);
    this.scene.add(root);
    return record;
  }

  private addTarget(
    id: string,
    vessel: VesselVisual,
    x: number,
    z: number,
  ): InstrumentRecord {
    const root = new THREE.Group();
    root.add(vessel.group);
    root.position.set(x, vessel.height / 2, z);
    const label = createLabelSprite(vessel.label, "drop target", "#6fe3a5");
    label.position.set(0, vessel.height / 2 + 0.42, 0);
    root.add(label);

    const haloMaterial = new THREE.MeshBasicMaterial({
      color: TARGET_READY,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.92, 48), haloMaterial);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -vessel.height / 2 + 0.02;
    halo.renderOrder = 4;
    root.add(halo);

    const object: SceneObject = {
      id,
      name: vessel.label,
      mesh: root,
      restY: vessel.height / 2,
      grabbable: false,
      onHighlight: (state) => {
        this.highlightInstrument(haloMaterial, state);
        vessel.setTargetHighlight(
          state === "none" ? TARGET_READY : state === "hover" ? CURSOR_HOVER : TARGET_NEAR,
          state === "none" ? 0.55 : 0.85,
        );
      },
    };
    const record: InstrumentRecord = {
      id,
      root,
      home: root.position.clone(),
      height: vessel.height,
      object,
      halo,
      haloMaterial,
      label,
      vessel,
      canGrab: false,
    };
    this.instruments.push(record);
    this.instrumentByRoot.set(root, record);
    this.scene.add(root);
    return record;
  }

  private clearInstruments(): void {
    this.restTweens.length = 0;
    for (const pour of this.pours) {
      if (!pour.resolved) {
        pour.resolved = true;
        this.scene.remove(pour.stream);
        disposeObject(pour.stream);
        pour.resolve();
      }
    }
    this.pours.length = 0;
    for (const reaction of this.reactions) {
      reaction.resolve();
    }
    this.reactions.length = 0;
    for (const record of this.instruments) {
      this.scene.remove(record.root);
      disposeObject(record.root);
    }
    this.instruments.length = 0;
    this.instrumentByRoot.clear();
    this.targetId = null;
    this.held = null;
    this.hovered = null;
    this.cursorTone = "idle";
    this.setCursorVisible(false);

    for (const root of this.disposalRoots.splice(0)) {
      this.scene.remove(root);
      disposeObject(root);
    }
  }

  private activeTarget(): InstrumentRecord | null {
    if (!this.targetId) {
      return null;
    }
    return this.instruments.find((record) => record.id === this.targetId) ?? null;
  }

  private recordForObject(object: SceneObject): InstrumentRecord | null {
    return this.instruments.find((record) => record.object === object) ?? null;
  }

  private applyHighlight(object: SceneObject, highlight: SceneHighlight): void {
    object.onHighlight?.(highlight);
  }

  private highlightInstrument(
    material: THREE.MeshBasicMaterial,
    state: SceneHighlight,
  ): void {
    if (state === "held") {
      material.color.setHex(CURSOR_HELD);
      material.opacity = 0.95;
    } else if (state === "hover") {
      material.color.setHex(CURSOR_HOVER);
      material.opacity = 0.85;
    } else {
      material.opacity = 0;
    }
  }

  private refreshCursorAppearance(): void {
    const tone = this.held ? "held" : this.hovered ? "hover" : "idle";
    if (tone === this.cursorTone) {
      return;
    }
    this.cursorTone = tone;
    const color =
      tone === "held" ? CURSOR_HELD : tone === "hover" ? CURSOR_HOVER : CURSOR_IDLE;
    this.cursorRingMaterial.color.setHex(color);
    this.cursorDotMaterial.color.setHex(color);
  }

  private updateTargetFeedback(): void {
    const nearTargetId = this.targetUnderHeld();
    const reject = this.time < this.rejectFlashUntil;
    const pulse = 0.5 + Math.sin(this.time * 2.4) * 0.12;
    for (const record of this.instruments) {
      if (!record.vessel || record.object.grabbable !== false) {
        continue;
      }
      if (reject) {
        record.vessel.setTargetHighlight(TARGET_REJECT, 0.95);
      } else if (nearTargetId === record.id) {
        record.vessel.setTargetHighlight(TARGET_NEAR, 0.95);
      } else if (nearTargetId === null) {
        record.vessel.setTargetHighlight(TARGET_READY, pulse);
      }
    }
  }

  private updateHeldTiltPhysics(dt: number): void {
    if (!this.held) {
      this.heldPrevPos.set(0, 0, 0);
      this.heldTiltZ = 0;
      this.heldTiltX = 0;
      this.heldSpringY = 0;
      this.heldSpringVelY = 0;
      this.heldPourTilt = 0;
      return;
    }

    const record = this.recordForObject(this.held);
    if (!record) {
      return;
    }

    const currentPos = record.root.position;

    // Initialize previous position if first frame
    if (this.heldPrevPos.lengthSq() === 0) {
      this.heldPrevPos.copy(currentPos);
    }

    // Velocity estimation
    const vx = (currentPos.x - this.heldPrevPos.x) / Math.max(0.001, dt);
    const vz = (currentPos.z - this.heldPrevPos.z) / Math.max(0.001, dt);
    this.heldPrevPos.copy(currentPos);

    // Carry tilt based on horizontal velocity (max ~15° = ~0.26 rad)
    const maxTilt = 0.26;
    const targetTiltZ = Math.max(-maxTilt, Math.min(maxTilt, -vx * 0.12));
    const targetTiltX = Math.max(-maxTilt, Math.min(maxTilt, vz * 0.12));
    this.heldTiltZ += (targetTiltZ - this.heldTiltZ) * Math.min(1, dt * 10);
    this.heldTiltX += (targetTiltX - this.heldTiltX) * Math.min(1, dt * 10);

    // Subtle spring wobble while suspended
    const speed = Math.hypot(vx, vz);
    const springK = 25;
    const springDamp = 4;
    const force = -springK * this.heldSpringY - springDamp * this.heldSpringVelY;
    this.heldSpringVelY += (force + Math.sin(this.time * 9) * speed * 0.05) * dt;
    this.heldSpringY += this.heldSpringVelY * dt;
    this.heldSpringY = Math.max(-0.03, Math.min(0.03, this.heldSpringY));

    // Check distance to target vessel (beaker / flask)
    let pourAngle = 0;
    const targetRecord = this.activeTarget();
    if (targetRecord) {
      const dx = currentPos.x - targetRecord.root.position.x;
      const dz = currentPos.z - targetRecord.root.position.z;
      const dist = Math.hypot(dx, dz);
      const triggerDist = 1.45;
      if (dist < triggerDist) {
        // Tilt towards beaker (60°–75° = ~1.05–1.3 rad)
        const factor = 1 - dist / triggerDist;
        pourAngle = -1.15 * factor;
      }
    }

    // Blend pour tilt smoothly
    this.heldPourTilt += (pourAngle - this.heldPourTilt) * Math.min(1, dt * 8);

    // Apply combined rotations
    record.root.rotation.z = this.heldPourTilt < -0.05 ? this.heldPourTilt : this.heldTiltZ;
    record.root.rotation.x = this.heldPourTilt < -0.05 ? 0 : this.heldTiltX;

    // Apply subtle spring wobble to inner wrapper child mesh without overriding root position
    const innerWrapper = record.root.children[0];
    if (innerWrapper) {
      innerWrapper.position.y = this.heldSpringY;
    }
  }

  private counterRotateBottleLiquid(): void {
    for (const record of this.instruments) {
      if (record.object.grabbable === false) {
        continue;
      }
      // Reagent bottle root rotation
      const rootRotZ = record.root.rotation.z;
      const rootRotX = record.root.rotation.x;

      record.root.traverse((node) => {
        if (node.name === "stock-liquid") {
          node.rotation.z = -rootRotZ;
          node.rotation.x = -rootRotX;
        }
      });
    }
  }

  private updateRestTweens(dt: number): void {
    for (let index = this.restTweens.length - 1; index >= 0; index -= 1) {
      const tween = this.restTweens[index];
      if (!tween) {
        continue;
      }
      tween.elapsed += dt;
      const t = smoothstep(tween.elapsed / tween.duration);
      tween.record.root.position.lerpVectors(tween.from, tween.to, t);
      if (tween.elapsed >= tween.duration) {
        tween.record.root.position.copy(tween.to);
        tween.record.root.rotation.set(0, 0, 0);
        tween.record.canGrab = tween.record.object.grabbable !== false;
        this.restTweens.splice(index, 1);
      }
    }
  }

  private updatePours(dt: number): void {
    for (let index = this.pours.length - 1; index >= 0; index -= 1) {
      const pour = this.pours[index];
      if (!pour) {
        continue;
      }
      pour.elapsed += dt;
      const moveIn = smoothstep(pour.elapsed / 0.5);
      const back = smoothstep((pour.elapsed - 1.55) / 0.55);
      if (pour.elapsed <= 1.55) {
        pour.record.root.position.lerpVectors(pour.from, pour.to, moveIn);
      } else {
        pour.record.root.position.lerpVectors(pour.to, pour.record.home, back);
      }
      const tilt = smoothstep((pour.elapsed - 0.35) / 0.25) * (1 - smoothstep((pour.elapsed - 1.25) / 0.25));
      pour.record.root.rotation.z = -1.05 * tilt;

      const targetY = pour.target.root.position.y + pour.target.height / 2;
      const showing = pour.elapsed > 0.55 && pour.elapsed < 1.45;
      pour.stream.visible = showing;
      if (showing) {
        const top = pour.record.root.position.y - 0.1;
        const bottom = targetY + 0.08;
        const height = Math.max(0.05, top - bottom);
        pour.stream.scale.y = height;
        pour.stream.position.set(
          pour.target.root.position.x,
          bottom + height / 2,
          pour.target.root.position.z,
        );
      }

      if (pour.elapsed >= 2.1) {
        pour.record.root.position.copy(pour.record.home);
        pour.record.root.rotation.set(0, 0, 0);
        pour.record.canGrab = true;
        this.scene.remove(pour.stream);
        disposeObject(pour.stream);
        pour.resolved = true;
        pour.resolve();
        this.pours.splice(index, 1);
      }
    }
  }

  private updateReactions(dt: number): void {
    for (let index = this.reactions.length - 1; index >= 0; index -= 1) {
      const reaction = this.reactions[index];
      if (!reaction) {
        continue;
      }
      reaction.elapsed += dt;
      if (reaction.elapsed >= reaction.duration) {
        reaction.resolve();
        this.reactions.splice(index, 1);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Environment
  // ---------------------------------------------------------------------

  private buildRoom(): void {
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x0b1219,
      roughness: 0.88,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 24), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -2.3, -2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x111c26,
      roughness: 0.92,
    });
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(28, 14, 0.3), wallMaterial);
    backWall.position.set(0, 4.6, -7);
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 14, 18), wallMaterial);
    leftWall.position.set(-9.5, 4.6, -1.5);
    this.scene.add(leftWall);

    const rightWall = leftWall.clone();
    rightWall.position.x = 9.5;
    this.scene.add(rightWall);

    const benchTop = new THREE.Mesh(
      new THREE.BoxGeometry(12.5, 0.35, 5.2),
      new THREE.MeshStandardMaterial({
        color: 0x1b2a33,
        roughness: 0.55,
        metalness: 0.15,
      }),
    );
    benchTop.position.set(0, -0.175, -0.55);
    benchTop.castShadow = true;
    benchTop.receiveShadow = true;
    this.scene.add(benchTop);

    const benchBody = new THREE.Mesh(
      new THREE.BoxGeometry(11.9, 2.1, 4.6),
      new THREE.MeshStandardMaterial({ color: 0x101a22, roughness: 0.75 }),
    );
    benchBody.position.set(0, -1.4, -0.55);
    benchBody.castShadow = true;
    benchBody.receiveShadow = true;
    this.scene.add(benchBody);

    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(12.6, 0.06, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0x2f6f83,
        emissive: 0x123f4c,
        emissiveIntensity: 0.8,
        roughness: 0.35,
      }),
    );
    edge.position.set(0, 0.02, 2.07);
    this.scene.add(edge);

    // Back shelf with a row of inert bottles for a laboratory silhouette.
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(10.5, 0.16, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.7 }),
    );
    shelf.position.set(0, 2.45, -5.55);
    shelf.receiveShadow = true;
    this.scene.add(shelf);

    const bottleColors = [0x6fe3a5, 0x7fb7ff, 0xffc86b, 0xd58cff, 0xff9c7a];
    bottleColors.forEach((color, index) => {
      const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.2, 0.72, 16),
        new THREE.MeshPhysicalMaterial({
          color,
          transparent: true,
          opacity: 0.5,
          roughness: 0.12,
          transmission: 0.3,
          depthWrite: false,
        }),
      );
      bottle.position.set(-4 + index * 1.9, 2.9, -5.55);
      bottle.castShadow = true;
      this.scene.add(bottle);
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.1, 0.28, 12),
        new THREE.MeshStandardMaterial({ color: 0x16232c, roughness: 0.5 }),
      );
      neck.position.set(bottle.position.x, 3.38, -5.55);
      this.scene.add(neck);
    });

    // Window and light panel on the left wall.
    const windowFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 5.4, 6.4),
      new THREE.MeshStandardMaterial({ color: 0x1a2d3a, roughness: 0.6 }),
    );
    windowFrame.position.set(-8.7, 4.1, -2.8);
    this.scene.add(windowFrame);
    const windowPane = new THREE.Mesh(
      new THREE.PlaneGeometry(5.9, 4.9),
      new THREE.MeshBasicMaterial({ color: 0x2d5368 }),
    );
    windowPane.rotation.y = Math.PI / 2;
    windowPane.position.set(-8.62, 4.1, -2.8);
    this.scene.add(windowPane);

    const stripMaterial = new THREE.MeshStandardMaterial({
      color: 0xe9fbff,
      emissive: 0x9fe8ff,
      emissiveIntensity: 2.4,
      roughness: 0.3,
    });
    for (const x of [-3.6, 0, 3.6]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.3), stripMaterial);
      strip.position.set(x, 6.8, -2.4);
      this.scene.add(strip);
    }

    const backSign = createLabelSprite(
      "CHEMISTRY LAB",
      "gesture-controlled bench",
      "#2f6f83",
    );
    backSign.scale.set(5.2, 1.95, 1);
    backSign.position.set(0, 5.55, -6.8);
    this.scene.add(backSign);

    // A subtle tray under the working area.
    const tray = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 0.04, 2.8),
      new THREE.MeshStandardMaterial({
        color: 0x10303b,
        roughness: 0.6,
        metalness: 0.1,
      }),
    );
    tray.position.set(0, 0.02, 0.1);
    tray.receiveShadow = true;
    this.scene.add(tray);
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xb9e8ff, 0x0a1218, 1.25));

    const key = new THREE.DirectionalLight(0xfff4e6, 3.1);
    key.position.set(4.5, 9.5, 5.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 28;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x6fb8ff, 1.1);
    fill.position.set(-6, 5, 4);
    this.scene.add(fill);

    const rim = new THREE.PointLight(0x54d9ff, 14, 14, 2);
    rim.position.set(-3.5, 3.2, -3.5);
    this.scene.add(rim);
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}

function disposeMaterial(material: THREE.Material): void {
  // Sprite labels own a CanvasTexture that is not released by
  // Material.dispose(); clear it so repeated restarts do not leak GPU memory.
  const mapped = material as THREE.Material & { map?: THREE.Texture | null };
  mapped.map?.dispose();
  material.dispose();
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh;
    renderable.geometry?.dispose();
    if (Array.isArray(renderable.material)) {
      for (const material of renderable.material) {
        disposeMaterial(material);
      }
    } else if (renderable.material) {
      disposeMaterial(renderable.material);
    }
  });
}
