// ============================================================
//  Phòng thí nghiệm hóa học 3D - Phiên bản 1
//  Vite + Three.js (không dùng dịch vụ trả phí)
// ============================================================
import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ROOM,
  BENCH_TOP,
  createLabRoom,
  createBenchTopMaterial,
  applyLabLighting,
  captureRoomEnvironment,
  naturalPlacement,
  limitCameraToRoom,
  clampCameraToRoom,
} from './lab-room.js';
import {

  createExperimentState,
  selectSample,
  getExperimentLog,
  getSampleInfo,
  pourIntoVessel,
  saveExperimentState,
  loadExperimentState,
  registerSample,
  removeSample,
  addSampleToVessel,
  checkSampleAmount,
  consumeSample,
  transferLiquid,
  evaporate,
} from './experiment.js';
import {
  PERIODIC_CATEGORY,
  createPeriodicTable,
  renderElementInfoHtml,
  renderPeriodicLibraryHtml,
  readSampleForm,
  bindSampleForm,
} from './periodic-table.js';
import { ELEMENTS as PERIODIC_ELEMENTS, getElement, getElementKind } from './elements.js';
import {
  ELEMENT_ITEM_PREFIX,
  toQuantity,
  createSampleRecord,
  sampleSummaryHtml,
  amountLabel,
  fmtQ,
  toStockQuantity,
  createStockRecord,
  stockFormHtml,
  stockPreviewHtml,
  stockUnits,
  stockAmountToMl,
  readStockForm,
  convertElementAmount,
  unitsFor,
} from './quantity.js';
import {
  createElementItem,
  buildElementSampleModel,
  buildVesselDeposit,
  elementLiquidColor,
  elementMouth,
  elementColor,
  makeAmountLabel,
} from './element-models.js';
import { createAnimator } from './animations.js';
import { askAmount, isAmountDialogOpen } from './amount-dialog.js';
import {
  findSnap,
  attach,
  detach,
  childAt,
  childrenOf,
  socketById,
  heatSourceOf,
  flameScaleFor,
  stirrerOf,
  bathOf,
} from './assembly.js';
import { createLabWorld } from './lab-world.js';
import { createReactionLab, REACTION_ITEMS } from './lab-reactions.js';
import {
  LIQUID_ITEMS,
  GLASSWARE_ITEMS,
  EQUIPMENT_ITEMS,
  VESSEL_SPECS,
  LIQUID_COLORS,
  STOCK_SPECS,
  buildStockModel,
  buildVesselFill,
  liquidColorFor,
  fillPoints,
  liquidOpacity,
  MOUTHS,
  TIPS,
} from './lab-models.js';
const experimentState =
  loadExperimentState() ?? createExperimentState();
// ------------------------------------------------------------
// 1. Hằng số & tìm các vùng giao diện trong index.html
// ------------------------------------------------------------
const BENCH_W = 14; // chiều rộng bàn
const BENCH_D = 8; // chiều sâu bàn
const BENCH_H = 0.4; // độ dày mặt bàn
const CATEGORIES = ['Liquid', 'Solid', 'Gas', 'Glassware', 'Equipment', PERIODIC_CATEGORY];

const categoryBarEl = document.getElementById('category-bar');
const libraryEl = document.getElementById('library');
const viewportEl = document.getElementById('viewport');
const infoEl = document.getElementById('info-panel');

if (!categoryBarEl || !libraryEl || !viewportEl || !infoEl) {
  throw new Error(
    'Thiếu vùng giao diện. Hãy chắc chắn index.html có 4 phần tử với id: category-bar, library, viewport, info-panel.'
  );
}

// ------------------------------------------------------------
// 2. Hàm hỗ trợ tạo vật liệu & hình khối
// ------------------------------------------------------------
const std = (color, o = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, ...o });

const glass = (tint = 0xcfe8ff, opacity = 0.22) =>
  new THREE.MeshPhysicalMaterial({
    color: tint,
    transparent: true,
    opacity,
    roughness: 0.05,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    clearcoat: 1,
  });

const liquidMat = (color, opacity = 0.8) =>
  new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.2,
    side: THREE.DoubleSide,
  });

const at = (mesh, x = 0, y = 0, z = 0) => {
  mesh.position.set(x, y, z);
  return mesh;
};


// Hình trụ có đáy nằm ở độ cao y
const cylAt = (rTop, rBottom, h, mat, x = 0, y = 0, z = 0, seg = 32) =>
  at(new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat), x, y + h / 2, z);

const boxAt = (w, h, d, mat, x = 0, y = 0, z = 0) =>
  at(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y + h / 2, z);

// Tạo hình tròn xoay (LatheGeometry) từ các điểm [bán kính, độ cao]
const lathe = (pts, mat, seg = 48) =>
  new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat);

const layered = (mesh, order) => {
  mesh.renderOrder = order;
  return mesh;
};

// ------------------------------------------------------------
// 3. Mô hình phân tử (quả cầu + que)
// ------------------------------------------------------------
const ELEMENTS = {
  C: { color: 0x4b5563, r: 0.34 },
  H: { color: 0xf1f5f9, r: 0.2 },
  O: { color: 0xef4444, r: 0.3 },
};

function buildMolecule(atoms, bonds, scale) {
  const g = new THREE.Group();
  const pos = atoms.map(([, x, y, z]) => new THREE.Vector3(x, y, z));

  atoms.forEach(([el], i) => {
    const e = ELEMENTS[el];
    const m = new THREE.Mesh(new THREE.SphereGeometry(e.r, 28, 20), std(e.color, { roughness: 0.35 }));
    m.position.copy(pos[i]);
    g.add(m);
  });

  const bondMat = std(0xaab4c3, { roughness: 0.4 });
  bonds.forEach(([a, b, order = 1]) => {
    const dir = new THREE.Vector3().subVectors(pos[b], pos[a]);
    const len = dir.length();
    dir.normalize();
    const mid = new THREE.Vector3().addVectors(pos[a], pos[b]).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const offsets = order === 2 ? [-0.08, 0.08] : [0];
    const rad = order === 2 ? 0.05 : 0.08;
    offsets.forEach((o) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 12), bondMat);
      c.position.copy(mid).addScaledVector(side, o);
      c.quaternion.copy(q);
      g.add(c);
    });
  });

  g.scale.setScalar(scale);
  return g;
}

function buildMethane() {
  const k = 0.63;
  const atoms = [
    ['C', 0, 0, 0],
    ['H', k, k, k],
    ['H', k, -k, -k],
    ['H', -k, k, -k],
    ['H', -k, -k, k],
  ];
  const bonds = [[0, 1], [0, 2], [0, 3], [0, 4]];
  return buildMolecule(atoms, bonds, 1.2);
}

function buildBenzene() {
  const atoms = [];
  const bonds = [];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    atoms.push(['C', Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4]);
  }
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    atoms.push(['H', Math.cos(a) * 2.45, 0, Math.sin(a) * 2.45]);
  }
  for (let k = 0; k < 6; k++) {
    bonds.push([k, (k + 1) % 6, k % 2 === 0 ? 2 : 1]);
    bonds.push([k, 6 + k]);
  }
  return buildMolecule(atoms, bonds, 0.55);
}

function buildEthanol() {
  const atoms = [
    ['C', 0, 0, 0],
    ['C', 1.52, 0, 0],
    ['O', 2.15, 1.25, 0],
    ['H', -0.37, -0.51, 0.89],
    ['H', -0.37, -0.51, -0.89],
    ['H', -0.37, 1.02, 0],
    ['H', 1.89, -0.51, 0.89],
    ['H', 1.89, -0.51, -0.89],
    ['H', 3.0, 1.65, 0],
  ];
  const bonds = [[0, 1], [1, 2], [0, 3], [0, 4], [0, 5], [1, 6], [1, 7], [2, 8]];
  return buildMolecule(atoms, bonds, 0.9);
}

// ------------------------------------------------------------
// 4. Chất rắn
// ------------------------------------------------------------
function buildNaCl() {
  const g = new THREE.Group();
  const na = std(0xa78bfa, { roughness: 0.3 });
  const cl = std(0x4ade80, { roughness: 0.3 });
  const naGeo = new THREE.SphereGeometry(0.16, 20, 14);
  const clGeo = new THREE.SphereGeometry(0.25, 20, 14);
  const step = 0.55;
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      for (let z = 0; z < 3; z++) {
        const isNa = (x + y + z) % 2 === 0;
        const m = new THREE.Mesh(isNa ? naGeo : clGeo, isNa ? na : cl);
        m.position.set((x - 1) * step, (y - 1) * step, (z - 1) * step);
        g.add(m);
      }
    }
  }
  g.rotation.y = Math.PI / 6;
  return g;
}

function buildCopper() {
  const g = new THREE.Group();
  const cu = std(0xb87333, { metalness: 0.9, roughness: 0.35 });
  g.add(boxAt(1.3, 0.5, 0.8, cu));
  g.add(boxAt(0.7, 0.35, 0.5, cu, 0.1, 0.5, 0));
  return g;
}

function buildSulfur() {
  const g = new THREE.Group();
  const mat = std(0xf5d90a, { roughness: 0.7, flatShading: true });
  const lumps = [
    [0, 0.45, 0, 0.5],
    [0.6, 0.3, 0.2, 0.32],
    [-0.55, 0.28, 0.25, 0.3],
    [0.15, 0.25, -0.55, 0.28],
    [-0.2, 0.2, 0.65, 0.22],
  ];
  lumps.forEach(([x, y, z, r], i) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    m.position.set(x, y, z);
    m.rotation.set(i, i * 2, i * 3);
    g.add(m);
  });
  return g;
}

// ------------------------------------------------------------
// 5. Chất lỏng (chai thuốc thử)
// ------------------------------------------------------------
function buildBottle(liquidColor, labelColor, capColor, glassTint, fill = 1) {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [0.6, 0], [0.6, 1.2], [0.22, 1.55], [0.22, 1.8]], glass(glassTint, 0.25)));
  g.children[0].renderOrder = 2;
  // fill: phần còn lại trong chai (1 = đầy, 0 = đã dùng hết)
  const f = Math.min(1, Math.max(0, Number.isFinite(fill) ? fill : 1));
  if (f > 0.005) {
    const level = 0.04 + 0.91 * f;
    const liq = layered(
      lathe([[0, 0.04], [0.57, 0.04], [0.57, level], [0, level]], liquidMat(liquidColor, 0.85)),
      1
    );
    liq.name = 'stock-liquid';
    g.add(liq);
  }
  g.add(
    at(
      new THREE.Mesh(
        new THREE.CylinderGeometry(0.612, 0.612, 0.5, 32, 1, true),
        std(labelColor, { side: THREE.DoubleSide, roughness: 0.8 })
      ),
      0,
      0.62,
      0
    )
  );
  const cap = cylAt(0.28, 0.28, 0.28, std(capColor, { roughness: 0.6 }), 0, 1.8, 0);
  cap.name = 'cap';
  g.add(cap);
  return g;
}

// ------------------------------------------------------------
// 6. Chất khí (bình khí)
// ------------------------------------------------------------
function buildGasCylinder(color) {
  const g = new THREE.Group();
  g.add(
    lathe(
      [[0, 0], [0.5, 0], [0.5, 2.5], [0.42, 2.85], [0.2, 3.05], [0.14, 3.1]],
      std(color, { metalness: 0.5, roughness: 0.35 })
    )
  );
  const dark = std(0x2a2f38, { metalness: 0.4, roughness: 0.5 });
  const brass = std(0xc9a24a, { metalness: 0.8, roughness: 0.3 });
  g.add(cylAt(0.52, 0.52, 0.1, dark, 0, 0, 0));
  g.add(cylAt(0.08, 0.08, 0.5, brass, 0, 3.1, 0));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 10, 28), dark);
  wheel.rotation.x = Math.PI / 2;
  wheel.position.y = 3.62;
  g.add(wheel);
  const outlet = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.28, 16), brass);
  outlet.rotation.z = Math.PI / 2;
  outlet.position.set(0.18, 3.25, 0);
  g.add(outlet);
  return g;
}

// ------------------------------------------------------------
// 7. Dụng cụ thủy tinh
// ------------------------------------------------------------
function buildBeaker() {
  const g = new THREE.Group();

  g.add(
    layered(
      lathe([[0, 0], [0.72, 0], [0.72, 1.9], [0.78, 1.97]], glass()),
      2
    )
  );

  return g;
}


function createLiquidForVessel(vesselId, chemicalIds, liquidLevel, colorOverride = null) {
  const liquidGroup = new THREE.Group();
  

  if (!chemicalIds || chemicalIds.length === 0) {
    return liquidGroup;
  }

  const isBeaker = vesselId === 'beaker';
  const isErlenmeyer = vesselId === 'erlenmeyer';

  const maxHeight = isBeaker ? 1.0 : 0.75;
const height = Math.max(
  0.02,
  Math.min(
    Number(liquidLevel ?? chemicalIds.length * 0.18),
    maxHeight,
  ),
);

  const colorByChemical = {
    hcl: 0xfde68a,
    naoh: 0xdbeafe,
    water: 0x93c5fd,
    cuso4: 0x3b82f6,
    ethanol: 0xdbeafe,
    nacl: 0xe5e7eb,
  };

  // Dung dịch sản phẩm NaCl + H2O được hiển thị
  // thành một khối chất lỏng đồng nhất.
  const isSaltWater =
    chemicalIds.includes('nacl') &&
    chemicalIds.includes('water');

  const color = colorOverride != null
    ? colorOverride
    : isSaltWater
    ? 0xdbeafe
    : colorByChemical[chemicalIds[0]] ?? elementLiquidColor(chemicalIds[0]) ?? LIQUID_COLORS[chemicalIds[0]] ?? 0x93c5fd;

  let points;

  if (isBeaker) {
    points = [
      [0, 0.06],
      [0.62, 0.06],
      [0.62, 0.06 + height],
      [0, 0.06 + height],
    ];
  } else if (isErlenmeyer) {
    const radius = Math.max(0.12, 0.72 - height * 0.3);

    points = [
      [0, 0.06],
      [0.68, 0.06],
      [radius, 0.06 + height],
      [0, 0.06 + height],
    ];
  } else {
    return liquidGroup;
  }
  const liquid = lathe(
  points,
  liquidMat(color, liquidOpacity(color, 0.85)),
  48,
);

liquid.name = 'liquid-surface';
liquid.renderOrder = 3;

liquidGroup.add(liquid);
return liquidGroup;
}


// Lớp chất lỏng của chính bình này (không lấy nhầm của bình hứng gắn bên dưới)
function ownLiquid(root) {
  return (
    root.children.find((c) => c.name === 'dynamic-liquid') ??
    root.userData.inner?.children.find((c) => c.name === 'dynamic-liquid') ??
    null
  );
}

function removeOwnLiquid(root) {
  let old;
  while ((old = ownLiquid(root))) {
    old.parent.remove(old);
    disposeObject(old);
  }
}

// Lớp kết tủa lắng dưới đáy (ví dụ Cu(OH)₂ xanh lam)
function buildSediment(color, radius, y) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 12), std(color, { roughness: 0.95 }));
  m.scale.set(radius * 0.9, 0.06, radius * 0.9);
  m.position.y = y + 0.03;
  return m;
}
const SEDIMENTS = { cuoh2: 0x1e88e5, baso4: 0xf8fafc };
const pendingSediment = new Set(); // kết tủa đang hình thành (hiện sau hoạt cảnh lắng)

