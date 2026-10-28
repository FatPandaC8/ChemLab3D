// ============================================================
// ChemLab 3D — Hóa chất lỏng, bình thủy tinh và dụng cụ bổ sung
// Mô hình tạo bằng hình học Three.js có sẵn (không dùng dịch vụ ngoài).
// main.js nối các danh sách này vào CATALOG hiện có.
// ============================================================
import * as THREE from 'three';
import { makeAmountLabel } from './element-models.js';
import { amountLabel } from './quantity.js';

// ------------------------------------------------------------
// Vật liệu & hình khối dùng chung
// ------------------------------------------------------------
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, ...o });

const glass = (tint = 0xcfe8ff, opacity = 0.2) =>
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

const fillMat = (color, opacity = 0.82) =>
  new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

const PORCELAIN = () => std(0xf3f1ec, { roughness: 0.35, side: THREE.DoubleSide });
const METAL = () => std(0x9ca3af, { metalness: 0.85, roughness: 0.3 });
const DARK = () => std(0x2a2f38, { metalness: 0.3, roughness: 0.5 });
const WOOD = () => std(0x9a6b3f, { roughness: 0.8 });

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1));

function lathe(pts, mat, seg = 40) {
  return new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat);
}

function order(mesh, n) {
  mesh.renderOrder = n;
  return mesh;
}

function cylAt(r, h, mat, y = 0, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.y = y + h / 2;
  return m;
}

function boxAt(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}

// Ống trụ nằm ngang theo trục X, tâm tại (x, y, z)
function rodX(r, len, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

// Vòng nằm ngang (song song mặt bàn)
function ringAt(r, tube, mat, y, x = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 40), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

// Mặt cắt hình cầu (bình cầu) từ đáy lên cổ bình
function sphereProfile(cy, R, neckR, top, steps = 18) {
  const end = Math.PI - Math.asin(neckR / R);
  const pts = [[0, cy - R]];
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * end;
    pts.push([R * Math.sin(t), cy - R * Math.cos(t)]);
  }
  pts.push([neckR, top]);
  return pts;
}

// Mặt cắt ống nghiệm đáy tròn
function tubeProfile(r, y0, top) {
  const pts = [[0, y0]];
  for (let i = 1; i <= 8; i++) {
    const t = (i / 8) * (Math.PI / 2);
    pts.push([r * Math.sin(t), y0 + r - r * Math.cos(t)]);
  }
  pts.push([r, top]);
  return pts;
}

// Vạch chia trên ống đong, buret
function addMarks(g, r, from, to, count, x = 0) {
  const mat = std(0x374151);
  for (let i = 0; i <= count; i++) {
    const y = from + ((to - from) * i) / count;
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, i % 5 === 0 ? 0.008 : 0.005, 4, 32, Math.PI * 0.6), mat);
    m.rotation.x = Math.PI / 2;
    m.rotation.z = Math.PI * 0.2;
    m.position.set(x, y, 0);
    g.add(m);
  }
}

// ------------------------------------------------------------
// Chất lỏng trong bình: mức chất lỏng theo đúng hình dạng lòng bình
// ------------------------------------------------------------
const frustum = (r1, r2, h) => (Math.PI * h * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;

export function fillPoints(inner, fraction) {
  const f = clamp01(fraction);
  const cum = [0];
  for (let i = 1; i < inner.length; i++) {
    const [r1, y1] = inner[i - 1];
    const [r2, y2] = inner[i];
    cum.push(cum[i - 1] + frustum(r1, r2, Math.max(0, y2 - y1)));
  }
  const target = f * cum[cum.length - 1];
  if (target <= 0) return null;
  let i = 1;
  while (i < inner.length - 1 && cum[i] < target) i++;
  const [r1, y1] = inner[i - 1];
  const [r2, y2] = inner[i];
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 32; k++) {
    const mid = (lo + hi) / 2;
    const r = r1 + (r2 - r1) * mid;
    if (cum[i - 1] + frustum(r1, r, (y2 - y1) * mid) < target) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  const h = y1 + (y2 - y1) * t;
  return [...inner.slice(0, i), [r1 + (r2 - r1) * t, h], [0, h]];
}

// Dung dịch không màu (gần trắng): vẽ trong suốt như nước thay vì trắng đục
export function liquidOpacity(color, opacity) {
  const hex = typeof color === 'number' ? color : new THREE.Color(color).getHex();
  const min = Math.min((hex >> 16) & 255, (hex >> 8) & 255, hex & 255);
  if (hex === LIQUID_COLORS.water) return 0.5; // nước trong: thấy được ống nghiệm đặt trong cốc nước (đun cách thủy)
  return min >= 214 ? 0.4 : opacity;
}

export function buildVesselFill(spec, fraction, color) {
  const pts = fillPoints(spec.inner, fraction);
  if (!pts) return null;
  return order(lathe(pts, fillMat(color, liquidOpacity(color, 0.82))), 1);
}

// Lòng bình (tọa độ theo mô hình gốc) và dung tích tương ứng khi đầy
export const VESSEL_SPECS = {
  roundflask: { inner: sphereProfile(1.0, 0.81, 0.21, 2.85), capacityMl: 250, bottomRadius: 0.3 },
  testtube: { inner: tubeProfile(0.15, 0.02, 1.76), capacityMl: 20, bottomRadius: 0.12 },
  burette: { inner: [[0, 2.6], [0.065, 2.6], [0.065, 5.15]], capacityMl: 50, bottomRadius: 0.05 },
  'separatory-funnel': {
    inner: [[0, 2.0], [0.04, 2.0], [0.27, 2.3], [0.37, 2.7], [0.34, 3.0], [0.2, 3.3], [0.08, 3.45]],
    capacityMl: 250,
    bottomRadius: 0.05,
  },
  'graduated-cylinder': { inner: [[0, 0.1], [0.2, 0.1], [0.2, 2.5]], capacityMl: 100, bottomRadius: 0.18 },
  'volumetric-flask': {
    inner: [[0, 0.04], [0.46, 0.05], [0.58, 0.25], [0.56, 0.6], [0.38, 0.9], [0.14, 1.1], [0.09, 1.25], [0.09, 2.0]],
    capacityMl: 100,
    bottomRadius: 0.4,
  },
  'distilling-flask': { inner: sphereProfile(0.85, 0.72, 0.17, 2.6), capacityMl: 250, bottomRadius: 0.3 },
  'filter-flask': { inner: [[0, 0.05], [0.8, 0.05], [0.8, 0.1], [0.27, 1.55], [0.27, 2.05]], capacityMl: 500, bottomRadius: 0.55 },
  crucible: { inner: [[0, 0.07], [0.24, 0.07], [0.38, 0.6]], capacityMl: 25, bottomRadius: 0.2 },
  'evaporating-dish': { inner: [[0, 0.05], [0.3, 0.05], [0.6, 0.28]], capacityMl: 60, bottomRadius: 0.28 },
};

// Màu chất lỏng theo hóa chất (cho các bình mới và cốc/bình cũ)
export const LIQUID_COLORS = {
  water: 0x93c5fd,
  hcl: 0xfde68a,
  naoh: 0xdbeafe,
  cuso4: 0x3b82f6,
  ethanol: 0xdbeafe,
  nacl: 0xe5e7eb,
  hno3: 0xf6efc4,
  h2so4: 0xe8eef5,
  ch3cooh: 0xeef2f6,
  nh3: 0xe6f0ff,
  agno3: 0xeef2f6,
  bacl2: 0xeef2f6,
  na2co3: 0xeef2f6,
  kmno4: 0x7e1f8f,
  h2o2: 0xe6f0ff,
  fecl3: 0xc0702a,
  phenolphthalein: 0xf5f5f5,
  hcl_dil: 0xeef2f6,
  h2so4_dil: 0xeef2f6,
  brwater: 0xe39a35, // nước brom loãng: vàng cam
  glucose: 0xf1f5f9,
  tollens: 0xeef2f6,
  cacl2: 0xeef2f6,
  hbr: 0xeef2f6,
  'el:br': 0x7a1f12,
  'el:hg': 0xc9ccd2,
};

export function liquidColorFor(chemicalIds) {
  for (const id of chemicalIds || []) if (LIQUID_COLORS[id] != null) return LIQUID_COLORS[id];
  return 0x93c5fd;
}

// ------------------------------------------------------------
// Chai hóa chất
// ------------------------------------------------------------
const CLEAR = { tint: 0xcfe8ff, tintOpacity: 0.25 };
const AMBER = { tint: 0x8a5a2b, tintOpacity: 0.5 }; // chai nâu cho chất dễ bị ánh sáng phân hủy

function buildReagentBottle({ liquid, label, cap, tint, tintOpacity }, fill = 1) {
  const g = new THREE.Group();
  g.add(order(lathe([[0, 0], [0.6, 0], [0.6, 1.2], [0.22, 1.55], [0.22, 1.8]], glass(tint, tintOpacity)), 2));
  const f = clamp01(fill);
  if (f > 0.005) {
    const level = 0.04 + 0.91 * f;
    const liq = order(lathe([[0, 0.04], [0.57, 0.04], [0.57, level], [0, level]], fillMat(liquid, 0.85)), 1);
    liq.name = 'stock-liquid'; // hoạt cảnh rót làm mức này hạ dần
    g.add(liq);
  }
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.612, 0.612, 0.5, 32, 1, true),
    std(label, { side: THREE.DoubleSide, roughness: 0.8 })
  );
  sleeve.position.y = 0.62;
  g.add(sleeve);
  const capMesh = cylAt(0.28, 0.28, std(cap, { roughness: 0.6 }), 1.8);
  capMesh.name = 'cap'; // mở nắp khi rót
  g.add(capMesh);
  return g;
}

