// ============================================================
// ChemLab 3D — Không gian phòng thí nghiệm (chỉ phần môi trường)
// Phòng, nội thất, ánh sáng, vật liệu và đồ trang trí nền.
// Không chứa logic thí nghiệm; main.js chỉ gọi các hàm xuất ra ở đây.
//
// Tỉ lệ: 1 đơn vị ≈ 10 cm. Mặt bàn chính ở y = 0 (cao 90 cm so với sàn).
// ============================================================
import * as THREE from 'three';
import { STORAGES } from './lab-storage-defs.js';
import { LIQUID_COLORS } from './lab-models.js';
import { buildPortraits } from './lab-chemists.js';

// ------------------------------------------------------------
// Kích thước phòng
// ------------------------------------------------------------
export const ROOM = {
  floorY: -9, // sàn: thấp hơn mặt bàn 90 cm
  ceilY: 26, // trần cao 3,5 m (có ống kỹ thuật lộ trần)
  x0: -32, // tường trái (có cửa sổ)
  x1: 32, // tường phải (tủ hút, tủ hóa chất, thiết bị)
  z0: -24, // tường sau (quầy bồn rửa, tủ kính)
  z1: 28, // tường trước (cửa ra vào, bảng trắng)
};

// Mặt bàn chính: dài hơn vùng làm thí nghiệm để hai đầu bàn có chỗ để dụng cụ gọn gàng,
// phía sau có kệ đứng (riser) đựng chai lọ
export const BENCH_TOP = { w: 23, d: 11, cz: -1, h: 0.4 };

const { floorY: FY, ceilY: CY, x0: X0, x1: X1, z0: Z0, z1: Z1 } = ROOM;

// ------------------------------------------------------------
// Họa tiết vẽ bằng canvas (không cần tải ảnh ngoài)
// ------------------------------------------------------------
function canvasTexture(size, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  return tex;
}

// số ngẫu nhiên có hạt giống: lần nào mở app cũng giống nhau
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function speckle(ctx, size, base, colors, count, seed, maxR = 1.2) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rnd = seeded(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ctx.globalAlpha = 0.25 + rnd() * 0.5;
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, 0.3 + rnd() * maxR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Sàn vinyl tấm 60 × 60 cm, có lốm đốm và đường ghép
function floorTexture() {
  return canvasTexture(
    512,
    (ctx, s) => {
      speckle(ctx, s, '#c9ccd0', ['#b4b8bd', '#d8dadd', '#a9adb2', '#e4e5e7'], 5200, 7, 1.4);
      ctx.strokeStyle = 'rgba(120,125,132,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, s - 2, s - 2);
    },
    { repeat: [(X1 - X0) / 6, (Z1 - Z0) / 6] }
  );
}

// Mặt bàn epoxy màu than chì, hạt li ti
function epoxyTexture(repeat) {
  return canvasTexture(256, (ctx, s) => speckle(ctx, s, '#33373c', ['#3d4248', '#2c3034', '#464b51'], 2400, 11, 0.9), {
    repeat,
  });
}

// Sơn tường: rất nhạt, chỉ tạo cảm giác bề mặt thật
function wallTexture() {
  return canvasTexture(256, (ctx, s) => speckle(ctx, s, '#eceeef', ['#e4e6e8', '#f3f4f5'], 3000, 3, 1.6), {
    repeat: [8, 4],
  });
}

// Trần tấm thạch cao 60 × 60 cm
function ceilingTexture() {
  return canvasTexture(
    256,
    (ctx, s) => {
      speckle(ctx, s, '#f1f2f3', ['#e6e7e9', '#f7f7f8'], 1800, 5, 1.2);
      ctx.strokeStyle = 'rgba(160,165,170,0.9)';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, s, s);
    },
    { repeat: [(X1 - X0) / 6, (Z1 - Z0) / 6] }
  );
}

// Bầu trời và cảnh bên ngoài cửa sổ: phòng lab ở tầng cao, nhìn ra trời và mái nhà xa,
// màu nhạt và mờ như ảnh chụp phơi sáng theo trong phòng
function outsideTexture() {
  return canvasTexture(
    1024,
    (ctx, s) => {
      const sky = ctx.createLinearGradient(0, 0, 0, s);
      sky.addColorStop(0, '#a9cdee');
      sky.addColorStop(0.5, '#d7e7f5');
      sky.addColorStop(0.8, '#eef4f9');
      sky.addColorStop(1, '#f4f6f8');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, s, s);
      const rnd = seeded(21);
      // mây mỏng
      ctx.filter = 'blur(18px)';
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.ellipse(rnd() * s, 80 + rnd() * 260, 120 + rnd() * 160, 25 + rnd() * 30, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // các khối nhà xa, rất nhạt
      ctx.filter = 'blur(3px)';
      let x = -20;
      while (x < s) {
        const w = 60 + rnd() * 110;
        const h = 40 + rnd() * 150;
        const tone = 200 + rnd() * 25;
        ctx.fillStyle = `rgb(${tone - 8},${tone - 2},${tone + 6})`;
        ctx.fillRect(x, s * 0.86 - h, w, h + s);
        // hàng cửa sổ của tòa nhà
        ctx.fillStyle = `rgba(150,170,195,0.35)`;
        for (let yy = s * 0.86 - h + 10; yy < s * 0.86 - 8; yy += 16) {
          for (let xx = x + 8; xx < x + w - 10; xx += 14) ctx.fillRect(xx, yy, 7, 8);
        }
        x += w + 6 + rnd() * 30;
      }
      // tán cây thấp, nhạt
      ctx.filter = 'blur(10px)';
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = `rgba(${150 + rnd() * 30},${180 + rnd() * 25},${150 + rnd() * 20},0.75)`;
        ctx.beginPath();
        ctx.arc(rnd() * s, s * 0.9 + rnd() * 30, 30 + rnd() * 40, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.filter = 'none';
    },
    { repeat: [1, 1] }
  );
}

// Bảng trắng: vẽ lại được (người dùng viết thêm ghi chú)
export const DEFAULT_BOARD = ['2H₂ + O₂ → 2H₂O', 'n = m / M', 'C_M = n / V', 'pH = −log[H⁺]', '• Đeo kính bảo hộ', '• Rửa dụng cụ sau khi dùng'];
function whiteboardTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const colors = ['#1f4fa8', '#1f4fa8', '#b3261e', '#1d1d1d', '#1d1d1d', '#1d1d1d'];
  tex.userData.draw = (lines) => {
    ctx.fillStyle = '#fbfbfb';
    ctx.fillRect(0, 0, 1024, 512);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.moveTo(80, 470);
    ctx.lineTo(420, 440);
    ctx.stroke(); // vết lau mờ
    const list = lines.slice(0, 10);
    const col2 = list.length > 5;
    list.forEach((line, i) => {
      const left = col2 && i >= 5;
      const row = left ? i - 5 : i;
      ctx.font = `italic ${col2 ? 36 : 42}px "Segoe Print", "Comic Sans MS", cursive`;
      ctx.fillStyle = colors[i % colors.length];
      let text = String(line);
      while (ctx.measureText(text).width > (col2 ? 440 : 900) && text.length > 3) text = text.slice(0, -2) + '…';
      ctx.fillText(text, left ? 540 : 50, 90 + row * (col2 ? 82 : 80));
    });
    tex.needsUpdate = true;
  };
  tex.userData.draw(DEFAULT_BOARD);
  return tex;
}

// Bóng tiếp xúc mềm (giả lập ambient occlusion dưới đồ vật)
function contactShadowTexture() {
  return canvasTexture(
    128,
    (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.25)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
    { srgb: false }
  );
}

// Dải bóng dọc chân tường / góc phòng
function edgeShadowTexture() {
  return canvasTexture(
    64,
    (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(0,0,0,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
    { srgb: false }
  );
}

// Mặt đồng hồ treo tường: vẽ lại theo giờ thật
function clockTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.draw = (date = new Date()) => {
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(128, 128, 126, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#222';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.lineWidth = i % 3 === 0 ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(128 + Math.sin(a) * 100, 128 - Math.cos(a) * 100);
      ctx.lineTo(128 + Math.sin(a) * 116, 128 - Math.cos(a) * 116);
      ctx.stroke();
    }
    const hand = (a, len, w) => {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len);
      ctx.stroke();
    };
    const h = date.getHours() % 12;
    const m = date.getMinutes();
    const sec = date.getSeconds();
    hand(((h + m / 60) / 12) * Math.PI * 2, 60, 9);
    hand(((m + sec / 60) / 60) * Math.PI * 2, 92, 6);
    ctx.strokeStyle = '#c62828';
    hand((sec / 60) * Math.PI * 2, 100, 2);
    tex.needsUpdate = true;
  };
  tex.userData.draw();
  return tex;
}

// Biển báo nhỏ (rửa mắt khẩn cấp, lối thoát...)
function signTexture(text, bg, fg = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 192);
  ctx.fillStyle = fg;
  ctx.font = 'bold 62px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------
// Vật liệu dùng chung (tạo một lần)
// ------------------------------------------------------------
function createMaterials() {
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
  const M = {
    wall: std(0xe9edf0, { map: wallTexture(), roughness: 0.92 }),
    floor: std(0xffffff, { map: floorTexture(), roughness: 0.48, envMapIntensity: 0.7 }),
    ceiling: std(0xffffff, { map: ceilingTexture(), roughness: 0.95 }),
    baseboard: std(0x5d636a, { roughness: 0.7 }),
    epoxy: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: epoxyTexture([6, 3]),
      roughness: 0.36,
      clearcoat: 0.6,
      clearcoatRoughness: 0.22,
    }),
    epoxyCounter: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: epoxyTexture([10, 1.2]),
      roughness: 0.36,
      clearcoat: 0.6,
      clearcoatRoughness: 0.22,
    }),
    laminate: std(0xe3e6e9, { roughness: 0.5 }),
    laminateDoor: std(0xd9dde1, { roughness: 0.42 }),
    cabInterior: std(0xc4c9ce, { roughness: 0.7 }),
    kick: std(0x4a4f56, { roughness: 0.7 }),
    steel: std(0xd3d6da, { metalness: 1, roughness: 0.28 }),
    brushed: std(0xc4c8cc, { metalness: 0.9, roughness: 0.42 }),
    powder: std(0xb9c0c7, { metalness: 0.35, roughness: 0.5 }),
    alu: std(0xe1e4e7, { metalness: 0.75, roughness: 0.38 }),
    darkMetal: std(0x3b4047, { metalness: 0.6, roughness: 0.42 }),
    black: std(0x1c1e21, { roughness: 0.55 }),
    rubber: std(0x232527, { roughness: 0.85 }),
    panelLight: std(0xffffff, { emissive: 0xffffff, emissiveIntensity: 2.4, roughness: 1 }),
    outside: new THREE.MeshBasicMaterial({ map: outsideTexture(), color: 0xffffff }),
    windowGlass: new THREE.MeshPhysicalMaterial({
      color: 0xe6f1fb,
      transparent: true,
      opacity: 0.1,
      roughness: 0.03,
      metalness: 0,
      depthWrite: false,
    }),
    cabinetGlass: new THREE.MeshPhysicalMaterial({
      color: 0xdfeaf2,
      transparent: true,
      opacity: 0.16,
      roughness: 0.05,
      depthWrite: false,
      clearcoat: 1,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xe8f4ff,
      transparent: true,
      opacity: 0.3,
      roughness: 0.04,
      clearcoat: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    amber: new THREE.MeshPhysicalMaterial({ color: 0x7a3e0e, transparent: true, opacity: 0.85, roughness: 0.12, clearcoat: 1 }),
    hdpe: std(0xf4f3ee, { roughness: 0.55 }),
    label: std(0xfafafa, { roughness: 0.8 }),
    capBlue: std(0x1f5fbf, { roughness: 0.45 }),
    capRed: std(0xb83227, { roughness: 0.45 }),
    capBlack: std(0x1d1f22, { roughness: 0.45 }),
    capGreen: std(0x2e7d4f, { roughness: 0.45 }),
    capYellow: std(0xe0b21f, { roughness: 0.45 }),
    liquidBlue: std(0x6ab4e8, { transparent: true, opacity: 0.7, roughness: 0.15 }),
    liquidClear: std(0xd9eef8, { transparent: true, opacity: 0.45, roughness: 0.1 }),
    liquidPink: std(0xe36aa6, { transparent: true, opacity: 0.7, roughness: 0.15 }),
    liquidGreen: std(0x8fd18a, { transparent: true, opacity: 0.7, roughness: 0.15 }),
    liquidAmber: std(0xd99a3c, { transparent: true, opacity: 0.75, roughness: 0.15 }),
    yellowCab: std(0xf0c02c, { metalness: 0.3, roughness: 0.48 }),
    blueCase: std(0x2f6fd0, { roughness: 0.5 }),
    glove: std(0x4a8fe0, { roughness: 0.7 }),
    paper: std(0xfaf8f2, { roughness: 0.9 }),
    notebook: std(0x203a63, { roughness: 0.7 }),
    whiteboard: std(0xffffff, { map: whiteboardTexture(), roughness: 0.25 }),
    clock: std(0xffffff, { map: clockTexture(), roughness: 0.4 }),
    red: std(0xc62828, { roughness: 0.45 }),
    green: std(0x1f8a4c, { roughness: 0.5 }),
    screen: std(0x10161e, { emissive: 0x3d7bd9, emissiveIntensity: 0.35, roughness: 0.3 }),
    displayGreen: std(0x0b1a10, { emissive: 0x41d36b, emissiveIntensity: 0.6, roughness: 0.3 }),
    hoodInterior: std(0xf6f7f8, { emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.6 }),
    contact: new THREE.MeshBasicMaterial({
      map: contactShadowTexture(),
      transparent: true,
      depthWrite: false,
      color: 0x000000,
      alphaMap: null,
    }),
    edgeShadow: new THREE.MeshBasicMaterial({ map: edgeShadowTexture(), transparent: true, depthWrite: false, color: 0x000000 }),
  };
  // bóng tiếp xúc dùng kênh alpha của họa tiết
  M.contact.alphaMap = M.contact.map;
  M.contact.map = null;
  M.contact.opacity = 1;
  M.edgeShadow.alphaMap = M.edgeShadow.map;
  M.edgeShadow.map = null;
  return M;
}

// ------------------------------------------------------------
// Hàm dựng hình nhỏ
// ------------------------------------------------------------
function box(parent, w, h, d, mat, x, y, z, { cast = false, receive = true, ry = 0 } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}

function cyl(parent, rt, rb, h, mat, x, y, z, { seg = 24, cast = false, rx = 0, rz = 0 } = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, 0, rz);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function plane(parent, w, h, mat, x, y, z, rx = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Bóng mềm nằm trên mặt sàn/mặt bàn dưới đồ vật
function contactShadow(parent, M, w, d, x, y, z, opacity = 0.6) {
  const mat = M.contact.clone();
  mat.opacity = opacity;
  const m = plane(parent, w, d, mat, x, y + 0.012, z, -Math.PI / 2);
  m.receiveShadow = false;
  m.renderOrder = -1;
  return m;
}

// Đặt nhiều bản sao cùng hình bằng InstancedMesh (nhẹ cho GPU)
function instances(parent, geo, mat, list, { cast = false } = {}) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const o = new THREE.Object3D();
  list.forEach((t, i) => {
    o.position.set(t[0], t[1], t[2]);
    o.rotation.set(0, t[3] ?? 0, 0);
    const s = t[4] ?? 1;
    o.scale.set(s, t[5] ?? s, s);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
  });
  im.castShadow = cast;
  im.receiveShadow = true;
  parent.add(im);
  return im;
}