// override: { volume, ids } để vẽ mức đang dâng trong lúc rót
function updateVesselLiquid(root, override = null) {
  if (!root) return;
  const itemId = root.userData.itemId;
  const instanceId = root.userData.instanceId;
  removeOwnLiquid(root);

  // Cốc beaker và bình Erlenmeyer dùng cách vẽ cũ; các bình khác vẽ theo lòng bình
  if (!['beaker', 'erlenmeyer'].includes(itemId)) {
    updateGenericVessel(root, itemId, instanceId, override);
    reactionLab?.decorate(root); // đá vôi, nút cao su, gương bạc, vẩn đục, màu giấy quỳ
    return;
  }

  const id = String(instanceId);
  const chemicalIds = override?.ids ?? experimentState.mixtures[id] ?? [];
  const totalVolume = override?.volume ?? experimentState.liquidVolumes?.[id] ?? 0;
  const maxHeight = itemId === 'beaker' ? 1.0 : 0.75;
  const liquidLevel = Math.min((totalVolume / 250) * maxHeight, maxHeight);
  const liquid = createLiquidForVessel(
    itemId,
    totalVolume > 0 ? chemicalIds : [], // chỉ có chất rắn thì không vẽ lớp chất lỏng
    liquidLevel,
    override ? null : reactionLab?.liquidColor(id) ?? null
  );
  liquid.name = 'dynamic-liquid';
  // Chất rắn nguyên tố đã cho vào bình: vẽ thành lớp hạt dưới đáy
  const solidRecords = (experimentState.pourRecords?.[id] || []).filter(
    (r) => r.phase === 'solid' && r.massG > 0 && r.chemicalId.startsWith(ELEMENT_ITEM_PREFIX)
  );
  if (solidRecords.length) {
    liquid.add(
      buildVesselDeposit(
        solidRecords.map((r) => ({
          el: getElement(r.chemicalId.slice(ELEMENT_ITEM_PREFIX.length)),
          massG: r.massG,
        }))
      )
    );
  }
  if (!override && !pendingSediment.has(id)) {
    const sid = chemicalIds.find((c) => SEDIMENTS[c]);
    if (sid) liquid.add(buildSediment(SEDIMENTS[sid], itemId === 'beaker' ? 0.6 : 0.65, 0.06));
  }
  root.add(liquid);
  reactionLab?.decorate(root);
}

function buildErlenmeyer() {
  const g = new THREE.Group();

  g.add(
    layered(
      lathe([[0, 0], [0.85, 0], [0.3, 1.5], [0.3, 2.2], [0.38, 2.28]], glass()),
      2
    )
  );

  return g;
}
function buildRoundFlask() {
  const g = new THREE.Group();
  const ball = at(new THREE.Mesh(new THREE.SphereGeometry(0.85, 40, 28), glass()), 0, 1.0, 0);
  ball.renderOrder = 2;
  g.add(ball);
  const neck = cylAt(0.24, 0.24, 1.2, glass(), 0, 1.7, 0);
  neck.renderOrder = 2;
  g.add(neck);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 12, 32), std(0x374151));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.17;
  g.add(ring);
  return g;
}

function buildTestTubeRack() {
  // Giá gỗ có 5 lỗ; kéo thả ống nghiệm vào lỗ để cắm ống
  const g = new THREE.Group();
  const wood = std(0x9a6b3f, { roughness: 0.8 });
  g.add(boxAt(2.7, 0.14, 0.9, wood, 0, 0, 0));
  g.add(boxAt(0.12, 1.1, 0.5, wood, -1.3, 0.14, 0));
  g.add(boxAt(0.12, 1.1, 0.5, wood, 1.3, 0.14, 0));
  g.add(boxAt(2.7, 0.1, 0.5, wood, 0, 1.2, 0));
  const holeMat = std(0x3b2a1a, { roughness: 0.9 });
  [-1, -0.5, 0, 0.5, 1].forEach((x) => {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.012, 24), holeMat);
    hole.position.set(x, 1.306, 0);
    g.add(hole);
  });
  return g;
}

// ------------------------------------------------------------
// 8. Thiết bị
// ------------------------------------------------------------
function buildBunsen() {
  const g = new THREE.Group();
  const metal = std(0x6b7280, { metalness: 0.7, roughness: 0.4 });
  const dark = std(0x1f2937, { metalness: 0.5, roughness: 0.5 });
  g.add(cylAt(0.6, 0.65, 0.18, dark, 0, 0, 0));
  g.add(cylAt(0.13, 0.13, 1.6, metal, 0, 0.18, 0));
  g.add(cylAt(0.2, 0.2, 0.25, dark, 0, 0.5, 0));

  const outerGeo = new THREE.ConeGeometry(0.26, 1.25, 24);
  outerGeo.translate(0, 0.625, 0);
  const innerGeo = new THREE.ConeGeometry(0.14, 0.7, 24);
  innerGeo.translate(0, 0.35, 0);
  const outer = new THREE.Mesh(
    outerGeo,
    new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.4, depthWrite: false })
  );
  const inner = new THREE.Mesh(
    innerGeo,
    new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.8, depthWrite: false })
  );
  outer.position.y = 1.78;
  inner.position.y = 1.78;
  outer.name = 'flame'; // ẩn/hiện theo trạng thái van gas
  inner.name = 'flame';
  g.add(outer, inner);

  g.userData.animate = (t) => {
    const k = g.userData.flameScale ?? 1; // ngọn lửa thấp lại khi chạm lưới kiềng
    outer.scale.y = k * (1 + 0.12 * Math.sin(t * 12) + 0.06 * Math.sin(t * 23));
    outer.scale.x = outer.scale.z = (1 + 0.05 * Math.sin(t * 17)) * (k < 1 ? 1.25 : 1);
    inner.scale.y = k * (1 + 0.08 * Math.sin(t * 15 + 1));
  };
  return g;
}

function buildRetortStand() {
  const g = new THREE.Group();
  const metal = std(0x9ca3af, { metalness: 0.8, roughness: 0.35 });
  const dark = std(0x1f2937, { metalness: 0.5, roughness: 0.5 });
  g.add(boxAt(2.2, 0.15, 1.2, dark, 0, 0, 0));
  g.add(cylAt(0.06, 0.06, 4.0, metal, -0.8, 0.15, 0, 16));
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 16), metal);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(-0.05, 3.0, 0);
  g.add(arm);
  const boss = boxAt(0.2, 0.2, 0.2, dark, -0.8, 2.9, 0);
  g.add(boss);
  const clamp = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 10, 28), metal);
  clamp.rotation.x = Math.PI / 2;
  clamp.position.set(0.7, 3.0, 0);
  g.add(clamp);
  return g;
}

function buildBalance() {
  const g = new THREE.Group();
  const body = std(0x1f2937, { roughness: 0.4, metalness: 0.3 });
  g.add(boxAt(1.8, 0.25, 1.4, body, 0, 0, 0));
  g.add(cylAt(0.55, 0.55, 0.06, std(0xd1d5db, { metalness: 0.9, roughness: 0.25 }), 0, 0.25, -0.1, 40));
  g.add(boxAt(0.8, 0.12, 0.02, new THREE.MeshBasicMaterial({ color: 0x22c55e }), 0, 0.07, 0.71));
  return g;
}

// ------------------------------------------------------------
// 9. Danh mục mẫu vật
// ------------------------------------------------------------
const CATALOG = [
  // ---- Organic ----
  {
    id: 'methane', category: 'Gas', name: 'Methane', formula: 'CH₄',
    desc: 'Hydrocarbon đơn giản nhất, thành phần chính của khí thiên nhiên. Chứa trong bình khí nén.',
    props: [['Khối lượng mol', '16,04 g/mol'], ['Trạng thái (25 °C)', 'Khí'], ['Nhiệt độ sôi', '−161,5 °C'], ['Hình dạng phân tử', 'Tứ diện']],
    safety: 'Dễ cháy nổ. Tránh xa nguồn lửa.',
    build: () => buildGasCylinder(0x8d6e63),
    stock: STOCK_SPECS.methane,
  },

  {
    id: 'ethanol', category: 'Liquid', name: 'Ethanol', formula: 'C₂H₅OH',
    desc: 'Rượu etylic, dùng làm dung môi, nhiên liệu và chất sát khuẩn. Đựng trong chai thủy tinh.',
    props: [['Khối lượng mol', '46,07 g/mol'], ['Trạng thái (25 °C)', 'Lỏng'], ['Nhiệt độ sôi', '78,4 °C'], ['Khối lượng riêng', '0,789 g/cm³']],
    safety: 'Dễ cháy. Hơi có thể gây kích ứng.',
    build: (fill) => buildBottle(0xf1f5f9, 0xd1fae5, 0x16a34a, 0xcfe8ff, fill),
    stock: STOCK_SPECS.ethanol,
  },
  {
    id: 'benzene', category: 'Legacy', name: 'Benzene', formula: 'C₆H₆',
    desc: 'Hydrocarbon thơm điển hình với vòng sáu cạnh. Mô hình hiển thị liên kết đơn và đôi xen kẽ.',
    props: [['Khối lượng mol', '78,11 g/mol'], ['Trạng thái (25 °C)', 'Lỏng'], ['Nhiệt độ sôi', '80,1 °C'], ['Nhiệt độ nóng chảy', '5,5 °C']],
    safety: 'Độc, có khả năng gây ung thư. Chỉ làm việc trong tủ hút.',
    build: buildBenzene,
  },

  // ---- Solid ----
  {
    id: 'nacl', category: 'Legacy', name: 'Sodium chloride', formula: 'NaCl',
    desc: 'Muối ăn. Mô hình mạng tinh thể lập phương với ion Na⁺ (tím) và Cl⁻ (xanh lá) xen kẽ.',
    props: [['Khối lượng mol', '58,44 g/mol'], ['Nhiệt độ nóng chảy', '801 °C'], ['Khối lượng riêng', '2,16 g/cm³'], ['Độ tan trong nước', '≈ 36 g/100 mL']],
    safety: 'Ít nguy hiểm trong phòng thí nghiệm.',
    build: buildNaCl,
  },
  {
    id: 'copper', category: 'Legacy', name: 'Copper', formula: 'Cu',
    desc: 'Kim loại màu đỏ cam, dẫn điện và dẫn nhiệt tốt. Hiển thị dạng khối kim loại.',
    props: [['Khối lượng mol', '63,55 g/mol'], ['Nhiệt độ nóng chảy', '1085 °C'], ['Khối lượng riêng', '8,96 g/cm³'], ['Loại', 'Kim loại chuyển tiếp']],
    safety: 'An toàn khi cầm; bụi và hơi đồng có thể gây hại.',
    build: buildCopper,
  },
  {
    id: 'sulfur', category: 'Legacy', name: 'Sulfur', formula: 'S₈',
    desc: 'Phi kim màu vàng, tồn tại dạng vòng S₈. Hiển thị các cục lưu huỳnh.',
    props: [['Khối lượng mol (S₈)', '256,5 g/mol'], ['Nhiệt độ nóng chảy', '115,2 °C'], ['Khối lượng riêng', '≈ 2,07 g/cm³'], ['Màu sắc', 'Vàng']],
    safety: 'Cháy tạo SO₂ độc. Tránh hít bụi.',
    build: buildSulfur,
  },

  // CaCO₃ (đá vôi dạng cục, mục Solid) và giấy quỳ: lab-reactions.js
  ...REACTION_ITEMS,
  // ---- Liquid ----
  {
    id: 'water', category: 'Liquid', name: 'Water', formula: 'H₂O',
    desc: 'Dung môi phổ biến nhất trong phòng thí nghiệm, đựng trong chai thủy tinh.',
    props: [['Khối lượng mol', '18,02 g/mol'], ['Nhiệt độ sôi', '100 °C'], ['Khối lượng riêng', '1,00 g/cm³'], ['pH (nguyên chất)', '≈ 7']],
    safety: 'An toàn.',
    build: (fill) => buildBottle(0x60a5fa, 0xe5e7eb, 0x3b82f6, 0xcfe8ff, fill),
    stock: STOCK_SPECS.water,
  },
  {
    id: 'hcl', category: 'Liquid', name: 'Hydrochloric acid', formula: 'HCl (aq)',
    desc: 'Axit mạnh, dùng trong chuẩn độ và tách kim loại. Mẫu hiển thị là dung dịch đậm đặc.',
    props: [['Khối lượng mol', '36,46 g/mol'], ['Nồng độ (đậm đặc)', '≈ 37 %'], ['Khối lượng riêng', '≈ 1,18 g/cm³'], ['Tính chất', 'Axit mạnh']],
    safety: 'Ăn mòn mạnh. Đeo kính, găng tay; dùng trong tủ hút.',
    build: (fill) => buildBottle(0xe9e08a, 0xfde68a, 0xdc2626, 0xcfe8ff, fill),
    stock: STOCK_SPECS.hcl,
  },
  {
    id: 'naoh',
    category: 'Liquid',
    name: 'Sodium hydroxide',
    formula: 'NaOH (aq)',
    desc: 'Dung dịch natri hiđroxit là bazơ mạnh, có thể trung hòa axit HCl.',
    props: [
      ['Khối lượng mol', '40,00 g/mol'],
      ['Trạng thái', 'Dung dịch'],
      ['Tính chất', 'Bazơ mạnh'],
    ],
    safety: 'Ăn mòn mạnh. Cần kính và găng tay bảo hộ; tránh tiếp xúc với da và mắt.',
    build: (fill) => buildBottle(0xdbeafe, 0x93c5fd, 0x2563eb, 0xcfe8ff, fill),
    stock: STOCK_SPECS.naoh,
  },
  {
    id: 'cuso4', category: 'Liquid', name: 'Copper(II) sulfate', formula: 'CuSO₄ (aq)',
    desc: 'Dung dịch muối đồng màu xanh lam đặc trưng, dùng trong nhiều thí nghiệm phản ứng.',
    props: [['Khối lượng mol', '159,61 g/mol'], ['Màu dung dịch', 'Xanh lam'], ['Ion tạo màu', 'Cu²⁺'], ['Loại', 'Dung dịch muối']],
    safety: 'Có hại nếu nuốt; độc với thủy sinh.',
    build: (fill) => buildBottle(0x1e8fd6, 0xbfdbfe, 0x1f2937, 0xcfe8ff, fill),
    stock: STOCK_SPECS.cuso4,
  },

  // Dung dịch bổ sung (lab-models.js)
  ...LIQUID_ITEMS,

  // ---- Gas ----
  {
    id: 'o2', category: 'Gas', name: 'Oxygen', formula: 'O₂',
    desc: 'Khí duy trì sự cháy và hô hấp, chứa trong bình áp suất cao.',
    props: [['Khối lượng mol', '32,00 g/mol'], ['Nhiệt độ sôi', '−183 °C'], ['Trạng thái (25 °C)', 'Khí'], ['Tỉ lệ trong không khí', '≈ 21 %']],
    safety: 'Chất oxy hóa mạnh, làm tăng nguy cơ cháy.',
    build: () => buildGasCylinder(0x2a6fdb),
    stock: STOCK_SPECS.o2,
  },
  {
    id: 'h2', category: 'Gas', name: 'Hydrogen', formula: 'H₂',
    desc: 'Khí nhẹ nhất, dễ cháy, dùng trong tổng hợp hóa học và làm nhiên liệu.',
    props: [['Khối lượng mol', '2,016 g/mol'], ['Nhiệt độ sôi', '−252,9 °C'], ['Trạng thái (25 °C)', 'Khí'], ['Đặc điểm', 'Nhẹ nhất']],
    safety: 'Rất dễ cháy nổ. Không để gần lửa hoặc tia lửa.',
    build: () => buildGasCylinder(0xd93b3b),
    stock: STOCK_SPECS.h2,
  },
  {
    id: 'co2', category: 'Gas', name: 'Carbon dioxide', formula: 'CO₂',
    desc: 'Khí không cháy, sinh ra khi đốt cháy hợp chất chứa cacbon và khi hô hấp.',
    props: [['Khối lượng mol', '44,01 g/mol'], ['Thăng hoa', '−78,5 °C (1 atm)'], ['Trạng thái (25 °C)', 'Khí'], ['Tỉ lệ trong không khí', '≈ 0,04 %']],
    safety: 'Nồng độ cao gây ngạt. Thông gió tốt.',
    build: () => buildGasCylinder(0x7d8590),
    stock: STOCK_SPECS.co2,
  },
  {
    id: 'so2', category: 'Gas', name: 'Sulfur dioxide', formula: 'SO₂',
    desc: 'Khí lưu huỳnh đioxit không màu, mùi hắc, có tính khử: làm mất màu nước brom (SO₂ + Br₂ + 2H₂O → 2HBr + H₂SO₄). Chọn bình khí, bấm P rồi chọn cốc để sục khí qua ống dẫn.',
    props: [['Khối lượng mol', '64,07 g/mol'], ['Trạng thái (25 °C)', 'Khí, không màu'], ['Mùi', 'Hắc, gây ho'], ['Tính chất', 'Oxit axit, có tính khử']],
    safety: 'Rất độc khi hít phải, gây tổn thương đường hô hấp. Chỉ thao tác trong tủ hút đang bật quạt.',
    build: () => buildGasCylinder(0xa16207),
    stock: STOCK_SPECS.so2,
  },

  // ---- Glassware ----
  {
    id: 'beaker', category: 'Glassware', name: 'Beaker 250 mL', formula: 'Cốc thủy tinh',
    desc: 'Cốc có mỏ rót, dùng để chứa, pha trộn và đun nóng nhẹ dung dịch.',
    props: [['Dung tích', '250 mL'], ['Vật liệu', 'Thủy tinh borosilicate'], ['Chịu nhiệt', 'Có'], ['Độ chính xác thể tích', 'Thấp']],
    safety: 'Cẩn thận vỡ khi nóng hoặc va chạm.',
    build: buildBeaker,
  },
  {
    id: 'erlenmeyer', category: 'Glassware', name: 'Erlenmeyer flask', formula: 'Bình tam giác',
    desc: 'Bình đáy rộng, cổ hẹp, thích hợp cho chuẩn độ và lắc trộn mà ít bị bắn ra ngoài.',
    props: [['Dung tích', '250 mL'], ['Vật liệu', 'Thủy tinh borosilicate'], ['Dùng cho', 'Chuẩn độ, pha dung dịch'], ['Chịu nhiệt', 'Có']],
    safety: 'Cẩn thận khi đun; không đậy kín khi nóng.',
    build: buildErlenmeyer,
  },
  {
    id: 'roundflask', category: 'Glassware', name: 'Round-bottom flask', formula: 'Bình cầu đáy tròn',
    desc: 'Bình đáy tròn chịu nhiệt đều, dùng trong chưng cất và phản ứng đun hồi lưu. Đặt trên vòng đỡ.',
    props: [['Dung tích', '250 mL'], ['Vật liệu', 'Thủy tinh borosilicate'], ['Dùng cho', 'Chưng cất, hồi lưu'], ['Chịu nhiệt', 'Rất tốt']],
    safety: 'Cần giá đỡ hoặc vòng đỡ khi sử dụng.',
    build: buildRoundFlask,
  },
  {
    id: 'rack', category: 'Glassware', name: 'Test tube rack', formula: 'Giá ống nghiệm',
    desc: 'Giá gỗ có 5 lỗ. Kéo thả ống nghiệm (mục Glassware) vào lỗ để cắm ống; ống sẽ đi theo giá khi di chuyển.',
    props: [['Số ống', '3'], ['Vật liệu giá', 'Gỗ'], ['Vật liệu ống', 'Thủy tinh'], ['Dùng cho', 'Phản ứng quy mô nhỏ']],
    safety: 'Ống nghiệm dễ vỡ, xếp ngay ngắn.',
    build: buildTestTubeRack,
  },

  // Bình và dụng cụ thủy tinh bổ sung (lab-models.js)
  ...GLASSWARE_ITEMS,

  // ---- Equipment ----
  {
    id: 'bunsen', category: 'Equipment', name: 'Bunsen burner', formula: 'Đèn Bunsen',
    desc: 'Đèn khí để đun nóng và khử trùng. Ngọn lửa trong mô hình có hiệu ứng chuyển động nhẹ.',
    props: [['Nhiên liệu', 'Khí gas / methane'], ['Vùng nóng nhất', 'Đỉnh nón xanh'], ['Vật liệu', 'Kim loại'], ['Mô hình', 'Có ngọn lửa động']],
    safety: 'Nguy cơ cháy và bỏng. Buộc tóc, tránh xa chất dễ cháy.',
    build: buildBunsen,
  },
  {
    id: 'stand', category: 'Equipment', name: 'Retort stand', formula: 'Giá đỡ thí nghiệm',
    desc: 'Giá kim loại có thanh đứng, tay đỡ và vòng kẹp. Kéo thả bình cầu, bình cầu có nhánh hoặc ống nghiệm vào vòng kẹp để giữ.',
    props: [['Vật liệu', 'Thép'], ['Chiều cao thanh', '≈ 40 cm (tỉ lệ mô hình)'], ['Phụ kiện', 'Tay đỡ, vòng kẹp'], ['Dùng cho', 'Cố định dụng cụ']],
    safety: 'Kiểm tra độ vững trước khi gắn dụng cụ nặng.',
    build: buildRetortStand,
  },
  {
    id: 'balance', category: 'Equipment', name: 'Digital balance', formula: 'Cân điện tử',
    desc: 'Cân điện tử có đĩa cân bằng kim loại. Đặt mẫu, cốc hoặc bình lên đĩa để đọc khối lượng chất (đã trừ bì).',
    props: [['Độ chính xác', '0,01 g (điển hình)'], ['Đĩa cân', 'Thép không gỉ'], ['Hiển thị', 'LED'], ['Dùng cho', 'Cân hóa chất']],
    safety: 'Đặt giấy cân; không cân trực tiếp hóa chất ăn mòn.',
    build: buildBalance,
  },
  // Dụng cụ bổ sung (lab-models.js)
  ...EQUIPMENT_ITEMS,



];