function buildDropperBottle({ liquid, tint, tintOpacity }, fill = 1) {
  const g = new THREE.Group();
  g.add(order(lathe([[0, 0], [0.4, 0], [0.4, 0.75], [0.17, 0.95], [0.17, 1.05]], glass(tint, tintOpacity)), 2));
  const f = clamp01(fill);
  if (f > 0.005) {
    const level = 0.03 + 0.68 * f;
    const liq = order(lathe([[0, 0.03], [0.37, 0.03], [0.37, level], [0, level]], fillMat(liquid, 0.85)), 1);
    liq.name = 'stock-liquid';
    g.add(liq);
  }
  const cap = new THREE.Group();
  cap.name = 'cap';
  cap.add(order(cylAt(0.03, 0.9, glass(), 0.2, 12), 2)); // ống nhỏ giọt
  cap.add(cylAt(0.21, 0.14, std(0x1f2328), 1.05));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), std(0xb91c1c, { roughness: 0.7 }));
  bulb.scale.y = 1.4;
  bulb.position.y = 1.38;
  cap.add(bulb);
  g.add(cap);
  return g;
}

// ------------------------------------------------------------
// Dụng cụ thủy tinh mới
// ------------------------------------------------------------
function buildTestTube() {
  // Ống nghiệm rời: cắm được vào giá ống nghiệm hoặc kẹp trên giá đỡ
  const g = new THREE.Group();
  g.add(order(lathe(tubeProfile(0.17, 0, 1.8), glass()), 2));
  g.add(order(ringAt(0.18, 0.012, glass(0xcfe8ff, 0.4), 1.8), 2));
  return g;
}

function buildGraduatedCylinder() {
  const g = new THREE.Group();
  g.add(cylAt(0.48, 0.08, glass(0xcfe8ff, 0.35), 0, 6));
  g.add(order(lathe([[0, 0.08], [0.23, 0.08], [0.23, 2.5], [0.27, 2.56]], glass()), 2));
  addMarks(g, 0.232, 0.35, 2.35, 10);
  return g;
}

function buildVolumetricFlask() {
  const g = new THREE.Group();
  g.add(
    order(
      lathe(
        [[0, 0], [0.5, 0.02], [0.62, 0.25], [0.6, 0.6], [0.42, 0.92], [0.16, 1.12], [0.11, 1.27], [0.11, 2.5], [0.13, 2.55]],
        glass()
      ),
      2
    )
  );
  g.add(ringAt(0.112, 0.008, std(0x374151), 2.0)); // vạch mức
  g.add(cylAt(0.13, 0.22, std(0x2563eb, { roughness: 0.6 }), 2.55)); // nút nhựa
  return g;
}

function buildDistillingFlask() {
  const g = new THREE.Group();
  g.add(order(lathe(sphereProfile(0.85, 0.75, 0.2, 2.7), glass()), 2));
  g.add(ringAt(0.42, 0.09, std(0xa0785a, { roughness: 0.9 }), 0.12)); // vòng đỡ li-e
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 16), glass());
  arm.renderOrder = 2;
  arm.position.set(0.62, 2.0, 0);
  arm.rotation.z = Math.PI / 2 - 0.55; // ống nhánh chếch xuống, hướng ra ngoài
  g.add(arm);
  return g;
}

function buildFilterFlask() {
  const g = new THREE.Group();
  g.add(order(lathe([[0, 0], [0.85, 0], [0.85, 0.08], [0.3, 1.55], [0.3, 2.1], [0.36, 2.15]], glass(0xcfe8ff, 0.26)), 2));
  g.add(order(rodX(0.06, 0.55, glass(0xcfe8ff, 0.3), 0.55, 1.85), 2)); // vòi nối bơm hút
  return g;
}

function buildStandBase(height) {
  // Đế rộng, thanh đứng lệch về sau để chừa chỗ đặt bình hứng ở giữa
  const g = new THREE.Group();
  g.add(boxAt(1.9, 0.1, 1.1, DARK(), -0.3, 0, 0));
  const rod = cylAt(0.045, height, METAL(), 0.1, 16);
  rod.position.x = -1.05;
  g.add(rod);
  return g;
}

function buildBurette() {
  const g = buildStandBase(5.6);
  g.add(boxAt(1.05, 0.1, 0.1, METAL(), -0.53, 4.15));
  g.add(boxAt(0.2, 0.24, 0.24, DARK(), 0, 4.08));
  const tube = new THREE.Group();
  tube.add(order(lathe([[0.015, 2.25], [0.04, 2.39], [0.07, 2.49], [0.08, 2.57], [0.08, 5.2], [0.1, 5.25]], glass()), 2));
  addMarks(tube, 0.082, 2.9, 5.0, 25);
  tube.add(rodX(0.05, 0.3, std(0xf8fafc, { roughness: 0.4 }), 0, 2.53)); // thân khóa
  const handle = boxAt(0.04, 0.16, 0.12, std(0xf8fafc), 0.17, 2.45);
  handle.name = 'stopcock'; // tay khóa xoay khi xả
  tube.add(handle);
  g.add(tube);
  return g;
}

function buildPipette() {
  const g = new THREE.Group();
  const p = new THREE.Group();
  p.add(
    order(
      lathe([[0.008, 0], [0.035, 0.15], [0.035, 1.0], [0.12, 1.15], [0.13, 1.35], [0.12, 1.55], [0.035, 1.7], [0.035, 2.6]], glass()),
      2
    )
  );
  p.add(ringAt(0.036, 0.006, std(0x374151), 2.2));
  p.rotation.z = -Math.PI / 2;
  p.position.set(-1.3, 0.13, 0);
  g.add(p);
  return g;
}

function buildFunnel() {
  const g = buildStandBase(2.6);
  g.add(boxAt(1.05, 0.05, 0.05, METAL(), -0.53, 2.43));
  g.add(ringAt(0.27, 0.022, METAL(), 2.48));
  g.add(order(lathe([[0.04, 1.55], [0.04, 2.2], [0.36, 2.6], [0.38, 2.63]], glass()), 2));
  return g;
}

