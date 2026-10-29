import * as THREE from "three";

/** Rectangular region of the ground plane that the hand can reach. */
export const INTERACTION_BOUNDS = {
  minX: -2.9,
  maxX: 2.9,
  minZ: -2.2,
  maxZ: 2.2,
} as const;

export type SceneHighlight = "none" | "hover" | "held";

export interface SceneObject {
  /** Stable identifier used by the chemistry layer (optional for demo objects). */
  readonly id?: string;
  readonly name: string;
  readonly mesh: THREE.Object3D;
  readonly material?: THREE.MeshStandardMaterial;
  /** Mesh Y at rest on the ground; also the object's half-height. */
  readonly restY: number;
  /** Targets can be hovered but never picked up. */
  readonly grabbable?: boolean;
  /** Custom highlight hook for objects made of several meshes. */
  readonly onHighlight?: (highlight: SceneHighlight) => void;
}

/** The slice of the 3D view that the hand interaction controller needs. */
export interface InteractionScene {
  setCursor(
    x: number,
    z: number,
    y?: number,
    screenX?: number,
    screenY?: number,
  ): void;
  setCursorVisible(visible: boolean): void;
  pickAtCursor(): SceneObject | null;
  setHovered(object: SceneObject | null): void;
  setHeld(object: SceneObject | null): void;
}

type Highlight = SceneHighlight;
type CursorTone = "idle" | "hover" | "held";

const CURSOR_COLORS: Record<CursorTone, number> = {
  idle: 0x7fe7ff,
  hover: 0xffc86b,
  held: 0x6fe3a5,
};

const HOVER_EMISSIVE = 0x202020;
const HELD_EMISSIVE = 0x525252;
const SELECTION_HOVER_COLOR = 0xffc86b;
const SELECTION_HELD_COLOR = 0x6fe3a5;