// Hình dụng cụ thủy tinh đơn giản cho đồ trang trí nền
const DECOR_GEO = {
  beaker: new THREE.LatheGeometry(
    [
      [0, 0],
      [0.6, 0],
      [0.62, 0.05],
      [0.62, 1.75],
      [0.68, 1.82],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    28
  ),
  flask: new THREE.LatheGeometry(
    [
      [0, 0],
      [0.62, 0],
      [0.66, 0.08],
      [0.25, 1.35],
      [0.22, 1.5],
      [0.22, 1.95],
      [0.26, 2.0],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    28
  ),
  bottle: new THREE.LatheGeometry(
    [
      [0, 0],
      [0.42, 0],
      [0.45, 0.06],
      [0.45, 1.25],
      [0.36, 1.45],
      [0.17, 1.55],
      [0.17, 1.72],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    24
  ),
  cylinder: new THREE.LatheGeometry(
    [
      [0, 0],
      [0.16, 0],
      [0.16, 2.3],
      [0.2, 2.36],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    18
  ),
  hdpe: new THREE.CylinderGeometry(0.42, 0.42, 1.5, 20),
  cap: new THREE.CylinderGeometry(0.19, 0.19, 0.22, 16),
  bigCap: new THREE.CylinderGeometry(0.28, 0.28, 0.24, 16),
  label: new THREE.CylinderGeometry(0.455, 0.455, 0.6, 24, 1, true),
  liquid: new THREE.CylinderGeometry(0.4, 0.4, 1, 20),
  dish: new THREE.CylinderGeometry(0.48, 0.48, 0.12, 24),
};


// ------------------------------------------------------------
// Đồ vật tương tác: đánh dấu để click được và không bị gộp lưới
// ------------------------------------------------------------
function makeRegistry() {
  return { items: [], storages: {}, refs: {} };
}
function interactive(R, obj, kind, data = {}) {
  obj.userData.interactive = { kind, ...data };
  obj.userData.noMerge = true;
  R.items.push(obj);
  return obj;
}
function addStoragePart(R, storageId, part) {
  if (!R.storages[storageId]) R.storages[storageId] = { id: storageId, parts: [], anchor: null };
  const st = R.storages[storageId];
  st.parts.push(part);
  if (!st.anchor) st.anchor = part.anchor;
  return part;
}

// Nhãn tên tủ: chữ trên nền trắng, dải màu theo nhóm hóa chất
const labelCache = new Map();
function labelMaterial(text, tag = '#64748b') {
  const key = `${text}|${tag}`;
  if (labelCache.has(key)) return labelCache.get(key);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = tag;
  ctx.fillRect(0, 0, 26, 128);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 508, 124);
  ctx.fillStyle = '#1d1f22';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 54;
  ctx.font = `bold ${size}px Inter, Arial, sans-serif`;
  while (ctx.measureText(text).width > 450 && size > 22) {
    size -= 2;
    ctx.font = `bold ${size}px Inter, Arial, sans-serif`;
  }
  ctx.fillText(text, 270, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
  labelCache.set(key, m);
  return m;
}

// Nhãn chai hóa chất (công thức + nồng độ)
function bottleLabelMaterial(chemId, line2 = '') {
  return labelMaterial(`${CHEM_LABELS[chemId] ?? chemId}${line2 ? ' ' + line2 : ''}`, CHEM_TAGS[chemId] ?? '#64748b');
}
const CHEM_LABELS = {
  water: 'H₂O cất', hcl: 'HCl 37%', naoh: 'NaOH 1M', cuso4: 'CuSO₄ 0,5M', ethanol: 'C₂H₅OH', hno3: 'HNO₃ 65%',
  h2so4: 'H₂SO₄ 98%', ch3cooh: 'CH₃COOH 1M', nh3: 'NH₃ 25%', agno3: 'AgNO₃ 0,1M', bacl2: 'BaCl₂ 0,1M',
  na2co3: 'Na₂CO₃ 0,5M', kmno4: 'KMnO₄ 0,02M', h2o2: 'H₂O₂ 3%', fecl3: 'FeCl₃ 0,1M', phenolphthalein: 'Phenolphtalein',
  o2: 'O₂', h2: 'H₂', co2: 'CO₂', methane: 'CH₄', so2: 'SO₂',
  hcl_dil: 'HCl 2M', h2so4_dil: 'H₂SO₄ 1M', brwater: 'Nước brom', glucose: 'Glucozơ 10%', caco3: 'CaCO₃ đá vôi', litmus: 'Giấy quỳ',
};
const CHEM_TAGS = {
  hcl: '#e11d48', hno3: '#e11d48', h2so4: '#e11d48', ch3cooh: '#e11d48', hcl_dil: '#e11d48', h2so4_dil: '#e11d48', brwater: '#ca8a04', naoh: '#2563eb', nh3: '#2563eb',
  ethanol: '#dc2626', kmno4: '#ca8a04', h2o2: '#ca8a04', water: '#0284c7',
};
// chai nâu cho chất nhạy sáng, chai nhựa cho bazơ, còn lại chai thủy tinh trong
const BOTTLE_TYPE = { hno3: 'amber', agno3: 'amber', kmno4: 'amber', h2o2: 'amber', brwater: 'amber', naoh: 'hdpe', nh3: 'hdpe', water: 'hdpe', caco3: 'hdpe', litmus: 'hdpe' };

// Chai hóa chất có thật chất bên trong: thân, nắp, nhãn, mức chất lỏng theo màu hóa chất
const liquidMatCache = new Map();
const LABEL_GEO = new THREE.CylinderGeometry(0.46, 0.46, 0.5, 20, 1, true, -0.95, 1.9);
function chemBottle(R, M, chemId, { scale = 1, kind = 'shelfBottle', data = {} } = {}) {
  const type = BOTTLE_TYPE[chemId] ?? 'clear';
  const g = new THREE.Group();
  const body = new THREE.Mesh(type === 'hdpe' ? DECOR_GEO.hdpe : DECOR_GEO.bottle, type === 'amber' ? M.amber : type === 'hdpe' ? M.hdpe : M.glass);
  if (type === 'hdpe') body.position.y = 0.75;
  const color = LIQUID_COLORS[chemId] ?? 0xd9eef8;
  if (type !== 'hdpe') {
    const key = `${color}|${type}`;
    if (!liquidMatCache.has(key)) {
      liquidMatCache.set(key, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: type === 'amber' ? 0.55 : 0.72, roughness: 0.15 }));
    }
    const liq = new THREE.Mesh(DECOR_GEO.liquid, liquidMatCache.get(key));
    liq.scale.set(1, 0.95, 1);
    liq.position.y = 0.53;
    liq.renderOrder = 1;
    body.renderOrder = 2;
    g.add(liq);
  }
  const cap = new THREE.Mesh(type === 'hdpe' ? DECOR_GEO.bigCap : DECOR_GEO.cap, CHEM_TAGS[chemId] === '#e11d48' ? M.capRed : type === 'hdpe' ? M.capBlue : M.capBlack);
  cap.position.y = type === 'hdpe' ? 1.62 : 1.83;
  const label = new THREE.Mesh(LABEL_GEO, bottleLabelMaterial(chemId));
  label.position.y = 0.68;
  label.rotation.y = 0; // nhãn quay ra phía trước (+z cục bộ)
  g.add(body, cap, label);
  g.scale.setScalar(scale);
  g.traverse((o) => o.isMesh && (o.castShadow = kind !== null));
  if (kind) interactive(R, g, kind, { chem: chemId, ...data });
  return g;
}

// Vùng bấm vô hình quanh một món đồ trong tủ (không tốn lệnh vẽ, chỉ để click)
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
function hitbox(R, parent, w, h, d, x, y, z, kind, data) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HIT_MAT);
  m.position.set(x, y, z);
  parent.add(m);
  interactive(R, m, kind, data);
  return m;
}

// Đồ bên trong tủ theo loại; mỗi món có vùng bấm để lấy ra
function fillInterior(R, M, parent, decor, items, w, d, y, storage = null) {
  const pick = (i) => (items.length ? items[i % items.length] : null);
  const hit = (i, bw, bh, bd, x, yy, z) => {
    const item = pick(i);
    if (storage && item) hitbox(R, parent, bw, bh, bd, x, yy, z, 'cabinetItem', { item, storage });
  };
  const rnd = seeded(Math.round(w * 97 + d * 13 + y * 7));
  if (decor === 'chem') {
    const n = Math.max(2, Math.min(6, items.length * 2));
    for (let i = 0; i < n; i++) {
      const chem = items[i % items.length];
      const b = chemBottle(R, M, chem, { scale: 0.62, kind: null });
      b.position.set(-w / 2 + 0.5 + (i * (w - 1)) / Math.max(1, n - 1), y, -d * 0.45 + (i % 2) * 0.5);
      parent.add(b);
      hit(i, 0.7, 1.2, 0.7, b.position.x, y + 0.6, b.position.z);
    }
  } else if (decor === 'glass') {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(i % 2 ? DECOR_GEO.flask : DECOR_GEO.cylinder, M.glass);
      m.position.set(-w / 2 + 0.7 + i * ((w - 1.4) / 3), y, -d * 0.45);
      m.scale.setScalar(0.6);
      parent.add(m);
      hit(i, 0.8, 1.3, 0.8, m.position.x, y + 0.65, m.position.z);
    }
  } else if (decor === 'equip') {
    for (let i = 0; i < 3; i++) {
      const bx = new THREE.Mesh(new THREE.BoxGeometry(0.9 + rnd() * 0.5, 0.6 + rnd() * 0.6, 1.0), i % 2 ? M.laminate : M.darkMetal);
      bx.position.set(-w / 2 + 0.8 + i * ((w - 1.6) / 2), y + 0.4, -d * 0.45);
      parent.add(bx);
      hit(i, 1.4, 1.2, 1.1, bx.position.x, y + 0.5, bx.position.z);
    }
  } else if (decor === 'tools') {
    for (let i = 0; i < 5; i++) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 8), i % 2 ? M.steel : M.glass);
      r.rotation.z = Math.PI / 2;
      r.position.set(0, y + 0.06, -d * 0.2 - i * 0.28);
      parent.add(r);
      hit(i, 1.7, 0.2, 0.26, 0, y + 0.08, r.position.z);
    }
  } else if (decor === 'ppe') {
    const goggles = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.06, 8, 20), M.capBlue);
    goggles.rotation.x = Math.PI / 2;
    goggles.position.set(-0.5, y + 0.07, -d * 0.3);
    const glovesBox = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.7), M.blueCase);
    glovesBox.position.set(0.7, y + 0.25, -d * 0.35);
    parent.add(goggles, glovesBox);
    hitbox(R, parent, 0.8, 0.3, 0.8, -0.5, y + 0.1, -d * 0.3, 'ppeItem', { ppe: 'goggles' });
    hitbox(R, parent, 1.3, 0.6, 0.8, 0.7, y + 0.25, -d * 0.35, 'ppeItem', { ppe: 'gloves' });
  } else if (decor === 'clean') {
    const wb = washBottle(M);
    wb.scale.setScalar(0.7);
    wb.position.set(-0.6, y, -d * 0.4);
    parent.add(wb);
    hit(0, 1.0, 1.4, 1.0, -0.6, y + 0.7, -d * 0.4);
  }
}

// Một khối tủ dưới (cánh hoặc ngăn kéo) có lòng tủ rỗng thật, mặt trước hướng +z cục bộ.
// Đặt ở (x, z) thế giới, xoay ry; y0/y1: đáy và đỉnh mặt trước.
function cabinetUnit(R, M, parent, { x, z, ry = 0, w, d, y0, y1, kind, storage, innerTop = null, label = true }) {
  const U = new THREE.Group();
  U.position.set(x, 0, z);
  U.rotation.y = ry;
  parent.add(U);
  const t = 0.12;
  const h = y1 - y0;
  const top = innerTop ?? y1;
  const def = STORAGES[storage] ?? {};
  // thân tủ rỗng: hai vách, đáy, nóc, lưng
  // vách hai bên (tủ dưới bồn rửa: chỉ cao tới nóc trong, chừa chỗ cho lòng bồn)
  box(U, t, top - y0, d, M.laminate, -w / 2 + t / 2, (y0 + top) / 2, -d / 2);
  box(U, t, top - y0, d, M.laminate, w / 2 - t / 2, (y0 + top) / 2, -d / 2);
  box(U, w, t, d, M.cabInterior, 0, y0 + t / 2, -d / 2);
  box(U, w, t, d, M.cabInterior, 0, top - t / 2, -d / 2);
  box(U, w, top - y0, t, M.cabInterior, 0, (y0 + top) / 2, -d + t / 2);
  const worldAnchor = () => U.localToWorld(new THREE.Vector3(0, (y0 + top) / 2, 0.6));
  const gap = 0.08;
  const handle = (grp, hx, hy, vertical) => {
    const len = vertical ? 1.5 : Math.min(2.0, w * 0.4);
    box(grp, vertical ? 0.1 : len, vertical ? len : 0.1, 0.1, M.steel, hx, hy, 0.24);
    const o = len / 2 - 0.1;
    for (const sgn of [-1, 1]) box(grp, 0.06, 0.06, 0.18, M.steel, vertical ? hx : hx + sgn * o, vertical ? hy + sgn * o : hy, 0.14);
  };
  const plate = (grp, px, py, pw = Math.min(2.4, w * 0.62)) => {
    if (!label || !def.short) return;
    const lp = new THREE.Mesh(new THREE.PlaneGeometry(pw, pw / 4), labelMaterial(def.short, def.tag));
    lp.position.set(px, py, 0.125);
    grp.add(lp);
  };
  if (kind === 'drawers') {
    const n = 4;
    const dh = (top - y0) / n;
    for (let i = 0; i < n; i++) {
      const yc = top - dh * (i + 0.5);
      const D = new THREE.Group();
      D.position.set(0, 0, 0);
      U.add(D);
      box(D, w - gap, dh - gap, 0.12, M.laminateDoor, 0, yc, 0.06);
      // khay ngăn kéo
      const ty = yc - dh / 2 + 0.15;
      box(D, w - 0.4, 0.06, d - 0.5, M.cabInterior, 0, ty, -(d - 0.5) / 2);
      box(D, 0.06, dh * 0.6, d - 0.5, M.cabInterior, -w / 2 + 0.25, ty + dh * 0.3, -(d - 0.5) / 2);
      box(D, 0.06, dh * 0.6, d - 0.5, M.cabInterior, w / 2 - 0.25, ty + dh * 0.3, -(d - 0.5) / 2);
      box(D, w - 0.4, dh * 0.6, 0.06, M.cabInterior, 0, ty + dh * 0.3, -(d - 0.5));
      handle(D, 0, yc + dh * 0.22, false);
      if (i === 0) plate(D, 0, yc - dh * 0.12, Math.min(2.2, w * 0.55));
      if (i < 4) {
        const inner = new THREE.Group();
        inner.position.set(0, 0, 0);
        D.add(inner);
        fillInterior(R, M, inner, def.decor, def.items ?? [], w - 0.6, d - 0.5, ty + 0.03, storage);
      }
      interactive(R, D, 'cabinet', { storage });
      addStoragePart(R, storage, { obj: D, type: 'drawer', axis: 'z', dist: (d - 0.6) * 0.7, anchor: worldAnchor, open: 0, target: 0 });
    }
  } else {
    // nội thất: một tầng kệ + đồ bên trong
    const shelfY = y0 + (top - y0) * 0.5;
    box(U, w - 2 * t, 0.08, d - 0.3, M.cabInterior, 0, shelfY, -d / 2 - 0.1);
    fillInterior(R, M, U, def.decor, def.items ?? [], w - 0.4, d, y0 + t, storage);
    fillInterior(R, M, U, def.decor === 'chem' ? 'chem' : 'none', def.items ?? [], w - 0.4, d, shelfY + 0.04, storage);
    const count = kind === 'door1' ? 1 : 2;
    const dw = w / count;
    for (let i = 0; i < count; i++) {
      const left = i === 0;
      const P = new THREE.Group(); // bản lề ở mép ngoài cánh
      P.position.set(left ? -w / 2 : w / 2, 0, 0.06);
      U.add(P);
      const sx = left ? 1 : -1;
      box(P, dw - gap, h - gap, 0.12, M.laminateDoor, sx * dw / 2, y0 + h / 2, 0);
      handle(P, sx * (dw - 0.45), y1 - 1.5, true);
      if (left) plate(P, sx * dw / 2, y1 - 0.75, Math.min(2.4, dw * 0.85));
      interactive(R, P, 'cabinet', { storage });
      addStoragePart(R, storage, { obj: P, type: 'door', angle: left ? -1.75 : 1.75, anchor: worldAnchor, open: 0, target: 0 });
    }
  }
  return U;
}