function buildSeparatoryFunnel() {
  const g = buildStandBase(3.7);
  g.add(boxAt(1.05, 0.05, 0.05, METAL(), -0.53, 2.93));
  g.add(ringAt(0.41, 0.024, METAL(), 2.95));
  g.add(order(lathe([[0.02, 1.45], [0.03, 1.85]], glass()), 2));
  g.add(rodX(0.05, 0.32, std(0xf8fafc, { roughness: 0.4 }), 0, 1.9));
  const handle = boxAt(0.04, 0.16, 0.12, std(0xf8fafc), 0.18, 1.82);
  handle.name = 'stopcock';
  g.add(handle);
  g.add(
    order(
      lathe([[0.03, 1.95], [0.06, 2.02], [0.3, 2.3], [0.4, 2.7], [0.37, 3.0], [0.22, 3.3], [0.1, 3.45], [0.1, 3.6]], glass()),
      2
    )
  );
  g.add(cylAt(0.12, 0.14, std(0x2563eb, { roughness: 0.6 }), 3.6));
  return g;
}

function buildWatchGlass() {
  const g = new THREE.Group();
  g.add(order(lathe([[0, 0.02], [0.55, 0.06], [0.8, 0.16], [0.83, 0.18]], glass(0xcfe8ff, 0.3)), 2));
  return g;
}

function buildPetriDish() {
  const g = new THREE.Group();
  g.add(order(lathe([[0, 0.008], [0.7, 0.008], [0.7, 0.12], [0.69, 0.12], [0.69, 0.018], [0, 0.018]], glass(0xcfe8ff, 0.3)), 2));
  g.add(order(lathe([[0, 0.16], [0.74, 0.16], [0.74, 0.05], [0.73, 0.05], [0.73, 0.15], [0, 0.15]], glass(0xcfe8ff, 0.25)), 3));
  return g;
}

function buildStirringRod() {
  const g = new THREE.Group();
  const pose = new THREE.Group();
  pose.name = 'pose';
  pose.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 2.2, 4, 12), glass(0xcfe8ff, 0.5)));
  g.add(pose);
  g.userData.tool = { halfLen: 1.135, radius: 0.035 };
  setToolPose(g, 'lying');
  return g;
}

function buildCondenser() {
  const g = new THREE.Group();
  const c = new THREE.Group();
  c.add(order(lathe([[0.05, 0], [0.05, 3.4]], glass(0xcfe8ff, 0.3)), 3));
  c.add(order(lathe([[0.06, 0.4], [0.17, 0.5], [0.17, 2.9], [0.06, 3.0]], glass()), 2));
  [0.75, 2.65].forEach((y) => {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.32, 12), glass(0xcfe8ff, 0.3));
    n.rotation.x = Math.PI / 2;
    n.position.set(0, y, 0.3);
    c.add(n);
  });
  c.rotation.z = -Math.PI / 2;
  c.position.set(-1.7, 0.3, 0);
  g.add(c);
  g.add(boxAt(0.3, 0.13, 0.4, DARK(), -0.9, 0, 0));
  g.add(boxAt(0.3, 0.13, 0.4, DARK(), 0.9, 0, 0));
  return g;
}

// Tư thế dụng cụ dài (đũa thủy tinh, nhiệt kế):
// 'lying' nằm trên bàn; 'leaning' dựng nghiêng, đầu dưới tại (offsetX, 0, 0)
export function setToolPose(group, mode, { lean = 0.32, offsetX = 0 } = {}) {
  // group: nhóm mô hình gốc (có userData.tool và nhóm con tên 'pose')
  const pose = group?.getObjectByName('pose');
  const tool = group?.userData.tool;
  if (!pose || !tool) return;
  if (mode === 'leaning') {
    pose.rotation.set(0, 0, lean);
    pose.position.set(offsetX - Math.sin(lean) * tool.halfLen, tool.radius + Math.cos(lean) * tool.halfLen, 0);
  } else {
    pose.rotation.set(0, 0.5, -Math.PI / 2);
    pose.position.set(0, tool.radius, 0);
  }
}

// ------------------------------------------------------------
// Dụng cụ (Equipment) mới
// ------------------------------------------------------------
function makeFlame(y, outerR, outerH, innerR, innerH) {
  const outerGeo = new THREE.ConeGeometry(outerR, outerH, 20);
  outerGeo.translate(0, outerH / 2, 0);
  const innerGeo = new THREE.ConeGeometry(innerR, innerH, 20);
  innerGeo.translate(0, innerH / 2, 0);
  const outer = new THREE.Mesh(
    outerGeo,
    new THREE.MeshBasicMaterial({ color: 0xffa94d, transparent: true, opacity: 0.55, depthWrite: false })
  );
  const inner = new THREE.Mesh(
    innerGeo,
    new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.7, depthWrite: false })
  );
  outer.position.y = y;
  inner.position.y = y;
  outer.name = 'flame'; // ẩn/hiện theo trạng thái châm lửa
  inner.name = 'flame';
  return { outer, inner };
}

function buildSpiritLamp() {
  const g = new THREE.Group();
  g.add(order(lathe([[0, 0], [0.45, 0], [0.52, 0.15], [0.5, 0.55], [0.3, 0.75], [0.16, 0.82], [0.16, 0.9]], glass(0xcfe8ff, 0.3)), 2));
  g.add(order(lathe([[0, 0.03], [0.43, 0.03], [0.49, 0.15], [0.48, 0.4], [0, 0.4]], fillMat(0xdbeafe, 0.5)), 1));
  g.add(cylAt(0.18, 0.12, METAL(), 0.9));
  g.add(cylAt(0.045, 0.16, std(0xf5f0e1, { roughness: 0.9 }), 1.02, 12));
  const { outer, inner } = makeFlame(1.12, 0.1, 0.5, 0.05, 0.22);
  g.add(outer, inner);
  g.userData.animate = (t) => {
    outer.scale.y = 1 + 0.15 * Math.sin(t * 11) + 0.07 * Math.sin(t * 27);
    outer.scale.x = outer.scale.z = 1 + 0.06 * Math.sin(t * 15);
    inner.scale.y = 1 + 0.1 * Math.sin(t * 13 + 1);
  };
  return g;
}

function buildHotPlate() {
  const g = new THREE.Group();
  g.add(boxAt(1.5, 0.42, 1.5, std(0xe5e7eb, { roughness: 0.4 })));
  g.add(boxAt(1.3, 0.05, 1.3, std(0xf8fafc, { roughness: 0.2 }), 0, 0.42));
  const heater = cylAt(0.5, 0.006, std(0x9ca3af, { roughness: 0.4, emissive: 0x000000 }), 0.47, 48);
  heater.name = 'heater'; // đỏ dần khi bếp đang đun
  g.add(heater);
  g.add(boxAt(1.5, 0.3, 0.04, DARK(), 0, 0.06, 0.77));
  [-0.4, 0.4].forEach((x) => {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 24), std(0x111827, { roughness: 0.5 }));
    k.rotation.x = Math.PI / 2;
    k.position.set(x, 0.21, 0.82);
    g.add(k);
  });
  g.add(boxAt(0.3, 0.1, 0.02, new THREE.MeshBasicMaterial({ color: 0xf97316 }), 0, 0.17, 0.79));
  return g;
}

// Máy khuấy từ (không gia nhiệt): mặt trên đặt cốc, núm chỉnh tốc độ, đèn nguồn
function buildMagneticStirrer() {
  const g = new THREE.Group();
  g.add(boxAt(1.4, 0.45, 1.5, std(0xf1f5f9, { roughness: 0.4 })));
  g.add(boxAt(1.25, 0.04, 1.25, std(0xcbd5e1, { roughness: 0.3, metalness: 0.2 }), 0, 0.45, -0.05));
  g.add(boxAt(1.4, 0.28, 0.04, DARK(), 0, 0.06, 0.77));
  const k = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 24), std(0x2563eb, { roughness: 0.5 }));
  k.rotation.x = Math.PI / 2;
  k.position.set(0.3, 0.2, 0.82);
  g.add(k);
  return g;
}

