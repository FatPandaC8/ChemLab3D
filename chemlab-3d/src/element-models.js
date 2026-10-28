// ============================================================
// ChemLab 3D — Mô hình 3D cho mẫu nguyên tố lấy từ bảng tuần hoàn
// Tạo bằng hình học Three.js có sẵn (không dùng dịch vụ ngoài).
// Màu sắc mang tính minh họa, không phải ảnh chụp mẫu thật.
// ============================================================
import * as THREE from 'three';
import { getElementKind, CATEGORY_INFO, PHASE_LABEL_VI } from './elements.js';
import { ELEMENT_ITEM_PREFIX, formulaUnit, molarMass, fmtQ, amountLabel, isRadioactive } from './quantity.js';

// ------------------------------------------------------------
// Vật liệu & hình khối
// ------------------------------------------------------------
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, ...o });

const glassMat = () =>
  new THREE.MeshPhysicalMaterial({
    color: 0xcfe8ff,
    transparent: true,
    opacity: 0.22,
    roughness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
    clearcoat: 1,
  });

const fillMat = (color, opacity) =>
  new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

const lathe = (pts, mat, seg = 40) =>
  new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat);

function boxAt(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}

function cylAt(r, h, mat, y = 0, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.y = y + h / 2;
  return m;
}

// Số giả ngẫu nhiên cố định theo nguyên tố, để mô hình giống nhau mỗi lần tải lại
function seeded(seed) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// ------------------------------------------------------------
// Màu minh họa
// ------------------------------------------------------------
const APPEARANCE = {
  cu: 0xc8743a, au: 0xd4af37, cs: 0xd9c48a, os: 0x9aa8bd, bi: 0xc9b9c4,
  c: 0x2b2b2b, p: 0xefe9d8, s: 0xf2d21b, se: 0x5f6368, i: 0x3b2a4a,
  b: 0x3d3d3d, si: 0x6b7280, ge: 0x8a8f96, as: 0x6b6f75, sb: 0xa7adb5,
  te: 0x9ca3af, at: 0x3a3a3a, br: 0x7a1f12, hg: 0xc9ccd2,
};
const METAL_DEFAULT = 0xb9bfc7;
const NONMETAL_DEFAULT = 0x8b93a1;
const GAS_FILL = { cl: [0xbcd65a, 0.35], f: [0xe8e49a, 0.22] };

export function elementColor(el) {
  if (APPEARANCE[el.id] != null) return APPEARANCE[el.id];
  return getElementKind(el) === 'metal' ? METAL_DEFAULT : NONMETAL_DEFAULT;
}

// Màu chất lỏng khi mẫu nguyên tố lỏng được cho vào cốc (Br, Hg)
export function elementLiquidColor(itemId) {
  if (typeof itemId !== 'string' || !itemId.startsWith(ELEMENT_ITEM_PREFIX)) return null;
  const id = itemId.slice(ELEMENT_ITEM_PREFIX.length);
  return id === 'br' || id === 'hg' ? APPEARANCE[id] : null;
}

// ------------------------------------------------------------
// Nhãn nổi: ký hiệu + lượng còn lại
// ------------------------------------------------------------
// Nhãn nổi dùng chung: dòng tiêu đề (ký hiệu + lượng) và dòng phụ.
// Luôn vẽ trên cùng để không bị vật khác che; chữ tự thu nhỏ khi dài.
export function makeAmountLabel(title, subtitle) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const r = 22;
    ctx.fillStyle = 'rgba(13, 17, 23, 0.88)';
    ctx.strokeStyle = 'rgba(79, 156, 255, 0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(r, 2);
    ctx.arcTo(318, 2, 318, 118, r);
    ctx.arcTo(318, 118, 2, 118, r);
    ctx.arcTo(2, 118, 2, 2, r);
    ctx.arcTo(2, 2, 318, 2, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    const fit = (text, weight, size, maxW) => {
      let s = size;
      do {
        ctx.font = `${weight} ${s}px -apple-system, system-ui, sans-serif`;
        s -= 2;
      } while (ctx.measureText(text).width > maxW && s > 14);
    };
    ctx.fillStyle = '#e6edf3';
    fit(title, 700, 46, 292);
    ctx.fillText(title, 160, 58);
    ctx.fillStyle = '#8b98a9';
    fit(subtitle, 500, 26, 292);
    ctx.fillText(subtitle, 160, 96);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true })
  );
  sprite.scale.set(1.6, 0.6, 1);
  sprite.renderOrder = 20;
  sprite.name = 'sample-label';
  return sprite;
}