// ------------------------------------------------------------
// 1. Vỏ phòng: sàn, tường, trần, len chân tường
// ------------------------------------------------------------
function buildShell(g, M) {
  const W = X1 - X0;
  const D = Z1 - Z0;
  const cx = (X0 + X1) / 2;
  const cz = (Z0 + Z1) / 2;
  plane(g, W, D, M.floor, cx, FY, cz, -Math.PI / 2);
  const ceil = plane(g, W, D, M.ceiling, cx, CY, cz, Math.PI / 2);
  ceil.receiveShadow = false;

  const H = CY - FY;
  const midY = (FY + CY) / 2;
  plane(g, W, H, M.wall, cx, midY, Z0, 0, 0); // tường sau
  plane(g, W, H, M.wall, cx, midY, Z1, 0, Math.PI); // tường trước
  plane(g, D, H, M.wall, X1, midY, cz, 0, -Math.PI / 2); // tường phải

  // len chân tường + dải bóng góc sàn
  const bb = 0.9;
  box(g, W, bb, 0.12, M.baseboard, cx, FY + bb / 2, Z0 + 0.06);
  box(g, W, bb, 0.12, M.baseboard, cx, FY + bb / 2, Z1 - 0.06);
  box(g, 0.12, bb, D, M.baseboard, X1 - 0.06, FY + bb / 2, cz);
  box(g, 0.12, bb, D, M.baseboard, X0 + 0.06, FY + bb / 2, cz);
  const edge = (w, x, z, ry) => {
    const m = plane(g, w, 3, M.edgeShadow, x, FY + 0.01, z, -Math.PI / 2, 0);
    m.rotation.set(-Math.PI / 2, 0, ry);
    m.receiveShadow = false;
  };
  edge(W, cx, Z0 + 1.5, 0);
  edge(W, cx, Z1 - 1.5, Math.PI);
  edge(D, X1 - 1.5, cz, -Math.PI / 2);
  edge(D, X0 + 1.5, cz, Math.PI / 2);
}

// ------------------------------------------------------------
// 2. Tường trái với dãy cửa sổ lớn (ánh sáng tự nhiên)
// ------------------------------------------------------------
function buildWindowWall(g, M, R) {
  const za = -19;
  const zb = 15;
  const ya = FY + 9.5; // bậu cửa sổ cao 95 cm
  const yb = CY - 3;
  const midZ = (za + zb) / 2;
  const H = CY - FY;
  const rotY = Math.PI / 2;
  // phần tường bao quanh ô cửa
  plane(g, za - Z0, H, M.wall, X0, (FY + CY) / 2, (Z0 + za) / 2, 0, rotY);
  plane(g, Z1 - zb, H, M.wall, X0, (FY + CY) / 2, (zb + Z1) / 2, 0, rotY);
  plane(g, zb - za, ya - FY, M.wall, X0, (FY + ya) / 2, midZ, 0, rotY);
  plane(g, zb - za, CY - yb, M.wall, X0, (yb + CY) / 2, midZ, 0, rotY);

  // cảnh ngoài trời (đặt lùi ra sau ô cửa)
  const outside = plane(g, (zb - za) * 1.7, (yb - ya) * 2.2, M.outside, X0 - 14, (ya + yb) / 2 - 2, midZ, 0, rotY);
  outside.receiveShadow = false;
  // hộp tường dày quanh ô cửa
  const depth = 1.2;
  box(g, depth, 0.2, zb - za, M.laminate, X0 - depth / 2, ya - 0.1, midZ); // bậu dưới
  box(g, depth + 0.6, 0.25, zb - za + 0.4, M.laminate, X0 + 0.2, ya + 0.02, midZ); // bậu trong
  box(g, depth, 0.2, zb - za, M.wall, X0 - depth / 2, yb + 0.1, midZ);
  box(g, depth, yb - ya, 0.2, M.wall, X0 - depth / 2, (ya + yb) / 2, za - 0.1);
  box(g, depth, yb - ya, 0.2, M.wall, X0 - depth / 2, (ya + yb) / 2, zb + 0.1);

  // khung nhôm: viền, đố dọc mỗi 4,25 đơn vị, đố ngang ở 2/3 chiều cao
  const fx = X0 - 0.5;
  const t = 0.22;
  box(g, 0.3, t, zb - za, M.alu, fx, ya + t / 2, midZ);
  box(g, 0.3, t, zb - za, M.alu, fx, yb - t / 2, midZ);
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const z = za + ((zb - za) * i) / n;
    box(g, 0.3, yb - ya, t, M.alu, fx, (ya + yb) / 2, z);
  }
  const ym = ya + (yb - ya) * 0.68;
  box(g, 0.3, t, zb - za, M.alu, fx, ym, midZ);
  const pane = plane(g, zb - za, yb - ya, M.windowGlass, fx + 0.05, (ya + yb) / 2, midZ, 0, rotY);
  pane.receiveShadow = false;

  // rèm cuốn (bấm để kéo xuống / cuốn lên)
  R.refs.blinds = { list: [], full: yb - ya - 0.6, short: 2.2 };
  for (let i = 0; i < n; i += 2) {
    const z0 = za + ((zb - za) * i) / n;
    const w = ((zb - za) * 2) / n - 0.3;
    const bl = new THREE.Group();
    bl.position.set(X0 + 0.35, yb - 0.5, z0 + w / 2 + 0.15);
    box(bl, 0.35, 0.5, w, M.laminate, 0, 0.25, 0);
    const fabric = new THREE.Group();
    const cloth = box(fabric, 0.08, 1, w, M.laminateDoor, 0.05, -0.5, 0);
    cloth.castShadow = false;
    fabric.scale.y = 2.2;
    bl.add(fabric);
    box(fabric, 0.12, 0.08, w, M.alu, 0.05, -1.0, 0);
    g.add(bl);
    interactive(R, bl, 'blinds');
    R.refs.blinds.list.push(fabric);
  }
}

// ------------------------------------------------------------
// 3. Trần: đèn LED âm trần, ống kỹ thuật, đầu phun chữa cháy
// ------------------------------------------------------------
function buildCeiling(g, M, R) {
  const lights = [];
  for (const x of [-20, -6, 8, 22]) {
    for (const z of [-15, -2, 11]) lights.push([x, z]);
  }
  const lightGroup = new THREE.Group();
  for (const [x, z] of lights) {
    box(lightGroup, 6.2, 0.18, 6.2, M.alu, x, CY - 0.09, z, { receive: false });
    const p = plane(lightGroup, 5.6, 5.6, M.panelLight, x, CY - 0.2, z, Math.PI / 2);
    p.receiveShadow = false;
  }
  g.add(lightGroup);
  interactive(R, lightGroup, 'lights');
  // đầu phun chữa cháy tự động (sprinkler) và đầu báo khói
  R.refs.sprinklers = [];
  for (const [x, z] of [
    [-13, -8],
    [1, -8],
    [15, -8],
    [-13, 4],
    [1, 4],
    [15, 4],
    [-13, 17],
    [1, 17],
    [15, 17],
  ]) {
    const sp = new THREE.Group();
    cyl(sp, 0.12, 0.2, 0.4, M.steel, x, CY - 0.2, z, { seg: 10 });
    cyl(sp, 0.32, 0.32, 0.04, M.steel, x, CY - 0.42, z, { seg: 14 });
    g.add(sp);
    interactive(R, sp, 'sprinkler');
    R.refs.sprinklers.push(new THREE.Vector3(x, CY - 0.45, z));
  }
  R.refs.detectors = [];
  for (const [x, z] of [
    [-2, -8],
    [-2, 10],
    [20, -2],
  ]) {
    const det = new THREE.Group();
    det.position.set(x, CY - 0.12, z);
    cyl(det, 0.55, 0.55, 0.25, M.laminate, 0, 0, 0, { seg: 24 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0x000000 }));
    led.position.set(0.3, -0.14, 0);
    det.add(led);
    g.add(det);
    interactive(R, det, 'smokeDetector');
    R.refs.detectors.push({ pos: det.position.clone(), led });
  }
}

// ------------------------------------------------------------
// 4. Bàn thí nghiệm chính: tủ dưới, kệ đứng phía sau, van khí/ổ điện
// ------------------------------------------------------------
function cabinetFront(g, M, x0, x1, z, dir, kind) {
  // dir: +1 mặt trước (hướng +z), -1 mặt sau
  const yTop = -BENCH_TOP.h - 0.15;
  const yBot = FY + 1.0;
  const w = x1 - x0;
  const h = yTop - yBot;
  const gap = 0.08;
  const fz = z + dir * 0.06;
  const handle = (x, y, vertical) => {
    const len = vertical ? 1.6 : Math.min(2.2, w * 0.4);
    box(g, vertical ? 0.1 : len, vertical ? len : 0.1, 0.1, M.steel, x, y, fz + dir * 0.18);
    // chân tay nắm
    const o = len / 2 - 0.1;
    for (const s of [-1, 1]) {
      box(g, 0.06, 0.06, 0.2, M.steel, vertical ? x : x + s * o, vertical ? y + s * o : y, fz + dir * 0.09);
    }
  };
  if (kind === 'drawers') {
    const n = 4;
    const dh = h / n;
    for (let i = 0; i < n; i++) {
      const yc = yTop - dh * (i + 0.5);
      box(g, w - gap, dh - gap, 0.12, M.laminateDoor, (x0 + x1) / 2, yc, fz);
      handle((x0 + x1) / 2, yc + dh * 0.25, false);
    }
  } else {
    const half = w / 2;
    for (const s of [0, 1]) {
      const xc = x0 + half * (s + 0.5);
      box(g, half - gap, h - gap, 0.12, M.laminateDoor, xc, yBot + h / 2, fz);
      handle(xc + (s === 0 ? half / 2 - 0.5 : -half / 2 + 0.5), yTop - 1.6, true);
    }
  }
}

function buildMainBench(g, M, R) {
  const x0 = -BENCH_TOP.w / 2 + 0.6;
  const x1 = BENCH_TOP.w / 2 - 0.6;
  const zf = BENCH_TOP.cz + BENCH_TOP.d / 2 - 0.5; // mặt tủ phía trước
  const zb = BENCH_TOP.cz - BENCH_TOP.d / 2 + 0.5; // mặt tủ phía sau
  const zm = BENCH_TOP.cz; // giữa bàn: nửa trước là tủ mở được, nửa sau là khối tủ phía sau
  const yTop = -BENCH_TOP.h;
  const yBot = FY + 1.0;
  // nửa sau: tủ mở được, quay về phía quầy bồn rửa
  // chân đế lùi vào (toe kick)
  box(g, x1 - x0 - 0.6, 1.0, zf - zb - 1.2, M.kick, (x0 + x1) / 2, FY + 0.5, (zf + zb) / 2);
  const sections = [
    [x0, x0 + 5.3, 'drawers', 'b-tools'],
    [x0 + 5.3, x0 + 10.9, 'doors', 'b-frames'],
    [x0 + 10.9, x1 - 5.3, 'doors', 'b-heat'],
    [x1 - 5.3, x1, 'drawers', 'b-safety'],
  ];
  const backStores = { 'b-tools': 'bb-small', 'b-frames': 'bb-glass', 'b-heat': 'bb-dish', 'b-safety': 'bb-heat' };
  for (const [a, b, k, st] of sections) {
    cabinetUnit(R, M, g, { x: (a + b) / 2, z: zf, w: b - a, d: zf - zm, y0: yBot, y1: yTop - 0.15, kind: k, storage: st });
    cabinetUnit(R, M, g, { x: (a + b) / 2, z: zb, ry: Math.PI, w: b - a, d: zm - zb, y0: yBot, y1: yTop - 0.15, kind: k, storage: backStores[st] });
  }
  contactShadow(g, M, BENCH_TOP.w + 3, BENCH_TOP.d + 3, 0, FY, BENCH_TOP.cz, 0.55);

  // kệ đứng phía sau mặt bàn (riser): trụ thép, 1 tầng kệ thấp để không che tầm nhìn ra phòng
  const rz = BENCH_TOP.cz - BENCH_TOP.d / 2 + 1.1; // ≈ -5.4
  for (const x of [-10.6, -3.6, 3.6, 10.6]) {
    box(g, 0.3, 5.0, 0.3, M.powder, x, 2.5, rz - 0.6, { cast: true });
    box(g, 0.3, 5.0, 0.3, M.powder, x, 2.5, rz + 0.6, { cast: true });
  }
  box(g, 21.6, 0.16, 1.9, M.powder, 0, 4.6, rz, { cast: true });
  box(g, 21.6, 0.35, 0.06, M.powder, 0, 4.77, rz + 0.95); // gờ chắn phía trước
  // máng kỹ thuật: ổ điện + van khí/nước trên mặt bàn
  box(g, 21.2, 1.4, 0.5, M.powder, 0, 0.7, rz - 0.75, { cast: true });
  R.refs.outlets = [];
  [-9, -5, -1, 3, 7].forEach((x, i) => {
    const o = new THREE.Group();
    o.position.set(x, 0.75, rz - 0.47);
    box(o, 0.9, 0.6, 0.06, M.laminate, 0, 0, 0);
    for (const dx of [-0.2, 0.2]) box(o, 0.08, 0.2, 0.02, M.black, dx, 0, 0.04);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0x000000 }));
    led.position.set(0.32, 0.2, 0.05);
    led.name = 'led';
    o.add(led);
    g.add(o);
    interactive(R, o, 'outlet', { index: i });
    R.refs.outlets.push({ index: i, obj: o, plug: new THREE.Vector3(x, 0.75, rz - 0.38), led });
  });
  R.refs.valves = [];
  const valve = (x, mat, type, label) => {
    const v = new THREE.Group();
    v.position.set(x, 0, rz);
    cyl(v, 0.12, 0.16, 1.0, M.steel, 0, 0.5, 0.2, { seg: 12 });
    cyl(v, 0.07, 0.07, 0.7, M.steel, 0, 0.95, 0.5, { seg: 10, rx: Math.PI / 2 });
    const lever = new THREE.Group();
    lever.position.set(0, 1.08, 0.2);
    box(lever, 0.5, 0.1, 0.14, mat, 0, 0, 0);
    lever.name = 'lever';
    v.add(lever);
    g.add(v);
    interactive(R, v, 'valve', { index: R.refs.valves.length, type, label });
    R.refs.valves.push({ index: R.refs.valves.length, type, label, obj: v, lever, nozzle: new THREE.Vector3(x, 0.95, rz + 0.85) });
  };
  valve(-7.2, M.capBlue, 'water', 'Van nước làm mát (cho ống sinh hàn)');
  valve(-6.4, M.capYellow, 'gas', 'Van khí đốt (gas) số 1');
  valve(5.2, M.capYellow, 'gas', 'Van khí đốt (gas) số 2');

  // chai hóa chất trên kệ: mỗi chai có hóa chất thật, click để lấy ra bàn
  const shelf = [
    [-10.1, 'hno3'], [-9.2, 'agno3'], [-8.3, 'kmno4'], [-7.3, 'h2o2'],
    [-5.4, 'naoh'], [-4.5, 'nh3'], [-3.6, 'water'],
    [-1.2, 'hcl'], [-0.3, 'h2so4'], [0.6, 'ch3cooh'], [1.6, 'cuso4'], [2.5, 'fecl3'],
    [5.0, 'bacl2'], [5.9, 'na2co3'], [6.9, 'hcl'],
    [8.6, 'ethanol'], [9.5, 'phenolphthalein'], [10.3, 'water'],
  ];
  const rnd = seeded(31);
  for (const [x, chem] of shelf) {
    const b = chemBottle(R, M, chem, { scale: 0.95 + rnd() * 0.12 });
    b.position.set(x, 4.68, rz + (rnd() - 0.5) * 0.4);
    b.rotation.y = (rnd() - 0.5) * 0.5;
    g.add(b);
  }
  return { rz };
}