// Bếp bọc gia nhiệt (heating mantle) cho bình cầu: lòng bát vải sợi thủy tinh
function buildHeatingMantle() {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [0.95, 0], [1.0, 0.1], [1.0, 0.75], [0.92, 0.8]], std(0x9ca3af, { metalness: 0.6, roughness: 0.35 }), 40));
  const bowl = lathe([[0.88, 0.8], [0.72, 0.62], [0.42, 0.4], [0, 0.35]], std(0xe7e2d6, { roughness: 0.95, side: THREE.DoubleSide }), 40);
  bowl.name = 'heater';
  g.add(bowl);
  g.add(boxAt(0.7, 0.35, 0.3, DARK(), 0, 0.1, 0.9));
  const k = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 20), std(0x111827, { roughness: 0.5 }));
  k.rotation.x = Math.PI / 2;
  k.position.set(0.15, 0.28, 1.08);
  g.add(k);
  return g;
}

// Máy đo pH để bàn: thân, màn hình, tay giữ điện cực
function buildPhMeter() {
  const g = new THREE.Group();
  const body = std(0xf8fafc, { roughness: 0.4 });
  const hull = boxAt(1.3, 0.55, 1.1, body);
  hull.rotation.x = -0.12;
  g.add(hull);
  g.add(boxAt(0.8, 0.32, 0.03, std(0x0b1a10, { emissive: 0x16a34a, emissiveIntensity: 0.25 }), 0, 0.26, 0.58));
  g.add(boxAt(0.12, 2.2, 0.12, METAL(), 0.55, 0, -0.35));
  g.add(boxAt(0.9, 0.08, 0.1, METAL(), 0.95, 1.9, -0.35));
  // điện cực thủy tinh
  g.add(cylAt(0.06, 1.3, glass(0xdbeafe, 0.5), 0.75, 16));
  g.children[g.children.length - 1].position.set(1.35, 1.3, -0.35);
  g.add(cylAt(0.08, 0.3, DARK(), 1.75, 16));
  g.children[g.children.length - 1].position.set(1.35, 2.0, -0.35);
  return g;
}

function buildTripod() {
  // Kiềng đủ cao để đặt đèn cồn hoặc đèn Bunsen bên dưới
  const g = new THREE.Group();
  const iron = std(0x4b5563, { metalness: 0.6, roughness: 0.5 });
  g.add(ringAt(0.55, 0.03, iron, 2.4));
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const top = new THREE.Vector3(Math.cos(a) * 0.55, 2.4, Math.sin(a) * 0.55);
    const foot = new THREE.Vector3(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9);
    const dir = new THREE.Vector3().subVectors(top, foot);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, dir.length(), 10), iron);
    leg.position.copy(foot).addScaledVector(dir, 0.5);
    leg.quaternion.setFromUnitVectors(up, dir.clone().normalize());
    g.add(leg);
  }
  g.add(boxAt(1.3, 0.015, 1.3, std(0x6b7280, { metalness: 0.6, roughness: 0.6 }), 0, 2.43));
  g.add(cylAt(0.36, 0.02, std(0xf3f1ec, { roughness: 0.9 }), 2.445, 32));
  return g;
}

function buildThermometer() {
  const g = new THREE.Group();
  const pose = new THREE.Group();
  pose.name = 'pose';
  const t = new THREE.Group();
  t.add(order(lathe([[0.06, 0.08], [0.06, 2.5], [0.04, 2.56], [0, 2.57]], glass(0xcfe8ff, 0.35)), 2));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), std(0xdc2626, { roughness: 0.3 }));
  bulb.position.y = 0.08;
  t.add(bulb);
  t.add(cylAt(0.016, 1.1, std(0xdc2626), 0.12, 8));
  t.position.y = -1.29; // đặt tâm nhiệt kế tại gốc để xoay tư thế
  pose.add(t);
  g.add(pose);
  g.userData.tool = { halfLen: 1.29, radius: 0.075 };
  setToolPose(g, 'lying');
  return g;
}

function buildTubeHolder() {
  const g = new THREE.Group();
  g.add(boxAt(1.1, 0.1, 0.14, WOOD(), -0.35, 0));
  g.add(boxAt(0.6, 0.03, 0.1, METAL(), 0.45, 0.04));
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 8, 32), METAL());
  loop.rotation.x = Math.PI / 2;
  loop.position.set(0.9, 0.05, 0);
  g.add(loop);
  return g;
}

function buildSpatula() {
  const g = new THREE.Group();
  const steel = std(0xc7ccd3, { metalness: 0.9, roughness: 0.25 });
  g.add(rodX(0.03, 1.1, steel, 0, 0.03));
  g.add(boxAt(0.45, 0.015, 0.13, steel, 0.75, 0.02));
  const spoon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), steel);
  spoon.scale.set(1.4, 0.5, 1);
  spoon.position.set(-0.62, 0.06, 0);
  g.add(spoon);
  return g;
}

function buildMortar() {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [0.4, 0], [0.6, 0.3], [0.66, 0.55], [0.62, 0.58], [0.54, 0.5], [0.36, 0.22], [0, 0.15]], PORCELAIN()));
  const pestle = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.8, 6, 16), PORCELAIN());
  pestle.rotation.z = 0.55;
  pestle.position.set(0.18, 0.62, 0);
  g.add(pestle);
  return g;
}

function buildCrucible() {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [0.26, 0], [0.4, 0.6], [0.43, 0.62], [0.38, 0.62], [0.24, 0.07], [0, 0.07]], PORCELAIN()));
  const lid = new THREE.Group();
  lid.add(lathe([[0, 0.06], [0.46, 0.02], [0.47, 0], [0, 0.02]], PORCELAIN()));
  lid.add(cylAt(0.06, 0.06, PORCELAIN(), 0.06, 16));
  lid.position.set(0.85, 0, 0);
  g.add(lid);
  return g;
}

function buildEvaporatingDish() {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [0.32, 0], [0.62, 0.26], [0.72, 0.32], [0.6, 0.28], [0.3, 0.05], [0, 0.05]], PORCELAIN()));
  return g;
}

function buildWashBottle() {
  const g = new THREE.Group();
  const plastic = new THREE.MeshPhysicalMaterial({
    color: 0xf8fafc,
    transparent: true,
    opacity: 0.55,
    roughness: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  g.add(order(lathe([[0, 0], [0.42, 0], [0.45, 0.1], [0.45, 1.1], [0.3, 1.35], [0.18, 1.45]], plastic), 2));
  g.add(order(lathe([[0, 0.03], [0.42, 0.03], [0.42, 0.8], [0, 0.8]], fillMat(0xbfdbfe, 0.6)), 1));
  g.add(cylAt(0.2, 0.15, std(0x2563eb, { roughness: 0.6 }), 1.45));
  const tubeMat = std(0xf1f5f9, { roughness: 0.5 });
  g.add(cylAt(0.025, 0.45, tubeMat, 1.6, 8));
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.015, 0.5, 8), tubeMat);
  nozzle.position.set(0.2, 2.1, 0);
  nozzle.rotation.z = -1.1;
  g.add(nozzle);
  return g;
}

