/**
 * Procedural laboratory instruments.
 *
 * Reagent bottles and glassware are taken from the existing chemlab-3d model
 * library so the integrated scene keeps the visual language of that project.
 * The small wrappers here only add readable labels, a stable origin at the
 * object's centre (needed by the pinch interaction), and reaction effects.
 */
import * as THREE from "three";
import {
  GLASSWARE_ITEMS,
  LIQUID_ITEMS,
} from "../../chemlab-3d/src/lab-models.js";
import { REACTION_ITEMS } from "../../chemlab-3d/src/lab-reactions.js";

interface ChemItem {
  id: string;
  name: string;
  formula?: string;
  build: (fill?: number) => THREE.Group;
}

const liquidItems = LIQUID_ITEMS as unknown as ChemItem[];
const glasswareItems = GLASSWARE_ITEMS as unknown as ChemItem[];
const reactionItems = REACTION_ITEMS as unknown as ChemItem[];

export interface ReagentModel {
  readonly group: THREE.Group;
  readonly height: number;
  readonly title: string;
  readonly subtitle: string;
}

export interface VesselVisual {
  readonly group: THREE.Group;
  readonly height: number;
  readonly label: string;
  setLiquid(color: number | null, fraction: number): void;
  setCloudy(cloudy: boolean): void;
  setTargetHighlight(color: number, opacity: number): void;
  addLimestone(): void;
  startReaction(effect: "precipitate" | "bubbles"): void;
  stopReaction(): void;
  update(dt: number): void;
  reset(): void;
}

const GLASS = () =>
  new THREE.MeshPhysicalMaterial({
    color: 0xd8ecff,
    transparent: true,
    opacity: 0.25,
    roughness: 0.04,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    clearcoat: 1,
  });

const std = (
  color: number,
  options: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0,
    ...options,
  });

const lathe = (
  points: ReadonlyArray<readonly [number, number]>,
  material: THREE.Material,
  segments = 48,
): THREE.Mesh =>
  new THREE.Mesh(
    new THREE.LatheGeometry(
      points.map(([radius, height]) => new THREE.Vector2(radius, height)),
      segments,
    ),
    material,
  );

function itemById(items: readonly ChemItem[], id: string): ChemItem | null {
  return items.find((item) => item.id === id) ?? null;
}

/** Build one of the existing chemlab reagent bottles. */
export function buildReagentModel(id: string): ReagentModel | null {
  const item = itemById(liquidItems, id);
  if (!item) {
    return null;
  }
  const group = item.build(1);
  const box = new THREE.Box3().setFromObject(group);
  const height = Math.max(0.2, box.max.y - box.min.y);
  return {
    group,
    height,
    title: item.formula ?? item.name,
    subtitle: item.name,
  };
}

/** Build the limestone jar from chemlab-3d's reaction item list. */
export function buildLimestoneModel(): ReagentModel | null {
  const item = itemById(reactionItems, "caco3");
  if (!item) {
    return null;
  }
  const group = item.build(1);
  const box = new THREE.Box3().setFromObject(group);
  const height = Math.max(0.2, box.max.y - box.min.y);
  return {
    group,
    height,
    title: "CaCO₃",
    subtitle: "limestone chips",
  };
}

/** A small upright test tube, used as bench decoration. */
export function buildTestTubeModel(): ReagentModel | null {
  const item = itemById(glasswareItems, "testtube");
  if (!item) {
    return null;
  }
  const group = item.build(1);
  const box = new THREE.Box3().setFromObject(group);
  return {
    group,
    height: Math.max(0.2, box.max.y - box.min.y),
    title: "Test tube",
    subtitle: "borosilicate glass",
  };
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius,
    y + height,
  );
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

/** A readable billboard label; it is ignored by the interaction raycaster. */
export function createLabelSprite(
  title: string,
  subtitle: string,
  accent = "#7fe7ff",
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    roundedRect(context, 8, 8, 496, 176, 30);
    context.fillStyle = "rgba(6, 15, 22, 0.9)";
    context.fill();
    context.lineWidth = 5;
    context.strokeStyle = accent;
    context.stroke();

    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#f4fbff";
    context.font = "bold 58px Inter, Arial, sans-serif";
    context.fillText(title, 256, 70);
    context.fillStyle = "#9fb4c6";
    context.font = "30px Inter, Arial, sans-serif";
    context.fillText(subtitle, 256, 132);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.85, 0.69, 1);
  // Labels must never block a pinch aimed at the instrument below.
  sprite.raycast = () => {};
  return sprite;
}

/** Centre a model at its own origin so the hand can carry it in 3D. */
export function centreModel(
  model: THREE.Object3D,
): { wrapper: THREE.Group; height: number } {
  const box = new THREE.Box3().setFromObject(model);
  const height = Math.max(0.2, box.max.y - box.min.y);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  const wrapper = new THREE.Group();
  wrapper.add(model);
  return { wrapper, height };
}