const itemById = Object.fromEntries(CATALOG.map((i) => [i.id, i]));

// Mẫu nguyên tố từ bảng tuần hoàn dùng chung itemById để chọn, xem thông tin, lưu và tải
// (không thêm vào CATALOG nên không tạo thêm 118 ảnh thu nhỏ lúc khởi động)
for (const el of PERIODIC_ELEMENTS) itemById[ELEMENT_ITEM_PREFIX + el.id] = createElementItem(el);

// ------------------------------------------------------------
// 10. Tạo một mẫu vật hoàn chỉnh (đáy nằm đúng mặt bàn, căn giữa)
// ------------------------------------------------------------
function buildInstance(item) {
  const inner = item.build();
  const box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);
  const root = new THREE.Group();
  root.add(inner);
  root.userData.inner = inner;
  return root;
}

function disposeObject(obj) {
  obj.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
    }
  });
}

function makeEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  return { tex, pmrem };
}

// ------------------------------------------------------------
// 11. Ảnh xem trước (thumbnail) cho thư viện
// ------------------------------------------------------------
function generateThumbnails() {
  const size = 200;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(size, size);
  r.setClearColor(0x000000, 0);
  r.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const env = makeEnvironment(r);
  scene.environment = env.tex;
  scene.environmentIntensity = 0.8;
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, 8, 5);
  scene.add(sun, new THREE.HemisphereLight(0xbfd4ff, 0x222833, 0.5));

  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

  CATALOG.filter((item) => CATEGORIES.includes(item.category)).forEach((item) => {
    const root = buildInstance(item);
    scene.add(root);
    const box = new THREE.Box3().setFromObject(root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(35 / 2))) * 1.05;
    cam.position.copy(sphere.center).addScaledVector(new THREE.Vector3(1, 0.65, 1).normalize(), dist);
    cam.lookAt(sphere.center);
    r.render(scene, cam);
    item.thumb = r.domElement.toDataURL('image/png');
    scene.remove(root);
    disposeObject(root);
  });

  env.tex.dispose();
  env.pmrem.dispose();
  r.dispose();
  r.forceContextLoss();
}

generateThumbnails();

// ------------------------------------------------------------
// 12. Cảnh 3D chính
// ------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.domElement.style.cssText =
  'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;';
viewportEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.fog = new THREE.Fog(0x0d1117, 28, 60);

const mainEnv = makeEnvironment(renderer);
scene.environment = mainEnv.tex;
scene.environmentIntensity = 0.6;

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
camera.position.set(-5.5, 11.5, 17.5); // nhìn chéo vào bàn chính, thấy được phòng lab phía sau

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.5, -3);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.minDistance = 3;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI / 2 - 0.03;
limitCameraToRoom(controls); // giữ camera ở trong phòng lab
controls.update();

// Ánh sáng
const hemiLight = new THREE.HemisphereLight(0xbfd4ff, 0x1a1f2a, 0.35);
scene.add(hemiLight);
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(6, 11, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -10;
sun.shadow.camera.right = 10;
sun.shadow.camera.top = 10;
sun.shadow.camera.bottom = -10;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0005;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x6ea8ff, 0.5);
fill.position.set(-7, 4, -5);
scene.add(fill);

// Ánh sáng phòng lab: nâng cấp các đèn ở trên (trần sáng, nắng qua cửa sổ, bóng mềm)
applyLabLighting({ scene, renderer, hemi: hemiLight, sun, fill });

// Phòng thí nghiệm: sàn, tường, cửa sổ, tủ, kệ hóa chất, bồn rửa, thiết bị nền (xem lab-room.js)
// Sàn phòng nằm ở ROOM.floorY; bàn chính có tủ bên dưới chạm sàn.
const labRoom = createLabRoom(scene);
// Thao tác với đồ vật trong phòng (tủ, bồn rửa, ổ điện, ghế...), khởi tạo ở cuối file
let world = null;
let reactionLab = null; // 5 thí nghiệm phản ứng (tạo ở cuối file)

// Bàn thí nghiệm (mặt trên nằm ở y = 0). Vùng đặt dụng cụ vẫn là BENCH_W × BENCH_D;
// mặt bàn epoxy dài hơn để hai đầu bàn và kệ phía sau có chỗ để đồ.
const bench = new THREE.Group();
const top = new THREE.Mesh(new THREE.BoxGeometry(BENCH_TOP.w, BENCH_H, BENCH_TOP.d), createBenchTopMaterial());
top.position.set(0, -BENCH_H / 2, BENCH_TOP.cz);
top.receiveShadow = true;
bench.add(top);

// Lưới trên mặt bàn
const gridPts = [];
for (let x = -BENCH_W / 2; x <= BENCH_W / 2 + 0.001; x += 1) {
  gridPts.push(x, 0.004, -BENCH_D / 2, x, 0.004, BENCH_D / 2);
}
for (let z = -BENCH_D / 2; z <= BENCH_D / 2 + 0.001; z += 1) {
  gridPts.push(-BENCH_W / 2, 0.004, z, BENCH_W / 2, 0.004, z);
}
const gridGeo = new THREE.BufferGeometry();
gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
// lưới mờ đánh dấu vùng làm thí nghiệm (vẫn giúp căn chỉnh nhưng không lấn át mặt bàn thật)
bench.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x8a939e, transparent: true, opacity: 0.16 })));
scene.add(bench);

// Phản chiếu lấy từ chính căn phòng (thay cho môi trường mặc định)
scene.environment = captureRoomEnvironment(renderer, scene);
scene.environmentIntensity = 0.7;

// ------------------------------------------------------------
// 13. Quản lý trạng thái ứng dụng
// ------------------------------------------------------------
const placed = []; // danh sách mẫu vật trên bàn
let selected = null; // mẫu vật đang chọn trên bàn
let experimentSource = null;
let experimentTarget = null;
let selectionBox = null; // khung viền chọn
let activeCategory = CATEGORIES[0];
let lastLabCategory = CATEGORIES[0]; // danh mục trước khi mở bảng tuần hoàn
let libraryItemId = CATALOG.find((i) => i.category === activeCategory).id;

function setupShadows(root) {
  root.traverse((c) => {
    if (c.isMesh) {
      const transparent = c.material && c.material.transparent;
      c.castShadow = !transparent;
      c.receiveShadow = !transparent;
    }
  });
}

function addToBench(itemId, stockAmount, stockUnit = 'mL') {
  const item = itemById[itemId];
  if (!item) return null;
  const instanceId = crypto.randomUUID();
  // Hóa chất (Liquid, Gas): ghi lượng tồn theo mL để hiện nhãn và trừ dần khi rót
  if (item.stock) {
    if (String(stockAmount ?? '').trim() === '') {
      showToast('Hãy nhập lượng cần lấy (mL, g hoặc mol).', 'error');
      infoEl.querySelector('[data-stock-amount]')?.focus();
      return null;
    }
    const quantity = toStockQuantity(item, stockAmount, stockUnit);
    if (!quantity.ok) {
      showToast(quantity.error, 'error');
      return null;
    }
    registerSample(experimentState, instanceId, createStockRecord(item, quantity));
    saveExperimentState(experimentState);
    if (stockUnit !== 'mL') {
      setTimeout(
        () =>
          showToast(
            `Đã lấy ${fmtQ(quantity.inputAmount, 6)} ${quantity.inputLabel} ≈ ${fmtQ(quantity.volumeMl, 6)} mL ${item.name}.`
          ),
        0
      );
    }
  }
  // Chất rắn trong lọ (đá vôi): lượng tồn theo gam
  if (item.solidStock) {
    const s = item.solidStock;
    registerSample(experimentState, instanceId, {
      kind: 'stock', itemId, symbol: s.symbol, nameVi: item.name, category: 'compound', phase: 'solid', formula: s.formula,
      solute: false, soluteMassG: null, unit: 'g', amount: s.grams, initialAmount: s.grams, massG: s.grams,
      volumeMl: s.grams / s.densityGmL, moles: s.grams / s.molarMass, massKind: 'measured', volumeKind: 'estimated',
      illustrative: false, createdAt: Date.now(),
    });
    saveExperimentState(experimentState);
  }
  const root = buildPlacedRoot(itemId, instanceId);
  root.userData.isPlaced = true;
  root.userData.itemId = itemId;
  root.userData.instanceId = instanceId;
  setupShadows(root);

  const spot = nextFreeBenchSpot();
  // lệch nhẹ vị trí và góc xoay cho tự nhiên như người thật đặt đồ
  const nat = naturalPlacement(placed.length);
  root.position.set(spot.x + nat.dx, 0, spot.z + nat.dz);
  root.rotation.y = nat.yaw;

  scene.add(root);
  placed.push(root);
  selectPlaced(root);
  return root;
}

// Cất vật vào tủ: gỡ khỏi bàn nhưng giữ nguyên dữ liệu (lượng còn lại, chất trong bình)
function stashPlaced(root) {
  childrenOf(root).forEach((c) => {
    detach(c, scene);
    world?.onDrop(c);
  });
  if (root.userData.attach) detach(root, scene);
  animator.setBoiling(String(root.userData.instanceId), null);
  const idx = placed.indexOf(root);
  if (idx >= 0) placed.splice(idx, 1);
  root.parent?.remove(root);
  disposeObject(root);
  if (selected === root) selectPlaced(null);
}

// Lấy vật đã cất trong tủ ra bàn (dựng lại từ dữ liệu đã giữ)
function restoreStored({ itemId, instanceId }) {
  if (!itemId.startsWith(ELEMENT_ITEM_PREFIX) && !itemById[itemId]) return null;
  const root = buildPlacedRoot(itemId, instanceId);
  root.userData.isPlaced = true;
  root.userData.itemId = itemId;
  root.userData.instanceId = instanceId;
  setupShadows(root);
  const spot = nextFreeBenchSpot();
  root.position.set(spot.x, 0, spot.z);
  scene.add(root);
  placed.push(root);
  updateVesselLiquid(root);
  selectPlaced(root);
  return root;
}

// Bình vừa được rửa / đổ bỏ: vẽ lại chất lỏng, tắt hiệu ứng sôi và kết tủa
function refreshVessel(root) {
  const id = String(root.userData.instanceId);
  pendingSediment.delete(id);
  animator.setBoiling(id, null);
  updateVesselLiquid(root);
}

// ------------------------------------------------------------
// Mẫu nguyên tố: lấy từ bảng tuần hoàn theo g / mg / mol / mL
// ------------------------------------------------------------
function buildElementRoot(itemId, instanceId) {
  const el = getElement(itemId.slice(ELEMENT_ITEM_PREFIX.length));
  const sample = experimentState.samples?.[instanceId] ?? null;
  return buildInstance({ build: () => buildElementSampleModel(el, sample) });
}

// Dựng vật thể trên bàn theo loại: mẫu nguyên tố, chai hóa chất có lượng tồn, hoặc dụng cụ
function buildPlacedRoot(itemId, instanceId) {
  if (itemId.startsWith(ELEMENT_ITEM_PREFIX)) return buildElementRoot(itemId, instanceId);
  const item = itemById[itemId];
  const stock = experimentState.samples?.[instanceId];
  if ((item.stock || item.solidStock) && stock) return buildInstance({ build: () => buildStockModel(item, stock) });
  return buildInstance(item);
}