// Chai lọ: thân + nắp + nhãn + chất lỏng bên trong
function placeBottles(g, M, groups, { liquidMats } = {}) {
  const caps = [M.capBlue, M.capRed, M.capBlack, M.capGreen, M.capYellow];
  const capLists = caps.map(() => []);
  const labelList = [];
  const liquidLists = (liquidMats ?? [M.liquidBlue, M.liquidClear, M.liquidPink, M.liquidGreen, M.liquidAmber]).map(() => []);
  const all = [];
  ['amber', 'clear'].forEach((type) => {
    const list = groups[type] || [];
    instances(g, DECOR_GEO.bottle, type === 'amber' ? M.amber : M.glass, list, { cast: false });
    list.forEach((t, i) => {
      const sy = t[5] ?? 1;
      capLists[(i + (type === 'amber' ? 2 : 0)) % caps.length].push([t[0], t[1] + 1.72 * sy + 0.1, t[2], 0, 1, 1]);
      labelList.push([t[0], t[1] + 0.65 * sy, t[2], t[3], 1, sy]);
      if (type === 'clear') {
        const k = i % liquidLists.length;
        liquidLists[k].push([t[0], t[1] + 0.5 * sy, t[2], 0, 1, 0.9 * sy]);
      }
      all.push(t);
    });
  });
  const hd = groups.hdpe || [];
  instances(g, DECOR_GEO.hdpe, M.hdpe, hd.map((t) => [t[0], t[1] + 0.75 * (t[5] ?? 1), t[2], t[3], 1, t[5] ?? 1]));
  hd.forEach((t, i) => {
    capLists[(i + 1) % caps.length].push([t[0], t[1] + 1.5 * (t[5] ?? 1) + 0.12, t[2], 0, 1.45, 1]);
    labelList.push([t[0], t[1] + 0.7 * (t[5] ?? 1), t[2], t[3], 1, t[5] ?? 1]);
  });
  caps.forEach((mat, i) => instances(g, DECOR_GEO.cap, mat, capLists[i]));
  instances(g, DECOR_GEO.label, M.label, labelList);
  liquidLists.forEach((list, i) => instances(g, DECOR_GEO.liquid, (liquidMats ?? [M.liquidBlue, M.liquidClear, M.liquidPink, M.liquidGreen, M.liquidAmber])[i], list));
}

// ------------------------------------------------------------
// 5. Đồ dùng gọn gàng ở hai đầu bàn chính (trạng thái ban đầu)
// ------------------------------------------------------------
function washBottle(M) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.45, 1.5, 20), M.hdpe);
  body.position.y = 0.75;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.25, 14), M.capRed);
  cap.position.y = 1.62;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), M.hdpe);
  tube.position.set(0.25, 1.95, 0);
  tube.rotation.z = -0.9;
  g.add(body, cap, tube);
  g.traverse((c) => c.isMesh && (c.castShadow = true));
  return g;
}

function decorBeaker(M, liquidMat = null, level = 0) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(DECOR_GEO.beaker, M.glass);
  g.add(b);
  if (liquidMat && level > 0) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.59, 0.59, level, 24), liquidMat);
    l.position.y = level / 2 + 0.05;
    g.add(l);
  }
  return g;
}

function notebook(M, open) {
  const g = new THREE.Group();
  if (open) {
    for (const s of [-1, 1]) {
      const page = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.06, 2.0), M.paper);
      page.position.set(s * 0.74, 0.05, 0);
      page.rotation.z = s * -0.03;
      page.castShadow = true;
      g.add(page);
      const cover = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 2.05), M.notebook);
      cover.position.set(s * 0.75, 0.015, 0);
      g.add(cover);
    }
    // dòng chữ ghi chép (vạch mảnh)
    const ink = new THREE.MeshStandardMaterial({ color: 0x2c3e66, roughness: 0.9 });
    for (let i = 0; i < 6; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.9 - (i % 3) * 0.2, 0.005, 0.03), ink);
      line.position.set(-0.75, 0.085, -0.7 + i * 0.25);
      g.add(line);
    }
  } else {
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 2.05), M.notebook);
    c.position.y = 0.08;
    c.castShadow = true;
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.12, 1.98), M.paper);
    p.position.set(0.03, 0.08, 0);
    g.add(c, p);
  }
  return g;
}

function pen(M) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 8), M.capBlue);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.05;
  g.add(body);
  return g;
}

function glovePair(M) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 1.0), M.glove);
    palm.position.set(s * 0.45, 0.04 + (s > 0 ? 0.06 : 0), 0);
    palm.rotation.y = s * 0.25;
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.7), M.glove);
    cuff.position.set(s * 0.5, 0.04 + (s > 0 ? 0.06 : 0), 0.8);
    cuff.rotation.y = s * 0.25;
    for (let f = 0; f < 4; f++) {
      const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), M.glove);
      finger.rotation.x = Math.PI / 2;
      finger.position.set(s * 0.45 - 0.27 + f * 0.18, 0.06 + (s > 0 ? 0.06 : 0), -0.72);
      g.add(finger);
    }
    g.add(palm, cuff);
  }
  return g;
}

function testTubeRackDecor(M) {
  const g = new THREE.Group();
  box(g, 2.2, 0.08, 0.8, M.hdpe, 0, 0.6, 0, { cast: true });
  box(g, 2.2, 0.08, 0.8, M.hdpe, 0, 0.04, 0);
  for (const x of [-1.05, 1.05]) box(g, 0.08, 0.64, 0.8, M.hdpe, x, 0.32, 0);
  const tubes = [-0.75, -0.25, 0.25].map((x) => [x, 0.05, 0, 0, 1, 1]);
  const tube = new THREE.CylinderGeometry(0.12, 0.12, 1.5, 14, 1, true);
  tube.translate(0, 0.75, 0);
  instances(g, tube, M.glass, tubes);
  return g;
}

function buildBenchEnds(g, M, R) {
  const top = 0;
  // --- đầu bàn bên phải: khay dụng cụ sạch, giá ống nghiệm, hộp găng tay, bình tia
  const tray = new THREE.Group();
  box(tray, 2.3, 0.12, 2.3, M.hdpe, 0, 0.06, 0, { cast: true });
  for (const [x, z, w, d] of [
    [0, 1.12, 2.3, 0.06],
    [0, -1.12, 2.3, 0.06],
    [1.12, 0, 0.06, 2.3],
    [-1.12, 0, 0.06, 2.3],
  ]) {
    box(tray, w, 0.3, d, M.hdpe, x, 0.15, z);
  }
  const b1 = decorBeaker(M);
  b1.position.set(-0.45, 0.12, -0.4);
  b1.scale.setScalar(0.8);
  const b2 = decorBeaker(M);
  b2.position.set(0.45, 0.12, -0.4);
  b2.scale.setScalar(0.65);
  const f1 = new THREE.Mesh(DECOR_GEO.flask, M.glass);
  f1.position.set(0, 0.12, 0.5);
  f1.scale.setScalar(0.8);
  tray.add(b1, b2, f1);
  tray.position.set(9.6, top, 1.0);
  g.add(tray);
  interactive(R, tray, 'take', { title: 'Khay dụng cụ thủy tinh sạch', items: ['beaker', 'erlenmeyer', 'roundflask'] });
  contactShadow(g, M, 3.2, 3.2, 9.6, top, 1.0, 0.35);

  const rack = testTubeRackDecor(M);
  rack.position.set(9.5, top, 3.4);
  g.add(rack);
  interactive(R, rack, 'take', { title: 'Giá ống nghiệm sạch', items: ['rack', 'testtube'] });

  const gloveBox = new THREE.Group();
  box(gloveBox, 2.4, 1.2, 1.25, M.blueCase, 0, 0.6, 0, { cast: true });
  box(gloveBox, 1.0, 0.04, 0.5, M.laminate, 0, 1.21, 0);
  gloveBox.position.set(9.6, top, -2.5);
  gloveBox.rotation.y = 0.05;
  g.add(gloveBox);
  interactive(R, gloveBox, 'gloveBox');

  const wb = washBottle(M);
  g.add(wb);
  interactive(R, wb, 'washBottle');

  // --- đầu bàn bên trái: sổ ghi chép, bút, cốc cắm dụng cụ, đồng hồ bấm giờ
  const nbClosed = notebook(M, false);
  nbClosed.position.set(-9.4, top, 2.0);
  nbClosed.rotation.y = 0.06;
  g.add(nbClosed);
  interactive(R, nbClosed, 'notebook');
  const nbOpen = notebook(M, true);
  nbOpen.position.set(-8.7, top, 2.6);
  nbOpen.rotation.y = -0.32;
  g.add(nbOpen);
  interactive(R, nbOpen, 'notebook');
  const p = pen(M);
  g.add(p);

  const toolCup = new THREE.Group();
  const cup = decorBeaker(M);
  cup.scale.setScalar(0.7);
  cup.position.set(-10.0, top, -1.2);
  toolCup.add(cup);
  // đũa, thìa xúc hóa chất cắm trong cốc
  const toolMat = M.steel;
  [
    [0.15, 0.2],
    [-0.15, -0.15],
    [0.05, -0.25],
  ].forEach(([dx, tilt], i) => {
    const r = cyl(toolCup, 0.03, 0.03, 2.2, i === 0 ? M.glass : toolMat, -10.0 + dx, 1.1, -1.2 + dx * 0.5, { seg: 8, rz: tilt });
    r.castShadow = true;
  });
  g.add(toolCup);
  interactive(R, toolCup, 'take', { title: 'Cốc cắm đũa và thìa', items: ['stirring-rod', 'spatula', 'tube-holder'] });
  const timer = new THREE.Group();
  box(timer, 0.9, 0.5, 0.55, M.laminate, 0, 0.25, 0, { cast: true });
  const timerCanvas = document.createElement('canvas');
  timerCanvas.width = 256;
  timerCanvas.height = 96;
  const timerTex = new THREE.CanvasTexture(timerCanvas);
  timerTex.colorSpace = THREE.SRGBColorSpace;
  const tscreen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.22), new THREE.MeshBasicMaterial({ map: timerTex }));
  tscreen.position.set(0, 0.3, 0.281);
  timer.add(tscreen);
  timer.position.set(-8.4, top, -2.9);
  timer.rotation.y = 0.2;
  g.add(timer);
  interactive(R, timer, 'timer');
  R.refs.timer = { canvas: timerCanvas, tex: timerTex };

  // cốc chất thải: đổ dung dịch thừa vào, đem ra bồn đổ bỏ và rửa
  const waste = new THREE.Group();
  const wglass = new THREE.Mesh(DECOR_GEO.beaker, M.glass);
  wglass.renderOrder = 2;
  waste.add(wglass);
  const wliq = new THREE.Mesh(
    new THREE.CylinderGeometry(0.59, 0.59, 1, 24),
    new THREE.MeshStandardMaterial({ color: 0xd9a35a, transparent: true, opacity: 0.75, roughness: 0.15 })
  );
  wliq.visible = false;
  wliq.renderOrder = 1;
  waste.add(wliq);
  const wlabel = new THREE.Mesh(new THREE.CylinderGeometry(0.635, 0.635, 0.4, 24, 1, true, -0.8, 1.6), labelMaterial('CHẤT THẢI', '#b91c1c'));
  wlabel.position.y = 1.2;
  waste.add(wlabel);
  waste.scale.setScalar(0.85);
  waste.position.set(-8.0, top, -1.4);
  g.add(waste);
  interactive(R, waste, 'wasteBeaker');
  R.refs.waste = { obj: waste, liquid: wliq, home: waste.position.clone(), capacity: 250 };

  // thùng rác đạp chân (găng tay, giấy lau đã dùng)
  const bin = new THREE.Group();
  bin.position.set(12.9, FY, 3.0);
  const binMat = M.steel.clone();
  binMat.side = THREE.DoubleSide;
  const binBody = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.9, 4.2, 24, 1, true), binMat);
  binBody.position.y = 2.1;
  bin.add(binBody);
  cyl(bin, 0.9, 0.9, 0.06, M.darkMetal, 0, 0.05, 0, { seg: 24 });
  const lid = new THREE.Group();
  lid.position.set(0, 4.2, -1.0);
  cyl(lid, 1.02, 1.02, 0.12, M.steel, 0, 0.06, 1.0, { seg: 24 });
  bin.add(lid);
  box(bin, 0.8, 0.12, 0.5, M.black, 0, 0.12, 1.05); // bàn đạp
  const binFill = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.85, 1, 20), M.paper);
  binFill.visible = false;
  bin.add(binFill);
  g.add(bin);
  interactive(R, bin, 'trashBin');
  R.refs.trash = { obj: bin, lid, fill: binFill, mouth: new THREE.Vector3(12.9, FY + 4.4, 3.0) };
  // chỗ đặt giấy lau vừa rút và găng tay vừa tháo
  R.refs.spots = { tissue: new THREE.Vector3(-8.3, 0, 0.6), gloves: new THREE.Vector3(8.2, 0, -1.2) };
  R.refs.makeGloves = () => glovePair(M);
  R.refs.makeTissue = (used) => {
    const t = used ? new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), M.paper) : new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.02, 1.2), M.paper);
    if (used) t.scale.set(1.2, 0.5, 1);
    t.castShadow = true;
    return t;
  };

  return { wb, nbClosed, nbOpen, pen: p };
}