function buildBeakerShape(height: number): THREE.Group {
  const group = new THREE.Group();
  const base = -height / 2;
  const glass = GLASS();
  group.add(
    lathe(
      [
        [0, base],
        [0.72, base],
        [0.72, height / 2 - 0.06],
        [0.77, height / 2],
        [0.73, height / 2],
        [0.68, height / 2 - 0.06],
        [0.68, base + 0.05],
        [0, base + 0.05],
      ],
      glass,
    ),
  );
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.73, 0.025, 10, 48),
    glass,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = height / 2;
  group.add(rim);
  return group;
}

function buildFlaskShape(height: number): THREE.Group {
  const group = new THREE.Group();
  const base = -height / 2;
  const glass = GLASS();
  group.add(
    lathe(
      [
        [0, base],
        [0.63, base],
        [0.66, base + 0.08],
        [0.62, base + 0.78],
        [0.3, base + 1.02],
        [0.17, base + 1.16],
        [0.17, height / 2 - 0.05],
        [0.2, height / 2],
        [0.16, height / 2],
        [0.13, height / 2 - 0.05],
        [0.13, base + 1.16],
        [0.26, base + 1.0],
        [0.52, base + 0.74],
        [0.58, base + 0.1],
        [0.58, base],
        [0, base],
      ],
      glass,
    ),
  );
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.17, 0.02, 10, 40),
    glass,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = height / 2;
  group.add(rim);
  return group;
}