// Tìm chỗ trống trên bàn cho vật thể mới, tránh đặt chồng lên vật thể đã có
function nextFreeBenchSpot() {
  const xs = [-5.4, -3.25, -1.1, 1.05, 3.2, 5.35];
  const zs = [-2.6, 0, 2.6];
  for (const z of zs) {
    for (const x of xs) {
      if (placed.every((p) => Math.hypot(p.position.x - x, p.position.z - z) > 1.6)) return { x, z };
    }
  }
  const n = placed.length; // bàn đã kín: quay lại cách xếp cũ
  return { x: ((n % 5) - 2) * 2.4, z: (Math.floor(n / 5) % 3) * 2.0 - 2.0 };
}

// Chất lỏng và chất rắn trong các bình mới (ống nghiệm, ống đong, bình định mức...)
function updateGenericVessel(root, itemId, instanceId, override = null) {
  removeOwnLiquid(root);
  const spec = VESSEL_SPECS[itemId];
  if (!spec || !root.userData.inner) return;
  const id = String(instanceId);
  const group = new THREE.Group();
  group.name = 'dynamic-liquid';
  const chemicalIds = override?.ids ?? experimentState.mixtures?.[id] ?? [];
  const total = override?.volume ?? experimentState.liquidVolumes?.[id] ?? 0;
  if (total > 0 && chemicalIds.length) {
    const fill = buildVesselFill(spec, total / spec.capacityMl, (override ? null : reactionLab?.liquidColor(id)) ?? liquidColorFor(chemicalIds));
    if (fill) group.add(fill);
  }
  const solids = (experimentState.pourRecords?.[id] || []).filter(
    (r) => r.phase === 'solid' && r.massG > 0 && r.chemicalId.startsWith(ELEMENT_ITEM_PREFIX)
  );
  if (solids.length) {
    const k = Math.max(0.6, spec.bottomRadius / 0.45);
    const deposit = buildVesselDeposit(
      solids.map((r) => ({ el: getElement(r.chemicalId.slice(ELEMENT_ITEM_PREFIX.length)), massG: r.massG }))
    );
    deposit.scale.setScalar(k);
    deposit.position.y = spec.inner[0][1] - 0.03 * k;
    group.add(deposit);
  }
  if (!override && !pendingSediment.has(id)) {
    const sid = chemicalIds.find((c) => SEDIMENTS[c]);
    if (sid) group.add(buildSediment(SEDIMENTS[sid], spec.bottomRadius, spec.inner[0][1]));
  }
  root.userData.inner.add(group);
}

// Dung tích bình nhận; báo lỗi nếu rót tràn
const VESSEL_CAPACITY = { beaker: 250, erlenmeyer: 250 };
function capacityError(itemId, instanceId, addMl) {
  const cap = VESSEL_CAPACITY[itemId] ?? VESSEL_SPECS[itemId]?.capacityMl;
  if (!cap) return null;
  const now = experimentState.liquidVolumes?.[String(instanceId)] ?? 0;
  if (now + addMl <= cap + 1e-9) return null;
  const room = Math.max(0, cap - now);
  return `Bình chỉ chứa tối đa ${cap} mL (còn trống ${fmtQ(room, 6)} mL), không rót thêm ${fmtQ(addMl, 6)} mL được.`;
}

function takeElementSample() {
  const form = readSampleForm(infoEl);
  const el = form && getElement(form.elementId);
  if (!el) return;
  if (!String(form.amount ?? '').trim()) {
    showToast('Hãy nhập lượng mẫu cần lấy.', 'error');
    infoEl.querySelector('[data-sample-amount]')?.focus();
    return;
  }
  const quantity = toQuantity(el, form.amount, form.unit);
  if (!quantity.ok) {
    showToast(quantity.error, 'error');
    return;
  }
  const itemId = ELEMENT_ITEM_PREFIX + el.id;
  const instanceId = crypto.randomUUID();
  registerSample(experimentState, instanceId, createSampleRecord(el, quantity));

  const root = buildElementRoot(itemId, instanceId);
  root.userData.isPlaced = true;
  root.userData.itemId = itemId;
  root.userData.instanceId = instanceId;
  setupShadows(root);
  const spot = nextFreeBenchSpot();
  root.position.set(spot.x, 0, spot.z);
  scene.add(root);
  placed.push(root);

  const label = `${amountLabel(quantity.amount, quantity.unit)} ${el.nameVi}`;
  experimentState.log.push({
    type: 'success',
    message: `Đã lấy mẫu ${label} (≈ ${fmtQ(quantity.massG)} g) lên bàn thí nghiệm.`,
    time: new Date().toLocaleTimeString(),
  });
  saveExperimentState(experimentState);
  renderInfo();
  showToast(`Đã lấy ${label} lên bàn. Bấm "Về bàn thí nghiệm" để xem.`);
}

// Vẽ lại mẫu sau khi lượng thay đổi (nhãn, mức chất lỏng)
function refreshElementSample(root) {
  if (!root || !experimentState.samples?.[root.userData.instanceId]) return;
  const fresh = buildPlacedRoot(root.userData.itemId, root.userData.instanceId);
  const inner = fresh.userData.inner;
  const old = root.userData.inner;
  root.remove(old);
  disposeObject(old);
  root.add(inner);
  root.userData.inner = inner;
  setupShadows(root);
}

function sampleBlockHtml(root) {
  const sample = experimentState.samples?.[root.userData.instanceId];
  if (!sample && !root.userData.itemId?.startsWith(ELEMENT_ITEM_PREFIX)) return '';
  const html = sampleSummaryHtml(sample);
  // khí SO₂ dẫn được vào cốc bằng ống dẫn khí; đá vôi dùng nút riêng (lab-reactions.js)
  if (root.userData.itemId === 'so2') return html.replace('Mẫu khí được giữ trong bình thu khí; chưa hỗ trợ dẫn khí sang bình khác.', 'Dẫn khí vào cốc/bình bằng ống dẫn khí (nút bên dưới).');
  return html;
}


function clampToBench(v) {
  v.x = THREE.MathUtils.clamp(v.x, -BENCH_W / 2 + 0.6, BENCH_W / 2 - 0.6);
  v.z = THREE.MathUtils.clamp(v.z, -BENCH_D / 2 + 0.6, BENCH_D / 2 - 0.6);
  v.y = 0;
}

function clearSelectionBox() {
  if (selectionBox) {
    scene.remove(selectionBox);
    selectionBox.geometry.dispose();
    selectionBox.material.dispose();
    selectionBox = null;
  }
}


function selectPlaced(root) {
  clearSelectionBox();
  selected = root;
  if (root) world?.clearSelection();

  if (root) {
    selectionBox = new THREE.BoxHelper(root, 0x60a5fa);
    scene.add(selectionBox);

    // Ghi nhận mẫu vật được chọn cho hệ thống thí nghiệm
    console.log('UPDATE VESSEL LIQUID ĐÃ CHẠY');
    const itemId = root.userData.itemId;
    if (itemId) {
      selectSample(experimentState, itemId);
      console.log('[ChemLab 3D] Đã chọn mẫu vật:', itemId);
    }
  }

  renderInfo();
}


function deleteSelected() {
  if (!selected) return;
  if (animator.isBusy()) {
    showToast('Hãy đợi thao tác đang thực hiện xong.');
    return;
  }
  removeSample(experimentState, selected.userData.instanceId);
  world?.onRemove(selected);
  childrenOf(selected).forEach((c) => detach(c, scene)); // vật đang gắn rơi xuống bàn
  animator.setBoiling(String(selected.userData.instanceId), null);
  const idx = placed.indexOf(selected);
  if (idx >= 0) placed.splice(idx, 1);
  selected.parent?.remove(selected);
  disposeObject(selected);
  selectPlaced(null);
}

// Gỡ toàn bộ mẫu vật khỏi bàn (không đụng tới bàn, camera, ánh sáng)
function removeAllFromBench() {
  placed.forEach((p) => {
    world?.onRemove(p);
    removeSample(experimentState, p.userData.instanceId);
    animator.setBoiling(String(p.userData.instanceId), null);
    p.parent?.remove(p);
    disposeObject(p);
  });
  placed.length = 0;
  selectPlaced(null);
}

function clearAll() {
  if (placed.length === 0) {
    showToast('Bàn thí nghiệm đang trống.');
    return;
  }
  if (
    !window.confirm(
      `Xóa ${placed.length} mẫu vật trên bàn thí nghiệm?\n(Bản lưu trong trình duyệt sẽ không bị xóa.)`
    )
  )
    return;
  removeAllFromBench();
  showToast('Đã xóa các mẫu vật trên bàn.');
}

function rotateSelected() {
  if (!selected) return;
  selected.rotation.y += Math.PI / 2;
  renderInfo();
}
// ------------------------------------------------------------
// 13b. Lưu / tải thí nghiệm (localStorage)
// ------------------------------------------------------------
const STORAGE_KEY = 'chemlab3d.experiment';
const STORAGE_VERSION = 1;

let toastEl = null;
let toastTimer = 0;

function showToast(message, type = 'info') {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.setAttribute('role', 'status');
    viewportEl.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.className = 'toast is-visible' + (type === 'error' ? ' is-error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 3500);
}

const round4 = (n) => Math.round(n * 10000) / 10000;

// Trả về { status: 'none' | 'error' | 'ok', ... } và không bao giờ ném lỗi
function readSavedExperiment() {
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (_) {
    return { status: 'error', reason: 'Trình duyệt không cho phép truy cập localStorage.' };
  }
  if (raw === null) return { status: 'none' };

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return { status: 'error', reason: 'Dữ liệu lưu bị hỏng (không đọc được JSON).' };
  }
  if (!data || typeof data !== 'object' || data.version !== STORAGE_VERSION || !Array.isArray(data.items)) {
    return { status: 'error', reason: 'Dữ liệu lưu không đúng định dạng.' };
  }

  const items = [];
  let skipped = 0;
  for (const it of data.items) {
    const valid =
      it &&
      typeof it === 'object' &&
      typeof it.id === 'string' &&
      Object.prototype.hasOwnProperty.call(itemById, it.id) &&
      Number.isFinite(it.x) &&
      Number.isFinite(it.z) &&
      Number.isFinite(it.rotY);
    if (valid) {
  items.push({
    id: it.id,
    instanceId: it.instanceId,
    x: it.x,
    z: it.z,
    rotY: it.rotY,
  });
}
    else skipped++;
  }
  if (data.items.length > 0 && items.length === 0) {
    return { status: 'error', reason: 'Bản lưu không có mẫu vật hợp lệ nào.' };
  }
return {
  status: 'ok',
  items,
  mixtures:
    data.mixtures && typeof data.mixtures === 'object'
      ? data.mixtures
      : {},
    pourRecords:
    data.pourRecords && typeof data.pourRecords === 'object'
      ? data.pourRecords
      : {},
  liquidVolumes:
    data.liquidVolumes && typeof data.liquidVolumes === 'object'
      ? data.liquidVolumes
      : {},
  log: Array.isArray(data.log) ? data.log : [],
  reactedVessels:
    data.reactedVessels &&
    typeof data.reactedVessels === 'object'
      ? data.reactedVessels
      : {},
  samples:
    data.samples && typeof data.samples === 'object'
      ? data.samples
      : {},
  attachments:
    data.attachments && typeof data.attachments === 'object' ? data.attachments : {},
  temperatures:
    data.temperatures && typeof data.temperatures === 'object' ? data.temperatures : {},
  rx: data.rx && typeof data.rx === 'object' ? data.rx : {},
  litmus: data.litmus && typeof data.litmus === 'object' ? data.litmus : {},
  world: data.world && typeof data.world === 'object' ? data.world : null,
  skipped,
  savedAt: Number.isFinite(data.savedAt) ? data.savedAt : null,
};
}