function makeLabel(el, sample) {
  const title = sample ? `${el.symbol}  ${amountLabel(sample.amount, sample.unit)}` : el.symbol;
  let sub = el.nameVi;
  if (sample && sample.amount <= 0) sub = 'Đã dùng hết';
  else if (sample?.illustrative || isRadioactive(el)) sub = '☢ Mẫu minh họa';
  return makeAmountLabel(title, sub);
}

// ------------------------------------------------------------
// Mô hình theo trạng thái
// ------------------------------------------------------------
function sizeFactor(sample) {
  if (!sample || sample.massG == null) return 0.8;
  return THREE.MathUtils.clamp(0.55 + 0.2 * Math.log10(sample.massG + 1), 0.5, 1.05);
}

function remainingFraction(sample) {
  if (!sample || !sample.initialAmount) return 0.7;
  return THREE.MathUtils.clamp(sample.amount / sample.initialAmount, 0, 1);
}

function buildSolidPiece(el, s, rand) {
  const g = new THREE.Group();
  const color = elementColor(el);
  if (getElementKind(el) === 'metal') {
    const mat = std(color, { metalness: 0.85, roughness: 0.32 });
    g.add(boxAt(0.8 * s, 0.26 * s, 0.5 * s, mat));
    g.add(boxAt(0.45 * s, 0.18 * s, 0.32 * s, mat, 0.08 * s, 0.26 * s, 0));
  } else {
    const mat = std(color, { roughness: 0.65, metalness: getElementKind(el) === 'metalloid' ? 0.35 : 0, flatShading: true });
    for (let i = 0; i < 6; i++) {
      const r = (0.14 + rand() * 0.12) * s;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
      const a = rand() * Math.PI * 2;
      const d = i === 0 ? 0 : (0.18 + rand() * 0.18) * s;
      m.position.set(Math.cos(a) * d, r * 0.85, Math.sin(a) * d);
      m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      g.add(m);
    }
  }
  return g;
}

function buildSolidSample(el, sample) {
  const g = new THREE.Group();
  const rand = seeded(el.atomicNumber);
  const s = sizeFactor(sample);
  const storedInLiquid =
    el.category === 'alkali-metal' ? [0xd9a441, 0.35] : el.id === 'p' ? [0x9cc9ff, 0.3] : null;

  if (storedInLiquid) {
    // Kim loại kiềm bảo quản trong dầu, photpho trắng bảo quản trong nước
    g.add(lathe([[0, 0], [0.62, 0], [0.62, 1.2], [0.66, 1.24]], glassMat()));
    g.children[0].renderOrder = 2;
    const liquid = lathe([[0, 0.03], [0.59, 0.03], [0.59, 0.95], [0, 0.95]], fillMat(...storedInLiquid));
    liquid.renderOrder = 1;
    g.add(liquid);
    const lid = cylAt(0.68, 0.1, std(0x3b4350, { roughness: 0.6 }), 1.24);
    lid.name = 'cap';
    g.add(lid);
    const piece = buildSolidPiece(el, Math.min(s, 0.75), rand);
    piece.position.y = 0.04;
    piece.name = 'solid-piece';
    g.add(piece);
  } else {
    // Mặt kính đồng hồ
    const dish = lathe([[0, 0.02], [0.55, 0.06], [0.8, 0.16], [0.83, 0.18]], glassMat());
    dish.renderOrder = 2;
    g.add(dish);
    const empty = sample && sample.amount <= 0;
    if (!empty) {
      const piece = buildSolidPiece(el, s, rand);
      piece.position.y = 0.04;
      piece.name = 'solid-piece'; // nhỏ dần khi thả hạt vào bình
      g.add(piece);
    }
  }
  return g;
}

function buildLiquidSample(el, sample) {
  const g = new THREE.Group();
  const bottle = lathe([[0, 0], [0.5, 0], [0.5, 1.0], [0.2, 1.3], [0.2, 1.55]], glassMat());
  bottle.renderOrder = 2;
  g.add(bottle);
  const level = 0.04 + 0.86 * remainingFraction(sample);
  if (level > 0.06) {
    const mat =
      el.id === 'hg'
        ? std(APPEARANCE.hg, { metalness: 1, roughness: 0.12 })
        : fillMat(elementColor(el), 0.85);
    const liquid = lathe([[0, 0.03], [0.47, 0.03], [0.47, level], [0, level]], mat);
    liquid.renderOrder = 1;
    liquid.name = 'stock-liquid';
    g.add(liquid);
  }
  const cap = cylAt(0.24, 0.24, std(0x2a2f38, { roughness: 0.6 }), 1.55);
  cap.name = 'cap';
  g.add(cap);
  return g;
}