// ------------------------------------------------------------
// 6. Quầy sát tường sau: bồn rửa, giá phơi dụng cụ, tủ kính treo tường
// ------------------------------------------------------------
function buildBackCounter(g, M, R) {
  const xa = -29;
  const xb = 25;
  const depth = 6.5;
  const yTop = 0;
  const zFront = Z0 + 6.0;
  // tủ dưới: mỗi khối là một tủ có tên phân loại
  const units = [
    [-29, -24.5, 'drawers', 'c-paper'],
    [-24.5, -20, 'doors', 'c-base'],
    [-20, -15.5, 'doors', 'c-salt'],
    [-15.5, -11, 'drawers', 'c-indicator'],
    [-11, -6.5, 'doors', 'c-sink', -2.75],
    [-6.5, -2, 'doors', 'c-sink', -2.75],
    [-2, 2.5, 'doors', 'c-solvent'],
    [2.5, 7, 'doors', 'c-oxidizer'],
    [7, 11.5, 'drawers', 'c-water'],
    [11.5, 16, 'doors', 'c-volume'],
    [16, 20.5, 'doors', 'c-distill'],
    [20.5, 25, 'drawers', 'c-misc'],
  ];
  units.forEach(([u0, u1, kind, storage, innerTop], i) => {
    cabinetUnit(R, M, g, {
      x: (u0 + u1) / 2, z: zFront, w: u1 - u0, d: 6.0, y0: FY + 1, y1: -0.55, kind, storage, innerTop,
      label: !(storage === 'c-sink' && i === 5),
    });
  });
  box(g, xb - xa - 0.4, 1, depth - 1.2, M.kick, (xa + xb) / 2, FY + 0.5, Z0 + (depth - 1.2) / 2);
  contactShadow(g, M, xb - xa + 2, depth + 2, (xa + xb) / 2, FY, Z0 + depth / 2, 0.45);

  // mặt quầy epoxy có lỗ khoét cho bồn rửa + gờ ốp tường
  const sx = -6;
  const bx0 = -8.2;
  const bx1 = -3.8;
  const bz0 = Z0 + 2.05; // -21.95
  const bz1 = Z0 + 5.05; // -18.95
  const zc = Z0 + depth / 2;
  box(g, bx0 - xa, 0.4, depth, M.epoxyCounter, (xa + bx0) / 2, yTop - 0.2, zc);
  box(g, xb - bx1, 0.4, depth, M.epoxyCounter, (bx1 + xb) / 2, yTop - 0.2, zc);
  box(g, bx1 - bx0, 0.4, bz0 - Z0, M.epoxyCounter, sx + 0, yTop - 0.2, (Z0 + bz0) / 2);
  box(g, bx1 - bx0, 0.4, Z0 + depth - bz1, M.epoxyCounter, sx + 0, yTop - 0.2, (bz1 + Z0 + depth) / 2);
  box(g, xb - xa, 1.6, 0.12, M.epoxyCounter, (xa + xb) / 2, yTop + 0.8, Z0 + 0.06);

  // lòng bồn rửa inox sâu 24 cm
  const basinBottom = -2.4;
  const sink = new THREE.MeshStandardMaterial({ color: 0xa9aeb4, metalness: 0.9, roughness: 0.32 });
  box(g, bx1 - bx0, 0.06, bz1 - bz0, sink, sx, basinBottom - 0.03, (bz0 + bz1) / 2);
  box(g, 0.06, -basinBottom, bz1 - bz0, sink, bx0 + 0.03, basinBottom / 2, (bz0 + bz1) / 2);
  box(g, 0.06, -basinBottom, bz1 - bz0, sink, bx1 - 0.03, basinBottom / 2, (bz0 + bz1) / 2);
  box(g, bx1 - bx0, -basinBottom, 0.06, sink, sx, basinBottom / 2, bz0 + 0.03);
  box(g, bx1 - bx0, -basinBottom, 0.06, sink, sx, basinBottom / 2, bz1 - 0.03);
  // viền bồn
  box(g, bx1 - bx0 + 0.6, 0.05, 0.3, M.brushed, sx, 0.02, bz0 - 0.15);
  box(g, bx1 - bx0 + 0.6, 0.05, 0.3, M.brushed, sx, 0.02, bz1 + 0.15);
  box(g, 0.3, 0.05, bz1 - bz0, M.brushed, bx0 - 0.15, 0.02, (bz0 + bz1) / 2);
  box(g, 0.3, 0.05, bz1 - bz0, M.brushed, bx1 + 0.15, 0.02, (bz0 + bz1) / 2);
  // lỗ thoát nước + nút chặn (bấm để đóng/mở cống)
  const drainX = sx + 1.2;
  const drainZ = (bz0 + bz1) / 2;
  cyl(g, 0.28, 0.28, 0.02, M.black, drainX, basinBottom + 0.005, drainZ, { seg: 24 });
  const stopper = new THREE.Group();
  stopper.position.set(drainX, basinBottom + 0.03, drainZ);
  cyl(stopper, 0.24, 0.24, 0.06, M.steel, 0, 0, 0, { seg: 24 });
  cyl(stopper, 0.05, 0.05, 0.25, M.steel, 0, 0.14, 0, { seg: 10 });
  g.add(stopper);
  interactive(R, stopper, 'drain');
  // mặt nước trong bồn (dâng lên khi đóng cống)
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(bx1 - bx0 - 0.14, bz1 - bz0 - 0.14),
    new THREE.MeshStandardMaterial({ color: 0x9fd0ee, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.1, depthWrite: false })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(sx, basinBottom + 0.02, drainZ);
  water.visible = false;
  water.renderOrder = 3;
  g.add(water);

  // lòng bồn: bấm để xem bảng điều khiển bồn rửa
  hitbox(R, g, bx1 - bx0, 0.5, bz1 - bz0, sx, basinBottom + 0.25, (bz0 + bz1) / 2, 'sinkBasin', {});
  // vòi cổ ngỗng + hai tay gạt (bấm để mở/khóa nước)
  const spout = new THREE.Group();
  cyl(spout, 0.16, 0.2, 0.4, M.steel, sx, yTop + 0.2, Z0 + 1.0, { seg: 14 });
  cyl(spout, 0.1, 0.1, 3.4, M.steel, sx, yTop + 1.9, Z0 + 1.0, { seg: 12 });
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.1, 10, 24, Math.PI), M.steel);
  arc.position.set(sx, yTop + 3.6, Z0 + 1.8);
  arc.rotation.y = Math.PI / 2;
  spout.add(arc);
  cyl(spout, 0.09, 0.09, 0.8, M.steel, sx, yTop + 3.2, Z0 + 2.6, { seg: 10 });
  g.add(spout);
  interactive(R, spout, 'faucet');
  const handles = [];
  for (const sgn of [-1, 1]) {
    const h = new THREE.Group();
    h.position.set(sx + sgn * 1.1, yTop, Z0 + 1.0);
    cyl(h, 0.12, 0.12, 0.3, M.steel, 0, 0.15, 0, { seg: 10 });
    const lever = new THREE.Group();
    lever.position.set(0, 0.35, 0);
    box(lever, 0.12, 0.08, 0.9, M.steel, 0, 0, 0.35);
    lever.name = 'lever';
    h.add(lever);
    g.add(h);
    interactive(R, h, 'faucet');
    handles.push(lever);
  }
  const stream = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 1, 12, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xcfe9fb, transparent: true, opacity: 0.6, roughness: 0.05, depthWrite: false })
  );
  stream.visible = false;
  stream.renderOrder = 4;
  g.add(stream);
  R.refs.sink = {
    x0: bx0, x1: bx1, z0: bz0, z1: bz1, bottomY: basinBottom, cx: sx, cz: drainZ,
    spout: new THREE.Vector3(sx, yTop + 2.78, Z0 + 2.6), stopper, water, stream, handles,
  };

  // bình xà phòng + hộp khăn giấy treo tường
  const soap = new THREE.Group();
  soap.position.set(sx + 3.0, yTop, Z0 + 1.0);
  cyl(soap, 0.3, 0.3, 1.0, M.hdpe, 0, 0.5, 0, { seg: 14 });
  cyl(soap, 0.08, 0.08, 0.4, M.capBlack, 0, 1.2, 0, { seg: 8 });
  g.add(soap);
  interactive(R, soap, 'soap');
  const towelBox = new THREE.Group();
  towelBox.position.set(sx + 4.4, 8.5, Z0 + 0.5);
  box(towelBox, 2.6, 3.2, 1.0, M.laminate, 0, 0, 0, { cast: true });
  box(towelBox, 1.6, 0.1, 0.3, M.capBlack, 0, -1.5, 0.5);
  g.add(towelBox);
  interactive(R, towelBox, 'towels');

  // giá phơi dụng cụ thủy tinh (bảng chốt) phía trên bồn rửa
  const pegX0 = sx - 3.6;
  const peg = new THREE.Group();
  box(peg, 5.6, 6.2, 0.3, M.hdpe, pegX0 + 2.3, 7.8, Z0 + 0.15, { cast: true });
  box(peg, 5.6, 0.25, 1.0, M.hdpe, pegX0 + 2.3, 4.6, Z0 + 0.6); // máng hứng nước
  const pegList = [];
  const hung = [];
  const flasksUpside = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const x = pegX0 + 0.3 + c * 0.8;
      const y = 5.5 + r * 1.45;
      pegList.push([x, y, Z0 + 0.65]);
      if ((r * 6 + c) % 3 !== 1) {
        if (r % 2 === 0) hung.push([x, y + 0.85, Z0 + 0.75, 0, 0.42, -0.42]);
        else flasksUpside.push([x, y + 1.0, Z0 + 0.75, 0, 0.38, -0.38]);
      }
    }
  }
  const pegGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6);
  pegGeo.rotateX(Math.PI / 2 - 0.35);
  instances(peg, pegGeo, M.hdpe, pegList);
  instances(peg, DECOR_GEO.beaker, M.glass, hung);
  instances(peg, DECOR_GEO.flask, M.glass, flasksUpside);
  g.add(peg);
  interactive(R, peg, 'dryingRack');

  // tủ kính treo tường hai bên (cửa kính trượt mở được)
  const wallCab = (xa2, xb2, storage) => {
    const y0 = 7;
    const y1 = 15.5;
    const d = 3.4;
    const cx = (xa2 + xb2) / 2;
    const cy = (y0 + y1) / 2;
    const zc2 = Z0 + d / 2;
    box(g, xb2 - xa2, 0.25, d, M.laminate, cx, y0, zc2, { cast: true });
    box(g, xb2 - xa2, 0.25, d, M.laminate, cx, y1, zc2);
    box(g, 0.25, y1 - y0, d, M.laminate, xa2, cy, zc2);
    box(g, 0.25, y1 - y0, d, M.laminate, xb2, cy, zc2);
    box(g, xb2 - xa2, y1 - y0, 0.1, M.laminate, cx, cy, Z0 + 0.05);
    const shelfY = [y0 + 2.9, y0 + 5.7];
    shelfY.forEach((y) => box(g, xb2 - xa2 - 0.3, 0.1, d - 0.4, M.cabinetGlass, cx, y, zc2 - 0.1));
    const rows = [y0 + 0.15, ...shelfY.map((y) => y + 0.06)];
    const beakers = [];
    const flasks = [];
    const cylinders = [];
    const dishes = [];
    const rnd = seeded(Math.round(xa2 * 13 + 400));
    const hitAt = (item, x, y, z, h) => hitbox(R, g, 1.1, h, 1.2, x, y + h / 2, z, 'cabinetItem', { item, storage });
    rows.forEach((y, ri) => {
      for (let x = xa2 + 0.9; x < xb2 - 0.7; x += 1.25) {
        if (rnd() < 0.15) continue;
        const z = zc2 - 0.3;
        if (storage === 'w-glass2') {
          // chồng đĩa Petri (hàng dưới, hàng trên) và mặt kính đồng hồ (hàng giữa)
          const petri = ri !== 1;
          const n = petri ? 2 + Math.floor(rnd() * 3) : 1;
          for (let k = 0; k < n; k++) dishes.push([x, y + k * 0.14, z, 0, petri ? 1 : 0.9, petri ? 1 : 0.35]);
          hitAt(petri ? 'petri-dish' : 'watch-glass', x, y, z, 0.6);
        } else if (ri === 0) {
          beakers.push([x, y, z, 0, 0.75, 0.75]);
          hitAt('beaker', x, y, z, 1.4);
        } else if (ri === 1) {
          flasks.push([x, y, z, 0, 0.72, 0.72]);
          hitAt(rnd() < 0.3 ? 'roundflask' : 'erlenmeyer', x, y, z, 1.5);
        } else if (rnd() < 0.5) {
          cylinders.push([x, y, z, 0, 0.75, 0.75]);
          hitAt('testtube', x, y, z, 1.8);
        } else {
          beakers.push([x, y, z, 0, 0.6, 0.6]);
          hitAt('beaker', x, y, z, 1.1);
        }
      }
    });
    instances(g, DECOR_GEO.beaker, M.glass, beakers);
    instances(g, DECOR_GEO.flask, M.glass, flasks);
    instances(g, DECOR_GEO.cylinder, M.glass, cylinders);
    instances(g, DECOR_GEO.dish, M.glass, dishes);
    // nhãn tên tủ trên ray dưới
    const def = STORAGES[storage];
    const lp = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), labelMaterial(def.short, def.tag));
    lp.position.set(cx, y0 - 0.55, Z0 + d + 0.02);
    g.add(lp);
    interactive(R, lp, 'cabinet', { storage });
    // cánh kính: cánh lẻ trượt sang trái chồng lên cánh chẵn
    const nDoors = Math.max(2, Math.round((xb2 - xa2) / 4));
    const dw = (xb2 - xa2) / nDoors;
    for (let i = 0; i < nDoors; i++) {
      const x = xa2 + dw * (i + 0.5);
      const zz = Z0 + d + (i % 2 ? 0.05 : -0.12);
      const D = new THREE.Group();
      D.position.set(x, cy, zz);
      const pane = plane(D, dw, y1 - y0, M.cabinetGlass, 0, 0, 0);
      pane.receiveShadow = false;
      box(D, dw, 0.18, 0.12, M.alu, 0, -(y1 - y0) / 2 + 0.1, 0);
      box(D, dw, 0.18, 0.12, M.alu, 0, (y1 - y0) / 2 - 0.1, 0);
      box(D, 0.12, y1 - y0, 0.12, M.alu, -dw / 2 + 0.06, 0, 0);
      box(D, 0.08, 1.2, 0.1, M.steel, i % 2 ? -dw / 2 + 0.5 : dw / 2 - 0.5, -1.5, 0.1);
      g.add(D);
      interactive(R, D, 'cabinet', { storage });
      addStoragePart(R, storage, {
        obj: D, type: 'slide', axis: 'x', dist: i % 2 ? -dw + 0.2 : 0, anchor: () => new THREE.Vector3(cx, y0 + 1, Z0 + d), open: 0, target: 0,
      });
    }
  };
  wallCab(-28.5, -12, 'w-glass1');
  wallCab(0.5, 24.5, 'w-glass2');

  // cân phân tích có tủ kính chắn gió: kéo vật lên đĩa cân để cân
  const balance = new THREE.Group();
  box(balance, 3.0, 0.8, 3.2, M.laminate, 0, 0.4, 0, { cast: true });
  box(balance, 2.6, 2.4, 0.06, M.cabinetGlass, 0, 2.0, -1.37);
  box(balance, 0.06, 2.4, 2.4, M.cabinetGlass, -1.27, 2.0, -0.2);
  box(balance, 0.06, 2.4, 2.4, M.cabinetGlass, 1.27, 2.0, -0.2);
  box(balance, 2.6, 0.12, 2.4, M.laminate, 0, 3.24, -0.2);
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 256;
  screenCanvas.height = 64;
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(0, 0.45, 1.62);
  balance.add(screen);
  cyl(balance, 0.6, 0.6, 0.05, M.brushed, 0, 0.85, -0.2, { seg: 20 });
  balance.position.set(5, yTop, Z0 + 3.0);
  g.add(balance);
  interactive(R, balance, 'anaBalance');
  R.refs.anaBalance = { obj: balance, pan: new THREE.Vector3(5, 0.875, Z0 + 2.8), radius: 1.1, canvas: screenCanvas, tex: screenTex };

  // máy khuấy từ trên quầy (đang khuấy cốc nước cất), bấm để bật/tắt
  const stirrer = new THREE.Group();
  box(stirrer, 2.0, 0.6, 2.4, M.laminate, 0, 0.3, 0, { cast: true });
  box(stirrer, 1.6, 0.06, 1.6, M.brushed, 0, 0.63, -0.25);
  cyl(stirrer, 0.12, 0.12, 0.12, M.capBlack, -0.5, 0.35, 1.22, { rx: Math.PI / 2, seg: 12 });
  cyl(stirrer, 0.12, 0.12, 0.12, M.capBlack, 0.5, 0.35, 1.22, { rx: Math.PI / 2, seg: 12 });
  const stirBeaker = decorBeaker(M, M.liquidClear, 0.9);
  stirBeaker.scale.setScalar(0.8);
  stirBeaker.position.set(0, 0.66, -0.25);
  stirrer.add(stirBeaker);
  const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.4, 4, 8), M.hdpe);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 0.74, -0.25);
  stirrer.add(bar);
  stirrer.position.set(12, yTop, Z0 + 3.2);
  stirrer.rotation.y = -0.08;
  g.add(stirrer);
  interactive(R, stirrer, 'counterStirrer');
  R.refs.counterStirrer = { bar, beaker: stirBeaker };

  const towels = new THREE.Group();
  cyl(towels, 0.55, 0.55, 2.3, M.paper, 0, 1.15, 0, { seg: 20, cast: true });
  cyl(towels, 0.12, 0.12, 2.32, M.darkMetal, 0, 1.15, 0, { seg: 10 });
  towels.position.set(-15, yTop, Z0 + 2.2);
  g.add(towels);
  interactive(R, towels, 'towels');
  // chai hóa chất hay dùng, xếp gọn ở góc quầy
  [
    [18.5, 'ethanol'], [19.4, 'hcl'], [20.4, 'naoh'], [21.4, 'cuso4'], [22.3, 'water'],
  ].forEach(([x, chem]) => {
    const b = chemBottle(R, M, chem);
    b.position.set(x, yTop, Z0 + 1.65);
    g.add(b);
  });
  // đồng hồ treo tường (chạy theo giờ thật)
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.2, 40), [M.darkMetal, M.clock, M.darkMetal]);
  clock.rotation.x = Math.PI / 2;
  clock.position.set(-6, 18, Z0 + 0.12);
  g.add(clock);
  interactive(R, clock, 'clock');

  // chân dung các nhà hóa học trên tường, phía trên tủ kính
  buildPortraits(
    g,
    [
      { id: 'lavoisier', x: -25, y: 19.8, z: Z0 + 0.14 },
      { id: 'dalton', x: -17.5, y: 19.8, z: Z0 + 0.14 },
      { id: 'avogadro', x: 4, y: 19.8, z: Z0 + 0.14 },
      { id: 'mendeleev', x: 10.5, y: 19.8, z: Z0 + 0.14 },
      { id: 'curie', x: 17, y: 19.8, z: Z0 + 0.14 },
      { id: 'pauling', x: 23.5, y: 19.8, z: Z0 + 0.14 },
    ],
    (obj, data) => interactive(R, obj, data.kind, data)
  );
}