// ------------------------------------------------------------
// Lượng tồn của hóa chất khi lấy ra bàn (mL)
// ------------------------------------------------------------
export const STOCK_SPECS = {
  water: { label: 'H₂O', phase: 'liquid', defaultMl: 250, densityGmL: 1.0, molarMass: 18.02, formula: 'H₂O' },
  hcl: { label: 'HCl', phase: 'liquid', defaultMl: 100, densityGmL: 1.18, solute: 'HCl', molarity: 12.0, soluteMolarMass: 36.46, conc: '≈ 37 % (≈ 12 M)' },
  naoh: { label: 'NaOH', phase: 'liquid', defaultMl: 250, solute: 'NaOH', molarity: 1, soluteMolarMass: 40.0, conc: '1 M' },
  cuso4: { label: 'CuSO₄', phase: 'liquid', defaultMl: 250, solute: 'CuSO₄', molarity: 0.5, soluteMolarMass: 159.61, conc: '0,5 M' },
  ethanol: { label: 'C₂H₅OH', phase: 'liquid', defaultMl: 250, densityGmL: 0.789, molarMass: 46.07, formula: 'C₂H₅OH' },
  o2: { label: 'O₂', phase: 'gas', defaultMl: 1000, molarMass: 32.0, formula: 'O₂' },
  h2: { label: 'H₂', phase: 'gas', defaultMl: 1000, molarMass: 2.016, formula: 'H₂' },
  co2: { label: 'CO₂', phase: 'gas', defaultMl: 1000, molarMass: 44.01, formula: 'CO₂' },
  methane: { label: 'CH₄', phase: 'gas', defaultMl: 1000, molarMass: 16.04, formula: 'CH₄' },
  hno3: { label: 'HNO₃', phase: 'liquid', defaultMl: 100, densityGmL: 1.39, solute: 'HNO₃', molarity: 14.3, soluteMolarMass: 63.01, conc: '≈ 65 % (≈ 14,3 M)' },
  h2so4: { label: 'H₂SO₄', phase: 'liquid', defaultMl: 100, densityGmL: 1.84, solute: 'H₂SO₄', molarity: 18.4, soluteMolarMass: 98.08, conc: '≈ 98 % (≈ 18,4 M)' },
  ch3cooh: { label: 'CH₃COOH', phase: 'liquid', defaultMl: 250, solute: 'CH₃COOH', molarity: 1, soluteMolarMass: 60.05, conc: '1 M' },
  nh3: { label: 'NH₃', phase: 'liquid', defaultMl: 100, densityGmL: 0.91, solute: 'NH₃', molarity: 13.4, soluteMolarMass: 17.03, conc: '≈ 25 % (≈ 13,4 M)' },
  agno3: { label: 'AgNO₃', phase: 'liquid', defaultMl: 100, solute: 'AgNO₃', molarity: 0.1, soluteMolarMass: 169.87, conc: '0,1 M' },
  bacl2: { label: 'BaCl₂', phase: 'liquid', defaultMl: 100, solute: 'BaCl₂', molarity: 0.1, soluteMolarMass: 208.23, conc: '0,1 M' },
  na2co3: { label: 'Na₂CO₃', phase: 'liquid', defaultMl: 250, solute: 'Na₂CO₃', molarity: 0.5, soluteMolarMass: 105.99, conc: '0,5 M' },
  kmno4: { label: 'KMnO₄', phase: 'liquid', defaultMl: 100, solute: 'KMnO₄', molarity: 0.02, soluteMolarMass: 158.03, conc: '0,02 M' },
  h2o2: { label: 'H₂O₂', phase: 'liquid', defaultMl: 100, solute: 'H₂O₂', molarity: 0.88, soluteMolarMass: 34.01, conc: '3 % (≈ 0,88 M)' },
  fecl3: { label: 'FeCl₃', phase: 'liquid', defaultMl: 100, solute: 'FeCl₃', molarity: 0.1, soluteMolarMass: 162.2, conc: '0,1 M' },
  phenolphthalein: { label: 'Phenolphtalein', phase: 'liquid', defaultMl: 25, conc: '1 % trong etanol' },
  // dùng cho 5 thí nghiệm phản ứng (lab-reactions.js)
  hcl_dil: { label: 'HCl 2M', phase: 'liquid', defaultMl: 100, solute: 'HCl', molarity: 2, soluteMolarMass: 36.46, conc: '2 M (loãng)' },
  h2so4_dil: { label: 'H₂SO₄ 1M', phase: 'liquid', defaultMl: 100, solute: 'H₂SO₄', molarity: 1, soluteMolarMass: 98.08, conc: '1 M (loãng)' },
  brwater: { label: 'Br₂ (aq)', phase: 'liquid', defaultMl: 100, solute: 'Br₂', molarity: 0.02, soluteMolarMass: 159.81, conc: '≈ 0,02 M' },
  glucose: { label: 'C₆H₁₂O₆', phase: 'liquid', defaultMl: 100, solute: 'C₆H₁₂O₆', molarity: 0.555, soluteMolarMass: 180.16, conc: '10 % (≈ 0,56 M)' },
  so2: { label: 'SO₂', phase: 'gas', defaultMl: 1000, molarMass: 64.07, formula: 'SO₂' },
};

// Mô hình hóa chất trên bàn: chai/bình + nhãn ghi lượng còn lại
export function buildStockModel(item, stock) {
  const g = new THREE.Group();
  const fraction = stock.initialAmount ? clamp01(stock.amount / stock.initialAmount) : 1;
  const body = item.build(fraction);
  g.add(body);
  const box = new THREE.Box3().setFromObject(body);
  const label = makeAmountLabel(
    `${stock.symbol}  ${amountLabel(stock.amount, stock.unit)}`,
    stock.amount <= 0 ? 'Đã dùng hết' : item.name
  );
  label.position.y = box.max.y + 0.45;
  g.add(label);
  return g;
}

// ------------------------------------------------------------
// Danh sách mục mới cho CATALOG
// ------------------------------------------------------------
function liquid(id, name, formula, desc, props, safety, look, dropper = false) {
  return {
    id,
    category: 'Liquid',
    name,
    formula,
    desc,
    props,
    safety,
    build: (fill) => (dropper ? buildDropperBottle(look, fill) : buildReagentBottle(look, fill)),
    stock: STOCK_SPECS[id],
  };
}