function buildGasSample(el, sample) {
  const g = new THREE.Group();
  const jar = lathe([[0, 0], [0.55, 0], [0.55, 1.6], [0.6, 1.63]], glassMat());
  jar.renderOrder = 2;
  g.add(jar);
  const [color, opacity] = GAS_FILL[el.id] ?? [0xdfefff, 0.08];
  const gas = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.52, 1.52, 32),
    fillMat(color, opacity * (0.3 + 0.7 * remainingFraction(sample)))
  );
  gas.position.y = 0.8;
  gas.renderOrder = 1;
  g.add(gas);
  // Tấm kính đậy miệng bình
  const lid = cylAt(0.68, 0.04, glassMat(), 1.63);
  lid.renderOrder = 2;
  g.add(lid);
  return g;
}

export function buildElementSampleModel(el, sample) {
  const g = new THREE.Group();
  const body =
    el.phase === 'gas' ? buildGasSample(el, sample) : el.phase === 'liquid' ? buildLiquidSample(el, sample) : buildSolidSample(el, sample);
  g.add(body);

  // Nguyên tố phóng xạ: thêm vòng màu vàng cảnh báo dưới đế
  if (isRadioactive(el) || el.atomicNumber >= 104) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.035, 8, 48), std(0xfacc15, { emissive: 0x3a2a00 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
  }

  const box = new THREE.Box3().setFromObject(body);
  const label = makeLabel(el, sample);
  label.position.y = box.max.y + 0.45;
  g.add(label);
  return g;
}

// Miệng vật chứa mẫu (tọa độ mô hình gốc), dùng khi nghiêng rót / đổ chất rắn
export function elementMouth(el) {
  if (el.phase === 'gas') return null;
  if (el.phase === 'liquid') return { r: 0.2, y: 1.55 };
  if (el.category === 'alkali-metal' || el.id === 'p') return { r: 0.6, y: 1.24 };
  return { r: 0.75, y: 0.18 };
}

// Lớp hạt chất rắn dưới đáy cốc/bình sau khi cho mẫu vào
export function buildVesselDeposit(entries) {
  const g = new THREE.Group();
  g.name = 'solid-deposit';
  entries.forEach(({ el, massG }, k) => {
    if (!el) return;
    const rand = seeded(el.atomicNumber + k * 31);
    const count = THREE.MathUtils.clamp(Math.round(2 + 2 * Math.log10(massG + 1)), 2, 7);
    const mat = std(elementColor(el), {
      metalness: getElementKind(el) === 'metal' ? 0.8 : 0.1,
      roughness: 0.5,
      flatShading: true,
    });
    for (let i = 0; i < count; i++) {
      const r = 0.06 + rand() * 0.06;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat);
      const a = rand() * Math.PI * 2;
      const d = rand() * 0.35;
      m.position.set(Math.cos(a) * d, 0.06 + r * 0.6, Math.sin(a) * d);
      m.scale.y = 0.6;
      g.add(m);
    }
  });
  return g;
}

// ------------------------------------------------------------
// Mục dùng chung với itemById (để chọn, xem thông tin, lưu, tải)
// ------------------------------------------------------------
export function createElementItem(el) {
  const unit = formulaUnit(el);
  const phase = `${PHASE_LABEL_VI[el.phase]}${el.phasePredicted ? ' (dự đoán)' : ''}`;
  return {
    id: ELEMENT_ITEM_PREFIX + el.id,
    elementId: el.id,
    category: 'Element',
    name: `${el.nameVi} (${el.symbol})`,
    formula: `${el.name} · ${unit.formula} · Z = ${el.atomicNumber}`,
    desc: el.highlight,
    props: [
      ['Phân loại', CATEGORY_INFO[el.category].label],
      ['Trạng thái (≈ 25 °C, 1 atm)', phase],
      ['Khối lượng mol', `${fmtQ(molarMass(el), 6)} g/mol (${unit.formula})`],
      ['Mô hình', 'Minh họa, màu sắc gần đúng'],
    ],
    safety: el.hazard,
    build: () => buildElementSampleModel(el, null),
  };
}