function buildVessel(kind: "beaker" | "flask"): VesselVisual {
  const height = kind === "beaker" ? 1.55 : 1.9;
  const group = new THREE.Group();
  const shape = kind === "beaker" ? buildBeakerShape(height) : buildFlaskShape(height);
  group.add(shape);

  const inner = new THREE.Group();
  group.add(inner);

  const liquidMaterial = new THREE.MeshStandardMaterial({
    color: 0xcfe8ff,
    transparent: true,
    opacity: 0.78,
    roughness: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const liquid = new THREE.Mesh(
    kind === "beaker"
      ? new THREE.CylinderGeometry(0.64, 0.64, 1, 40)
      : new THREE.CylinderGeometry(0.24, 0.6, 1, 40),
    liquidMaterial,
  );
  liquid.visible = false;
  inner.add(liquid);

  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xf7fbff,
    transparent: true,
    opacity: 0,
    roughness: 0.95,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const cloud = new THREE.Mesh(
    kind === "beaker"
      ? new THREE.CylinderGeometry(0.62, 0.62, 1, 40)
      : new THREE.CylinderGeometry(0.22, 0.58, 1, 40),
    cloudMaterial,
  );
  cloud.visible = false;
  inner.add(cloud);

  const lumps = new THREE.Group();
  inner.add(lumps);
  const lumpMaterial = std(0xeceae2, { roughness: 0.95, flatShading: true });
  for (let index = 0; index < 8; index += 1) {
    const lump = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.09 + (index % 3) * 0.012, 0),
      lumpMaterial,
    );
    const angle = index * 2.4;
    const radius = 0.08 + (index % 4) * 0.08;
    lump.position.set(
      Math.cos(angle) * radius,
      -height / 2 + 0.1 + Math.floor(index / 4) * 0.1,
      Math.sin(angle) * radius,
    );
    lump.rotation.set(index, index * 0.7, index * 1.3);
    lumps.add(lump);
  }
  lumps.visible = false;

  const bubbles = new THREE.Group();
  inner.add(bubbles);
  const bubbleMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xe9fbff,
    transparent: true,
    opacity: 0.35,
    roughness: 0.0,
    metalness: 0,
    transmission: 0.5,
    depthWrite: false,
  });
  const bubbleGeometry = new THREE.SphereGeometry(0.045, 10, 8);
  const bubbleData: Array<{ mesh: THREE.Mesh; speed: number; baseX: number; baseZ: number }> = [];
  for (let index = 0; index < 34; index += 1) {
    const mesh = new THREE.Mesh(bubbleGeometry, bubbleMaterial);
    mesh.visible = false;
    bubbles.add(mesh);
    bubbleData.push({
      mesh,
      speed: 0.35 + (index % 7) * 0.075,
      baseX: Math.cos(index * 2.39996) * (kind === "beaker" ? 0.5 : 0.4),
      baseZ: Math.sin(index * 2.39996) * (kind === "beaker" ? 0.5 : 0.4),
    });
  }

  const precipitate = new THREE.Group();
  inner.add(precipitate);
  const precipitateMaterial = std(0xffffff, { roughness: 0.9 });
  const precipitateData: Array<{ mesh: THREE.Mesh; fall: number; settled: number }> = [];
  for (let index = 0; index < 55; index += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.018 + (index % 4) * 0.006, 8, 6),
      precipitateMaterial,
    );
    mesh.visible = false;
    precipitate.add(mesh);
    const angle = index * 2.39996;
    const radius = Math.sqrt((index + 0.5) / 55) * (kind === "beaker" ? 0.56 : 0.44);
    precipitateData.push({
      mesh,
      fall: 0.4 + ((index * 17) % 13) * 0.035,
      settled: -height / 2 + 0.08 + Math.floor(index / 18) * 0.045,
    });
    mesh.position.set(
      Math.cos(angle) * radius,
      -height / 2 + 0.15 + ((index * 29) % 20) * 0.055,
      Math.sin(angle) * radius,
    );
  }

  const targetRingMaterial = new THREE.MeshBasicMaterial({
    color: 0x7fe7ff,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const targetRing = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 0.98, 48),
    targetRingMaterial,
  );
  targetRing.rotation.x = -Math.PI / 2;
  targetRing.position.y = -height / 2 + 0.015;
  targetRing.renderOrder = 2;
  group.add(targetRing);

  const state = {
    kind,
    liquidFraction: 0,
    cloudy: false,
    effect: null as "precipitate" | "bubbles" | null,
    effectElapsed: 0,
    lumpScale: 1,
  };

  const placeLiquid = (): void => {
    const bottom = -height / 2 + 0.09;
    const maxHeight = kind === "beaker" ? 1.3 : 1.0;
    const level = Math.max(0.02, state.liquidFraction * maxHeight);
    const center = bottom + level / 2;
    liquid.position.y = center;
    liquid.scale.y = level;
    liquid.visible = state.liquidFraction > 0.005;
    cloud.position.y = center;
    cloud.scale.y = level;
    cloud.visible = state.cloudy && state.liquidFraction > 0.005;
  };

  return {
    group,
    height,
    label: kind === "beaker" ? "Beaker" : "Erlenmeyer flask",
    setLiquid(color, fraction) {
      if (color === null || fraction <= 0) {
        liquid.visible = false;
        cloud.visible = false;
        state.liquidFraction = 0;
        return;
      }
      liquidMaterial.color.setHex(color);
      state.liquidFraction = Math.max(0, Math.min(1, fraction));
      placeLiquid();
    },
    setCloudy(cloudy) {
      state.cloudy = cloudy;
      cloudMaterial.opacity = cloudy ? 0.82 : 0;
      cloud.visible = cloudy && state.liquidFraction > 0.005;
      placeLiquid();
    },
    setTargetHighlight(color, opacity) {
      targetRingMaterial.color.setHex(color);
      targetRingMaterial.opacity = opacity;
    },
    addLimestone() {
      lumps.visible = true;
      state.lumpScale = 1;
      lumps.scale.setScalar(1);
    },
    startReaction(effect) {
      state.effect = effect;
      state.effectElapsed = 0;
      if (effect === "precipitate") {
        state.cloudy = true;
        cloudMaterial.opacity = 0.8;
        cloud.visible = state.liquidFraction > 0.005;
        for (const particle of precipitateData) {
          particle.mesh.visible = true;
        }
      }
      if (effect === "bubbles") {
        for (const bubble of bubbleData) {
          bubble.mesh.visible = true;
        }
      }
    },
    stopReaction() {
      state.effect = null;
      for (const bubble of bubbleData) {
        bubble.mesh.visible = false;
      }
      for (const particle of precipitateData) {
        particle.mesh.visible = false;
      }
      state.lumpScale = 1;
      lumps.scale.setScalar(1);
    },
    update(dt) {
      if (state.effect === "bubbles") {
        state.effectElapsed += dt;
        const dissolve = Math.max(0, 1 - state.effectElapsed / 5);
        state.lumpScale = dissolve;
        lumps.scale.setScalar(Math.max(0.01, dissolve));
        const bottom = -height / 2 + 0.12;
        const top = -height / 2 + 0.2 + state.liquidFraction * (kind === "beaker" ? 1.3 : 1.0);
        for (let index = 0; index < bubbleData.length; index += 1) {
          const bubble = bubbleData[index];
          if (!bubble) {
            continue;
          }
          bubble.mesh.position.x = bubble.baseX;
          bubble.mesh.position.z = bubble.baseZ;
          bubble.mesh.position.y += bubble.speed * dt;
          if (bubble.mesh.position.y > top) {
            bubble.mesh.position.y = bottom + ((index * 13) % 10) * 0.025;
          }
        }
      } else if (state.effect === "precipitate") {
        state.effectElapsed += dt;
        for (const particle of precipitateData) {
          if (!particle.mesh.visible) {
            continue;
          }
          if (particle.mesh.position.y > particle.settled) {
            particle.mesh.position.y -= particle.fall * dt;
          }
        }
        state.cloudy = true;
        cloudMaterial.opacity = Math.min(0.86, 0.55 + state.effectElapsed * 0.08);
      }

      if (state.effect === null && !state.cloudy) {
        cloud.visible = false;
      }
    },
    reset() {
      state.effect = null;
      state.effectElapsed = 0;
      state.cloudy = false;
      state.liquidFraction = 0;
      state.lumpScale = 1;
      liquid.visible = false;
      cloud.visible = false;
      lumps.visible = false;
      lumps.scale.setScalar(1);
      for (const bubble of bubbleData) {
        bubble.mesh.visible = false;
      }
      for (const particle of precipitateData) {
        particle.mesh.visible = false;
      }
      targetRingMaterial.color.setHex(0x7fe7ff);
      targetRingMaterial.opacity = 0.55;
    },
  };
}

export function buildBeaker(): VesselVisual {
  return buildVessel("beaker");
}

export function buildFlask(): VesselVisual {
  return buildVessel("flask");
}