export const LIQUID_ITEMS = [
  liquid(
    'hno3', 'Nitric acid', 'HNO₃ (aq)',
    'Axit mạnh có tính oxi hóa mạnh, dùng trong phân tích, sản xuất phân bón và khắc kim loại. Mẫu là dung dịch đặc, đựng trong chai nâu để tránh ánh sáng.',
    [['Khối lượng mol', '63,01 g/mol'], ['Nồng độ mẫu', '≈ 65 % (đặc)'], ['Khối lượng riêng', '≈ 1,39 g/mL'], ['Tính chất', 'Axit mạnh, oxi hóa mạnh']],
    'Ăn mòn mạnh, gây bỏng nặng; khí NO₂ sinh ra rất độc. Dùng trong tủ hút, đeo kính và găng tay.',
    { liquid: LIQUID_COLORS.hno3, label: 0xfde68a, cap: 0xdc2626, ...AMBER }
  ),
  liquid(
    'h2so4', 'Sulfuric acid', 'H₂SO₄ (aq)',
    'Axit mạnh, háo nước, dùng rất phổ biến trong công nghiệp và phòng thí nghiệm. Mẫu là axit đặc.',
    [['Khối lượng mol', '98,08 g/mol'], ['Nồng độ mẫu', '≈ 98 % (đặc)'], ['Khối lượng riêng', '≈ 1,84 g/mL'], ['Tính chất', 'Axit mạnh, háo nước']],
    'Ăn mòn rất mạnh, gây bỏng và làm than hóa chất hữu cơ. Khi pha loãng luôn rót từ từ axit vào nước, không làm ngược lại.',
    { liquid: LIQUID_COLORS.h2so4, label: 0xfecaca, cap: 0x991b1b, ...CLEAR }
  ),
  liquid(
    'ch3cooh', 'Acetic acid', 'CH₃COOH (aq)',
    'Axit hữu cơ yếu, tạo vị chua của giấm ăn. Mẫu là dung dịch loãng 1 M.',
    [['Khối lượng mol', '60,05 g/mol'], ['Nồng độ mẫu', '1 M'], ['Tính chất', 'Axit yếu'], ['Mùi', 'Chua, hăng']],
    'Dung dịch loãng gây kích ứng mắt và da; axit đặc ăn mòn và dễ cháy.',
    { liquid: LIQUID_COLORS.ch3cooh, label: 0xfef3c7, cap: 0xf59e0b, ...CLEAR }
  ),
  liquid(
    'nh3', 'Ammonia solution', 'NH₃ (aq)',
    'Dung dịch amoniac có tính bazơ yếu và mùi khai đặc trưng. Mẫu là dung dịch đặc.',
    [['Khối lượng mol (NH₃)', '17,03 g/mol'], ['Nồng độ mẫu', '≈ 25 %'], ['Khối lượng riêng', '≈ 0,91 g/mL'], ['Tính chất', 'Bazơ yếu, dễ bay hơi']],
    'Hơi amoniac kích ứng mạnh mắt và đường hô hấp; dung dịch đặc gây bỏng. Dùng trong tủ hút.',
    { liquid: LIQUID_COLORS.nh3, label: 0xdbeafe, cap: 0x1d4ed8, ...CLEAR }
  ),
  liquid(
    'agno3', 'Silver nitrate', 'AgNO₃ (aq)',
    'Dung dịch muối bạc, dùng nhận biết ion halogenua (ví dụ tạo kết tủa AgCl màu trắng với ion Cl⁻). Đựng trong chai nâu vì dễ bị ánh sáng phân hủy.',
    [['Khối lượng mol', '169,87 g/mol'], ['Nồng độ mẫu', '0,1 M'], ['Ứng dụng', 'Nhận biết ion Cl⁻, Br⁻, I⁻'], ['Bảo quản', 'Chai tối màu']],
    'Ăn mòn, làm da và quần áo đổi màu đen; độc với sinh vật thủy sinh.',
    { liquid: LIQUID_COLORS.agno3, label: 0xe5e7eb, cap: 0x111827, ...AMBER }
  ),
  liquid(
    'bacl2', 'Barium chloride', 'BaCl₂ (aq)',
    'Dung dịch muối bari, dùng nhận biết ion sunfat (tạo kết tủa BaSO₄ màu trắng).',
    [['Khối lượng mol', '208,23 g/mol'], ['Nồng độ mẫu', '0,1 M'], ['Ứng dụng', 'Nhận biết ion SO₄²⁻']],
    'Độc nếu nuốt (ion Ba²⁺); rửa tay sau khi dùng.',
    { liquid: LIQUID_COLORS.bacl2, label: 0xd1fae5, cap: 0x047857, ...CLEAR }
  ),
  liquid(
    'na2co3', 'Sodium carbonate', 'Na₂CO₃ (aq)',
    'Dung dịch muối có tính bazơ (soda), phản ứng với axit giải phóng khí CO₂.',
    [['Khối lượng mol', '105,99 g/mol'], ['Nồng độ mẫu', '0,5 M'], ['Tính chất', 'Môi trường bazơ']],
    'Gây kích ứng mắt; tránh để bắn vào mắt.',
    { liquid: LIQUID_COLORS.na2co3, label: 0xe0e7ff, cap: 0x4338ca, ...CLEAR }
  ),
  liquid(
    'kmno4', 'Potassium permanganate', 'KMnO₄ (aq)',
    'Dung dịch thuốc tím màu tím đậm, chất oxi hóa mạnh, dùng trong chuẩn độ và sát trùng.',
    [['Khối lượng mol', '158,03 g/mol'], ['Nồng độ mẫu', '0,02 M'], ['Màu dung dịch', 'Tím'], ['Tính chất', 'Chất oxi hóa mạnh']],
    'Chất oxi hóa mạnh, nhuộm da màu nâu; tránh tiếp xúc với chất dễ cháy.',
    { liquid: LIQUID_COLORS.kmno4, label: 0xf5d0fe, cap: 0x6b21a8, ...AMBER }
  ),
  liquid(
    'h2o2', 'Hydrogen peroxide', 'H₂O₂ (aq)',
    'Nước oxi già, chất oxi hóa, dễ phân hủy giải phóng khí oxi (nhanh hơn khi có xúc tác MnO₂).',
    [['Khối lượng mol', '34,01 g/mol'], ['Nồng độ mẫu', '3 %'], ['Tính chất', 'Oxi hóa, dễ phân hủy'], ['Bảo quản', 'Chai tối màu, nơi mát']],
    'Dung dịch 3 % gây kích ứng nhẹ; dung dịch đặc gây bỏng và có thể phản ứng mạnh với chất hữu cơ.',
    { liquid: LIQUID_COLORS.h2o2, label: 0xffffff, cap: 0x0ea5e9, ...AMBER }
  ),
  liquid(
    'fecl3', 'Iron(III) chloride', 'FeCl₃ (aq)',
    'Dung dịch muối sắt(III) màu vàng nâu, dùng khắc mạch in và nhận biết ion OH⁻ (tạo kết tủa Fe(OH)₃ màu nâu đỏ).',
    [['Khối lượng mol', '162,20 g/mol'], ['Nồng độ mẫu', '0,1 M'], ['Màu dung dịch', 'Vàng nâu']],
    'Ăn mòn kim loại, kích ứng da và mắt.',
    { liquid: LIQUID_COLORS.fecl3, label: 0xfed7aa, cap: 0x9a3412, ...CLEAR }
  ),
  liquid(
    'hcl_dil', 'Hydrochloric acid (dilute)', 'HCl 2 M',
    'Axit clohiđric loãng dùng cho thí nghiệm hằng ngày, ví dụ cho tác dụng với đá vôi (CaCO₃) để điều chế khí CO₂.',
    [['Khối lượng mol', '36,46 g/mol'], ['Nồng độ mẫu', '2 M'], ['Tính chất', 'Axit mạnh']],
    'Gây kích ứng, bỏng nhẹ da và mắt. Đeo kính và găng tay.',
    { liquid: LIQUID_COLORS.hcl_dil, label: 0xfde68a, cap: 0xdc2626, ...CLEAR }
  ),
  liquid(
    'h2so4_dil', 'Sulfuric acid (dilute)', 'H₂SO₄ 1 M',
    'Axit sunfuric loãng, đã pha sẵn đúng cách (rót từ từ axit đặc vào nước). Dùng nhận biết ion Ba²⁺ (tạo kết tủa trắng BaSO₄).',
    [['Khối lượng mol', '98,08 g/mol'], ['Nồng độ mẫu', '1 M'], ['Tính chất', 'Axit mạnh']],
    'Gây bỏng da và mắt. Đeo kính và găng tay.',
    { liquid: LIQUID_COLORS.h2so4_dil, label: 0xfecaca, cap: 0xdc2626, ...CLEAR }
  ),
  liquid(
    'brwater', 'Bromine water', 'Br₂ (aq) – nước brom',
    'Dung dịch brom trong nước màu vàng cam. Bị mất màu khi gặp chất khử như SO₂ (SO₂ + Br₂ + 2H₂O → 2HBr + H₂SO₄). Đựng trong chai nâu, thao tác trong tủ hút.',
    [['Chất tan', 'Br₂ (159,81 g/mol)'], ['Nồng độ mẫu', '≈ 0,02 M'], ['Màu', 'Vàng cam'], ['Tính chất', 'Chất oxi hóa']],
    'Hơi brom độc, gây bỏng da và niêm mạc. Chỉ dùng trong tủ hút, đeo găng tay và kính.',
    { liquid: LIQUID_COLORS.brwater, label: 0xfed7aa, cap: 0x7c2d12, ...AMBER }
  ),
  liquid(
    'glucose', 'Glucose solution', 'C₆H₁₂O₆ 10 %',
    'Dung dịch glucozơ. Nhóm –CHO khử ion bạc trong thuốc thử Tollens tạo lớp bạc sáng như gương trên thành ống nghiệm (phản ứng tráng bạc, đun cách thủy 60–70 °C).',
    [['Khối lượng mol', '180,16 g/mol'], ['Nồng độ mẫu', '10 % (≈ 0,56 M)'], ['Tính chất', 'Có tính khử (nhóm –CHO)']],
    'Ít nguy hiểm.',
    { liquid: LIQUID_COLORS.glucose, label: 0xdcfce7, cap: 0x15803d, ...CLEAR }
  ),
  liquid(
    'phenolphthalein', 'Phenolphthalein', 'Chất chỉ thị 1 %',
    'Dung dịch chất chỉ thị axit–bazơ trong etanol: không màu trong môi trường axit và trung tính, chuyển hồng trong môi trường bazơ (pH khoảng 8,2–10).',
    [['Công thức', 'C₂₀H₁₄O₄'], ['Khối lượng mol', '318,32 g/mol'], ['Nồng độ mẫu', '1 % trong etanol'], ['Khoảng đổi màu', 'pH ≈ 8,2–10']],
    'Dung dịch chứa etanol dễ cháy; tránh nuốt.',
    { liquid: LIQUID_COLORS.phenolphthalein, ...CLEAR },
    true
  ),
];