// ------------------------------------------------------------
// 7. Tường phải: tủ hút khí độc, tủ hóa chất, tủ lạnh, quầy thiết bị
// ------------------------------------------------------------
function buildFumeHood(g, M, R, za, zb) {
  const d = 7;
  const xw = X1;
  const xf = xw - d;
  const zc = (za + zb) / 2;
  const w = zb - za;
  // tủ đế: tủ axit có thông gió (3 khối cánh)
  for (let i = 0; i < 3; i++) {
    const z0 = za + (w / 3) * i;
    cabinetUnit(R, M, g, { x: xf, z: z0 + w / 6, ry: -Math.PI / 2, w: w / 3, d: 6.5, y0: FY + 1, y1: -0.55, kind: 'doors', storage: 'h-acid', label: i === 1 });
  }
  box(g, 5.6, 1, w - 0.4, M.kick, xw - 2.8, FY + 0.5, zc);
  // thân tủ hút
  const y0 = 0;
  const y1 = 14;
  const interior = M.hoodInterior.clone();
  box(g, d, 0.4, w, M.epoxyCounter, xw - d / 2, y0 - 0.2, zc);
  box(g, d, 0.6, w, M.laminate, xw - d / 2, y1, zc, { cast: true });
  box(g, d, y1 - y0, 0.5, M.laminate, xw - d / 2, (y0 + y1) / 2, za + 0.25, { cast: true });
  box(g, d, y1 - y0, 0.5, M.laminate, xw - d / 2, (y0 + y1) / 2, zb - 0.25, { cast: true });
  interactive(R, box(g, 0.3, y1 - y0, w, interior, xw - 0.15, (y0 + y1) / 2, zc), 'fumeHood');
  interactive(R, box(g, d - 0.6, 0.15, w - 1, interior, xw - d / 2, y1 - 0.4, zc), 'fumeHood');
  // dải trên (header)
  box(g, 0.4, 3.0, w, M.laminate, xf + 0.2, y1 - 1.5, zc);
  // cửa kính kéo (sash): bấm để nâng / hạ
  const sash = new THREE.Group();
  sash.position.set(xf + 0.3, 7.5, zc);
  box(sash, 0.15, 5.4, w - 1.0, M.cabinetGlass, 0.05, 2.7, 0);
  box(sash, 0.3, 0.3, w - 1.0, M.alu, 0, 0, 0);
  box(sash, 0.3, 0.3, w - 1.0, M.alu, 0, 5.4, 0);
  box(sash, 0.2, 0.15, w * 0.5, M.steel, -0.25, 0.25, 0); // tay kéo
  g.add(sash);
  interactive(R, sash, 'fumeHood');
  box(g, 0.6, 0.15, w - 0.6, M.brushed, xf + 0.1, y0 + 0.2, zc); // gờ đón gió
  // bảng điều khiển + đồng hồ lưu lượng gió
  const panel = new THREE.Group();
  panel.position.set(xf + 0.06, 9, zb - 0.9);
  box(panel, 0.12, 2.0, 0.9, M.darkMetal, 0, 0, 0);
  const flow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x0b1a10, emissive: 0x41d36b, emissiveIntensity: 0.1 }));
  flow.position.set(-0.06, 0.4, 0);
  panel.add(flow);
  g.add(panel);
  interactive(R, panel, 'fumeHood');
  // ống hút lên trần
  interactive(R, cyl(g, 1.2, 1.2, CY - y1 - 0.3, M.brushed, xw - d / 2, (y1 + CY) / 2, zc, { seg: 24 }), 'fumeHood');
  // chai axit đặc bay hơi đặt trong tủ hút
  [
    [za + 1.6, 'hno3'],
    [za + 2.6, 'hcl'],
    [za + 3.6, 'nh3'],
  ].forEach(([z, chem]) => {
    const bt = chemBottle(R, M, chem);
    bt.position.set(xw - 2.0, y0, z);
    bt.rotation.y = -Math.PI / 2;
    g.add(bt);
  });
  const f = new THREE.Mesh(DECOR_GEO.flask, M.glass);
  f.position.set(xw - 3.0, y0, zb - 2.5);
  g.add(f);
  interactive(R, f, 'take', { title: 'Bình tam giác sạch trong tủ hút', items: ['erlenmeyer'] });
  contactShadow(g, M, d + 2, w + 2, xw - d / 2, FY, zc, 0.45);
  R.refs.hood = { sash, sashLow: 7.5, sashHigh: 11.8, interior, flow, surface: { x0: xf + 0.7, x1: xw - 0.6, z0: za + 0.7, z1: zb - 0.7 } };
}

function buildChemicalCabinet(g, M, R, za, zb) {
  // tủ thép đựng mẫu nguyên tố, cửa kính mở được, có lỗ thông gió
  const d = 4.5;
  const h = 19;
  const xw = X1;
  const zc = (za + zb) / 2;
  const w = zb - za;
  const cx = xw - d / 2;
  box(g, d, h, 0.2, M.powder, cx, FY + h / 2, za + 0.1, { cast: true });
  box(g, d, h, 0.2, M.powder, cx, FY + h / 2, zb - 0.1, { cast: true });
  box(g, d, 0.2, w, M.powder, cx, FY + h, zc);
  box(g, d, 0.2, w, M.powder, cx, FY + 0.6, zc);
  box(g, 0.2, h, w, M.powder, xw - 0.1, FY + h / 2, zc);
  const shelves = [FY + 4.4, FY + 8.6, FY + 12.8, FY + 16.6];
  shelves.forEach((y) => box(g, d - 0.4, 0.12, w - 0.4, M.powder, cx, y, zc));
  // lọ mẫu nguyên tố xếp theo từng tầng
  const groups = { amber: [], clear: [], hdpe: [] };
  const rnd = seeded(77);
  [FY + 0.7, ...shelves.slice(0, 3)].forEach((y, si) => {
    for (let z = za + 0.8; z < zb - 0.6; z += 1.0) {
      if (rnd() < 0.18) continue;
      const type = si === 0 ? 'hdpe' : si === 1 ? 'amber' : rnd() < 0.5 ? 'clear' : 'amber';
      groups[type].push([cx + (rnd() - 0.5) * 0.8, y + 0.06, z, rnd() * 6, si === 0 ? 1.1 : 1, si === 0 ? 1.5 : 0.95 + rnd() * 0.2]);
    }
  });
  placeBottles(g, M, groups);
  // mỗi lọ ứng với một nguyên tố hay dùng (bấm để lấy mẫu qua bảng tuần hoàn)
  const JARS = ['na', 'k', 'mg', 'ca', 'al', 'fe', 'cu', 'zn', 'ag', 'sn', 'pb', 'ni', 's', 'c', 'p', 'i', 'si', 'mn', 'cr', 'co', 'li', 'ba', 'br', 'hg', 'b', 'ti', 'w', 'sb'];
  let j = 0;
  for (const list of [groups.hdpe, groups.amber, groups.clear]) {
    for (const t of list) {
      const sy = t[5] ?? 1;
      hitbox(R, g, 0.9, 1.8 * sy, 0.9, t[0], t[1] + 0.9 * sy, t[2], 'elementJar', { element: JARS[j % JARS.length], storage: 'elements' });
      j++;
    }
  }
  // cửa kính hai cánh, bản lề ở hai mép ngoài
  const xf = xw - d;
  const dw = w / 2;
  for (const left of [true, false]) {
    const P = new THREE.Group();
    P.position.set(xf - 0.05, 0, left ? za : zb);
    const sgn = left ? 1 : -1;
    const glassBox = box(P, 0.06, h - 0.8, dw - 0.1, M.cabinetGlass, 0, FY + h / 2 + 0.2, sgn * dw / 2);
    glassBox.receiveShadow = false;
    box(P, 0.12, h - 0.8, 0.18, M.powder, 0, FY + h / 2 + 0.2, sgn * 0.09);
    box(P, 0.12, h - 0.8, 0.18, M.powder, 0, FY + h / 2 + 0.2, sgn * (dw - 0.09));
    box(P, 0.12, 1.6, 0.1, M.steel, -0.12, FY + 10, sgn * (dw - 0.4));
    g.add(P);
    interactive(R, P, 'cabinet', { storage: 'elements' });
    addStoragePart(R, 'elements', { obj: P, type: 'door', angle: left ? -1.7 : 1.7, anchor: () => new THREE.Vector3(xf - 1, FY + 10, zc), open: 0, target: 0 });
  }
  const sign = new THREE.MeshStandardMaterial({ map: signTexture('MẪU NGUYÊN TỐ', '#f0c02c', '#1d1d1d'), roughness: 0.6 });
  const signP = plane(g, 3.0, 0.95, sign, xf - 0.12, FY + h + 0.65, zc, 0, -Math.PI / 2);
  interactive(R, signP, 'cabinet', { storage: 'elements' });
  // hàng lỗ thông gió phía trên
  for (let i = 0; i < 6; i++) box(g, 0.06, 0.08, 0.7, M.darkMetal, xf - 0.05, FY + h - 0.4, za + 0.9 + i * ((w - 1.8) / 5));
  contactShadow(g, M, d + 2, w + 2, cx, FY, zc, 0.45);
}

function buildSideCounterEquipment(g, M, R, za, zb) {
  const d = 6;
  const xw = X1;
  const zc = (za + zb) / 2;
  const w = zb - za;
  const uw = w / 4;
  ['s-electric', 's-electric', 's-store', 's-store'].forEach((st, i) => {
    cabinetUnit(R, M, g, {
      x: xw - (d - 0.5), z: za + uw * (i + 0.5), ry: -Math.PI / 2, w: uw, d: 5.5, y0: FY + 1, y1: -0.55, kind: i % 2 ? 'drawers' : 'doors', storage: st,
      label: i % 2 === 0,
    });
  });
  box(g, d - 1.2, 1, w - 0.4, M.kick, xw - (d - 1.2) / 2, FY + 0.5, zc);
  box(g, d, 0.4, w, M.epoxyCounter, xw - d / 2, -0.2, zc);
  contactShadow(g, M, d + 2, w + 2, xw - d / 2, FY, zc, 0.45);
  const yTop = 0;
  // máy ly tâm để bàn (nắp quay khi chạy)
  const centrifuge = new THREE.Group();
  box(centrifuge, 3.2, 1.6, 3.4, M.laminate, 0, 0.8, 0, { cast: true });
  const lid = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.laminate);
  lid.scale.set(1, 0.35, 1);
  lid.position.y = 1.6;
  centrifuge.add(lid);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 6, 24), M.darkMetal);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2.05;
  centrifuge.add(ring);
  box(centrifuge, 0.06, 0.5, 1.4, M.displayGreen, -1.62, 0.9, 0);
  centrifuge.position.set(xw - 3.0, yTop, za + 2.4);
  g.add(centrifuge);
  interactive(R, centrifuge, 'centrifuge');
  // máy quang phổ có màn hình
  const spectro = new THREE.Group();
  box(spectro, 3.0, 1.4, 4.2, M.laminate, 0, 0.7, 0, { cast: true });
  box(spectro, 2.4, 0.2, 1.4, M.darkMetal, 0, 1.5, 0.6);
  const screenFrame = box(spectro, 0.12, 1.8, 2.6, M.darkMetal, -1.2, 2.4, -0.6, { cast: true });
  screenFrame.rotation.z = 0.15;
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x10161e, emissive: 0x3d7bd9, emissiveIntensity: 0.15, roughness: 0.3 });
  const scr = box(spectro, 0.04, 1.6, 2.4, screenMat, -1.28, 2.42, -0.6);
  scr.rotation.z = 0.15;
  spectro.position.set(xw - 3.2, yTop, za + 7.6);
  g.add(spectro);
  interactive(R, spectro, 'spectro');
  // kính hiển vi (đèn dưới bàn soi)
  const micro = new THREE.Group();
  box(micro, 1.6, 0.3, 2.0, M.laminate, 0, 0.15, 0, { cast: true });
  const arm = box(micro, 0.5, 2.8, 0.5, M.laminate, 0, 1.6, 0.6, { cast: true });
  arm.rotation.x = -0.15;
  box(micro, 1.3, 0.12, 1.2, M.darkMetal, 0, 1.2, -0.2);
  const microLight = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff7d6, emissiveIntensity: 0 }));
  microLight.position.set(0, 1.27, -0.2);
  micro.add(microLight);
  cyl(micro, 0.22, 0.22, 1.4, M.black, 0, 3.0, -0.1, { rx: 0.5, seg: 12 });
  cyl(micro, 0.12, 0.12, 0.7, M.black, 0, 3.8, 0.35, { rx: 0.9, seg: 10 });
  micro.position.set(xw - 3.0, yTop, za + 11.8);
  micro.rotation.y = -Math.PI / 2;
  g.add(micro);
  interactive(R, micro, 'microscope');
  // máy đo pH cố định trên quầy (đã cắm điện sẵn)
  const ph = new THREE.Group();
  box(ph, 1.6, 0.7, 1.4, M.laminate, 0, 0.35, 0, { cast: true });
  const phCanvas = document.createElement('canvas');
  phCanvas.width = 256;
  phCanvas.height = 96;
  const phTex = new THREE.CanvasTexture(phCanvas);
  phTex.colorSpace = THREE.SRGBColorSpace;
  const phScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), new THREE.MeshBasicMaterial({ map: phTex }));
  phScreen.rotation.y = -Math.PI / 2;
  phScreen.position.set(-0.82, 0.45, 0);
  ph.add(phScreen);
  cyl(ph, 0.04, 0.04, 2.4, M.darkMetal, 0.5, 1.2, 0.3, { seg: 8 });
  const phB = decorBeaker(M, M.liquidClear, 0.6);
  phB.scale.setScalar(0.55);
  phB.position.set(0.2, 0, -1.0);
  ph.add(phB);
  ph.position.set(xw - 3.0, yTop, za + 15.2);
  g.add(ph);
  interactive(R, ph, 'phStation');
  R.refs.equipment = { lid, screenMat, microLight, phCanvas, phTex };
  R.refs.sideCounter = { x0: xw - d + 0.4, x1: xw - 0.6, z0: za + 0.5, z1: zb - 0.5 };
}