export class SceneView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly selectable: THREE.Mesh[] = [];
  private readonly objectByMesh = new Map<THREE.Object3D, SceneObject>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly intersections: THREE.Intersection[] = [];
  private readonly pickNdc = new THREE.Vector2();
  private readonly projectedCursor = new THREE.Vector3();
  private readonly cursorPosition = new THREE.Vector3();
  private readonly cursorGroup: THREE.Group;
  private readonly cursorRingMaterial: THREE.MeshBasicMaterial;
  private readonly cursorDotMaterial: THREE.MeshBasicMaterial;
  private readonly selectionRing: THREE.Mesh;
  private readonly selectionRingMaterial: THREE.MeshBasicMaterial;
  private readonly resizeObserver: ResizeObserver;
  private hovered: SceneObject | null = null;
  private held: SceneObject | null = null;
  private cursorTone: CursorTone = "idle";
  private cursorVisible = false;

  constructor(private readonly container: HTMLElement) {
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
    this.scene.background = new THREE.Color(0x05080c);
    this.scene.fog = new THREE.Fog(0x05080c, 13, 27);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    this.camera.position.set(0, 4.8, 6.6);
    this.camera.lookAt(0, 0.45, 0);

    this.addLights();
    this.addGround();

    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 1.2),
      new THREE.MeshStandardMaterial({
        color: 0xe04848,
        roughness: 0.34,
        metalness: 0.05,
      }),
    );
    cube.position.set(-2, 0.6, -0.25);
    cube.rotation.y = 0.28;
    this.registerObject("Red cube", cube);

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 48, 32),
      new THREE.MeshStandardMaterial({
        color: 0x3f7dff,
        roughness: 0.32,
        metalness: 0.08,
      }),
    );
    sphere.position.set(0, 0.72, 0.45);
    this.registerObject("Blue sphere", sphere);

    const cylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 1.36, 48),
      new THREE.MeshStandardMaterial({
        color: 0x3ed07e,
        roughness: 0.34,
        metalness: 0.08,
      }),
    );
    cylinder.position.set(2, 0.68, -0.25);
    this.registerObject("Green cylinder", cylinder);

    this.cursorGroup = new THREE.Group();
    const ringGeometry = new THREE.RingGeometry(0.2, 0.27, 32);
    const dotGeometry = new THREE.CircleGeometry(0.045, 20);
    this.cursorRingMaterial = new THREE.MeshBasicMaterial({
      color: CURSOR_COLORS.idle,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.cursorDotMaterial = new THREE.MeshBasicMaterial({
      color: CURSOR_COLORS.idle,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const ring = new THREE.Mesh(ringGeometry, this.cursorRingMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 20;
    const dot = new THREE.Mesh(dotGeometry, this.cursorDotMaterial);
    dot.rotation.x = -Math.PI / 2;
    dot.renderOrder = 21;
    this.cursorGroup.add(ring, dot);
    this.cursorGroup.visible = false;
    this.scene.add(this.cursorGroup);

    this.selectionRingMaterial = new THREE.MeshBasicMaterial({
      color: SELECTION_HOVER_COLOR,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.88, 0.99, 48),
      this.selectionRingMaterial,
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.03;
    this.selectionRing.visible = false;
    this.selectionRing.renderOrder = 3;
    this.scene.add(this.selectionRing);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  /**
   * Move the cursor to the given world position and update the pick ray so it
   * passes through the cursor as rendered. `y` defaults to the ground plane.
   */
  setCursor(x: number, z: number, y = 0): void {
    // Keep the ring just above the floor so it does not z-fight with the grid.
    const renderY = Math.max(y, 0.025);
    this.cursorPosition.set(x, renderY, z);
    this.cursorGroup.position.set(x, renderY, z);
    this.cursorGroup.visible = true;
    this.cursorVisible = true;

    this.projectedCursor.copy(this.cursorPosition).project(this.camera);
    this.pickNdc.set(this.projectedCursor.x, this.projectedCursor.y);
  }

  setCursorVisible(visible: boolean): void {
    this.cursorVisible = visible;
    this.cursorGroup.visible = visible;
  }

  /** Raycast from the camera through the cursor against the three objects. */
  pickAtCursor(): SceneObject | null {
    if (!this.cursorVisible) {
      return null;
    }

    this.raycaster.setFromCamera(this.pickNdc, this.camera);
    this.intersections.length = 0;
    this.raycaster.intersectObjects(this.selectable, false, this.intersections);
    const closest = this.intersections[0];
    if (!closest) {
      return null;
    }
    return this.objectByMesh.get(closest.object) ?? null;
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
    this.refreshSelectionRing();
  }

  setHeld(object: SceneObject | null): void {
    if (this.held === object) {
      return;
    }
    if (this.held) {
      this.applyHighlight(
        this.held,
        this.held === this.hovered ? "hover" : "none",
      );
    }
    this.held = object;
    if (object) {
      this.applyHighlight(object, "held");
    }
    this.refreshCursorAppearance();
    this.refreshSelectionRing();
  }

  render(): void {
    this.syncSelectionRingPosition();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.scene.traverse((object) => {
      const renderable = object as THREE.Mesh;
      renderable.geometry?.dispose();
      if (Array.isArray(renderable.material)) {
        for (const material of renderable.material) {
          material.dispose();
        }
      } else {
        renderable.material?.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x0a1118, 1.5));

    const keyLight = new THREE.DirectionalLight(0xfff2df, 2.6);
    keyLight.position.set(4, 9, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -6;
    keyLight.shadow.camera.right = 6;
    keyLight.shadow.camera.top = 6;
    keyLight.shadow.camera.bottom = -6;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 20;
    keyLight.shadow.bias = -0.0005;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x6aa7ff, 0.8);
    rimLight.position.set(-5, 4, -4);
    this.scene.add(rimLight);
  }

  private addGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({
        color: 0x0a1620,
        roughness: 0.94,
        metalness: 0,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(14, 14, 0x2b5b75, 0x162a38);
    grid.position.y = 0.004;
    const gridMaterial = grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.72;
    this.scene.add(grid);
  }

  private registerObject(name: string, mesh: THREE.Mesh): void {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.emissive.setHex(0x000000);
    const object: SceneObject = { name, mesh, material, restY: mesh.position.y };
    this.selectable.push(mesh);
    this.objectByMesh.set(mesh, object);
  }

  private applyHighlight(object: SceneObject, highlight: Highlight): void {
    if (object.onHighlight) {
      object.onHighlight(highlight);
      return;
    }
    if (!object.material) {
      return;
    }
    if (highlight === "held") {
      object.material.emissive.setHex(HELD_EMISSIVE);
      object.material.emissiveIntensity = 1;
    } else if (highlight === "hover") {
      object.material.emissive.setHex(HOVER_EMISSIVE);
      object.material.emissiveIntensity = 0.85;
    } else {
      object.material.emissive.setHex(0x000000);
      object.material.emissiveIntensity = 1;
    }
  }

  private refreshSelectionRing(): void {
    const active = this.held ?? this.hovered;
    this.selectionRing.visible = active !== null;
    if (!active) {
      return;
    }
    this.selectionRingMaterial.color.setHex(
      this.held ? SELECTION_HELD_COLOR : SELECTION_HOVER_COLOR,
    );
    this.syncSelectionRingPosition();
  }

  private syncSelectionRingPosition(): void {
    const active = this.held ?? this.hovered;
    if (!active) {
      return;
    }
    this.selectionRing.position.x = active.mesh.position.x;
    this.selectionRing.position.z = active.mesh.position.z;
    // Track the object's base so elevated objects keep a visible anchor.
    this.selectionRing.position.y = Math.max(
      0.03,
      active.mesh.position.y - active.restY + 0.03,
    );
  }

  private refreshCursorAppearance(): void {
    const tone: CursorTone = this.held
      ? "held"
      : this.hovered
        ? "hover"
        : "idle";
    if (tone === this.cursorTone) {
      return;
    }
    this.cursorTone = tone;
    this.cursorRingMaterial.color.setHex(CURSOR_COLORS[tone]);
    this.cursorDotMaterial.color.setHex(CURSOR_COLORS[tone]);
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