const glassItem = (id, name, formula, desc, props, safety, build) => ({
  id, category: 'Glassware', name, formula, desc, props, safety, build,
});

export const GLASSWARE_ITEMS = [
  glassItem('testtube', 'Test tube', 'Ống nghiệm',
    'Ống thủy tinh đáy tròn dùng cho phản ứng lượng nhỏ. Kéo thả vào giá ống nghiệm hoặc vòng kẹp của giá đỡ để giữ ống.',
    [['Dung tích', '≈ 20 mL'], ['Vật liệu', 'Thủy tinh borosilicate'], ['Đun nóng', 'Được, giữ bằng kẹp ống nghiệm'], ['Dùng cho', 'Phản ứng lượng nhỏ']],
    'Khi đun, hướng miệng ống ra xa người.', buildTestTube),
  glassItem('graduated-cylinder', 'Graduated cylinder 100 mL', 'Ống đong',
    'Ống thủy tinh có vạch chia, dùng đong thể tích chất lỏng với độ chính xác vừa phải.',
    [['Dung tích', '100 mL'], ['Độ chính xác', '≈ ±1 mL'], ['Không dùng để', 'Đun nóng, pha chế']],
    'Không đun nóng ống đong; đọc vạch ở đáy mặt khum chất lỏng.', buildGraduatedCylinder),
  glassItem('volumetric-flask', 'Volumetric flask 100 mL', 'Bình định mức',
    'Bình cổ dài có một vạch mức, dùng pha dung dịch có nồng độ chính xác.',
    [['Dung tích', '100 mL (tới vạch mức)'], ['Độ chính xác', 'Cao'], ['Có nút', 'Có'], ['Dùng cho', 'Pha dung dịch chuẩn']],
    'Không đun nóng bình định mức.', buildVolumetricFlask),
  glassItem('distilling-flask', 'Distilling flask', 'Bình cầu có nhánh',
    'Bình cầu có ống nhánh bên, dùng trong chưng cất để dẫn hơi sang ống sinh hàn.',
    [['Dung tích', '250 mL'], ['Vật liệu', 'Thủy tinh borosilicate'], ['Dùng cho', 'Chưng cất'], ['Đế đỡ', 'Vòng li-e']],
    'Không đun khi hệ kín; thêm đá bọt để tránh sôi trào.', buildDistillingFlask),
  glassItem('filter-flask', 'Filter flask 500 mL', 'Bình lọc hút',
    'Bình thành dày có vòi bên để nối bơm hút, dùng lọc chân không cùng phễu Büchner.',
    [['Dung tích', '500 mL'], ['Thành bình', 'Dày, chịu được hút chân không'], ['Dùng cho', 'Lọc hút']],
    'Kiểm tra vết nứt trước khi hút chân không.', buildFilterFlask),
  glassItem('burette', 'Burette 50 mL', 'Buret',
    'Ống chia vạch dài có khóa ở đầu dưới, dùng nhỏ từng lượng dung dịch chính xác khi chuẩn độ. Rót dung dịch vào buret, đặt bình hứng lên đế rồi mở khóa để nhỏ giọt.',
    [['Dung tích', '50 mL'], ['Vạch chia', '0,1 mL'], ['Dùng cho', 'Chuẩn độ']],
    'Tráng buret bằng dung dịch sẽ dùng; đuổi hết bọt khí ở đầu buret.', buildBurette),
  glassItem('pipette', 'Volumetric pipette 10 mL', 'Pipet bầu',
    'Ống hút có bầu ở giữa và một vạch mức, lấy chính xác một thể tích chất lỏng.',
    [['Dung tích', '10 mL'], ['Độ chính xác', 'Cao'], ['Dùng kèm', 'Quả bóp cao su']],
    'Không hút bằng miệng; luôn dùng quả bóp.', buildPipette),
  glassItem('funnel', 'Glass funnel', 'Phễu thủy tinh',
    'Phễu đặt trên giá đỡ, dùng rót chất lỏng hoặc lọc qua giấy lọc. Đặt bình hứng lên đế giá; rót vào phễu thì chất lỏng chảy xuống bình hứng.',
    [['Đường kính', '≈ 75 mm'], ['Dùng cho', 'Rót, lọc'], ['Đặt trên', 'Vòng giá đỡ']],
    'Không rót quá đầy giấy lọc.', buildFunnel),
  glassItem('separatory-funnel', 'Separatory funnel', 'Phễu chiết',
    'Phễu hình quả lê có khóa, dùng tách hai chất lỏng không tan vào nhau. Rót chất lỏng vào phễu, đặt bình hứng lên đế rồi mở khóa để xả.',
    [['Dung tích', '250 mL'], ['Có khóa', 'Có'], ['Dùng cho', 'Chiết, tách lớp']],
    'Khi lắc, mở khóa xả khí thường xuyên và hướng cuống phễu ra xa người.', buildSeparatoryFunnel),
  glassItem('watch-glass', 'Watch glass', 'Mặt kính đồng hồ',
    'Đĩa thủy tinh lõm, dùng đựng lượng nhỏ chất rắn, đậy cốc hoặc để cân hóa chất.',
    [['Đường kính', '≈ 100 mm'], ['Dùng cho', 'Cân, đậy cốc, bay hơi lượng nhỏ']],
    'Dễ vỡ; không đun trực tiếp trên lửa.', buildWatchGlass),
  glassItem('petri-dish', 'Petri dish', 'Đĩa Petri',
    'Đĩa thủy tinh dẹt có nắp, dùng nuôi cấy vi sinh hoặc quan sát phản ứng trên bề mặt.',
    [['Đường kính', '≈ 90 mm'], ['Có nắp', 'Có']],
    'Khử trùng trước khi nuôi cấy; xử lý mẫu vi sinh đúng quy định.', buildPetriDish),
  glassItem('stirring-rod', 'Glass stirring rod', 'Đũa thủy tinh',
    'Que thủy tinh dùng khuấy dung dịch. Kéo thả vào cốc hoặc bình có dung dịch rồi bấm "Khuấy".',
    [['Chiều dài', '≈ 200 mm'], ['Dùng cho', 'Khuấy, dẫn dòng khi rót']],
    'Khuấy nhẹ để tránh làm vỡ cốc.', buildStirringRod),
  glassItem('condenser', 'Liebig condenser', 'Ống sinh hàn',
    'Ống thủy tinh hai lớp: nước lạnh chảy ở lớp ngoài để ngưng tụ hơi trong ống giữa khi chưng cất.',
    [['Chiều dài', '≈ 300 mm'], ['Nước làm mát', 'Vào ở dưới, ra ở trên'], ['Dùng cho', 'Chưng cất, đun hồi lưu']],
    'Mở nước làm mát trước khi bắt đầu đun.', buildCondenser),
];

const equipItem = (id, name, formula, desc, props, safety, build) => ({
  id, category: 'Equipment', name, formula, desc, props, safety, build,
});