function buildFridge(g, M, R, za, zb) {
  const d = 6.5;
  const h = 18;
  const xw = X1;
  const xf = xw - d;
  const zc = (za + zb) / 2;
  const w = zb - za;
  const t = 0.25;
  // vỏ tủ lạnh rỗng: nóc, đáy, hai vách, lưng, vách ngăn ngăn đá
  box(g, d, t, w, M.laminate, xw - d / 2, FY + h - t / 2, zc, { cast: true });
  box(g, d, t, w, M.laminate, xw - d / 2, FY + 0.3 + t / 2, zc);
  box(g, d, h, t, M.laminate, xw - d / 2, FY + h / 2, za + t / 2, { cast: true });
  box(g, d, h, t, M.laminate, xw - d / 2, FY + h / 2, zb - t / 2, { cast: true });
  box(g, t, h, w, M.laminate, xw - t / 2, FY + h / 2, zc);
  const ySplit = FY + h * 0.37;
  box(g, d - 0.3, 0.3, w, M.laminate, xw - d / 2, ySplit, zc);
  const inside = new THREE.MeshStandardMaterial({ color: 0xf4f7fa, emissive: 0xeaf4ff, emissiveIntensity: 0, roughness: 0.6 });
  const liner = box(g, 0.05, h * 0.6, w - 0.6, inside, xw - t - 0.03, ySplit + h * 0.31, zc);
  liner.userData.noMerge = true;
  // kệ kính + hóa chất bảo quản lạnh
  const shelfYs = [ySplit + 3.4, ySplit + 7.0];
  shelfYs.forEach((y) => box(g, d - 1.0, 0.08, w - 0.6, M.cabinetGlass, xw - d / 2 - 0.2, y, zc));
  [[ySplit + 0.15, 'h2o2'], [ySplit + 0.15, 'h2o2'], [shelfYs[0] + 0.05, 'h2o2']].forEach(([y, chem], i) => {
    const bt = chemBottle(R, M, chem, { scale: 0.8, kind: 'cabinetBottle' });
    bt.position.set(xf + 1.6 + (i % 2) * 1.2, y, za + 1.4 + i * 1.3);
    bt.rotation.y = -Math.PI / 2;
    g.add(bt);
  });
  // hai cánh tủ (bản lề phía zb)
  const door = (y0, hh, handleY) => {
    const P = new THREE.Group();
    P.position.set(xf - 0.06, 0, zb);
    box(P, 0.14, hh, w - 0.15, M.laminateDoor, 0, y0 + hh / 2, -(w - 0.15) / 2);
    box(P, 0.14, 3.0, 0.14, M.steel, -0.18, handleY, -(w - 0.6));
    g.add(P);
    interactive(R, P, 'cabinet', { storage: 'fridge' });
    addStoragePart(R, 'fridge', { obj: P, type: 'door', angle: 1.7, anchor: () => new THREE.Vector3(xf - 1, ySplit + 4, zc), open: 0, target: 0 });
    return P;
  };
  const upper = door(ySplit + 0.1, FY + h - ySplit - 0.2, ySplit + 3.5);
  door(FY + 0.35, ySplit - FY - 0.45, ySplit - 2.2);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), labelMaterial(STORAGES.fridge.short, STORAGES.fridge.tag));
  lab.rotation.y = -Math.PI / 2;
  lab.position.set(-0.08, FY + h - 1.4, -(w - 0.15) / 2);
  upper.add(lab);
  const disp = box(g, 0.04, 0.5, 1.0, M.displayGreen, xf - 0.16, FY + h - 0.6, zc);
  interactive(R, disp, 'cabinet', { storage: 'fridge' });
  contactShadow(g, M, d + 2, w + 2, xw - d / 2, FY, zc, 0.45);
  R.refs.fridge = { inside };
}

// ------------------------------------------------------------
// 8. Tường trước: cửa ra vào, bảng trắng, vòi rửa mắt khẩn cấp, bình chữa cháy
// ------------------------------------------------------------
function buildFrontWall(g, M, R) {
  const zw = Z1;
  const rot = Math.PI;
  // cửa ra vào có ô kính (bản lề bên trái, mở vào trong phòng)
  const dx = -4;
  box(g, 9.6, 21.4, 0.4, M.alu, dx, FY + 10.7, zw - 0.2);
  const doorP = new THREE.Group();
  doorP.position.set(dx - 4.5, 0, zw - 0.35);
  box(doorP, 9.0, 21, 0.3, M.laminateDoor, 4.5, FY + 10.5, 0);
  const vision = plane(doorP, 1.6, 6, M.cabinetGlass, 4.5 + 2.4, FY + 14, -0.17, 0, rot);
  vision.receiveShadow = false;
  box(doorP, 1.8, 0.2, 0.3, M.steel, 4.5 + 3.2, FY + 10, -0.25);
  g.add(doorP);
  interactive(R, doorP, 'door');
  const exit = new THREE.MeshStandardMaterial({ map: signTexture('LỐI RA', '#1f8a4c'), emissive: 0x1f8a4c, emissiveIntensity: 0.4 });
  const exitSign = plane(g, 2.6, 0.95, exit, dx, FY + 22.6, zw - 0.05, 0, rot);
  interactive(R, exitSign, 'door');
  // công tắc đèn trần cạnh cửa
  const sw = new THREE.Group();
  sw.position.set(dx - 6, FY + 11, zw - 0.08);
  box(sw, 0.9, 1.3, 0.1, M.laminate, 0, 0, 0);
  const rocker = box(sw, 0.35, 0.6, 0.08, M.laminateDoor, 0, 0, -0.08);
  rocker.rotation.x = 0.2;
  g.add(sw);
  interactive(R, sw, 'lights');
  R.refs.lightSwitch = { rocker };

  // bảng trắng (viết được)
  const wb = new THREE.Group();
  box(wb, 16.4, 8.4, 0.3, M.alu, 14, 9.5, zw - 0.15);
  plane(wb, 16, 8, M.whiteboard, 14, 9.5, zw - 0.32, 0, rot);
  box(wb, 14, 0.25, 0.7, M.alu, 14, 5.2, zw - 0.45);
  for (const [x, mat] of [
    [12, M.capBlue],
    [12.8, M.capRed],
    [13.6, M.capBlack],
  ]) {
    cyl(wb, 0.08, 0.08, 0.7, mat, x, 5.42, zw - 0.5, { rz: Math.PI / 2, seg: 8 });
  }
  g.add(wb);
  interactive(R, wb, 'whiteboard');

  // trạm rửa mắt / tắm khẩn cấp
  const ex = -20;
  const eye = new THREE.Group();
  cyl(eye, 0.22, 0.22, CY - FY - 1, M.capGreen, ex, (FY + CY) / 2 - 0.5, zw - 1.0, { seg: 12 });
  const head = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.8, 24, 1, true), M.capGreen);
  head.position.set(ex, CY - 5, zw - 2.2);
  head.material.side = THREE.DoubleSide;
  eye.add(head);
  cyl(eye, 0.15, 0.15, 1.4, M.capGreen, ex, CY - 4.6, zw - 1.6, { rx: Math.PI / 2, seg: 10 });
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.5, 0.5, 20, 1, true), M.capGreen);
  bowl.position.set(ex, FY + 10.5, zw - 1.8);
  eye.add(bowl);
  const pull = box(eye, 0.15, 0.15, 1.2, M.capYellow, ex + 0.9, FY + 9.6, zw - 1.6);
  pull.rotation.x = 0.4;
  g.add(eye);
  interactive(R, eye, 'eyewash');
  const eyeSign = new THREE.MeshStandardMaterial({ map: signTexture('RỬA MẮT KHẨN CẤP', '#1f8a4c'), roughness: 0.6 });
  plane(eye, 4.2, 1.4, eyeSign, ex, 16, zw - 0.05, 0, rot);
  R.refs.eyewash = { bowlTop: new THREE.Vector3(ex, FY + 10.8, zw - 1.8), shower: new THREE.Vector3(ex, CY - 5.4, zw - 2.2) };

  // còi và đèn chớp báo cháy (đỏ) trên các bức tường
  const strobeMat = new THREE.MeshStandardMaterial({ color: 0xffd5d5, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.3 });
  const strobe = (x, y, z, ry) => {
    const s1 = new THREE.Group();
    s1.position.set(x, y, z);
    s1.rotation.y = ry;
    box(s1, 1.0, 1.3, 0.3, M.red, 0, 0, 0.15);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.12), strobeMat);
    lens.position.set(0, 0.35, 0.33);
    s1.add(lens);
    for (let i = 0; i < 3; i++) box(s1, 0.6, 0.05, 0.02, M.black, 0, -0.2 - i * 0.15, 0.31);
    g.add(s1);
    interactive(R, s1, 'alarmStrobe');
  };
  strobe(-13, 17, zw - 0.02, Math.PI);
  strobe(-1, 17, Z0 + 0.02, 0);
  strobe(X1 - 0.02, 17, 6, -Math.PI / 2);
  strobe(X0 + 0.02, 17, 18, Math.PI / 2);
  R.refs.strobeMat = strobeMat;

  // nút báo cháy bằng tay (kính vỡ) cạnh cửa
  const call = new THREE.Group();
  call.position.set(dx - 7.6, FY + 12.5, zw - 0.08);
  box(call, 1.3, 1.3, 0.3, M.red, 0, 0, -0.1);
  const callFace = new THREE.MeshStandardMaterial({ map: signTexture('BÁO CHÁY', '#c62828'), roughness: 0.5 });
  plane(call, 0.95, 0.36, callFace, 0, 0.35, -0.26, 0, rot);
  const glassBtn = box(call, 0.7, 0.5, 0.06, M.cabinetGlass, 0, -0.2, -0.27);
  glassBtn.receiveShadow = false;
  g.add(call);
  interactive(R, call, 'callPoint');

  // chăn chống cháy (hộp treo tường, kéo dây để lấy chăn)
  const blanket = new THREE.Group();
  blanket.position.set(-23.4, 4.2, zw - 0.35);
  box(blanket, 1.6, 2.0, 0.5, M.red, 0, 0, 0, { cast: true });
  const bl = new THREE.MeshStandardMaterial({ map: signTexture('CHĂN CHỐNG CHÁY', '#c62828'), roughness: 0.6 });
  plane(blanket, 1.4, 0.5, bl, 0, 0.45, -0.26, 0, rot);
  for (const sx of [-0.35, 0.35]) {
    box(blanket, 0.06, 1.2, 0.06, M.black, sx, -1.4, -0.2);
    box(blanket, 0.22, 0.22, 0.1, M.black, sx, -2.05, -0.2);
  }
  g.add(blanket);
  interactive(R, blanket, 'fireBlanket');

  // xô cát khô (dập đám cháy kim loại kiềm, đám cháy nhỏ)
  const sand = new THREE.Group();
  sand.position.set(-23.4, FY, zw - 1.6);
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.7, 1.6, 24, 1, true), M.red);
  bucket.material = M.red;
  bucket.position.y = 0.8;
  bucket.castShadow = true;
  sand.add(bucket);
  cyl(sand, 0.7, 0.7, 0.05, M.red, 0, 0.03, 0, { seg: 24 });
  cyl(sand, 0.8, 0.8, 0.06, new THREE.MeshStandardMaterial({ color: 0xd8c08a, roughness: 1 }), 0, 1.4, 0, { seg: 24 });
  const scoop = box(sand, 0.45, 0.08, 0.7, M.steel, 0.3, 1.5, 0.2);
  scoop.rotation.x = -0.4;
  const sandSign = new THREE.MeshStandardMaterial({ map: signTexture('CÁT KHÔ', '#c62828'), roughness: 0.6 });
  plane(sand, 1.2, 0.45, sandSign, 0, 0.9, -0.86, 0, rot);
  g.add(sand);
  interactive(R, sand, 'sandBucket');

  // bình chữa cháy + tủ sơ cứu
  const ext = new THREE.Group();
  cyl(ext, 0.55, 0.55, 2.8, M.red, -27, FY + 6.5, zw - 0.8, { seg: 18 });
  cyl(ext, 0.2, 0.25, 0.5, M.black, -27, FY + 8.15, zw - 0.8, { seg: 10 });
  cyl(ext, 0.06, 0.06, 1.6, M.black, -26.5, FY + 7.4, zw - 0.6, { seg: 8, rz: 0.4 });
  g.add(ext);
  interactive(R, ext, 'extinguisher');
  // tủ sơ cứu treo tường: lòng tủ rỗng, cửa mở được, có đồ sơ cứu bên trong
  const aidBox = new THREE.Group();
  aidBox.position.set(-27, 6, zw);
  box(aidBox, 2.2, 0.08, 0.9, M.laminate, 0, 1.06, -0.45);
  box(aidBox, 2.2, 0.08, 0.9, M.laminate, 0, -1.06, -0.45);
  box(aidBox, 0.08, 2.2, 0.9, M.laminate, -1.06, 0, -0.45);
  box(aidBox, 0.08, 2.2, 0.9, M.laminate, 1.06, 0, -0.45);
  box(aidBox, 2.2, 2.2, 0.06, M.cabInterior, 0, 0, -0.05);
  box(aidBox, 2.0, 0.05, 0.75, M.laminate, 0, 0.05, -0.45);
  box(aidBox, 0.6, 0.45, 0.5, M.paper, -0.55, 0.3, -0.45); // hộp băng gạc
  box(aidBox, 0.5, 0.35, 0.5, M.capBlue, 0.2, 0.25, -0.45);
  cyl(aidBox, 0.14, 0.14, 0.6, M.hdpe, 0.7, -0.68, -0.45, { seg: 12 }); // nước muối sinh lý
  cyl(aidBox, 0.1, 0.1, 0.35, M.capGreen, 0.35, -0.8, -0.45, { seg: 10 }); // thuốc mỡ bỏng
  box(aidBox, 0.7, 0.3, 0.4, M.capRed, -0.45, -0.85, -0.45); // kéo, nhíp, găng
  const aidDoor = new THREE.Group();
  aidDoor.position.set(-1.1, 0, -0.92);
  box(aidDoor, 2.2, 2.2, 0.08, M.laminate, 1.1, 0, 0);
  const aid = new THREE.MeshStandardMaterial({ map: signTexture('SƠ CỨU', '#1f8a4c'), roughness: 0.6 });
  plane(aidDoor, 1.8, 0.65, aid, 1.1, 0, -0.05, 0, rot);
  aidBox.add(aidDoor);
  g.add(aidBox);
  interactive(R, aidBox, 'firstAid');
  R.refs.firstAidDoor = aidDoor;

  // móc treo áo blouse (mặc / cởi áo)
  const coats = new THREE.Group();
  const hookBar = new THREE.Group();
  box(hookBar, 6, 0.3, 0.3, M.alu, 26, 9, zw - 0.15);
  g.add(hookBar);
  interactive(R, hookBar, 'coat');
  for (const x of [24.5, 26.5]) {
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 8.5, 16, 1, true), M.paper);
    coat.position.set(x, 4.6, zw - 1.0);
    coat.scale.z = 0.45;
    coat.castShadow = true;
    coats.add(coat);
  }
  g.add(coats);
  interactive(R, coats, 'coat');
  R.refs.coats = coats;
}