// Dùng cho khu vực nút trong bảng thông tin
function savedInfo() {
  const r = readSavedExperiment();
  if (r.status === 'none') return { text: 'Chưa có bản lưu', canLoad: false };
  if (r.status === 'error') return { text: 'Bản lưu không đọc được', canLoad: true };
  const when = r.savedAt
    ? new Date(r.savedAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
    : '';
  return { text: `Bản lưu: ${r.items.length} mẫu vật${when ? ' · ' + when : ''}`, canLoad: true };
}

function saveExperiment() {
  if (placed.length === 0) {
    const prev = readSavedExperiment();
    if (prev.status === 'ok' && prev.items.length > 0) {
      if (!window.confirm('Bàn đang trống. Lưu sẽ ghi đè bản lưu cũ bằng bố cục trống. Tiếp tục?')) return;
    } else {
      showToast('Bàn đang trống, chưa có gì để lưu.');
      return;
    }
  }
  const payload = {
    version: STORAGE_VERSION,
    savedAt: Date.now(),
    mixtures: experimentState.mixtures,
    pourRecords: experimentState.pourRecords || {},
    liquidVolumes: experimentState.liquidVolumes || {},
    samples: experimentState.samples || {},
    log: experimentState.log,
    reactedVessels: experimentState.reactedVessels,
    items: placed.map((p) => {
      const w = p.getWorldPosition(new THREE.Vector3());
      const yaw = new THREE.Euler().setFromQuaternion(p.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
      return { id: p.userData.itemId, instanceId: p.userData.instanceId, x: round4(w.x), z: round4(w.z), rotY: round4(yaw) };
    }),
    // vật nào đang gắn vào ổ ghép nào của vật nào
    attachments: Object.fromEntries(placed.filter((p) => p.userData.attach).map((p) => [p.userData.instanceId, p.userData.attach])),
    temperatures: experimentState.temperatures || {},
    rx: experimentState.rx || {},
    litmus: experimentState.litmus || {},
    // trạng thái phòng: đồ đã cất trong tủ, ổ điện, van gas, bồn rửa, bảng trắng...
    world: world?.serialize() ?? null,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (_) {
    showToast('Không thể lưu (localStorage bị chặn hoặc đã đầy).', 'error');
    return;
  }
  renderInfo();
  showToast(`Đã lưu ${payload.items.length} mẫu vật.`);
}

// Dựng một mẫu vật từ dữ liệu lưu (không tự chọn, không tự xếp vị trí)
function restoreItem({ id, instanceId, x, z, rotY }) {
  const item = itemById[id];
  if (!item) return;

  const root = buildPlacedRoot(id, instanceId);
  root.userData.isPlaced = true;
  root.userData.itemId = id;
  root.userData.instanceId = instanceId || crypto.randomUUID();

  setupShadows(root);
  root.position.set(x, 0, z);
  if (world) world.clampToSurfaces(root.position);
  else clampToBench(root.position);
  root.rotation.y = rotY;

  scene.add(root);
  placed.push(root);
  world?.onDrop(root); // trong bồn rửa / trên cân phân tích

  updateVesselLiquid(root);
}

function loadExperiment() {
  const res = readSavedExperiment();
  if (res.status === 'none') {
    showToast('Chưa có bố cục nào được lưu.');
    return;
  }
  if (res.status === 'error') {
    showToast(`${res.reason} Bản lưu cũ không bị xóa; bấm Save Experiment để ghi đè.`, 'error');
    return;
  }
  if (
    placed.length > 0 &&
    !window.confirm(`Bàn đang có ${placed.length} mẫu vật. Tải bố cục đã lưu sẽ thay thế chúng. Tiếp tục?`)
  )
    return;

 removeAllFromBench();
 experimentState.mixtures = res.mixtures ?? {};
 experimentState.pourRecords = res.pourRecords ?? {};
 experimentState.liquidVolumes = res.liquidVolumes ?? {};
 experimentState.log = res.log ?? [];
 experimentState.reactedVessels = res.reactedVessels ?? {};
 experimentState.samples = res.samples ?? {};
 experimentState.temperatures = res.temperatures ?? {};
 experimentState.rx = res.rx ?? {};
 experimentState.litmus = res.litmus ?? {};
 console.log('[ChemLab] Trạng thái phản ứng sau khi tải:', experimentState.reactedVessels);
  res.items.forEach(restoreItem);
  // Gắn lại các dụng cụ đã ghép
  Object.entries(res.attachments || {}).forEach(([childId, a]) => {
    const child = findPlaced(childId);
    const host = a && findPlaced(a.host);
    const socket = host && socketById(host, a.socket);
    if (child && host && socket && !childAt(host, socket.id)) attach(child, host, socket);
  });
  world?.restore(res.world);
  selectPlaced(null);
  showToast(
    res.skipped > 0
      ? `Đã tải ${res.items.length} mẫu vật (bỏ qua ${res.skipped} mục lỗi).`
      : `Đã tải ${res.items.length} mẫu vật.`
  );
}
// ------------------------------------------------------------
// 14. Giao diện: thanh danh mục, thư viện, bảng thông tin
// ------------------------------------------------------------
function renderCategories() {
  categoryBarEl.innerHTML = CATEGORIES.map(
    (c) =>
      `<button class="category-btn${c === activeCategory ? ' is-active' : ''}" data-category="${c}">${c}</button>`
  ).join('');
}

function renderLibrary() {
  if (activeCategory === PERIODIC_CATEGORY) {
    libraryEl.innerHTML = renderPeriodicLibraryHtml();
    return;
  }
  const list = CATALOG.filter((i) => i.category === activeCategory);
  libraryEl.innerHTML = `
    <div class="library-header">
      <h2>${activeCategory}</h2>
      <span class="library-count">${list.length} mẫu vật</span>
    </div>
    <div class="library-grid">
      ${list
        .map(
          (i) => `
        <button class="item-card${i.id === libraryItemId ? ' is-active' : ''}" data-id="${i.id}" title="Nhấp đúp để thêm vào bàn">
          <img class="item-thumb" src="${i.thumb}" alt="${i.name}" draggable="false" />
          <span class="item-name">${i.name}</span>
          <span class="item-formula">${i.formula}</span>
        </button>`
        )
        .join('')}
    </div>
    <p class="library-tip">Nhấp để xem thông tin. Nhấp đúp để thêm vào bàn.</p>`;
}

function propsHtml(item) {
  return `<dl class="prop-list">${item.props
    .map(([k, v]) => `<div class="prop-row"><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('')}</dl>`;
}

function positionText(root) {
  const w = root.getWorldPosition(new THREE.Vector3());
  const deg = Math.round(THREE.MathUtils.radToDeg(root.rotation.y)) % 360;
  return `X: ${w.x.toFixed(1)} · Z: ${w.z.toFixed(1)} · Xoay: ${(deg + 360) % 360}°`;
}

function renderInfo() {
  let html = '';
  if (activeCategory === PERIODIC_CATEGORY) {
    html = renderElementInfoHtml(periodicTable.getSelected());
  } else if (!selected && world?.selection) {
    html = world.panelHtml();
  } else if (selected) {
    const item = itemById[selected.userData.itemId];
    console.log('Cốc đang chọn:', selected.userData.itemId);
    console.log('Mã cốc:', selected.userData.instanceId);
    console.log(
      'Hóa chất trong cốc:',
      experimentState.mixtures[selected.userData.instanceId]
    );
    html = `
      <div class="info-card">
        <span class="info-badge is-placed">Đang chọn trên bàn</span>
        <h2 class="info-title">${item.name}</h2>
        <p class="info-formula">${item.formula}</p>
        <p class="info-desc">${item.desc}</p>
        ${propsHtml(item)}
        <p class="info-safety"><strong>An toàn:</strong> ${item.safety}</p>
        <p class="info-position" id="pos-readout">${positionText(selected)}</p>
        ${sampleBlockHtml(selected)}
        ${relationsHtml(selected)}
        ${reactionLab ? reactionLab.vesselHtml(selected) + reactionLab.itemHtml(selected) : ''}
        ${world ? world.placedHtml(selected) : ''}
        
        ${
          getSampleInfo(selected.userData.itemId).kind === 'vessel'
            ? `
              
<div class="vessel-contents">
  <strong>Thành phần trong bình</strong>
  ${
    (experimentState.mixtures[selected.userData.instanceId] || []).length
      ? `
        <ul>
          ${[...new Set(experimentState.mixtures[selected.userData.instanceId])]
            .map((chemicalId) => {
  const chemical = itemById[chemicalId];
  const vesselId = String(selected.userData.instanceId);
  const records = (experimentState.pourRecords?.[vesselId] || []).filter(
    (record) => record.chemicalId === chemicalId
  );

  // Mỗi chất chỉ hiện một dòng; ghi cả mL và g nếu có
  const volume = records.reduce((sum, record) => sum + (record.volumeMl || 0), 0);
  const mass = records.reduce((sum, record) => sum + (record.massG || 0), 0);
  const parts = [];
  if (volume > 0) parts.push(`${fmtQ(volume, 6)} mL`);
  if (mass > 0) parts.push(`${fmtQ(mass, 6)} g`);

  return `<li>${chemical ? chemical.name : reactionLab?.productName(chemicalId) ?? chemicalId}${
    parts.length ? ` — ${parts.join(' · ')}` : ''
  }</li>`;
})
            .join('')}
        </ul>
        <p><strong>Tổng thể tích đã rót:</strong> ${
          experimentState.liquidVolumes?.[
            String(selected.userData.instanceId)
          ] ?? 0
        } mL</p>
      `
      : '<p class="bench-saved">Chưa ghi nhận hóa chất nào.</p>'
  }
</div>
            `
            : ''
        }

        <div class="info-actions">
          <button class="btn" data-action="rotate">Xoay 90° (R)</button>
          <button class="btn btn-danger" data-action="delete">Xóa (Delete)</button>
        </div>
      </div>`;
  } else if (libraryItemId) {
    const item = itemById[libraryItemId];
    html = `
      <div class="info-card">
        <span class="info-badge">${item.category} · Thư viện</span>
        <h2 class="info-title">${item.name}</h2>
        <p class="info-formula">${item.formula}</p>
        <p class="info-desc">${item.desc}</p>
        ${propsHtml(item)}
        <p class="info-safety"><strong>An toàn:</strong> ${item.safety}</p>
        ${item.stock ? stockFormHtml(item) : ''}
        <div class="info-actions">
          <button class="btn btn-primary" data-action="add">Thêm vào bàn thí nghiệm</button>
        </div>
      </div>`;
  } else {
    html = `<div class="info-card"><p class="info-desc">Chọn một mẫu vật để xem thông tin.</p></div>`;
  }

  const saved = savedInfo();
  html += `
    <div class="bench-panel">
      <div class="bench-panel-head">
        <span>Trên bàn: <strong>${placed.length}</strong> mẫu vật</span>
      </div>
      <p class="bench-saved">${saved.text}</p>
      <div class="bench-actions">
        <button class="btn btn-primary" data-action="save">Save Experiment</button>
        <button class="btn" data-action="load" ${saved.canLoad ? '' : 'disabled'}>Load Experiment</button>
        <button class="btn btn-danger" data-action="clear">Clear Bench</button>
      </div>
    </div>`;
 
  // hướng dẫn 5 thí nghiệm phản ứng (lab-reactions.js)
  if (reactionLab) html += `<div class="bench-panel">${reactionLab.guideHtml()}</div>`;

  const log = getExperimentLog(experimentState);

  html += `
    <div class="bench-panel">
      <div class="bench-panel-head">
        <span>Nhật ký thí nghiệm</span>
        <strong>${log.length}</strong>
      </div>
      <div class="experiment-log">
        ${
          log.length
            ? log.slice(-10).reverse().map((entry) => `
                <div class="experiment-log-entry">
                  <small>${entry.time}</small>
                  <p>${entry.message}</p>
                </div>
              `).join('')
            : '<p class="bench-saved">Chưa có thao tác nào.</p>'
        }
      </div>
    </div>`;

  // giữ trạng thái mở/đóng của các mục hướng dẫn khi bảng vẽ lại
  const openKeys = new Set([...infoEl.querySelectorAll('details[data-keep][open]')].map((d) => d.dataset.keep));
  infoEl.innerHTML = html;
  infoEl.querySelectorAll('details[data-keep]').forEach((d) => {
    if (openKeys.has(d.dataset.keep)) d.open = true;
  });
  world?.afterRender(infoEl);
}


// Sự kiện: danh mục
categoryBarEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.category-btn');
  if (!btn) return;
  if (activeCategory !== PERIODIC_CATEGORY) lastLabCategory = activeCategory;
  activeCategory = btn.dataset.category;
  libraryItemId = CATALOG.find((i) => i.category === activeCategory)?.id ?? null;
  world?.clearSelection();
  selectPlaced(null);
  renderCategories();
  renderLibrary();
  periodicTable.setVisible(activeCategory === PERIODIC_CATEGORY);
});

// Sự kiện: thư viện (không vẽ lại khi nhấp để nhấp đúp hoạt động)
libraryEl.addEventListener('click', (e) => {
  const card = e.target.closest('.item-card');
  if (!card) return;
  libraryItemId = card.dataset.id;
  world?.clearSelection();
  libraryEl.querySelectorAll('.item-card').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.id === libraryItemId);
  });
  if (selected) selectPlaced(null);
  else renderInfo();
});

libraryEl.addEventListener('dblclick', (e) => {
  const card = e.target.closest('.item-card');
  if (!card) return;
  // Hóa chất: không lấy lượng mặc định, mời người dùng nhập thể tích
  if (itemById[card.dataset.id]?.stock) {
    infoEl.querySelector('[data-stock-amount]')?.focus();
    showToast('Nhập lượng cần lấy (chọn mL, g hoặc mol) rồi nhấn Enter.');
    return;
  }
  addToBench(card.dataset.id);
});

// Sự kiện: bảng thông tin
infoEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'w') {
    world?.handleAction(btn);
    return;
  }
  if (action === 'rx') {
    reactionLab?.handleAction(btn);
    return;
  }
  if (action === 'add') {
    const f = readStockForm(infoEl);
    addToBench(libraryItemId, f?.amount, f?.unit);
  }
  else if (action === 'delete') deleteSelected();
  else if (action === 'rotate') rotateSelected();
  else if (action === 'clear') clearAll();
  else if (action === 'save') saveExperiment();
  else if (action === 'load') loadExperiment();
  else if (action === 'add-element') takeElementSample();
  else if (action === 'pour-start') handlePourStep();
  else if (action === 'stir') stirVessel(selected);
  else if (action === 'drain') drainFromStopcock(selected);
  else if (action === 'detach') detachSelected();
});

// Phím tắt
// Phím tắt
window.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selected) {
      e.preventDefault();
      deleteSelected();
    }
    return;
  }

  if (e.key === 'Escape') {
    // Hủy nguồn đang chờ rót/cho vào bình (nếu có)
    if (experimentSource) {
      experimentSource = null;
      showToast('Đã hủy chọn nguồn.');
    }
    selectPlaced(null);
    return;
  }

  if (e.key === 'r' || e.key === 'R') {
    rotateSelected();
    return;
  }

  if (e.key !== 'p' && e.key !== 'P') return;
  handlePourStep();
});

// Thao tác rót / cho mẫu vào bình: gọi từ phím P hoặc nút trong bảng thông tin
// ============================================================
// 15b. Rót / cho mẫu vào bình: nhập lượng → hoạt cảnh → chất xuất hiện dần
// ============================================================
const animator = createAnimator(scene);

// Vòng xanh báo chỗ có thể ghép khi đang kéo vật
const snapMarker = new THREE.Mesh(
  new THREE.TorusGeometry(0.45, 0.03, 8, 48),
  new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.85, depthTest: false })
);
snapMarker.rotation.x = Math.PI / 2;
snapMarker.renderOrder = 30;
snapMarker.visible = false;
scene.add(snapMarker);
function showSnapMarker(snap) {
  snapMarker.visible = Boolean(snap);
  if (snap) snapMarker.position.copy(snap.world).add(new THREE.Vector3(0, 0.02, 0));
}

const findPlaced = (instanceId) => placed.find((o) => o.userData.instanceId === instanceId) ?? null;
const nameOf = (root) => itemById[root?.userData.itemId]?.name ?? root?.userData.itemId ?? '';

function capacityOf(itemId) {
  return VESSEL_CAPACITY[itemId] ?? VESSEL_SPECS[itemId]?.capacityMl ?? null;
}

function vesselRoom(root) {
  const cap = capacityOf(root.userData.itemId);
  if (!cap) return Infinity;
  return Math.max(0, cap - (experimentState.liquidVolumes?.[String(root.userData.instanceId)] ?? 0));
}

// Miệng bình/chai theo tọa độ mô hình gốc (để nghiêng rót quanh miệng)
const BASE_MOUTHS = { beaker: { r: 0.72, y: 1.97 }, erlenmeyer: { r: 0.32, y: 2.28 }, roundflask: { r: 0.22, y: 2.9 } };
function mouthOf(root) {
  const id = root.userData.itemId;
  if (id.startsWith(ELEMENT_ITEM_PREFIX)) return elementMouth(getElement(id.slice(ELEMENT_ITEM_PREFIX.length)));
  return MOUTHS[id] ?? BASE_MOUTHS[id] ?? (itemById[id]?.stock ? { r: 0.22, y: 1.8 } : null);
}

// Lòng cốc beaker / bình tam giác, khớp với cách vẽ chất lỏng hiện có
const BASIC_VESSELS = {
  beaker: { inner: [[0, 0.06], [0.62, 0.06], [0.62, 1.9]], level: (v) => 0.06 + Math.max(0.02, Math.min(v / 250, 1)) },
  erlenmeyer: {
    inner: [[0, 0.06], [0.68, 0.06], [0.3, 1.5], [0.3, 2.15]],
    level: (v) => 0.06 + Math.max(0.02, Math.min((v / 250) * 0.75, 0.75)),
  },
};

function radiusAt(profile, y) {
  for (let i = 1; i < profile.length; i++) {
    const [r1, y1] = profile[i - 1];
    const [r2, y2] = profile[i];
    if (y <= y2 + 1e-9 && y2 > y1) return r1 + ((r2 - r1) * Math.max(0, y - y1)) / (y2 - y1);
  }
  return profile[profile.length - 1][0];
}

// Hình học lòng bình theo tọa độ thế giới: đáy, mặt chất lỏng, bán kính, miệng
function vesselGeom(root, volume) {
  if (!root?.parent || !root.userData.inner) return null;
  const itemId = root.userData.itemId;
  const basic = BASIC_VESSELS[itemId];
  const spec = VESSEL_SPECS[itemId] ?? basic;
  if (!spec) return null;
  const vol = volume ?? experimentState.liquidVolumes?.[String(root.userData.instanceId)] ?? 0;
  const yb = spec.inner[0][1];
  let h = yb;
  if (vol > 0) {
    if (basic) h = basic.level(vol);
    else {
      const pts = fillPoints(spec.inner, vol / spec.capacityMl);
      if (pts) h = pts[pts.length - 1][1];
    }
  }
  const inner = root.userData.inner;
  const bottom = inner.localToWorld(new THREE.Vector3(0, yb, 0));
  const surface = inner.localToWorld(new THREE.Vector3(0, h, 0));
  const mouthY = inner.localToWorld(new THREE.Vector3(0, mouthOf(root)?.y ?? h + 0.5, 0)).y;
  const radius = Math.max(0.05, Math.min(radiusAt(spec.inner, yb + 0.01), radiusAt(spec.inner, Math.max(h, yb + 0.02))));
  return { center: bottom, bottomY: bottom.y, surfaceY: vol > 0 ? surface.y : bottom.y, radius, mouthY };
}
const fallbackGeom = (p) => ({ center: p.clone(), bottomY: p.y - 1, surfaceY: p.y - 1, radius: 0.4, mouthY: p.y });

// Vật đang gắn (ví dụ ống nghiệm trên giá) được nhấc ra tạm thời để rót, xong đặt lại
function liftOut(root) {
  const parent = root.parent;
  if (!root.userData.attach || !parent || parent === scene) return () => {};
  const pos = root.position.clone();
  const quat = root.quaternion.clone();
  scene.attach(root);
  return () => {
    parent.add(root);
    root.position.copy(pos);
    root.quaternion.copy(quat);
  };
}

// Điểm đặt miệng chai khi rót: sát mép miệng bình nhận, hơi cao hơn miệng
function pourPoint(visual, sourceRoot, lift = 0.16) {
  const m = mouthOf(visual) ?? { r: 0.3, y: 2 };
  const c = visual.userData.inner.localToWorld(new THREE.Vector3(0, m.y, 0));
  const s = sourceRoot.getWorldPosition(new THREE.Vector3());
  const dir = new THREE.Vector3(c.x - s.x, 0, c.z - s.z);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
  dir.normalize();
  return { point: c.clone().addScaledVector(dir, -Math.min(m.r * 0.45, 0.25)).add(new THREE.Vector3(0, lift, 0)), dir, center: c };
}

// Đích rót: rót vào phễu thì chất lỏng đi xuống bình hứng bên dưới
function resolvePourTarget(root) {
  if (root.userData.itemId === 'funnel') {
    const receiver = childAt(root, 'receiver');
    return receiver ? { visual: root, vessel: receiver, funnel: root } : { error: 'Hãy đặt bình hứng lên đế phễu trước khi rót.' };
  }
  if (getSampleInfo(root.userData.itemId).kind !== 'vessel') {
    return { error: 'Đích nhận phải là cốc, bình hoặc phễu có bình hứng.' };
  }
  return { visual: root, vessel: root, funnel: null };
}

function prepareReaction(vesselId, reaction) {
  if (reaction?.vesselId === vesselId && reaction.products?.some((p) => SEDIMENTS[p])) pendingSediment.add(vesselId);
}

// Hiệu ứng phản ứng sau khi chất lỏng đã vào bình: sủi bọt khí, kết tủa lắng dần
function playReactionEffects(vessel, reaction) {
  const id = String(vessel.userData.instanceId);
  if (!reaction || reaction.vesselId !== id) return;
  const geom = () => vesselGeom(vessel);
  if (reaction.hasGas) animator.bubbles({ geom, duration: 7, rate: 45 });
  const sid = reaction.products?.find((x) => SEDIMENTS[x]);
  if (sid) {
    pendingSediment.add(id);
    animator.precipitate({
      geom,
      color: SEDIMENTS[sid],
      duration: 5,
      onSettle: () => {
        pendingSediment.delete(id);
        updateVesselLiquid(vessel);
      },
    });
  }
}

// Hoạt cảnh rót chất lỏng; mức chất lỏng trong bình nhận dâng dần theo dòng chảy
function animateLiquidTransfer({ sourceRoot, target, color, volume, before, idsDuring, fracFrom = 1, fracTo = 1, sourceDrain = null, onDone }) {
  const vessel = target.vessel;
  const vid = String(vessel.userData.instanceId);
  const after = experimentState.liquidVolumes?.[vid] ?? 0;
  const restore = liftOut(sourceRoot);
  const pp = pourPoint(target.visual, sourceRoot);
  const disp = { vol: before.vol, built: before.vol };
  const surfacePoint = (k) => {
    const G = vesselGeom(vessel, disp.vol) ?? fallbackGeom(pp.center);
    return new THREE.Vector3(
      G.center.x - pp.dir.x * G.radius * k,
      Math.max(G.surfaceY, G.bottomY + 0.01),
      G.center.z - pp.dir.z * G.radius * k
    );
  };
  const funnelInner = target.funnel?.userData.inner;
  const funnel = funnelInner
    ? { tip: funnelInner.localToWorld(new THREE.Vector3(0, TIPS.funnel.y, 0)), end: () => surfacePoint(0) }
    : null;
  const streamEnd = funnelInner ? () => funnelInner.localToWorld(new THREE.Vector3(0, 2.3, 0)) : () => surfacePoint(0.25);
  const step = Math.max(0.4, Math.abs(after - before.vol) / 30);
  animator.pour({
    source: sourceRoot,
    mouth: mouthOf(sourceRoot) ?? { r: 0.3, y: 1.5 },
    targetPoint: pp.point,
    streamEnd,
    color,
    volume,
    fracFrom,
    fracTo,
    funnel,
    onSourceDrain: sourceDrain,
    onFill: (p) => {
      disp.vol = before.vol + (after - before.vol) * p;
      if (p < 1 && Math.abs(disp.vol - disp.built) >= step) {
        disp.built = disp.vol;
        updateVesselLiquid(vessel, { volume: disp.vol, ids: idsDuring });
      }
    },
    onDone: () => {
      restore();
      updateVesselLiquid(vessel);
      onDone?.();
    },
  });
}

// Hoạt cảnh đổ chất rắn: hạt rơi vào bình rồi lắng thành lớp dưới đáy
function animateSolidDrop({ sourceRoot, vessel, el, massG, onDone }) {
  const restore = liftOut(sourceRoot);
  const pp = pourPoint(vessel, sourceRoot, 0.35);
  const mouth = mouthOf(sourceRoot) ?? { r: 0.5, y: 0.2 };
  animator.dropSolid({
    source: sourceRoot,
    mouth,
    targetPoint: pp.point,
    landing: () => vesselGeom(vessel) ?? fallbackGeom(pp.center),
    color: elementColor(el),
    metal: getElementKind(el) === 'metal',
    count: 8 + 7 * Math.log10(massG + 1),
    grain: Math.min(0.09, 0.035 + 0.015 * Math.log10(massG + 1)),
    tilt: mouth.y > 1 ? 100 : 72,
    onDone: () => {
      restore();
      updateVesselLiquid(vessel);
      onDone?.();
    },
  });
}

// Phím P / nút "Cho vào cốc/bình": chọn nguồn, rồi chọn bình nhận
async function handlePourStep() {
  if (animator.isBusy() || isAmountDialogOpen()) {
    showToast('Hãy đợi thao tác đang thực hiện xong.');
    return;
  }
  if (!selected) {
    showToast('Hãy chọn một mẫu vật trên bàn trước.', 'error');
    return;
  }
  const itemId = selected.userData.itemId;
  const instanceId = selected.userData.instanceId;
  const info = getSampleInfo(itemId);

  if (!experimentSource) {
    const hasLiquid = info.kind === 'vessel' && (experimentState.liquidVolumes?.[String(instanceId)] ?? 0) > 0;
    if (!['chemical', 'gas', 'element'].includes(info.kind) && !hasLiquid) {
      showToast('Hãy chọn hóa chất, mẫu nguyên tố hoặc bình đang có dung dịch làm nguồn.', 'error');
      return;
    }
    const bad = reactionLab?.checkSource(instanceId);
    if (bad) {
      showToast(bad, 'error');
      return;
    }
    experimentSource = { itemId, instanceId };
    const warn = world?.safetyWarning(itemId);
    showToast(`Đã chọn nguồn: ${nameOf(selected)}. Hãy chọn bình nhận rồi nhấn P lần nữa (Esc để hủy).${warn ? ' ' + warn : ''}`, warn ? 'error' : 'info');
    return;
  }

  const source = experimentSource;
  if (source.instanceId === instanceId) {
    showToast('Hãy chọn bình nhận khác với nguồn.', 'error');
    return;
  }
  const sourceRoot = findPlaced(source.instanceId);
  if (!sourceRoot) {
    experimentSource = null;
    showToast('Không tìm thấy vật nguồn trên bàn.', 'error');
    return;
  }
  // đá vôi, khí SO₂, giấy quỳ: xử lý riêng (lab-reactions.js)
  if (reactionLab?.handlesSource(source.itemId)) {
    await reactionLab.pour(source, sourceRoot, selected);
    renderInfo();
    return;
  }
  const target = resolvePourTarget(selected);
  if (target.error) {
    showToast(target.error, 'error');
    return;
  }
  const blocked = reactionLab?.blockedTarget(target.vessel);
  if (blocked) {
    showToast(blocked, 'error');
    return;
  }
  if (source.itemId.startsWith(ELEMENT_ITEM_PREFIX)) await pourElementSample(source, sourceRoot, target);
  else if (getSampleInfo(source.itemId).kind === 'vessel') await pourFromVessel(source, sourceRoot, target);
  else await pourChemical(source, sourceRoot, target);
  renderInfo();
}

// Rót hóa chất từ chai (Liquid) vào bình
async function pourChemical(source, sourceRoot, target) {
  const item = itemById[source.itemId];
  if (getSampleInfo(source.itemId).kind === 'gas') {
    showToast('Chưa hỗ trợ chuyển khí. Cần xây dựng cơ chế dẫn khí riêng.', 'error');
    return;
  }
  const stock = experimentState.samples?.[source.instanceId];
  if (stock && stock.amount <= 0) {
    showToast(`${item.name} đã dùng hết.`, 'error');
    return;
  }
  const vessel = target.vessel;
  const vid = String(vessel.userData.instanceId);
  const check = reactionLab?.checkPour({ sourceIds: [source.itemId], sourceInstanceId: source.instanceId, vessel });
  if (check?.block) {
    showToast(check.block, 'error');
    return;
  }
  const room = vesselRoom(vessel);
  const lines = [];
  if (stock) {
    const mol = stock.moles > 0 && stock.formula ? ` (≈ ${fmtQ(stock.moles)} mol ${stock.formula})` : '';
    lines.push(`Chai còn: ${amountLabel(stock.amount, 'mL')}${mol}`);
  }
  if (Number.isFinite(room)) lines.push(`${nameOf(vessel)} còn trống: ${fmtQ(room, 6)} mL`);
  if (target.funnel) lines.push('Rót qua phễu, chất lỏng chảy xuống bình hứng.');
  const units = item.stock ? stockUnits(item) : [{ id: 'mL', label: 'mL' }];
  const toMl = (v, u) => {
    if (u === 'mL') return { ok: true, ml: v };
    const c = stockAmountToMl(item, v, u);
    // lấy "hết chai" theo mol/g: làm tròn sai số về đúng lượng còn lại
    if (c.ok && stock && Math.abs(c.ml - stock.amount) <= stock.amount * 1e-6) c.ml = stock.amount;
    return c;
  };
  const picked = await askAmount({
    container: viewportEl,
    title: `Rót ${item.name} vào ${nameOf(target.visual)}`,
    units,
    lines,
    confirmLabel: 'Rót',
    preview: (v, u) => {
      if (!item.stock) return '';
      const q = toStockQuantity(item, v, u);
      if (!q.ok) return '';
      const parts = [`≈ ${fmtQ(q.volumeMl, 6)} mL`];
      if (q.moles != null && q.formula) parts.push(`≈ ${fmtQ(q.moles)} mol ${q.formula}`);
      if (q.soluteMassG != null) parts.push(`≈ ${fmtQ(q.soluteMassG)} g ${q.formula}`);
      else if (q.massG != null) parts.push(`≈ ${fmtQ(q.massG)} g`);
      return parts.join(' · ');
    },
    validate: (v, u) => {
      const c = toMl(v, u);
      if (!c.ok) return c.error;
      const k = checkSampleAmount(experimentState, source.instanceId, c.ml);
      if (!k.ok) return k.error;
      return capacityError(vessel.userData.itemId, vid, c.ml);
    },
  });
  if (picked == null) return;
  const volumeMl = toMl(picked.value, picked.unit).ml;
  const askedText = picked.unit === 'mL' ? '' : `${fmtQ(picked.value, 6)} ${units.find((x) => x.id === picked.unit)?.label} ≈ ${fmtQ(volumeMl, 6)} mL. `;

  const before = { vol: experimentState.liquidVolumes?.[vid] ?? 0, ids: [...(experimentState.mixtures?.[vid] || [])] };
  const fracFrom = stock ? stock.amount / stock.initialAmount : 1;
  const result = pourIntoVessel(experimentState, source.itemId, vessel.userData.itemId, vid, volumeMl);
  if (!result.success) {
    showToast(result.message, 'error');
    return;
  }
  experimentSource = null;
  if (stock) consumeSample(experimentState, source.instanceId, volumeMl);
  const fracTo = stock ? stock.amount / stock.initialAmount : 1;
  const reaction = experimentState.lastReaction;
  prepareReaction(vid, reaction);
  saveExperimentState(experimentState);
  animateLiquidTransfer({
    sourceRoot,
    target,
    color: LIQUID_COLORS[source.itemId] ?? 0x93c5fd,
    volume: volumeMl,
    before,
    idsDuring: [...before.ids, source.itemId],
    fracFrom,
    fracTo,
    onDone: () => {
      refreshElementSample(sourceRoot);
      playReactionEffects(vessel, reaction);
      showToast(askedText + result.message, result.message.includes('CẢNH BÁO') ? 'error' : 'info');
      reactionLab?.afterPour(vessel, { sourceIds: [source.itemId], reaction, mistakeKey: check?.mistake });
      renderInfo();
    },
  });
}

// Rót dung dịch từ bình này sang bình khác
async function pourFromVessel(source, sourceRoot, target) {
  const sid = String(source.instanceId);
  const have = experimentState.liquidVolumes?.[sid] ?? 0;
  if (!(have > 0)) {
    experimentSource = null;
    showToast('Bình nguồn không còn chất lỏng.', 'error');
    return;
  }
  const vessel = target.vessel;
  const vid = String(vessel.userData.instanceId);
  if (vid === sid) {
    showToast('Bình nguồn và bình nhận phải khác nhau.', 'error');
    return;
  }
  const srcIdsNow = [...new Set(experimentState.mixtures?.[sid] || [])];
  const check = reactionLab?.checkPour({ sourceIds: srcIdsNow, vessel });
  if (check?.block) {
    showToast(check.block, 'error');
    return;
  }
  const room = vesselRoom(vessel);
  const lines = [`${nameOf(sourceRoot)} còn: ${fmtQ(have, 6)} mL`];
  if (Number.isFinite(room)) lines.push(`${nameOf(vessel)} còn trống: ${fmtQ(room, 6)} mL`);
  const volumeMl = await askAmount({
    container: viewportEl,
    title: `Rót từ ${nameOf(sourceRoot)} sang ${nameOf(target.visual)}`,
    unit: 'mL',
    lines,
    confirmLabel: 'Rót',
    validate: (v) =>
      v > have * (1 + 1e-9) ? `Bình nguồn chỉ còn ${fmtQ(have, 6)} mL.` : capacityError(vessel.userData.itemId, vid, v),
  });
  if (volumeMl == null) return;

  const srcIds = [...(experimentState.mixtures?.[sid] || [])];
  const before = { vol: experimentState.liquidVolumes?.[vid] ?? 0, ids: [...(experimentState.mixtures?.[vid] || [])] };
  const result = transferLiquid(experimentState, { fromId: sid, toItemId: vessel.userData.itemId, toId: vid, volumeMl });
  if (!result.success) {
    showToast(result.message, 'error');
    return;
  }
  experimentSource = null;
  const srcAfter = experimentState.liquidVolumes?.[sid] ?? 0;
  const reaction = experimentState.lastReaction;
  prepareReaction(vid, reaction);
  saveExperimentState(experimentState);
  const cap = capacityOf(source.itemId) ?? have;
  let built = have;
  animateLiquidTransfer({
    sourceRoot,
    target,
    color: liquidColorFor(srcIds),
    volume: volumeMl,
    before,
    idsDuring: [...before.ids, ...srcIds],
    fracFrom: have / cap,
    fracTo: srcAfter / cap,
    sourceDrain: (k) => {
      const v = have + (srcAfter - have) * k;
      if (k < 1 && Math.abs(v - built) >= Math.max(0.4, volumeMl / 25)) {
        built = v;
        updateVesselLiquid(sourceRoot, { volume: v, ids: srcIds });
      }
    },
    onDone: () => {
      updateVesselLiquid(sourceRoot);
      playReactionEffects(vessel, reaction);
      showToast(result.message);
      reactionLab?.afterPour(vessel, { sourceIds: srcIds, reaction, mistakeKey: check?.mistake });
      renderInfo();
    },
  });
}

// Cho mẫu nguyên tố (chất rắn hoặc lỏng) vào bình
async function pourElementSample(source, sourceRoot, target) {
  const sample = experimentState.samples?.[source.instanceId];
  if (!sample) {
    experimentSource = null;
    showToast('Không tìm thấy dữ liệu của mẫu nguồn.', 'error');
    return;
  }
  const el = getElement(sample.elementId);
  if (sample.phase === 'gas') {
    showToast('Chưa hỗ trợ chuyển khí. Cần xây dựng cơ chế dẫn khí riêng.', 'error');
    return;
  }
  if (sample.amount <= 0) {
    showToast(`Mẫu ${sample.nameVi} đã dùng hết.`, 'error');
    return;
  }
  if (sample.phase === 'solid' && target.funnel) {
    showToast('Hãy cho chất rắn trực tiếp vào bình, không qua phễu.', 'error');
    return;
  }
  const vessel = target.vessel;
  const vid = String(vessel.userData.instanceId);
  const room = vesselRoom(vessel);
  const molText = sample.moles > 0 && sample.formula ? ` (≈ ${fmtQ(sample.moles)} mol ${sample.formula})` : '';
  const lines = [`Mẫu còn: ${amountLabel(sample.amount, sample.unit)}${molText}`];
  if (sample.phase === 'liquid' && Number.isFinite(room)) lines.push(`${nameOf(vessel)} còn trống: ${fmtQ(room, 6)} mL`);
  const elUnits = el ? unitsFor(el) : [sample.unit];
  const units = (elUnits.includes(sample.unit) ? elUnits : [sample.unit, ...elUnits]).map((id) => ({
    id,
    label: id === 'mol' ? `mol ${sample.formula ?? sample.symbol}` : id,
  }));
  // Đổi lượng nhập về đơn vị của mẫu (để trừ lượng tồn)
  const toOwn = (v, u) => {
    if (u === sample.unit) return { ok: true, value: v };
    const c = convertElementAmount(el, v, u, sample.unit);
    if (c.ok && Math.abs(c.value - sample.amount) <= sample.amount * 1e-6) c.value = sample.amount;
    return c;
  };
  const picked = await askAmount({
    container: viewportEl,
    title: `Cho ${sample.nameVi} vào ${nameOf(target.visual)}`,
    units,
    unit: sample.unit,
    lines,
    confirmLabel: sample.phase === 'solid' ? 'Cho vào' : 'Rót',
    preview: (v, u) => {
      if (!el) return '';
      const q = toQuantity(el, v, u);
      if (!q.ok) return '';
      const parts = [];
      if (q.massG != null) parts.push(`≈ ${fmtQ(q.massG)} g`);
      if (q.moles != null) parts.push(`≈ ${fmtQ(q.moles)} mol ${q.formula}`);
      if (q.volumeMl != null && sample.phase === 'liquid') parts.push(`≈ ${fmtQ(q.volumeMl)} mL`);
      return parts.join(' · ');
    },
    validate: (v, u) => {
      const c = toOwn(v, u);
      if (!c.ok) return c.error;
      if (c.value > sample.amount * (1 + 1e-9)) return `Mẫu chỉ còn ${amountLabel(sample.amount, sample.unit)}${molText}.`;
      if (sample.phase === 'liquid') {
        const ml = sample.unit === 'mL' ? c.value : convertElementAmount(el, c.value, sample.unit, 'mL');
        const mlv = typeof ml === 'number' ? ml : ml.ok ? ml.value : null;
        if (mlv != null) return capacityError(vessel.userData.itemId, vid, mlv);
      }
      return null;
    },
  });
  if (picked == null) return;
  const amount = toOwn(picked.value, picked.unit).value;

  const before = { vol: experimentState.liquidVolumes?.[vid] ?? 0, ids: [...(experimentState.mixtures?.[vid] || [])] };
  const fracFrom = sample.amount / sample.initialAmount;
  const result = addSampleToVessel(experimentState, {
    sampleInstanceId: source.instanceId,
    targetId: vessel.userData.itemId,
    targetInstanceId: vid,
    amount,
  });
  if (!result.success) {
    showToast(result.message, 'error');
    return;
  }
  experimentSource = null;
  saveExperimentState(experimentState);
  const fracTo = sample.amount / sample.initialAmount;
  const record = experimentState.pourRecords?.[vid]?.at(-1);
  const done = () => {
    refreshElementSample(sourceRoot);
    showToast(result.message, result.message.includes('CẢNH BÁO') ? 'error' : 'info');
    reactionLab?.afterPour(vessel, { sourceIds: [sample.itemId] });
    renderInfo();
  };
  if (sample.phase === 'liquid') {
    animateLiquidTransfer({
      sourceRoot,
      target,
      color: elementLiquidColor(sample.itemId) ?? 0x93c5fd,
      volume: record?.volumeMl || amount,
      before,
      idsDuring: [...before.ids, sample.itemId],
      fracFrom,
      fracTo,
      onDone: done,
    });
  } else {
    animateSolidDrop({ sourceRoot, vessel, el, massG: record?.massG ?? 1, onDone: done });
  }
}

// Buret / phễu chiết: mở khóa xả xuống bình hứng đặt bên dưới
async function drainFromStopcock(root) {
  if (!root || animator.isBusy() || isAmountDialogOpen()) return;
  const id = String(root.userData.instanceId);
  const have = experimentState.liquidVolumes?.[id] ?? 0;
  const receiver = childAt(root, 'receiver');
  if (!receiver) {
    showToast('Hãy kéo thả bình hứng vào đế, ngay dưới đầu khóa, trước khi mở khóa.', 'error');
    return;
  }
  if (!(have > 0)) {
    showToast(`${nameOf(root)} chưa có dung dịch. Hãy rót dung dịch vào trước.`, 'error');
    return;
  }
  const rid = String(receiver.userData.instanceId);
  const check = reactionLab?.checkPour({ sourceIds: [...new Set(experimentState.mixtures?.[id] || [])], vessel: receiver });
  if (check?.block) {
    showToast(check.block, 'error');
    return;
  }
  const room = vesselRoom(receiver);
  const lines = [`Trong ${nameOf(root)}: ${fmtQ(have, 6)} mL`];
  if (Number.isFinite(room)) lines.push(`${nameOf(receiver)} còn trống: ${fmtQ(room, 6)} mL`);
  const volumeMl = await askAmount({
    container: viewportEl,
    title: `Mở khóa ${nameOf(root)}, xả xuống ${nameOf(receiver)}`,
    unit: 'mL',
    lines,
    confirmLabel: 'Mở khóa',
    validate: (v) => (v > have * (1 + 1e-9) ? `Chỉ còn ${fmtQ(have, 6)} mL.` : capacityError(receiver.userData.itemId, rid, v)),
  });
  if (volumeMl == null) return;

  const srcIds = [...(experimentState.mixtures?.[id] || [])];
  const before = { vol: experimentState.liquidVolumes?.[rid] ?? 0, ids: [...(experimentState.mixtures?.[rid] || [])] };
  const result = transferLiquid(experimentState, { fromId: id, toItemId: receiver.userData.itemId, toId: rid, volumeMl });
  if (!result.success) {
    showToast(result.message, 'error');
    return;
  }
  const reaction = experimentState.lastReaction;
  prepareReaction(rid, reaction);
  saveExperimentState(experimentState);
  const after = experimentState.liquidVolumes?.[rid] ?? 0;
  const srcAfter = experimentState.liquidVolumes?.[id] ?? 0;
  const disp = { vol: before.vol, built: before.vol };
  const step = Math.max(0.3, volumeMl / 30);
  animator.drip({
    tip: root.userData.inner.localToWorld(new THREE.Vector3(0, TIPS[root.userData.itemId].y, 0)),
    receiverEnd: () => {
      const G = vesselGeom(receiver, disp.vol) ?? fallbackGeom(root.getWorldPosition(new THREE.Vector3()));
      return new THREE.Vector3(G.center.x, Math.max(G.surfaceY, G.bottomY + 0.01), G.center.z);
    },
    color: liquidColorFor(srcIds),
    volume: volumeMl,
    stopcock: root.getObjectByName('stopcock'),
    mode: root.userData.itemId === 'burette' ? 'drops' : 'stream',
    onFill: (p) => {
      disp.vol = before.vol + (after - before.vol) * p;
      if (p < 1 && Math.abs(disp.vol - disp.built) >= step) {
        disp.built = disp.vol;
        updateVesselLiquid(receiver, { volume: disp.vol, ids: [...before.ids, ...srcIds] });
        updateVesselLiquid(root, { volume: have + (srcAfter - have) * p, ids: srcIds });
      }
    },
    onDone: () => {
      updateVesselLiquid(root);
      updateVesselLiquid(receiver);
      playReactionEffects(receiver, reaction);
      showToast(result.message);
      reactionLab?.afterPour(receiver, { sourceIds: srcIds, reaction, mistakeKey: check?.mistake });
      renderInfo();
    },
  });
  renderInfo();
}

// Khuấy bằng đũa thủy tinh đang đặt trong bình
function stirVessel(vessel) {
  if (!vessel) return;
  if (animator.isBusy()) {
    showToast('Hãy đợi thao tác đang thực hiện xong.');
    return;
  }
  const rod = childAt(vessel, 'rod');
  if (!rod) {
    showToast('Hãy kéo thả đũa thủy tinh vào bình trước.', 'error');
    return;
  }
  const id = String(vessel.userData.instanceId);
  if (!((experimentState.liquidVolumes?.[id] ?? 0) > 0)) {
    showToast('Bình chưa có dung dịch để khuấy.', 'error');
    return;
  }
  animator.stir({
    tool: rod,
    geom: () => vesselGeom(vessel),
    duration: 3,
    onDone: () => {
      experimentState.log.push({
        type: 'success',
        message: `Đã khuấy đều dung dịch trong ${nameOf(vessel)}.`,
        time: new Date().toLocaleTimeString(),
      });
      saveExperimentState(experimentState);
      showToast('Đã khuấy đều dung dịch.');
      renderInfo();
    },
  });
}

// Tháo vật đang chọn khỏi dụng cụ đang giữ nó, đặt sang chỗ trống trên bàn
function detachSelected() {
  if (!selected?.userData.attach || animator.isBusy()) return;
  const host = selected.parent;
  detach(selected, scene);
  const spot = nextFreeBenchSpot();
  selected.position.set(spot.x, 0, spot.z);
  showToast(`Đã tháo ${nameOf(selected)} khỏi ${nameOf(host)}.`);
  selectPlaced(selected);
}

// ------------------------------------------------------------
// Mô phỏng trên bàn: đun nóng, sôi, bay hơi, nhiệt kế, cân
// ------------------------------------------------------------
function boilingPointOf(vesselId) {
  const ids = experimentState.mixtures?.[vesselId] || [];
  return ids.length && ids.every((x) => x === 'ethanol') ? 78 : 100;
}

// Khối lượng chất trên đĩa cân (đã trừ bì vật chứa)
function massOfContents(root) {
  const id = String(root.userData.instanceId);
  let g = 0;
  let unknown = false;
  const sample = experimentState.samples?.[id];
  if (sample) {
    if (sample.massG != null) g += sample.massG;
    else if (sample.amount > 0) unknown = true;
  }
  if (getSampleInfo(root.userData.itemId).kind === 'vessel') {
    (experimentState.pourRecords?.[id] || []).forEach((r) => {
      if (r.massG != null) g += r.massG;
      else if (r.volumeMl > 0) {
        const d = STOCK_SPECS[r.chemicalId]?.densityGmL;
        if (d) g += r.volumeMl * d;
        else unknown = true;
      }
    });
  }
  childrenOf(root).forEach((c) => {
    const m = massOfContents(c);
    g += m.g;
    unknown = unknown || m.unknown;
  });
  return { g, unknown };
}

function balanceText(balance) {
  if (!balance.userData.powered) return { title: '– – –', sub: 'Cân chưa bật (cắm điện rồi bật)' };
  const item = childAt(balance, 'pan');
  if (!item) return { title: '0,00 g', sub: 'Cân điện tử (đã trừ bì)' };
  const m = massOfContents(item);
  const value = m.g.toFixed(2).replace('.', ',');
  return m.unknown
    ? { title: `≈ ${value} g +?`, sub: 'Có chất chưa rõ khối lượng riêng' }
    : { title: `${value} g`, sub: `${nameOf(item)} · đã trừ bì` };
}

function setFloatingLabel(root, key, title, sub, y) {
  let label = root.children.find((c) => c.name === key);
  if (label?.userData.text === `${title}|${sub}`) return;
  if (label) {
    root.remove(label);
    label.material.map?.dispose();
    label.material.dispose();
  }
  label = makeAmountLabel(title, sub);
  label.name = key;
  label.userData.text = `${title}|${sub}`;
  label.position.set(0, y, 0);
  label.scale.set(1.3, 0.49, 1);
  root.add(label);
}

function removeFloatingLabel(root, key) {
  const label = root.children.find((c) => c.name === key);
  if (!label) return;
  root.remove(label);
  label.material.map?.dispose();
  label.material.dispose();
}

function refreshLabels() {
  for (const root of placed) {
    const itemId = root.userData.itemId;
    if (itemId === 'thermometer') {
      const a = root.userData.attach;
      if (a?.socket === 'thermo' && root.parent?.userData.instanceId) {
        const T = experimentState.temperatures?.[String(root.parent.userData.instanceId)] ?? 25;
        setFloatingLabel(root, 'thermo-label', `${fmtQ(T, 3)} °C`, 'Nhiệt kế', 3.0);
      } else removeFloatingLabel(root, 'thermo-label');
    } else if (itemId === 'balance') {
      const b = balanceText(root);
      setFloatingLabel(root, 'balance-label', b.title, b.sub, 1.25);
    }
  }
  // Cập nhật số đo đang hiển thị trong bảng thông tin
  const tempEl = infoEl.querySelector('[data-temp]');
  if (tempEl && selected) tempEl.textContent = `${fmtQ(experimentState.temperatures?.[String(selected.userData.instanceId)] ?? 25, 3)} °C`;
  const balEl = infoEl.querySelector('[data-balance]');
  if (balEl && selected?.userData.itemId === 'balance') balEl.textContent = balanceText(selected).title;
}

const evapTimers = new Map();
let labelTimer = 0;
function updateBench(dt) {
  if (!experimentState.temperatures) experimentState.temperatures = {};
  const temps = experimentState.temperatures;
  for (const root of placed) {
    const itemId = root.userData.itemId;
    const inner = root.userData.inner;
    if (itemId === 'bunsen' || itemId === 'spirit-lamp') inner.userData.flameScale = flameScaleFor(root);
    if (getSampleInfo(itemId).kind !== 'vessel') continue;

    const id = String(root.userData.instanceId);
    const vol = experimentState.liquidVolumes?.[id] ?? 0;
    const heat = heatSourceOf(root);
    const bp = boilingPointOf(id);
    let T = temps[id] ?? 25;
    const bath = bathOf(root);
    if (bath && (experimentState.liquidVolumes?.[String(bath.userData.instanceId)] ?? 0) > 0) {
      // đun cách thủy: ống nghiệm nóng dần theo nước trong cốc
      const Tb = temps[String(bath.userData.instanceId)] ?? 25;
      T += (Tb - T) * Math.min(1, dt * 0.6);
    } else if (heat) {
      // lượng chất lỏng càng ít thì nóng càng nhanh; tối đa bằng nhiệt độ sôi
      T = vol > 0 ? Math.min(bp, T + (dt * heat.power * 450) / (vol + 40)) : Math.min(400, T + dt * heat.power * 12);
    } else {
      T += (25 - T) * Math.min(1, dt * 0.03); // nguội dần về nhiệt độ phòng
    }
    temps[id] = Math.round(T * 100) / 100;

    const boilingNow = Boolean(heat) && vol > 0 && T >= bp - 0.05;
    const warm = Boolean(heat) && vol > 0 && T > 70;
    animator.setBoiling(id, warm ? () => vesselGeom(root) : null, boilingNow ? 1 : Math.max(0, (T - 70) / (bp - 70)) * 0.35);

    // Đang sôi: chất lỏng bay hơi dần
    if (boilingNow && !animator.isBusy()) {
      const left = evaporate(experimentState, id, dt * 0.35 * heat.power);
      const t = (evapTimers.get(id) ?? 0) + dt;
      if (t > 0.6 || left === 0) {
        evapTimers.set(id, 0);
        updateVesselLiquid(root);
        if (left === 0) {
          experimentState.log.push({
            type: 'success',
            message: `Chất lỏng trong ${nameOf(root)} đã bay hơi hết.`,
            time: new Date().toLocaleTimeString(),
          });
          showToast(`Chất lỏng trong ${nameOf(root)} đã bay hơi hết.`);
          saveExperimentState(experimentState);
          renderInfo();
        }
      } else evapTimers.set(id, t);
    }
  }
  labelTimer += dt;
  if (labelTimer > 0.3) {
    labelTimer = 0;
    refreshLabels();
  }
}

// Khối "mối ghép" trong bảng thông tin: đang ở đâu, đang giữ gì, nhiệt độ, thao tác
function relationsHtml(root) {
  const parts = [];
  const actions = [];
  const a = root.userData.attach;
  if (a) {
    const host = root.parent;
    const socket = host && socketById(host, a.socket);
    parts.push(`<p>Đang ở: <b>${socket?.label ?? ''}</b> — ${nameOf(host)}</p>`);
    actions.push('<button class="btn" data-action="detach">Tháo ra</button>');
  }
  const kids = childrenOf(root);
  if (kids.length) parts.push(`<p>Đang giữ: ${kids.map((k) => nameOf(k)).join(', ')}</p>`);
  const id = String(root.userData.instanceId);
  if (getSampleInfo(root.userData.itemId).kind === 'vessel') {
    const T = experimentState.temperatures?.[id] ?? 25;
    const vol = experimentState.liquidVolumes?.[id] ?? 0;
    const heat = heatSourceOf(root);
    let line = `Nhiệt độ: <b data-temp>${fmtQ(T, 3)} °C</b>`;
    if (heat) line += vol > 0 && T >= boilingPointOf(id) - 0.05 ? ` · đang sôi (${heat.name})` : ` · đang đun bằng ${heat.name}`;
    else if (bathOf(root)) line += ` · đang đun cách thủy trong ${nameOf(root.parent)}`;
    parts.push(`<p>${line}</p>`);
    if (childAt(root, 'rod') && vol > 0) actions.unshift('<button class="btn btn-primary" data-action="stir">Khuấy</button>');
    if (TIPS[root.userData.itemId] && vol > 0) actions.unshift('<button class="btn btn-primary" data-action="drain">Mở khóa xả</button>');
  }
  if (root.userData.itemId === 'balance') parts.push(`<p>Cân hiển thị: <b data-balance>${balanceText(root).title}</b></p>`);
  if (!parts.length && !actions.length) return '';
  return `<div class="relation-box">${parts.join('')}${actions.length ? `<div class="info-actions">${actions.join('')}</div>` : ''}</div>`;
}


// Gợi ý thao tác trong khung 3D
const hint = document.createElement('div');
hint.className = 'viewport-hint';
hint.textContent =
  'Chuột trái: xoay · Cuộn: phóng to/thu nhỏ · Chuột phải: dịch góc nhìn · Kéo mẫu vật để di chuyển';
viewportEl.appendChild(hint);

// Bảng tuần hoàn hóa học: lớp phủ trong vùng 3D, mở bằng nút "Periodic Table"
const periodicTable = createPeriodicTable({
  container: viewportEl,
  onSelect: () => renderInfo(),
  onClose: () => {
    categoryBarEl.querySelector(`[data-category="${lastLabCategory}"]`)?.click();
  },
});
bindSampleForm(infoEl, takeElementSample);

// Form lượng lấy cho hóa chất trong thư viện: xem trước khi gõ, Enter để lấy
const updateStockPreview = (e) => {
  const form = e.target.closest?.('.stock-form');
  if (!form) return;
  const f = readStockForm(infoEl);
  form.querySelector('[data-stock-preview]').innerHTML = stockPreviewHtml(itemById[form.dataset.itemId], f.amount, f.unit);
};
infoEl.addEventListener('input', updateStockPreview);
infoEl.addEventListener('change', updateStockPreview);
infoEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('[data-stock-amount], [data-stock-unit]')) {
    e.preventDefault();
    const f = readStockForm(infoEl);
    addToBench(libraryItemId, f?.amount, f?.unit);
  }
});

// ------------------------------------------------------------
// 15. Chọn & kéo mẫu vật bằng chuột
// ------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dragPoint = new THREE.Vector3();
const dragOffset = new THREE.Vector3();
let dragging = null;
let dragStarted = false; // chỉ coi là kéo khi chuột di chuyển đủ xa
let downX = 0;
let downY = 0;
let downHitSomething = false;

function updateNdc(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
}

function pickPlaced(e) {
  updateNdc(e);
  const hits = raycaster.intersectObjects(placed, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.isPlaced) o = o.parent;
    if (o) return o;
  }
  return null;
}

// Dùng capture để chặn OrbitControls xoay khi đang kéo mẫu vật
renderer.domElement.addEventListener(
  'pointerdown',
  (e) => {
    if (e.button !== 0) return;
    // Bỏ focus khỏi ô nhập để phím tắt (P, R, Delete) hoạt động trên khung 3D
    const active = document.activeElement;
    if (active?.matches?.('input, select, textarea')) active.blur();
    downX = e.clientX;
    downY = e.clientY;
    const hit = pickPlaced(e);
    downHitSomething = !!hit;
    if (hit) {
      if (selected !== hit) selectPlaced(hit);
      dragging = hit;
      dragStarted = false;
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
    }
  },
  { capture: true }
);

renderer.domElement.addEventListener('pointermove', (e) => {
  if (dragging) {
    updateNdc(e);
    if (!dragStarted) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) < 5 || animator.isBusy()) return;
      dragStarted = true;
      // Đang gắn vào dụng cụ khác: tháo ra để kéo đi
      if (dragging.userData.attach) {
        detach(dragging, scene);
        selectPlaced(dragging);
      }
      raycaster.ray.intersectPlane(dragPlane, dragPoint);
      dragOffset.copy(dragging.position).sub(dragPoint);
    }
    if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
      dragging.position.copy(dragPoint).add(dragOffset);
      if (world) world.clampToSurfaces(dragging.position);
      else clampToBench(dragging.position);
      showSnapMarker(findSnap(dragging, placed));
      const readout = document.getElementById('pos-readout');
      if (readout) readout.textContent = positionText(dragging);
    }
  } else if (e.buttons === 0) {
    renderer.domElement.style.cursor = pickPlaced(e) ? 'grab' : world?.pick(raycaster) ? 'pointer' : 'default';
  }
});

function endPointer(e) {
  if (dragging) {
    const dropped = dragging;
    const started = dragStarted;
    dragging = null;
    dragStarted = false;
    showSnapMarker(null);
    // Thả gần ổ ghép phù hợp: gắn vào (ống nghiệm vào giá, cốc lên kiềng...)
    if (started) {
      const snap = findSnap(dropped, placed);
      if (snap) {
        attach(dropped, snap.host, snap.socket);
        showToast(`Đã đặt ${nameOf(dropped)} vào ${snap.socket.label} (${nameOf(snap.host)}).`);
      } else world?.onDrop(dropped);
      selectPlaced(dropped);
    }
    controls.enabled = true;
    renderer.domElement.style.cursor = 'grab';
    try {
      renderer.domElement.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* bỏ qua */
    }
  } else if (e.type === 'pointerup' && e.button === 0 && !downHitSomething) {
    // Nhấp vào chỗ trống (không kéo) sẽ bỏ chọn
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved < 4) {
      // bấm vào đồ vật trong phòng (tủ, vòi nước, chân dung...) hoặc chỗ trống
      updateNdc(e);
      const hit = world?.pick(raycaster);
      if (selected) selectPlaced(null);
      world?.select(hit);
      renderInfo();
    }
  }
}
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', endPointer);

// ------------------------------------------------------------
// 16. Thay đổi kích thước & vòng lặp vẽ
// ------------------------------------------------------------
function resize() {
  const w = viewportEl.clientWidth || 1;
  const h = viewportEl.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewportEl);
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();

const activePourAnimations = [];



function startPourAnimation(sourceRoot, targetRoot) {
  if (!sourceRoot || !targetRoot) return;

  const originalPosition = sourceRoot.position.clone();
  const originalQuaternion = sourceRoot.quaternion.clone();

  const horizontal = new THREE.Vector3(
    targetRoot.position.x - originalPosition.x,
    0,
    targetRoot.position.z - originalPosition.z
  );

  if (horizontal.length() < 0.001) horizontal.set(1, 0, 0);
  horizontal.normalize();

  const axis = new THREE.Vector3(horizontal.z, 0, -horizontal.x);

  const startTime = clock.getElapsedTime();
  const duration = 3.0;
  const liftHeight = 2.0;
  const approachDistance = 0.65;
  const tiltAngle = THREE.MathUtils.degToRad(55);

  const streamMaterial = new THREE.MeshBasicMaterial({
    color: 0xb9eaff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending
  });

  const stream = new THREE.Mesh(
    new THREE.BufferGeometry(),
    streamMaterial
  );
  stream.visible = false;
  scene.add(stream);

  function smooth(v) {
    v = THREE.MathUtils.clamp(v, 0, 1);
    return v * v * (3 - 2 * v);
  }

  // Miệng chai trong hệ tọa độ của sourceRoot.
  // buildBottle có cổ chai cao khoảng 1.55–1.8.
  const mouthLocal = new THREE.Vector3(0, 1.8, 0);

  activePourAnimations.push((t) => {
    const p = THREE.MathUtils.clamp(
      (t - startTime) / duration, 0, 1
    );


let move = 0;
let lift = 0;
let tilt = 0;

if (p < 0.25) {
  // 1. Di chuyển đến cạnh cốc
  move = smooth(p / 0.25);
} else if (p < 0.40) {
  // 2. Nâng bình lên
  move = 1;
  lift = smooth((p - 0.25) / 0.15);
} else if (p < 0.52) {
  // 3. Nghiêng bình
  move = 1;
  lift = 1;
  tilt = smooth((p - 0.40) / 0.12);
} else if (p < 0.72) {
  // 4. Giữ bình nghiêng để rót
  move = 1;
  lift = 1;
  tilt = 1;
} else if (p < 0.82) {
  // 5. Dựng bình thẳng lại
  move = 1;
  lift = 1;
  tilt = 1 - smooth((p - 0.72) / 0.10);
} else if (p < 0.90) {
  // 6. Hạ bình xuống
  move = 1;
  lift = 1 - smooth((p - 0.82) / 0.08);
} else {
  // 7. Trở về vị trí cũ
  move = 1 - smooth((p - 0.90) / 0.10);
}


    // Nâng bình và đưa về phía cốc nhận.
    sourceRoot.position.copy(originalPosition);
    sourceRoot.position.y += lift * liftHeight;
    sourceRoot.position.addScaledVector(
      horizontal, move * approachDistance
    );
    const rotation = new THREE.Quaternion()
  .setFromAxisAngle(axis, tilt * tiltAngle);

sourceRoot.quaternion
  .copy(rotation)
  .multiply(originalQuaternion);

    const pouring = p >= 0.52 && p < 0.72;
    stream.visible = pouring;

    if (pouring) {
      // Điểm đầu dòng chất lỏng lấy từ vị trí miệng chai.
      const start = mouthLocal.clone();
      sourceRoot.localToWorld(start);

      const targetBox = new THREE.Box3().setFromObject(targetRoot);
      const targetCenter = targetBox.getCenter(new THREE.Vector3());

      const end = new THREE.Vector3(
        targetCenter.x,
        targetBox.max.y - 0.12,
        targetCenter.z
      );

      const sway = Math.sin(t * 8) * 0.006;
      const control = start.clone().lerp(end, 0.5);
      control.x += sway;
      control.y -= 0.05;

      const curve = new THREE.QuadraticBezierCurve3(
        start, control, end
      );

      const oldGeometry = stream.geometry;
      stream.geometry = new THREE.TubeGeometry(
        curve, 32, 0.028, 10, false
      );
      oldGeometry.dispose();

      streamMaterial.opacity = 0.8 * smooth((p - 0.43) / 0.08);
    }

    if (p >= 1) {
      sourceRoot.position.copy(originalPosition);
      sourceRoot.quaternion.copy(originalQuaternion);

      scene.remove(stream);
      stream.geometry.dispose();
      streamMaterial.dispose();

      return true;
    }

    return false;
  });
}



let lastFrame = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const t = now / 1000;
  controls.update();
  clampCameraToRoom(camera, controls);
  animator.update(dt);
  updateBench(dt);
  labRoom.update(dt, placed.length); // phòng chuyển dần từ gọn gàng sang "đang làm thí nghiệm"
  world?.update(dt);
  reactionLab?.update(dt);

  for (const p of placed) {
    const fn = p.userData.inner.userData.animate;
    if (fn) fn(t);
  }
  if (selectionBox) selectionBox.update();
  // Bảng tuần hoàn che vùng 3D: tạm dừng vẽ cảnh để đỡ tốn GPU
  if (!periodicTable.isVisible()) renderer.render(scene, camera);
}

// Khởi tạo thao tác với đồ vật trong phòng thí nghiệm
world = createLabWorld({
  scene,
  camera,
  controls,
  room: labRoom,
  lights: { sun, hemi: hemiLight, fill },
  placed,
  benchW: BENCH_W,
  benchD: BENCH_D,
  infoEl,
  viewportEl,
  itemById,
  experimentState,
  saveExperimentState,
  getSelected: () => selected,
  selectPlaced,
  addToBench,
  stashPlaced,
  restoreStored,
  refreshVessel,
  showToast,
  renderInfo,
  nameOf,
  getSampleInfo,
  updateVesselLiquid,
  vesselGeom,
  massOfContents,
  stirrerOf,
  askAmount,
  capacityError,
  pourIntoVessel,
  stockUnits,
  toStockQuantity,
  animatorBusy: () => animator.isBusy(),
  openPeriodicTable: (elementId) => {
    categoryBarEl.querySelector(`[data-category="${PERIODIC_CATEGORY}"]`)?.click();
    if (elementId) periodicTable.select(elementId);
  },
  refreshStock: refreshElementSample,
});

// 5 thí nghiệm phản ứng có hoạt cảnh và các bước làm sai (lab-reactions.js)
reactionLab = createReactionLab({
  scene,
  camera,
  animator,
  experimentState,
  placed,
  itemById,
  viewportEl,
  get world() {
    return world;
  },
  getSampleInfo,
  vesselGeom,
  innerProfile: (itemId) => VESSEL_SPECS[itemId]?.inner ?? BASIC_VESSELS[itemId]?.inner ?? null,
  mouthOf,
  capacityOf,
  updateVesselLiquid,
  refreshVessel,
  refreshStock: refreshElementSample,
  saveExperimentState,
  showToast,
  renderInfo,
  nameOf,
  askAmount,
  stockUnits,
  stockAmountToMl,
  consumeSample,
  liftOut,
  pourPoint,
  getSelected: () => selected,
  clearSource: () => {
    experimentSource = null;
  },
});
placed.forEach((p) => updateVesselLiquid(p)); // vẽ lại bình đã tải (gương bạc, nút đậy...)

// Khởi động
renderCategories();
renderLibrary();
renderInfo();
animate();
function createCO2Bubbles(vessel) {
  if (!vessel) return;

  const bubbles = new THREE.Group();
  bubbles.name = 'co2-bubbles';

  const material = new THREE.MeshStandardMaterial({
    color: 0xdaf5ff,
    transparent: true,
    opacity: 0.8,
    roughness: 0.2,
  });

  for (let i = 0; i < 12; i++) {
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 12, 12),
      material
    );

    bubble.position.set(
      (Math.random() - 0.5) * 0.2,
      Math.random() * 0.5,
      (Math.random() - 0.5) * 0.2
    );

    bubbles.add(bubble);
  }

  vessel.add(bubbles);
}
function createCuOH2Precipitate(vessel) {
  if (!vessel) return;

  const old = vessel.getObjectByName('cuoh2-precipitate');
  if (old) vessel.remove(old);
  
  const precipitate = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0x168cff,
      roughness: 0.9,
    })
  );
  precipitate.name = 'cuoh2-precipitate';

  precipitate.scale.set(1.5, 0.45, 1.5);

  precipitate.position.set(0, 0.12, 0);



  vessel.add(precipitate);

}