export const EQUIPMENT_ITEMS = [
  equipItem('spirit-lamp', 'Spirit lamp', 'Đèn cồn',
    'Đèn đốt cồn có bấc, dùng đun nóng trong phòng thí nghiệm trường học. Ngọn lửa có hiệu ứng chuyển động.',
    [['Nhiên liệu', 'Cồn (etanol)'], ['Ngọn lửa', 'Nhiệt độ thấp hơn đèn Bunsen'], ['Cách tắt', 'Đậy nắp, không thổi']],
    'Không châm đèn từ một đèn cồn khác; không thêm cồn khi đèn đang cháy.', buildSpiritLamp),
  equipItem('hot-plate', 'Hot plate stirrer', 'Bếp gia nhiệt khuấy từ',
    'Bếp điện có mặt gia nhiệt và bộ khuấy từ. Cắm điện vào ổ trên kệ sau bàn, bật máy, rồi đặt cốc hoặc bình lên mặt bếp để đun nóng và khuấy.',
    [['Nhiệt độ', 'Điều chỉnh bằng núm'], ['Khuấy từ', 'Có, cá từ quay trong bình'], ['Nguồn', 'Điện 220 V (cần cắm điện)']],
    'Mặt bếp vẫn nóng sau khi tắt; không đun dung môi dễ cháy gần bếp.', buildHotPlate),
  equipItem('tripod', 'Tripod with wire gauze', 'Kiềng ba chân và lưới',
    'Kiềng sắt ba chân với lưới thép có lõi gốm. Đặt cốc hoặc bình lên lưới, đặt đèn cồn hoặc đèn Bunsen bên dưới để đun nóng.',
    [['Vật liệu', 'Thép, lõi gốm'], ['Dùng với', 'Đèn cồn, đèn Bunsen']],
    'Kiềng và lưới rất nóng sau khi đun; dùng kẹp để di chuyển.', buildTripod),
  equipItem('thermometer', 'Laboratory thermometer', 'Nhiệt kế',
    'Nhiệt kế thủy tinh chứa chất lỏng màu. Kéo thả vào cốc hoặc bình để đọc nhiệt độ dung dịch.',
    [['Khoảng đo', '−10 °C đến 110 °C'], ['Chất lỏng chỉ thị', 'Cồn nhuộm màu']],
    'Không dùng nhiệt kế để khuấy; báo ngay nếu làm vỡ.', buildThermometer),
  equipItem('tube-holder', 'Test tube holder', 'Kẹp ống nghiệm',
    'Kẹp tay cầm gỗ, đầu kẹp kim loại, dùng giữ ống nghiệm khi đun.',
    [['Vật liệu', 'Gỗ, thép'], ['Vị trí kẹp', 'Khoảng 1/3 ống tính từ miệng']],
    'Kẹp chắc trước khi đun, hướng miệng ống ra xa người.', buildTubeHolder),
  equipItem('spatula', 'Spatula', 'Thìa xúc hóa chất',
    'Thìa kim loại một đầu dẹt, một đầu lõm, dùng lấy hóa chất rắn.',
    [['Vật liệu', 'Thép không gỉ'], ['Dùng cho', 'Lấy hóa chất rắn']],
    'Lau sạch giữa các lần lấy hóa chất khác nhau để tránh nhiễm bẩn.', buildSpatula),
  equipItem('mortar', 'Mortar and pestle', 'Cối chày sứ',
    'Cối và chày bằng sứ, dùng nghiền nhỏ chất rắn.',
    [['Vật liệu', 'Sứ'], ['Dùng cho', 'Nghiền, trộn chất rắn']],
    'Không nghiền chung chất oxi hóa với chất dễ cháy.', buildMortar),
  equipItem('crucible', 'Crucible with lid', 'Chén sứ nung',
    'Chén sứ chịu nhiệt cao kèm nắp, dùng nung chất rắn.',
    [['Dung tích', '≈ 25 mL'], ['Vật liệu', 'Sứ chịu nhiệt'], ['Chịu nhiệt', 'Rất cao']],
    'Dùng kẹp để cầm; để nguội trên lưới, không đặt chén nóng lên mặt bàn lạnh.', buildCrucible),
  equipItem('evaporating-dish', 'Evaporating dish', 'Bát sứ cô cạn',
    'Bát sứ nông, dùng cô cạn dung dịch để thu chất rắn.',
    [['Dung tích', '≈ 60 mL'], ['Vật liệu', 'Sứ'], ['Dùng cho', 'Cô cạn, bay hơi']],
    'Đun nhẹ và khuấy đều để tránh chất lỏng bắn ra.', buildEvaporatingDish),
  equipItem('wash-bottle', 'Wash bottle', 'Bình tia nước cất',
    'Bình nhựa mềm có vòi cong, bóp để phun tia nước cất tráng rửa dụng cụ.',
    [['Dung tích', '500 mL'], ['Chứa', 'Nước cất'], ['Vật liệu', 'Nhựa PE']],
    'Ghi nhãn rõ chất chứa bên trong.', buildWashBottle),
  equipItem('magnetic-stirrer', 'Magnetic stirrer', 'Máy khuấy từ',
    'Máy khuấy từ không gia nhiệt. Cắm điện, bật máy rồi đặt cốc hoặc bình tam giác có dung dịch lên mặt máy: cá từ trong bình quay để khuấy đều.',
    [['Tốc độ', 'Điều chỉnh bằng núm'], ['Gia nhiệt', 'Không'], ['Nguồn', 'Điện 220 V (cần cắm điện)']],
    'Tăng tốc độ từ từ để cá từ không văng; không dùng cho bình đáy tròn.', buildMagneticStirrer),
  equipItem('heating-mantle', 'Heating mantle', 'Bếp bọc gia nhiệt',
    'Bếp có lòng bát ôm sát bình cầu, đun nóng đều mà không dùng ngọn lửa. Cắm điện, bật máy rồi đặt bình cầu hoặc bình cầu có nhánh vào lòng bếp.',
    [['Dùng với', 'Bình cầu, bình cầu có nhánh'], ['Ưu điểm', 'Không có lửa trần, nóng đều'], ['Nguồn', 'Điện 220 V (cần cắm điện)']],
    'Không bật khi bình rỗng; lòng bếp rất nóng sau khi tắt.', buildHeatingMantle),
  equipItem('ph-meter', 'pH meter', 'Máy đo pH',
    'Máy đo pH để bàn với điện cực thủy tinh. Cắm điện, bật máy, rồi chọn bình cần đo trong bảng thông tin.',
    [['Khoảng đo', 'pH 0 – 14'], ['Hiệu chuẩn', 'Dung dịch đệm pH 4, 7, 10'], ['Nguồn', 'Điện 220 V (cần cắm điện)']],
    'Rửa điện cực bằng nước cất giữa các lần đo; không để điện cực khô.', buildPhMeter),
];

// Các mục có lòng bình nhận được hóa chất (ngoài beaker, erlenmeyer đã có)
export const VESSEL_IDS = Object.keys(VESSEL_SPECS);

// Miệng bình/chai (tọa độ mô hình gốc): dùng để nghiêng rót quanh miệng
const BOTTLE_MOUTH = { r: 0.22, y: 1.8 };
export const MOUTHS = {
  ...Object.fromEntries(LIQUID_ITEMS.map((i) => [i.id, BOTTLE_MOUTH])),
  phenolphthalein: { r: 0.15, y: 1.05 },
  testtube: { r: 0.15, y: 1.8 },
  'graduated-cylinder': { r: 0.22, y: 2.5 },
  'volumetric-flask': { r: 0.09, y: 2.5 },
  'distilling-flask': { r: 0.17, y: 2.7 },
  'filter-flask': { r: 0.28, y: 2.12 },
  crucible: { r: 0.38, y: 0.62 },
  'evaporating-dish': { r: 0.62, y: 0.3 },
  burette: { r: 0.08, y: 5.25 },
  'separatory-funnel': { r: 0.1, y: 3.6 },
  funnel: { r: 0.36, y: 2.62 },
};

// Đầu ra ở đáy (buret, phễu chiết, cuống phễu)
export const TIPS = {
  burette: { y: 2.25 },
  'separatory-funnel': { y: 1.45 },
  funnel: { y: 1.55 },
};