// ------------------------------------------------------------
// 8b. Giá bình khí nén (sát tường trái, gần cửa ra vào)
// ------------------------------------------------------------
function buildGasRack(g, M, R) {
  const x = X0 + 1.3;
  const list = [
    [17.5, 'o2', 0x1f2937, 0xf8fafc],
    [19.5, 'h2', 0xb91c1c, 0xb91c1c],
    [21.5, 'co2', 0x6b7280, 0x6b7280],
    [23.5, 'methane', 0x9a3412, 0xb91c1c],
    [25.5, 'so2', 0x3f3f46, 0xca8a04],
  ];
  const rackBars = new THREE.Group();
  box(rackBars, 0.3, 0.3, 8.6, M.darkMetal, X0 + 0.2, FY + 9, 21.5);
  box(rackBars, 0.3, 0.3, 8.6, M.darkMetal, X0 + 0.2, FY + 4, 21.5);
  g.add(rackBars);
  interactive(R, rackBars, 'gasRack');
  for (const [z, chem, body, shoulder] of list) {
    const c = new THREE.Group();
    c.position.set(x, 0, z);
    const bodyMat = new THREE.MeshStandardMaterial({ color: body, roughness: 0.4, metalness: 0.3 });
    const shMat = new THREE.MeshStandardMaterial({ color: shoulder, roughness: 0.4, metalness: 0.3 });
    cyl(c, 0.9, 0.9, 12, bodyMat, 0, FY + 6.2, 0, { seg: 24, cast: true });
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), shMat);
    top.position.y = FY + 12.2;
    c.add(top);
    cyl(c, 0.2, 0.2, 0.6, M.steel, 0, FY + 13.3, 0, { seg: 12 });
    cyl(c, 0.32, 0.32, 0.3, M.brushed, 0.25, FY + 13.8, 0, { seg: 14, rz: Math.PI / 2 });
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), labelMaterial(CHEM_LABELS[chem], '#64748b'));
    lab.rotation.y = Math.PI / 2;
    lab.position.set(0.92, FY + 8, 0);
    c.add(lab);
    // xích giữ bình
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.04, 6, 30), M.steel);
    chain.rotation.x = Math.PI / 2;
    chain.position.y = FY + 9;
    c.add(chain);
    g.add(c);
    interactive(R, c, 'gasCylinder', { chem });
  }
  const sign = new THREE.MeshStandardMaterial({ map: signTexture('KHÍ NÉN', '#64748b'), roughness: 0.6 });
  interactive(R, plane(g, 3.0, 0.95, sign, X0 + 0.06, FY + 16, 21.5, 0, Math.PI / 2), 'gasRack');
  contactShadow(g, M, 3, 9.5, x, FY, 21.5, 0.4);
}

// ------------------------------------------------------------
// 9. Ghế lab
// ------------------------------------------------------------
function stool(M) {
  const g = new THREE.Group();
  const seat = new THREE.Group();
  seat.name = 'seat';
  cyl(seat, 1.2, 1.2, 0.5, M.black, 0, 6.2 + FY, 0, { seg: 24, cast: true });
  cyl(seat, 0.18, 0.18, 5.0, M.steel, 0, 3.6 + FY, 0, { seg: 12, cast: true });
  g.add(seat);
  cyl(g, 0.24, 0.24, 2.4, M.darkMetal, 0, FY + 1.6, 0, { seg: 12 }); // ống ben khí nâng hạ
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.07, 8, 28), M.steel);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = FY + 2.6;
  g.add(ring);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = box(g, 1.6, 0.15, 0.25, M.darkMetal, Math.cos(a) * 0.8, FY + 0.45, Math.sin(a) * 0.8, { cast: true });
    leg.rotation.y = -a;
    cyl(g, 0.16, 0.16, 0.25, M.rubber, Math.cos(a) * 1.55, FY + 0.15, Math.sin(a) * 1.55, { seg: 10 });
  }
  g.userData.seat = seat;
  return g;
}

// ------------------------------------------------------------
// 10. Trạng thái "đang làm thí nghiệm": các chi tiết đổi dần theo số dụng cụ trên bàn
// ------------------------------------------------------------
function createActivity(g, M, R, ends, shelfInfo) {
  const items = [];
  // kiểu "move": dời vật từ vị trí gọn sang vị trí đang dùng; kiểu "show": hiện dần ra; "hide": ẩn dần
  const add = (obj, need, kind, to = null) => {
    const from = { p: obj.position.clone(), r: obj.rotation.y };
    items.push({ obj, need, kind, from, to, t: 0 });
    if (kind === 'show') obj.scale.setScalar(0.0001);
  };

  // 1+ dụng cụ: ghế được kéo ra khỏi bàn
  const s1 = stool(M);
  s1.position.set(-3.5, 0, 6.0);
  g.add(s1);
  const s2 = stool(M);
  s2.position.set(4.5, 0, 6.0);
  s2.rotation.y = 0.8;
  g.add(s2);
  interactive(R, s1, 'stool', { index: 0 });
  interactive(R, s2, 'stool', { index: 1 });
  R.refs.stools = [s1, s2];
  add(s1, 1, 'move', { p: new THREE.Vector3(-2.6, 0, 8.6), r: 0.5 });

  // 2+: sổ ghi chép được mở ra, bút đặt cạnh
  add(ends.nbClosed, 2, 'hide');
  add(ends.nbOpen, 2, 'show');
  ends.pen.position.set(-10.3, 0, 2.2);
  ends.pen.rotation.y = 1.45;
  add(ends.pen, 2, 'move', { p: new THREE.Vector3(-8.0, 0.1, 3.3), r: 0.6 });
  interactive(R, ends.pen, 'notebook');

  // 4+: bình tia được lấy ra gần chỗ làm
  ends.wb.position.set(10.5, 0, -0.9);
  ends.wb.rotation.y = 0;
  add(ends.wb, 4, 'move', { p: new THREE.Vector3(7.9, 0, 0.8), r: 0.9 });

  // 5+: một chai thuốc thử được lấy từ kệ xuống bàn, nắp mở để bên cạnh
  const reagent = new THREE.Group();
  const body = new THREE.Mesh(DECOR_GEO.bottle, M.amber);
  const lab = new THREE.Mesh(DECOR_GEO.label, M.label);
  lab.position.y = 0.65;
  reagent.add(body, lab);
  reagent.traverse((c) => c.isMesh && (c.castShadow = true));
  reagent.position.set(7.75, 4.68, shelfInfo.rz);
  g.add(reagent);
  interactive(R, reagent, 'shelfBottle', { chem: 'hno3' });
  add(reagent, 5, 'move', { p: new THREE.Vector3(7.95, 0, 2.9), r: 0.4, arc: 2.0 });
  const cap = new THREE.Mesh(DECOR_GEO.cap, M.capBlack);
  cap.position.set(8.1, 0.11, 3.9);
  cap.castShadow = true;
  g.add(cap);
  add(cap, 5, 'show');
  interactive(R, cap, 'shelfBottle', { chem: 'hno3' });
  // nắp chai trên kệ (ẩn khi chai được lấy xuống)
  const capOnShelf = new THREE.Mesh(DECOR_GEO.cap, M.capBlack);
  capOnShelf.position.set(7.75, 4.68 + 1.82, shelfInfo.rz);
  g.add(capOnShelf);
  add(capOnShelf, 5, 'hide');
  interactive(R, capOnShelf, 'shelfBottle', { chem: 'hno3' });

  const ease = (x) => x * x * (3 - 2 * x);
  return function update(dt, count) {
    for (const it of items) {
      const target = count >= it.need ? 1 : 0;
      if (Math.abs(it.t - target) < 1e-3) {
        if (it.t !== target) it.t = target;
        else continue;
      } else it.t += (target - it.t) * Math.min(1, dt * 2.2);
      const k = ease(it.t);
      if (it.kind === 'show' || it.kind === 'hide') {
        const s = it.kind === 'show' ? k : 1 - k;
        it.obj.scale.setScalar(Math.max(0.0001, s));
        it.obj.visible = s > 0.002;
      } else {
        it.obj.position.lerpVectors(it.from.p, it.to.p, k);
        if (it.to.arc) it.obj.position.y += Math.sin(k * Math.PI) * it.to.arc;
        it.obj.rotation.y = it.from.r + (it.to.r - it.from.r) * k;
      }
    }
  };
}

// ------------------------------------------------------------
// Gộp các khối tĩnh dùng chung vật liệu thành một lưới (ít lệnh vẽ hơn → mượt hơn trên MacBook)
// ------------------------------------------------------------
function mergeStaticMeshes(root, keep = new Set()) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const isKept = (o) => {
    for (let p = o; p && p !== root; p = p.parent) if (keep.has(p) || p.userData.noMerge) return true;
    return false;
  };
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || isKept(o)) return;
    const geo = o.geometry;
    if (!geo.index || !geo.attributes.normal || !geo.attributes.uv) return;
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    let vCount = 0;
    let iCount = 0;
    list.forEach((m) => {
      vCount += m.geometry.attributes.position.count;
      iCount += m.geometry.index.count;
    });
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const uv = new Float32Array(vCount * 2);
    const idx = new Uint32Array(iCount);
    let vo = 0;
    let io = 0;
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    for (const m of list) {
      const gsrc = m.geometry;
      const P = gsrc.attributes.position;
      const N = gsrc.attributes.normal;
      const U = gsrc.attributes.uv;
      rel.multiplyMatrices(inv, m.matrixWorld);
      nm.getNormalMatrix(rel);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(rel);
        pos.set([v.x, v.y, v.z], (vo + i) * 3);
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        nor.set([v.x, v.y, v.z], (vo + i) * 3);
        uv.set([U.getX(i), U.getY(i)], (vo + i) * 2);
      }
      const I = gsrc.index;
      for (let i = 0; i < I.count; i++) idx[io + i] = I.getX(i) + vo;
      vo += P.count;
      io += I.count;
      m.parent.remove(m);
      gsrc.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.setIndex(new THREE.BufferAttribute(idx, 1));
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    mesh.renderOrder = list[0].renderOrder;
    root.add(mesh);
  }
}

// ------------------------------------------------------------
// Vật liệu mặt bàn chính (main.js dùng cho mặt bàn có sẵn)
// ------------------------------------------------------------
let sharedMaterials = null;
function materials() {
  if (!sharedMaterials) sharedMaterials = createMaterials();
  return sharedMaterials;
}

export function createBenchTopMaterial() {
  return materials().epoxy;
}

// ------------------------------------------------------------
// Dựng toàn bộ phòng. Trả về { group, update(dt, benchItemCount) }
// ------------------------------------------------------------
export function createLabRoom(scene) {
  const M = materials();
  const g = new THREE.Group();
  g.name = 'lab-room';
  const R = makeRegistry();
  buildShell(g, M);
  buildWindowWall(g, M, R);
  buildCeiling(g, M, R);
  const shelfInfo = buildMainBench(g, M, R);
  const ends = buildBenchEnds(g, M, R);
  buildBackCounter(g, M, R);
  buildFumeHood(g, M, R, -21, -9);
  buildChemicalCabinet(g, M, R, -8.5, -2);
  buildFridge(g, M, R, -1.5, 4);
  buildSideCounterEquipment(g, M, R, 5, 24);
  buildFrontWall(g, M, R);
  buildGasRack(g, M, R);
  // gộp khối tĩnh trước khi thêm các vật sẽ di chuyển theo trạng thái thí nghiệm
  mergeStaticMeshes(g, new Set([ends.wb, ends.nbClosed, ends.nbOpen, ends.pen]));
  // gộp tiếp bên trong từng cánh tủ / ngăn kéo (các phần di chuyển cùng nhau)
  for (const o of R.items) if (o.userData.interactive.kind === 'cabinet') mergeStaticMeshes(o);
  const updateActivity = createActivity(g, M, R, ends, shelfInfo);
  R.refs.panelLight = M.panelLight;
  R.refs.whiteboard = M.whiteboard;
  R.refs.clock = M.clock;
  R.refs.room = { ...ROOM };
  R.refs.backCounter = { x0: -28.6, x1: 24.6, z0: Z0 + 0.6, z1: Z0 + 6.2 };
  // đồ nền không nhận lựa chọn chuột (chỉ vật trên bàn mới được chọn)
  g.traverse((o) => {
    o.userData.isRoom = true;
  });
  scene.add(g);
  return {
    group: g,
    registry: R,
    update(dt, count) {
      updateActivity(dt, count);
    },
  };
}

// ------------------------------------------------------------
// Ánh sáng phòng: nâng cấp các đèn sẵn có trong main.js (không tạo hệ thống mới)
// ------------------------------------------------------------
export function applyLabLighting({ scene, renderer, hemi, sun, fill }) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.type = THREE.PCFShadowMap; // bản Three.js này: PCF đã lọc mềm theo shadow.radius
  scene.background = new THREE.Color(0xe6e9ec);
  scene.fog = new THREE.Fog(0xe6e9ec, 60, 120);

  // ánh sáng trần (tán xạ đều từ trên xuống) + phản xạ từ sàn sáng
  hemi.color.set(0xffffff);
  hemi.groundColor.set(0xb9b6ae);
  hemi.intensity = 0.5;

  // đèn chính từ trần, đổ bóng mềm lên bàn
  sun.color.set(0xfffaf2);
  sun.intensity = 2.1;
  sun.position.set(5, 22, 7);
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 50;
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.camera.updateProjectionMatrix();

  // ánh sáng ban ngày qua cửa sổ bên trái
  fill.color.set(0xe4eefc);
  fill.intensity = 0.9;
  fill.position.set(-30, 14, -2);
}

// Giới hạn điều khiển camera: xoay được trọn vòng để nhìn mọi bức tường
export function limitCameraToRoom(controls) {
  controls.maxDistance = 24;
  controls.minPolarAngle = 0.3; // không nhìn thẳng từ trần xuống
}

// Mỗi khung hình: giữ camera ở trong phòng, không xuyên tường, tủ sát tường hay trần
export function clampCameraToRoom(camera, controls) {
  const p = camera.position;
  const x0 = X0 + 1.5;
  const x1 = X1 - 7.5; // trước dãy tủ hút, tủ lạnh, quầy thiết bị
  const z0 = Z0 + 7.5; // trước quầy bồn rửa và tủ kính treo tường
  const z1 = Z1 - 1.5;
  const y1 = CY - 1.5;
  const nx = THREE.MathUtils.clamp(p.x, x0, x1);
  const nz = THREE.MathUtils.clamp(p.z, z0, z1);
  const ny = Math.min(p.y, y1);
  if (nx !== p.x || nz !== p.z || ny !== p.y) {
    p.set(nx, ny, nz);
    // điểm nhìn cũng phải ở trong phòng để không giật hình
    const t = controls.target;
    t.x = THREE.MathUtils.clamp(t.x, X0 + 1, X1 - 1);
    t.z = THREE.MathUtils.clamp(t.z, Z0 + 1, Z1 - 1);
  }
}

// Môi trường phản chiếu lấy từ chính căn phòng (kính, kim loại, mặt epoxy phản chiếu cửa sổ và đèn trần)
export function captureRoomEnvironment(renderer, scene, hidden = []) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const prevFog = scene.fog;
  scene.fog = null;
  hidden.forEach((o) => (o.visible = false));
  const rt = pmrem.fromScene(scene, 0.03, 0.1, 200, { size: 256, position: new THREE.Vector3(0, 6, 2) });
  hidden.forEach((o) => (o.visible = true));
  scene.fog = prevFog;
  pmrem.dispose();
  return rt.texture;
}

// Vị trí đặt dụng cụ mới hơi lệch tự nhiên (không thẳng hàng tăm tắp), cố định theo thứ tự
export function naturalPlacement(index) {
  const rnd = seeded(index * 7919 + 13);
  return { dx: (rnd() - 0.5) * 0.5, dz: (rnd() - 0.5) * 0.45, yaw: (rnd() - 0.5) * 0.6 };
}
