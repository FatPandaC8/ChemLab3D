// ============================================================
// ChemLab 3D — 5 thí nghiệm phản ứng có hoạt cảnh 3D và các bước làm sai
//  1. BaCl₂ + H₂SO₄ → BaSO₄↓ (trắng) + 2HCl
//  2. CaCO₃ + 2HCl → CaCl₂ + CO₂↑ + H₂O   (đá vôi tan dần, sủi bọt theo thời gian)
//  3. SO₂ + Br₂ + 2H₂O → 2HBr + H₂SO₄     (sục khí, nước brom mất màu dần)
//  4. CH₃COOH ⇌ CH₃COO⁻ + H⁺              (giấy quỳ hóa đỏ, hình ảnh ion phân li)
//  5. Tráng bạc: C₆H₁₂O₆ + 2[Ag(NH₃)₂]OH → C₅H₁₁O₅COONH₄ + 2Ag↓ + 3NH₃ + H₂O
// Mỗi thí nghiệm có một bước làm sai thường gặp. Khi người dùng làm sai:
// hiện cảnh báo đỏ giữa màn hình, hoạt cảnh hậu quả (bỏng tay, nổ bình, khí độc...),
// và yêu cầu "Rửa sạch và làm lại từ đầu".
// ============================================================
import * as THREE from 'three';
import { estimatePH } from './lab-ph.js';
import { STOCK_SPECS, LIQUID_COLORS, liquidColorFor, MOUTHS } from './lab-models.js';
import { fmtQ, MOLAR_VOLUME_ML } from './quantity.js';
import { heatSourceOf } from './assembly.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, ...o });

const M_CACO3 = 100.09;
const M_BASO4 = 233.39;
const M_AG = 107.87;

// ------------------------------------------------------------
// Tên hiển thị của sản phẩm phản ứng (không có trong thư viện)
// ------------------------------------------------------------
export const PRODUCT_NAMES = {
  baso4: 'Bari sunfat BaSO₄ (kết tủa trắng)',
  hcl_dil: 'Axit clohiđric loãng HCl',
  h2so4_dil: 'Axit sunfuric loãng H₂SO₄',
  cacl2: 'Canxi clorua CaCl₂ (dung dịch)',
  co2: 'Khí CO₂',
  hbr: 'Axit bromhiđric HBr',
  so2: 'SO₂ hòa tan (dư)',
  tollens: 'Thuốc thử Tollens [Ag(NH₃)₂]OH',
  ag2o: 'Bạc(I) oxit Ag₂O (kết tủa nâu)',
  ag: 'Bạc kim loại Ag (lớp gương)',
  gluconate: 'Amoni gluconat C₅H₁₁O₅COONH₄',
  caco3: 'Đá vôi CaCO₃ (cục)',
};

// ------------------------------------------------------------
// Mô hình: lọ đá vôi, giấy quỳ tím
// ------------------------------------------------------------
function buildLimestoneJar(fill = 1) {
  const g = new THREE.Group();
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xe6f2fb, transparent: true, opacity: 0.28, roughness: 0.05, transmission: 0.6, thickness: 0.05, depthWrite: false,
  });
  const jar = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.58, 0], [0.6, 0.05], [0.6, 1.05], [0.5, 1.15], [0.48, 1.25]].map(([r, y]) => new THREE.Vector2(r, y)), 36), glassMat);
  jar.renderOrder = 2;
  g.add(jar);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.16, 32), std(0x1e3a8a, { roughness: 0.6 }));
  cap.position.y = 1.33;
  cap.name = 'cap';
  g.add(cap);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.605, 0.605, 0.36, 32, 1, true), std(0xf8fafc, { side: THREE.DoubleSide, roughness: 0.8 }));
  label.position.y = 0.6;
  g.add(label);
  const lump = std(0xeceae2, { roughness: 0.95, flatShading: true });
  const n = Math.round(3 + 10 * clamp(fill, 0, 1));
  const piece = new THREE.Group();
  piece.name = 'solid-piece';
  for (let i = 0; i < n; i++) {
    const r = 0.11 + ((i * 37) % 5) * 0.012;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), lump);
    const a = i * 2.4;
    const rr = 0.18 + ((i * 53) % 7) * 0.04;
    m.position.set(Math.cos(a) * rr, 0.06 + r + Math.floor(i / 5) * 0.16, Math.sin(a) * rr);
    m.rotation.set(i, i * 0.7, i * 1.3);
    piece.add(m);
  }
  g.add(piece);
  return g;
}

function buildLitmusStrip() {
  const g = new THREE.Group();
  // đế: tấm sứ trắng nhỏ để đặt giấy quỳ (giữ giấy sạch, khô)
  const tile = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.6), std(0xf8fafc, { roughness: 0.4 }));
  tile.position.set(0.55, 0.03, 0);
  g.add(tile);
  const strip = new THREE.Group();
  strip.name = 'litmus-strip';
  const purple = 0x7e57c2;
  const dry = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.75, 0.2), std(purple, { roughness: 0.9 }));
  dry.position.y = 0.55 + 0.375;
  dry.name = 'litmus-dry';
  const wet = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.55, 0.2), std(purple, { roughness: 0.9 }));
  wet.position.y = 0.275;
  wet.name = 'litmus-wet';
  strip.add(dry, wet);
  // nằm ngang trên đế: trục dài của giấy theo +x
  strip.rotation.z = -Math.PI / 2;
  strip.position.set(-0.1, 0.07, 0);
  g.add(strip);
  return g;
}

export const REACTION_ITEMS = [
  {
    id: 'caco3',
    category: 'Solid',
    name: 'Calcium carbonate (đá vôi)',
    formula: 'CaCO₃ – dạng cục',
    desc: 'Đá vôi dạng cục nhỏ đựng trong lọ miệng rộng (50 g). Cho vài cục vào bình tam giác hoặc ống nghiệm rồi rót HCl loãng: đá vôi tan dần, sủi bọt khí CO₂.',
    props: [['Khối lượng mol', '100,09 g/mol'], ['Trạng thái', 'Rắn, màu trắng'], ['Khối lượng riêng', '≈ 2,71 g/cm³'], ['Độ tan trong nước', 'Rất ít tan']],
    safety: 'Ít nguy hiểm. Bình đang sinh khí CO₂ tuyệt đối không được đậy kín.',
    build: (fill = 1) => buildLimestoneJar(fill),
    solidStock: { symbol: 'CaCO₃', formula: 'CaCO₃', molarMass: M_CACO3, densityGmL: 2.71, grams: 50 },
  },
  {
    id: 'litmus',
    category: 'Equipment',
    name: 'Litmus paper',
    formula: 'Giấy quỳ tím',
    desc: 'Một mẩu giấy quỳ tím đặt trên tấm sứ. Chọn giấy quỳ, bấm P, rồi chọn cốc/bình có dung dịch và bấm P lần nữa để nhúng: axit làm quỳ hóa đỏ, bazơ làm quỳ hóa xanh. Mỗi mẩu chỉ dùng một lần.',
    props: [['Đổi màu', 'pH < 4,5: đỏ · pH > 8,3: xanh'], ['Dùng cho', 'Nhận biết axit – bazơ'], ['Dùng một lần', 'Có']],
    safety: 'Không nhúng giấy quỳ trực tiếp vào chai hóa chất gốc: làm nhiễm bẩn cả chai. Rót một ít ra cốc riêng rồi mới thử.',
    build: buildLitmusStrip,
  },
];

// miệng lọ đá vôi (để nghiêng đổ cục đá vào bình)
MOUTHS.caco3 = { r: 0.46, y: 1.25 };

// ------------------------------------------------------------
// Hướng dẫn 5 thí nghiệm (hiện trong bảng thông tin)
// ------------------------------------------------------------
export const EXPERIMENTS = [
  {
    n: 1,
    title: 'Kết tủa trắng BaSO₄',
    eq: 'BaCl₂ + H₂SO₄ → BaSO₄↓ + 2HCl',
    steps: ['Rót khoảng 10 mL dung dịch BaCl₂ 0,1 M vào ống nghiệm hoặc cốc.', 'Rót từ từ vài mL H₂SO₄ loãng 1 M vào: xuất hiện vẩn đục trắng rồi kết tủa trắng lắng xuống đáy.'],
    wrong: 'Rót nước hoặc dung dịch vào bình đang chứa H₂SO₄ đặc 98 % (pha loãng sai chiều).',
  },
  {
    n: 2,
    title: 'Đá vôi tác dụng với HCl sinh khí CO₂',
    eq: 'CaCO₃ + 2HCl → CaCl₂ + CO₂↑ + H₂O',
    steps: ['Lấy lọ đá vôi (mục Solid), cho 2–3 g đá vôi vào bình tam giác.', 'Rót 20–30 mL HCl loãng 2 M: đá vôi sủi bọt mạnh và tan dần.', 'Để miệng bình mở cho khí thoát ra.'],
    wrong: 'Đậy kín nút cao su vào bình đang sinh khí CO₂.',
  },
  {
    n: 3,
    title: 'Sục khí SO₂ vào nước brom',
    eq: 'SO₂ + Br₂ + 2H₂O → 2HBr + H₂SO₄',
    steps: ['Đặt cốc/ống nghiệm và bình khí SO₂ vào trong tủ hút (quạt hút đang bật).', 'Rót 10 mL nước brom (màu vàng cam) vào cốc.', 'Chọn bình SO₂, bấm P, chọn cốc, bấm P, nhập thể tích khí: nước brom nhạt màu dần rồi mất màu.'],
    wrong: 'Sục khí SO₂ ngoài tủ hút (hoặc khi quạt tủ hút đang tắt).',
  },
  {
    n: 4,
    title: 'Axit axetic điện li, làm quỳ tím hóa đỏ',
    eq: 'CH₃COOH ⇌ CH₃COO⁻ + H⁺',
    steps: ['Rót khoảng 10 mL CH₃COOH 1 M ra một cốc riêng.', 'Chọn giấy quỳ tím (mục Equipment), bấm P, chọn cốc, bấm P: phần giấy nhúng chuyển đỏ; trong dung dịch hiện các ion H⁺, CH₃COO⁻ (điện li yếu).'],
    wrong: 'Nhúng giấy quỳ trực tiếp vào chai axit gốc.',
  },
  {
    n: 5,
    title: 'Phản ứng tráng bạc của glucozơ',
    eq: 'C₆H₁₂O₆ + 2[Ag(NH₃)₂]OH → C₅H₁₁O₅COONH₄ + 2Ag↓ + 3NH₃ + H₂O',
    steps: [
      'Rót 2–3 mL AgNO₃ 0,1 M vào ống nghiệm, nhỏ dần NH₃ (0,1 mL NH₃ đặc là đủ) đến khi kết tủa nâu vừa tan hết → thuốc thử Tollens.',
      'Rót thêm 2 mL dung dịch glucozơ 10 %.',
      'Đun cách thủy: rót nước vào cốc, đặt cốc lên bếp gia nhiệt (cắm điện, bật), kéo ống nghiệm thả vào cốc. Khi đạt 60–70 °C, lớp bạc sáng như gương bám trên thành ống.',
    ],
    wrong: 'Đun ống nghiệm trực tiếp trên ngọn lửa (kẹp ống trên giá đỡ, đèn đặt ngay bên dưới).',
  },
];

// ------------------------------------------------------------
// Các bước làm sai và hậu quả
// ------------------------------------------------------------
const MISTAKES = {
  'acid-water': {
    exp: 1,
    wrong: 'Rót nước (hoặc dung dịch nước) vào H₂SO₄ đặc 98 %.',
    why: 'Khi hòa tan, H₂SO₄ đặc tỏa nhiệt rất mạnh (≈ 74 kJ/mol). Nước nhẹ hơn axit nên nổi trên bề mặt, nhận toàn bộ nhiệt và sôi bùng tức thì, làm axit đặc bắn tung tóe ra ngoài.',
    result: 'Axit sôi bắn lên tay gây bỏng hóa chất, bỏng nhiệt; hơi axit bốc lên.',
    correct: 'Dùng sẵn H₂SO₄ loãng 1 M. Nếu phải pha loãng: rót TỪ TỪ axit đặc vào nước (không làm ngược lại), vừa rót vừa khuấy. Sau đó mới nhỏ dung dịch BaCl₂.',
  },
  pressure: {
    exp: 2,
    wrong: 'Đậy kín nút cao su vào bình đang sinh khí CO₂.',
    why: 'Khí CO₂ sinh ra liên tục không thoát được, áp suất trong bình tăng nhanh vượt sức chịu của nút và thành thủy tinh.',
    result: 'Nút bật mạnh ra, bình thủy tinh nổ vỡ, mảnh thủy tinh và axit văng ra gây đứt tay, bỏng axit.',
    correct: 'Để miệng bình mở. Muốn thu khí thì dùng nút có ống dẫn khí xuyên qua (khí thoát ra ngoài), không bao giờ bịt kín bình đang có phản ứng sinh khí.',
  },
  'so2-outside': {
    exp: 3,
    wrong: 'Sục khí SO₂ vào nước brom ở ngoài tủ hút (hoặc quạt tủ hút đang tắt).',
    why: 'SO₂ không màu, mùi hắc, rất độc; phần khí không hấp thụ hết cùng hơi brom thoát thẳng ra phòng.',
    result: 'Khí độc lan ra phòng: ho, cay mắt, khó thở, tổn thương đường hô hấp.',
    correct: 'Đặt bình khí và cốc nước brom bên trong tủ hút, bật quạt hút, hạ cửa kính rồi mới mở khí.',
  },
  'litmus-stock': {
    exp: 4,
    wrong: 'Nhúng giấy quỳ trực tiếp vào chai hóa chất gốc.',
    why: 'Chất màu và sợi giấy hòa vào chai, làm bẩn toàn bộ hóa chất gốc; các lần dùng sau cho kết quả sai.',
    result: 'Chai hóa chất bị nhiễm bẩn (đổi màu, có vẩn giấy), phải loại bỏ cả chai.',
    correct: 'Rót một ít dung dịch ra cốc hoặc ống nghiệm riêng, rồi nhúng giấy quỳ (hoặc dùng đũa thủy tinh chấm lên giấy quỳ).',
  },
  'direct-heat': {
    exp: 5,
    wrong: 'Đun ống nghiệm chứa thuốc thử Tollens trực tiếp trên ngọn lửa.',
    why: 'Ngọn lửa làm đáy ống quá nóng cục bộ: dung dịch sôi bùng, phụt ra khỏi ống; bạc tách ra nhanh thành bột đen thay vì lớp gương; thuốc thử khô có thể tạo hợp chất bạc dễ nổ.',
    result: 'Dung dịch nóng phụt lên tay gây bỏng; ống có cặn đen, không tạo được gương bạc.',
    correct: 'Đun cách thủy: đặt ống nghiệm trong cốc nước nóng 60–70 °C, không lắc ống.',
  },
};

// dung dịch nước (rót vào axit đặc là sai)
const AQUEOUS = new Set(['water', 'hcl', 'hcl_dil', 'naoh', 'cuso4', 'cacl2', 'na2so4', 'hno3', 'ch3cooh', 'nh3', 'agno3', 'bacl2', 'na2co3', 'kmno4', 'h2o2', 'fecl3', 'h2so4_dil', 'brwater', 'glucose', 'tollens', 'nacl', 'baso4']);

const LITMUS = { red: 0xd62839, redPurple: 0xb03a6e, purple: 0x7e57c2, bluePurple: 0x5b5fd6, blue: 0x2563eb, bleached: 0xf1ede4 };

// ------------------------------------------------------------
// Ảnh chữ (sprite) dùng cho nhãn ion, cảnh báo trong cảnh 3D
// ------------------------------------------------------------
const spriteCache = new Map();
function textSprite(text, { color = '#ffffff', bg = 'rgba(15,23,42,0.85)', size = 0.5, border = null } = {}) {
  const key = `${text}|${color}|${bg}|${border}`;
  let tex = spriteCache.get(key);
  if (!tex) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = 'bold 44px system-ui, sans-serif';
    let w = 256;
    if (ctx) {
      ctx.font = font;
      w = Math.ceil(ctx.measureText(text).width) + 40;
    }
    c.width = w;
    c.height = 72;
    if (ctx) {
      ctx.font = font;
      ctx.fillStyle = bg;
      const r = 18;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(w, 0, w, 72, r);
      ctx.arcTo(w, 72, 0, 72, r);
      ctx.arcTo(0, 72, 0, 0, r);
      ctx.arcTo(0, 0, w, 0, r);
      ctx.fill();
      if (border) {
        ctx.strokeStyle = border;
        ctx.lineWidth = 6;
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(text, w / 2, 38);
    }
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData = { aspect: w / 72 };
    spriteCache.set(key, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(size * tex.userData.aspect, size, 1);
  s.renderOrder = 20;
  return s;
}

let puffTex = null;
function puffTexture() {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  puffTex = new THREE.CanvasTexture(c);
  return puffTex;
}

const SPH = new THREE.SphereGeometry(1, 10, 8);
const LUMP = new THREE.DodecahedronGeometry(1, 0);
const DISC = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);

// ------------------------------------------------------------
// Bàn tay (để thấy hậu quả bỏng / đứt tay)
// ------------------------------------------------------------
function buildHand(gloved) {
  const g = new THREE.Group();
  const mat = gloved ? std(0x5b8def, { roughness: 0.55 }) : std(0xe2b08f, { roughness: 0.65 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.17, 0.7), mat);
  palm.position.set(0, 0, 0);
  g.add(palm);
  const cap = (len, r, x, z, ry = 0) => {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
    f.rotation.x = Math.PI / 2;
    f.rotation.z = ry;
    f.position.set(x, 0.01, z);
    g.add(f);
    return f;
  };
  cap(0.36, 0.065, -0.22, -0.58);
  cap(0.42, 0.068, -0.07, -0.62);
  cap(0.4, 0.066, 0.08, -0.6);
  cap(0.32, 0.06, 0.22, -0.55);
  const thumb = cap(0.28, 0.072, -0.4, -0.12, 0.7);
  thumb.position.y = -0.02;
  // cổ tay / ống tay áo
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.8, 18), std(0xf8fafc, { roughness: 0.85 }));
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.set(0, 0, 0.72);
  g.add(sleeve);
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

// ============================================================
export function createReactionLab(ctx) {
  const { scene, animator } = ctx;
  const S = ctx.experimentState;
  if (!S.rx) S.rx = {};
  if (!S.litmus) S.litmus = {};
  const rt = new Map(); // dữ liệu chạy (không lưu): vid -> { mirrorMat, turbid, stopper, acc... }
  const runtime = (vid) => {
    if (!rt.has(vid)) rt.set(vid, { acc: 0, rebuild: 0 });
    return rt.get(vid);
  };
  const rxOf = (vid) => (S.rx[vid] ??= {});
  const fx = []; // vật thể hậu quả (vết axit, mảnh vỡ, bàn tay...) xóa khi rửa sạch
  const parts = []; // hạt đang bay: { m, v, life, kind, ... }
  let mistake = null; // { key, root, el }
  let toxic = null; // lớp phủ khí độc trên màn hình

  const vidOf = (root) => String(root.userData.instanceId);
  const isVessel = (root) => ctx.getSampleInfo(root.userData.itemId).kind === 'vessel';
  const recs = (vid) => S.pourRecords?.[vid] || [];
  const volOf = (vid) => S.liquidVolumes?.[vid] ?? 0;
  const molOfRecord = (r) => {
    if (r.moles != null) return r.moles;
    const M = STOCK_SPECS[r.chemicalId]?.molarity;
    return M ? ((r.volumeMl || 0) * M) / 1000 : 0;
  };
  const addedMol = (vid, ids) => recs(vid).reduce((s, r) => s + (ids.includes(r.chemicalId) ? molOfRecord(r) : 0), 0);
  const volOfIds = (vid, ids) => recs(vid).reduce((s, r) => s + (ids.includes(r.chemicalId) ? r.volumeMl || 0 : 0), 0);
  const log = (message) => S.log.push({ type: 'success', message, time: new Date().toLocaleTimeString() });
  const save = () => ctx.saveExperimentState(S);
  const mix = (vid) => (S.mixtures[vid] ??= []);
  const addMix = (vid, ...ids) => ids.forEach((id) => !mix(vid).includes(id) && mix(vid).push(id));
  const delMix = (vid, ...ids) => (S.mixtures[vid] = mix(vid).filter((x) => !ids.includes(x)));

  // ---------------- thành phần hiện tại ----------------
  function chem(vid) {
    const rx = S.rx[vid] || {};
    const caco3 = recs(vid).reduce((s, r) => s + (r.chemicalId === 'caco3' ? r.moles || 0 : 0), 0);
    const acid = Math.max(0, addedMol(vid, ['hcl', 'hcl_dil']) - (rx.hclUsed || 0));
    const br0 = addedMol(vid, ['brwater']);
    const ag = addedMol(vid, ['agno3']);
    const nh3 = addedMol(vid, ['nh3']);
    const glu0 = addedMol(vid, ['glucose']);
    const tollens = ag > 0 && nh3 >= 3 * ag * 0.999;
    return {
      caco3,
      acid,
      br0,
      brLeft: Math.max(0, br0 - (rx.brUsed || 0)),
      ag,
      nh3,
      tollens,
      ag2oFrac: ag > 0 && nh3 > 0 && !tollens ? (nh3 < ag ? nh3 / ag : (3 * ag - nh3) / (2 * ag)) : 0,
      glu: Math.max(0, glu0 - (rx.gluUsed || 0)),
      V: volOf(vid),
    };
  }
  const involved = (vid) =>
    Boolean(S.rx[vid]) || recs(vid).some((r) => ['caco3', 'brwater', 'glucose', 'agno3', 'h2so4'].includes(r.chemicalId));

  // ---------------- màu dung dịch ----------------
  function liquidColor(vid) {
    if (!involved(vid)) return null;
    const c = chem(vid);
    const solids = new Set(['caco3', 'baso4', 'ag2o', 'ag', 'cuoh2']);
    const base = liquidColorFor((S.mixtures[vid] || []).filter((x) => !solids.has(x) && x !== 'brwater'));
    if (c.br0 > 0 && c.V > 0) {
      const k = clamp(c.brLeft / (c.V / 1000) / 0.02, 0, 1.4);
      return new THREE.Color(0xeef2f6).lerp(new THREE.Color(LIQUID_COLORS.brwater), Math.pow(Math.min(1, k), 0.75)).getHex();
    }
    return base;
  }

  // ---------------- hình học lòng bình (tọa độ trong mô hình gốc) ----------------
  function localGeom(root) {
    const G = ctx.vesselGeom(root);
    if (!G) return null;
    root.updateWorldMatrix(true, true);
    const inner = root.userData.inner;
    const at = (y) => inner.worldToLocal(new THREE.Vector3(G.center.x, y, G.center.z)).y;
    return { bottomY: at(G.bottomY), surfaceY: at(G.surfaceY), mouthY: at(G.mouthY), radius: G.radius, world: G };
  }
  function wallProfile(root, top, inset = 0.012) {
    const prof = ctx.innerProfile(root.userData.itemId);
    if (!prof) return null;
    const pts = [];
    for (let i = 0; i < prof.length; i++) {
      const [r, y] = prof[i];
      if (y <= top) pts.push(new THREE.Vector2(Math.max(0, r - inset), y + (i === 0 ? 0.004 : 0)));
      else {
        const [r0, y0] = prof[i - 1];
        const k = (top - y0) / (y - y0);
        pts.push(new THREE.Vector2(Math.max(0, r0 + (r - r0) * k - inset), top));
        break;
      }
    }
    return pts.length >= 2 ? pts : null;
  }

  // ---------------- vẽ thêm trong bình: cục đá vôi, nút cao su, gương bạc, vẩn đục ----------------
  function decorate(root) {
    const inner = root.userData.inner;
    if (!inner) return;
    const old = inner.getObjectByName('rx-decor');
    if (old) {
      inner.remove(old);
      old.traverse((o) => {
        if (o.geometry && o.geometry !== LUMP && o.geometry !== SPH) o.geometry.dispose();
      });
    }
    if (root.userData.itemId === 'litmus') return decorateLitmus(root);
    if (!isVessel(root)) return;
    const vid = vidOf(root);
    // bình đã được đổ bỏ / rửa sạch: xóa trạng thái phản ứng cũ (giữ nút đậy nếu có)
    if (S.rx[vid] && !recs(vid).length && !(volOf(vid) > 0)) {
      if (S.rx[vid].stopper) S.rx[vid] = { stopper: true };
      else delete S.rx[vid];
      const keep = rt.get(vid);
      if (keep) keep.turbid = null;
    }
    const rx = S.rx[vid];
    const c = involved(vid) ? chem(vid) : null;
    const G = localGeom(root);
    if (!G) return;
    const grp = new THREE.Group();
    grp.name = 'rx-decor';
    const R = runtime(vid);
    // cục đá vôi dưới đáy, nhỏ dần khi phản ứng
    if (c && c.caco3 > 1e-7) {
      const total = recs(vid).reduce((s, r) => s + (r.chemicalId === 'caco3' ? r.massG0 ?? r.massG ?? 0 : 0), 0);
      const now = c.caco3 * M_CACO3;
      const n = clamp(Math.round(total * 1.6), 1, 10);
      const k = Math.cbrt(clamp(now / Math.max(total, 1e-9), 0.05, 1));
      const size = clamp(G.radius * 0.32, 0.04, 0.13);
      const mat = (R.lumpMat ??= std(0xeceae2, { roughness: 0.95, flatShading: true }));
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(LUMP, mat);
        const s = size * (0.75 + ((i * 29) % 5) * 0.08) * k;
        m.scale.setScalar(s);
        const a = i * 2.39996 + vid.length;
        const rr = Math.sqrt((i + 0.5) / n) * G.radius * 0.62;
        m.position.set(Math.cos(a) * rr, G.bottomY + s * 0.75 + Math.floor(i / 6) * s, Math.sin(a) * rr);
        m.rotation.set(i * 1.1, i * 0.7, i * 0.3);
        grp.add(m);
      }
      R.lumps = grp.children.slice();
    }
    // vẩn đục: trắng (BaSO₄ mới tạo), nâu (Ag₂O), đen (bạc dạng bột)
    const top = G.surfaceY - 0.01;
    if (c && c.V > 0 && top > G.bottomY + 0.02) {
      const cloud = R.turbid;
      const brown = c.ag2oFrac > 0.02 ? c.ag2oFrac : 0;
      const black = rx?.bumped ? 1 : 0;
      if (cloud || brown || black) {
        const pts = wallProfile(root, top, 0.02);
        if (pts) {
          pts.push(new THREE.Vector2(0, top));
          const color = black ? 0x26221f : brown ? 0x6b4423 : cloud.color;
          const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.0, roughness: 0.95, depthWrite: false });
          const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), mat);
          mesh.renderOrder = 4;
          mesh.name = 'rx-turbid';
          grp.add(mesh);
          R.turbidMat = mat;
          R.turbidBase = black ? 0.72 : brown ? 0.25 + 0.55 * brown : 0;
          mat.opacity = cloud ? cloud.op : R.turbidBase;
        }
      } else R.turbidMat = null;
    } else R.turbidMat = null;
    // gương bạc trên thành ống (tới mức chất lỏng)
    if (rx?.mirror > 0.001) {
      const lvl = Math.max(G.surfaceY, rx.mirrorTop ?? G.surfaceY);
      rx.mirrorTop = lvl;
      const pts = wallProfile(root, lvl, 0.006);
      if (pts) {
        const mat = (R.mirrorMat ??= new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.08, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
        mat.opacity = clamp(rx.mirror * 1.05, 0, 0.97);
        const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), mat);
        mesh.renderOrder = 5;
        mesh.name = 'rx-mirror';
        grp.add(mesh);
      }
    }
    // nút cao su ở miệng bình
    if (rx?.stopper) {
      const m = ctx.mouthOf(root) ?? { r: 0.3, y: G.mouthY };
      const r = Math.max(0.08, m.r);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.18, r * 0.86, 0.32, 24), std(0x7a2e22, { roughness: 0.8 }));
      st.position.y = m.y + 0.05;
      st.name = 'rx-stopper';
      st.castShadow = true;
      grp.add(st);
      R.stopper = st;
      R.stopperY = st.position.y;
    } else R.stopper = null;
    if (grp.children.length) inner.add(grp);
  }

  function decorateLitmus(root) {
    const st = S.litmus[vidOf(root)];
    const wet = root.getObjectByName('litmus-wet');
    if (wet && st) wet.material.color.setHex(st.color);
  }

  // ---------------- chặn / phát hiện bước sai trước khi rót ----------------
  // trả về { block } (không cho rót) hoặc { mistake } (vẫn rót, hậu quả sau khi rót xong)
  function checkPour({ sourceIds = [], sourceInstanceId = null, vessel }) {
    const bad = (sourceInstanceId != null ? checkSource(sourceInstanceId) : null) ?? blockedTarget(vessel);
    if (bad) return { block: bad };
    const vid = vidOf(vessel);
    // nước / dung dịch nước rót vào bình đang chứa phần lớn là H₂SO₄ đặc
    const conc = volOfIds(vid, ['h2so4']);
    const V = volOf(vid);
    const aqueous = sourceIds.length && sourceIds.every((id) => AQUEOUS.has(id));
    if (conc >= 0.5 && conc >= 0.3 * V && aqueous) return { mistake: 'acid-water' };
    return null;
  }

  // nguồn rót có bị chặn không (chai đã nhiễm bẩn)
  function checkSource(instanceId) {
    if (mistake) return 'Hãy bấm "Rửa sạch và làm lại từ đầu" trước khi làm tiếp.';
    if (S.litmus[String(instanceId)]) return 'Mẩu giấy quỳ này đã dùng rồi. Bỏ vào thùng rác (Xóa) và lấy mẩu mới.';
    if (S.samples?.[String(instanceId)]?.contaminated) return 'Chai này đã bị nhiễm bẩn (đã nhúng giấy quỳ vào chai gốc), không được dùng nữa.';
    return null;
  }

  // ---------------- sau khi rót xong vào bình ----------------
  function afterPour(vessel, { sourceIds = [], reaction = null, mistakeKey = null } = {}) {
    const vid = vidOf(vessel);
    const R = runtime(vid);
    if (mistakeKey) {
      trigger(mistakeKey, vessel);
      return;
    }
    // pha loãng đúng cách: axit đặc rót vào nước → H₂SO₄ loãng, dung dịch nóng lên
    const conc = recs(vid).filter((r) => r.chemicalId === 'h2so4');
    const concV = conc.reduce((s, r) => s + (r.volumeMl || 0), 0);
    const V = volOf(vid);
    if (concV > 0 && V - concV >= 2 * concV) {
      const n = conc.reduce((s, r) => s + molOfRecord(r), 0);
      const water = recs(vid).filter((r) => r.chemicalId === 'water');
      const wV = water.reduce((s, r) => s + (r.volumeMl || 0), 0);
      S.pourRecords[vid] = recs(vid).filter((r) => r.chemicalId !== 'h2so4' && r.chemicalId !== 'water');
      S.pourRecords[vid].push({ chemicalId: 'h2so4_dil', volumeMl: concV + wV, moles: n, note: 'pha loãng từ H₂SO₄ đặc' });
      const ids = mix(vid);
      if (ids.includes('h2so4')) {
        delMix(vid, 'h2so4', 'water');
        addMix(vid, 'h2so4_dil');
      }
      const dT = (n * 74000) / (V * 1.1 * 4.18);
      S.temperatures[vid] = Math.min(100, (S.temperatures[vid] ?? 25) + dT);
      log(`Pha loãng đúng cách: rót axit đặc vào nước. Dung dịch H₂SO₄ loãng nóng lên ≈ ${fmtQ(dT, 2)} °C (tỏa nhiệt khi hòa tan).`);
      ctx.showToast(`Pha loãng H₂SO₄ đúng cách (axit vào nước): dung dịch nóng lên ≈ ${fmtQ(dT, 2)} °C.`);
    }
    // BaSO₄: dung dịch vẩn đục trắng rồi trong dần khi kết tủa lắng
    if (reaction?.products?.includes('baso4')) {
      R.turbid = { color: 0xf8fafc, op: 0.82, t: 0, dur: 7 };
      const ba = addedMol(vid, ['bacl2']);
      const so4 = addedMol(vid, ['h2so4', 'h2so4_dil']) + (S.rx[vid]?.brUsed || 0);
      rxOf(vid).baso4 = Math.min(ba, so4);
    }
    // khí sinh ra tức thì (ví dụ Na₂CO₃ + HCl): tính là đang sinh khí trong ~7 s
    if (reaction?.hasGas) rxOf(vid).gasUntil = Date.now() + 7000;
    // thuốc thử Tollens: AgNO₃ + NH₃
    const c = chem(vid);
    if (c.ag > 0 && c.nh3 > 0) {
      const rx = rxOf(vid);
      if (c.tollens) {
        if (!rx.tollensMade) {
          rx.tollensMade = true;
          // nhỏ NH₃ vào AgNO₃: kết tủa nâu xuất hiện rồi tan trong NH₃ dư
          if (sourceIds.includes('nh3')) R.turbid = { color: 0x6b4423, op: 0.6, t: 0, dur: 3.2 };
          log('Đã tạo thuốc thử Tollens: AgNO₃ + 3NH₃ + H₂O → [Ag(NH₃)₂]OH + NH₄NO₃ (kết tủa nâu Ag₂O tan trong NH₃ dư).');
          ctx.showToast('Kết tủa nâu Ag₂O tan hết trong NH₃ dư → đã có thuốc thử Tollens [Ag(NH₃)₂]OH.');
        }
        delMix(vid, 'agno3', 'nh3', 'ag2o');
        addMix(vid, 'tollens');
      } else {
        addMix(vid, 'ag2o');
        ctx.showToast('Xuất hiện kết tủa nâu Ag₂O. Nhỏ thêm NH₃ đến khi kết tủa tan hết để được thuốc thử Tollens.');
      }
    }
    if (c.caco3 > 0 && c.acid > 0) {
      addMix(vid, 'cacl2');
      rxOf(vid).co2 ??= 0;
    }
    if (c.br0 > 0) rxOf(vid);
    if (c.glu > 0 && c.tollens) {
      const rx = rxOf(vid);
      if (!rx.mixedNote) {
        rx.mixedNote = true;
        ctx.showToast('Glucozơ + thuốc thử Tollens: ở nhiệt độ phòng phản ứng rất chậm. Hãy đun cách thủy 60–70 °C.');
      }
    }
    ctx.updateVesselLiquid(vessel);
    save();
  }

  // ---------------- chặn rót vào bình (nút đậy, bình vỡ, đang cảnh báo) ----------------
  function blockedTarget(root) {
    if (mistake) return 'Hãy bấm "Rửa sạch và làm lại từ đầu" trước khi làm tiếp.';
    if (root.userData.broken) return 'Bình đã vỡ.';
    if (isVessel(root) && S.rx[vidOf(root)]?.stopper) return `${ctx.nameOf(root)} đang đậy nút cao su. Hãy mở nút trước khi cho chất vào.`;
    return null;
  }

  // ---------------- nguồn đặc biệt: đá vôi, khí SO₂, giấy quỳ ----------------
  const handlesSource = (itemId) => itemId === 'caco3' || itemId === 'so2' || itemId === 'litmus';

  async function pour(source, sourceRoot, targetRoot) {
    const bad = checkSource(source.instanceId) ?? blockedTarget(targetRoot);
    if (bad) {
      ctx.showToast(bad, 'error');
      return;
    }
    if (source.itemId === 'litmus') return dipLitmus(sourceRoot, targetRoot);
    if (!isVessel(targetRoot)) {
      ctx.showToast('Đích nhận phải là cốc, bình hoặc ống nghiệm.', 'error');
      return;
    }
    if (source.itemId === 'caco3') return dropLimestone(source, sourceRoot, targetRoot);
    if (source.itemId === 'so2') return bubbleSO2(source, sourceRoot, targetRoot);
  }

  // ---- 2. Cho cục đá vôi vào bình ----
  async function dropLimestone(source, sourceRoot, vessel) {
    const sample = S.samples?.[source.instanceId];
    if (!sample || sample.amount <= 0) {
      ctx.showToast('Lọ đá vôi đã hết.', 'error');
      return;
    }
    const vid = vidOf(vessel);
    const grams = await ctx.askAmount({
      container: ctx.viewportEl,
      title: `Cho đá vôi (CaCO₃) vào ${ctx.nameOf(vessel)}`,
      unit: 'g',
      lines: [`Lọ còn: ${fmtQ(sample.amount, 6)} g (≈ ${fmtQ(sample.amount / M_CACO3)} mol CaCO₃)`, 'Thường dùng 2–3 g (vài cục nhỏ).'],
      confirmLabel: 'Cho vào',
      preview: (v) => `≈ ${fmtQ(v / M_CACO3)} mol CaCO₃ · ≈ ${fmtQ((v / M_CACO3) * MOLAR_VOLUME_ML)} mL CO₂ nếu tan hết`,
      validate: (v) => (v > sample.amount * (1 + 1e-9) ? `Lọ chỉ còn ${fmtQ(sample.amount, 6)} g.` : v > 20 ? 'Mỗi lần chỉ nên cho tối đa 20 g.' : null),
    });
    if (grams == null) return;
    ctx.clearSource();
    ctx.consumeSample(S, source.instanceId, grams);
    const n = grams / M_CACO3;
    S.pourRecords[vid] ??= [];
    S.pourRecords[vid].push({ chemicalId: 'caco3', phase: 'solid', massG: grams, massG0: grams, moles: n, volumeMl: 0 });
    addMix(vid, 'caco3');
    rxOf(vid).co2 ??= 0;
    log(`Đã cho ${fmtQ(grams, 4)} g đá vôi CaCO₃ (≈ ${fmtQ(n)} mol) vào ${ctx.nameOf(vessel)}.`);
    save();
    const restore = ctx.liftOut(sourceRoot);
    const pp = ctx.pourPoint(vessel, sourceRoot, 0.35);
    animator.dropSolid({
      source: sourceRoot,
      mouth: MOUTHS.caco3,
      targetPoint: pp.point,
      landing: () => ctx.vesselGeom(vessel),
      color: 0xeceae2,
      count: clamp(3 + grams * 1.5, 4, 14),
      grain: 0.085,
      tilt: 100,
      onDone: () => {
        restore();
        ctx.refreshStock(sourceRoot);
        afterPour(vessel, { sourceIds: ['caco3'] });
        const c = chem(vid);
        ctx.showToast(c.acid > 0 ? 'Đá vôi gặp axit HCl: sủi bọt khí CO₂, đá vôi tan dần.' : `Đã cho ${fmtQ(grams, 4)} g đá vôi vào ${ctx.nameOf(vessel)}. Rót HCl loãng vào để thấy khí CO₂.`);
        ctx.renderInfo();
      },
    });
  }

  // ---- 3. Sục khí SO₂ ----
  let gasJob = null;
  async function bubbleSO2(source, cyl, vessel) {
    const sample = S.samples?.[source.instanceId];
    const item = ctx.itemById.so2;
    if (!sample || sample.amount <= 0) {
      ctx.showToast('Bình khí SO₂ đã hết.', 'error');
      return;
    }
    const vid = vidOf(vessel);
    if (!(volOf(vid) > 0)) {
      ctx.showToast(`${ctx.nameOf(vessel)} chưa có dung dịch: khí sục vào sẽ thoát hết ra ngoài. Hãy rót nước brom vào trước.`, 'error');
      return;
    }
    const pc = cyl.getWorldPosition(new THREE.Vector3());
    const pv = vessel.getWorldPosition(new THREE.Vector3());
    if (Math.hypot(pc.x - pv.x, pc.z - pv.z) > 7) {
      ctx.showToast('Ống dẫn khí không đủ dài: hãy đặt bình khí SO₂ gần cốc (cách dưới 7 ô).', 'error');
      return;
    }
    const units = ctx.stockUnits(item);
    const c0 = chem(vid);
    const picked = await ctx.askAmount({
      container: ctx.viewportEl,
      title: `Sục khí SO₂ vào ${ctx.nameOf(vessel)}`,
      units,
      lines: [
        `Bình khí còn: ${fmtQ(sample.amount, 6)} mL (≈ ${fmtQ(sample.amount / MOLAR_VOLUME_ML)} mol SO₂)`,
        c0.brLeft > 0 ? `Br₂ trong cốc: ≈ ${fmtQ(c0.brLeft)} mol → cần ≈ ${fmtQ(c0.brLeft * MOLAR_VOLUME_ML, 3)} mL SO₂ để mất màu hết` : 'Cốc không có nước brom.',
      ],
      confirmLabel: 'Mở van, sục khí',
      preview: (v, u) => {
        const c = ctx.stockAmountToMl(item, v, u);
        return c.ok ? `≈ ${fmtQ(c.ml, 6)} mL khí · ≈ ${fmtQ(c.ml / MOLAR_VOLUME_ML)} mol SO₂` : '';
      },
      validate: (v, u) => {
        const c = ctx.stockAmountToMl(item, v, u);
        if (!c.ok) return c.error;
        if (c.ml > sample.amount * (1 + 1e-9)) return `Bình chỉ còn ${fmtQ(sample.amount, 6)} mL.`;
        return null;
      },
    });
    if (picked == null) return;
    let ml = ctx.stockAmountToMl(item, picked.value ?? picked, picked.unit ?? 'mL').ml;
    if (Math.abs(ml - sample.amount) < sample.amount * 1e-6) ml = sample.amount;
    ctx.clearSource();
    ctx.consumeSample(S, source.instanceId, ml);
    ctx.refreshStock(cyl);
    const nTotal = ml / MOLAR_VOLUME_ML;
    const hood = ctx.world?.hoodStatus(vessel) ?? { inside: false, fan: false };
    const outside = !(hood.inside && hood.fan);
    const rx = rxOf(vid);
    // ống dẫn khí từ van bình tới đáy cốc
    const box = new THREE.Box3().setFromObject(cyl);
    const valve = new THREE.Vector3(pc.x, box.max.y - 0.35, pc.z);
    const G = ctx.vesselGeom(vessel);
    const tip = new THREE.Vector3(G.center.x, G.bottomY + 0.12, G.center.z);
    const mouth = new THREE.Vector3(G.center.x, G.mouthY + 0.25, G.center.z);
    const curve = new THREE.CatmullRomCurve3([
      valve,
      valve.clone().add(new THREE.Vector3(0, 0.6, 0)),
      new THREE.Vector3((valve.x + mouth.x) / 2, Math.max(valve.y, mouth.y) + 1.2, (valve.z + mouth.z) / 2),
      mouth.clone().add(new THREE.Vector3(0, 0.5, 0)),
      mouth,
      tip,
    ]);
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0xe8eef3, transparent: true, opacity: 0, roughness: 0.25 });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.045, 10, false), tubeMat);
    tube.renderOrder = 6;
    scene.add(tube);
    const dur = clamp(2 + ml / 15, 3, 9);
    const bubMat = new THREE.MeshStandardMaterial({ color: 0xf8fbff, transparent: true, opacity: 0.6, roughness: 0.1, depthWrite: false });
    const bubbles = [];
    let e = 0;
    let acc = 0;
    let fed = 0;
    let rebuild = 0;
    let warned = false;
    const job = { vid, cancelled: false };
    gasJob = job;
    animator.task(
      (dt) => {
        e += dt;
        if (job.cancelled || !vessel.parent || !cyl.parent) {
          // đã rửa sạch, làm lại: khóa van, tháo ống
          bubbles.forEach((b) => scene.remove(b.m));
          scene.remove(tube);
          tube.geometry.dispose();
          tubeMat.dispose();
          bubMat.dispose();
          if (gasJob === job) gasJob = null;
          return true;
        }
        tubeMat.opacity = e < 0.6 ? e / 0.6 * 0.75 : e > dur + 1.2 ? Math.max(0, 0.75 - (e - dur - 1.2) / 0.6) : 0.75;
        const flowing = e > 0.7 && e < 0.7 + dur;
        const Gn = ctx.vesselGeom(vessel);
        // lượng khí đã sục tới thời điểm này (kể cả phần cuối khi khung hình chậm); Br₂ phản ứng tức thì với SO₂
        const want = nTotal * clamp((e - 0.7) / dur, 0, 1);
        const d = want - fed;
        if (d > 0) {
          fed = want;
          const c = chem(vid);
          const react = Math.min(d, c.brLeft);
          rx.brUsed = (rx.brUsed || 0) + react;
          rx.so2 = (rx.so2 || 0) + d;
        }
        if (flowing && Gn) {
          acc += dt * 22;
          while (acc >= 1) {
            acc -= 1;
            const b = new THREE.Mesh(SPH, bubMat);
            b.scale.setScalar(rand(0.025, 0.05));
            b.position.set(tip.x + rand(-0.04, 0.04), tip.y, tip.z + rand(-0.04, 0.04));
            scene.add(b);
            bubbles.push({ m: b, v: rand(0.5, 0.8) });
          }
          rebuild += dt;
          if (rebuild > 0.2) {
            rebuild = 0;
            ctx.updateVesselLiquid(vessel);
          }
          if (outside && e > 1.6 && !warned) {
            warned = true;
            trigger('so2-outside', vessel);
          }
        }
        for (let i = bubbles.length - 1; i >= 0; i--) {
          const b = bubbles[i];
          b.v += dt * 0.5;
          b.m.position.y += b.v * dt;
          b.m.position.x += Math.sin(e * 11 + i) * 0.002;
          if (!Gn || b.m.position.y >= Gn.surfaceY - 0.01) {
            scene.remove(b.m);
            bubbles.splice(i, 1);
          }
        }
        if (e >= dur + 1.9 && bubbles.length === 0) {
          scene.remove(tube);
          tube.geometry.dispose();
          tubeMat.dispose();
          bubMat.dispose();
          gasJob = null;
          finishSO2(vessel, ml, nTotal);
          return true;
        }
        return false;
      },
      { blocking: true }
    );
  }
  function finishSO2(vessel, ml, n) {
    const vid = vidOf(vessel);
    const rx = rxOf(vid);
    const c = chem(vid);
    if ((rx.brUsed || 0) > 0) addMix(vid, 'hbr', 'h2so4_dil');
    if (c.br0 > 0 && c.brLeft <= 1e-9) delMix(vid, 'brwater');
    if ((rx.so2 || 0) > c.br0 + 1e-9) addMix(vid, 'so2');
    ctx.updateVesselLiquid(vessel);
    const msg =
      c.br0 > 0
        ? c.brLeft <= 1e-9
          ? `Đã sục ${fmtQ(ml, 4)} mL SO₂ (≈ ${fmtQ(n)} mol): nước brom mất màu hoàn toàn. SO₂ + Br₂ + 2H₂O → 2HBr + H₂SO₄.`
          : `Đã sục ${fmtQ(ml, 4)} mL SO₂ (≈ ${fmtQ(n)} mol): nước brom nhạt màu (còn ≈ ${fmtQ(c.brLeft)} mol Br₂). Sục thêm để mất màu hết.`
        : `Đã sục ${fmtQ(ml, 4)} mL SO₂ vào dung dịch (SO₂ tan trong nước tạo H₂SO₃, không có hiện tượng màu).`;
    log(msg);
    save();
    if (!mistake) ctx.showToast(msg);
    ctx.renderInfo();
  }

  // ---- 4. Nhúng giấy quỳ ----
  function litmusVerdict(vid) {
    const c = chem(vid);
    const ids = new Set(S.mixtures[vid] || []);
    if (ids.has('tollens') || (c.nh3 > 0 && !c.ag)) return { color: LITMUS.blue, text: 'xanh (môi trường bazơ, có NH₃)' };
    if (c.brLeft > 1e-9) return { color: LITMUS.bleached, text: 'đỏ rồi mất màu (Br₂/HBrO tẩy màu giấy quỳ)' };
    let records = recs(vid).filter((r) => r.phase !== 'solid' && r.chemicalId !== 'brwater' && r.chemicalId !== 'so2');
    const rx = S.rx[vid] || {};
    if (rx.brUsed > 0) records = [...records, { chemicalId: 'hcl_dil', moles: 2 * rx.brUsed }, { chemicalId: 'h2so4_dil', moles: rx.brUsed }];
    if (rx.hclUsed > 0) records = records.map((r) => (['hcl', 'hcl_dil'].includes(r.chemicalId) ? { ...r, moles: molOfRecord(r) * (c.acid / Math.max(1e-12, c.acid + rx.hclUsed)) } : r));
    if (ids.has('baso4')) records = records.filter((r) => r.chemicalId !== 'bacl2');
    const pH = estimatePH(records, volOf(vid), STOCK_SPECS);
    if (!pH.ok) return { color: LITMUS.purple, text: 'không đổi màu rõ (chưa xác định được pH)', note: pH.note };
    const p = pH.pH;
    const color = p < 4.5 ? LITMUS.red : p < 5.5 ? LITMUS.redPurple : p <= 8 ? LITMUS.purple : p < 8.3 ? LITMUS.bluePurple : LITMUS.blue;
    const text = p < 4.5 ? 'đỏ (môi trường axit)' : p < 5.5 ? 'đỏ tím (axit rất yếu)' : p <= 8 ? 'tím (gần trung tính)' : p < 8.3 ? 'tím xanh' : 'xanh (môi trường bazơ)';
    return { color, text, pH: p };
  }

  async function dipLitmus(stripRoot, target) {
    const sid = vidOf(stripRoot);
    if (S.litmus[sid]) {
      ctx.clearSource();
      ctx.showToast('Mẩu giấy quỳ này đã dùng rồi. Bỏ vào thùng rác (Xóa) và lấy mẩu mới.', 'error');
      return;
    }
    const stock = S.samples?.[vidOf(target)];
    const isStock = Boolean(ctx.itemById[target.userData.itemId]?.stock && stock && stock.phase !== 'gas');
    if (!isVessel(target) && !isStock) {
      ctx.showToast('Hãy nhúng giấy quỳ vào cốc, bình hoặc ống nghiệm có dung dịch.', 'error');
      return;
    }
    let G;
    if (isStock) {
      const p = target.getWorldPosition(new THREE.Vector3());
      const f = stock.initialAmount ? clamp(stock.amount / stock.initialAmount, 0, 1) : 1;
      G = { center: new THREE.Vector3(p.x, p.y + 0.04, p.z), bottomY: p.y + 0.04, surfaceY: p.y + 0.04 + 0.91 * f, mouthY: p.y + 1.8, radius: 0.2 };
      if (stock.amount <= 0) {
        ctx.showToast('Chai đã hết.', 'error');
        return;
      }
    } else {
      G = ctx.vesselGeom(target);
      if (!G || !(volOf(vidOf(target)) > 0)) {
        ctx.showToast(`${ctx.nameOf(target)} chưa có dung dịch để thử.`, 'error');
        return;
      }
    }
    ctx.clearSource();
    const verdict = isStock ? { color: LITMUS.purple } : litmusVerdict(vidOf(target));
    const strip = stripRoot.getObjectByName('litmus-strip');
    const wet = strip.getObjectByName('litmus-wet');
    const home = { parent: strip.parent, pos: strip.position.clone(), quat: strip.quaternion.clone() };
    scene.attach(strip);
    const start = strip.position.clone();
    const q0 = strip.quaternion.clone();
    const qUp = new THREE.Quaternion();
    const depth = Math.min(0.5, Math.max(0.12, G.surfaceY - G.bottomY - 0.05));
    const above = new THREE.Vector3(G.center.x, G.mouthY + 0.45, G.center.z);
    const inLiquid = new THREE.Vector3(G.center.x, G.surfaceY - depth, G.center.z);
    const c0 = wet.material.color.clone();
    const c1 = new THREE.Color(verdict.color);
    let e = 0;
    let ions = false;
    const T = { up: 0.9, down: 0.6, hold: 1.8, rise: 0.6, back: 0.9 };
    const t1 = T.up;
    const t2 = t1 + T.down;
    const t3 = t2 + T.hold;
    const t4 = t3 + T.rise;
    const t5 = t4 + T.back;
    animator.task(
      (dt) => {
        e += dt;
        if (e < t1) {
          const k = smooth(e / T.up);
          strip.position.lerpVectors(start, above, k).y += Math.sin(k * Math.PI) * 0.6;
          strip.quaternion.slerpQuaternions(q0, qUp, k);
        } else if (e < t2) {
          strip.position.lerpVectors(above, inLiquid, smooth((e - t1) / T.down));
          strip.quaternion.copy(qUp);
        } else if (e < t3) {
          strip.position.copy(inLiquid);
          const k = smooth((e - t2) / 1.2);
          wet.material.color.copy(c0).lerp(c1, k);
          if (!ions && !isStock) {
            ions = true;
            showIons(target);
          }
          if (isStock && !ions) {
            ions = true; // chỉ báo lỗi một lần cho lần nhúng này
            trigger('litmus-stock', target);
          }
        } else if (e < t4) {
          strip.position.lerpVectors(inLiquid, above, smooth((e - t3) / T.rise));
        } else if (e < t5) {
          const k = smooth((e - t4) / T.back);
          strip.position.lerpVectors(above, start, k).y += Math.sin(k * Math.PI) * 0.6;
          strip.quaternion.slerpQuaternions(qUp, q0, k);
        }
        if (e >= t5) {
          home.parent.add(strip);
          strip.position.copy(home.pos);
          strip.quaternion.copy(home.quat);
          S.litmus[sid] = { color: verdict.color, text: verdict.text ?? '', pH: verdict.pH ?? null, from: ctx.nameOf(target) };
          if (!isStock) {
            const msg = `Nhúng giấy quỳ vào ${ctx.nameOf(target)}: quỳ chuyển ${verdict.text}${verdict.pH != null ? ` (pH ≈ ${fmtQ(verdict.pH, 3)})` : ''}.`;
            log(msg);
            ctx.showToast(msg);
          }
          save();
          ctx.renderInfo();
          return true;
        }
        return false;
      },
      { blocking: true }
    );
  }

  // ion trong dung dịch: axit yếu phân li một phần (⇌), axit mạnh phân li hoàn toàn.
  // Hiện trong một "kính phóng đại" phía trên miệng cốc, nối xuống dung dịch.
  function showIons(vessel) {
    const vid = vidOf(vessel);
    const ids = new Set(recs(vid).map((r) => r.chemicalId));
    const weak = ids.has('ch3cooh');
    const strong = ['hcl', 'hcl_dil', 'hno3', 'h2so4', 'h2so4_dil'].find((x) => ids.has(x));
    if (!weak && !strong) return;
    if (!ctx.vesselGeom(vessel)) return;
    const C = addedMol(vid, ['ch3cooh']) / (volOf(vid) / 1000);
    const v = litmusVerdict(vid);
    const alpha = weak && v.pH != null ? Math.pow(10, -v.pH) / Math.max(C, 1e-9) : 1;
    const anion = weak ? 'CH₃COO⁻' : strong.startsWith('h2so4') ? 'HSO₄⁻' : strong === 'hno3' ? 'NO₃⁻' : 'Cl⁻';
    const MOL = 'CH₃COOH';
    const style = (t) =>
      t === 'H⁺' ? { color: '#ffffff', bg: 'rgba(220,38,38,0.95)' } : t === MOL ? { color: '#e5e7eb', bg: 'rgba(71,85,105,0.95)' } : { color: '#ffffff', bg: 'rgba(37,99,235,0.95)' };
    const R0 = 1.0; // bán kính vùng chuyển động trong kính
    const bodies = [];
    const spawn = (text, u, w, vu = rand(-0.25, 0.25), vw = rand(-0.25, 0.25)) => {
      const sp = textSprite(text, { ...style(text), size: text === MOL ? 0.17 : 0.16 });
      sp.renderOrder = 22;
      scene.add(sp);
      const b = { s: sp, text, u, w, vu, vw };
      bodies.push(b);
      return b;
    };
    const kill = (b) => {
      scene.remove(b.s);
      b.s.material.dispose();
      bodies.splice(bodies.indexOf(b), 1);
    };
    const randIn = () => {
      const a = rand(0, 6.28);
      const r = Math.sqrt(Math.random()) * R0 * 0.85;
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
    if (weak) {
      for (let i = 0; i < 7; i++) spawn(MOL, ...randIn());
      spawn('H⁺', ...randIn());
      spawn(anion, ...randIn());
    } else {
      for (let i = 0; i < 5; i++) {
        spawn('H⁺', ...randIn());
        spawn(anion, ...randIn());
      }
    }
    // kính phóng đại: nền tròn tối, viền sáng
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g2 = c.getContext('2d');
    if (g2) {
      g2.fillStyle = 'rgba(15,23,42,0.82)';
      g2.beginPath();
      g2.arc(128, 128, 120, 0, Math.PI * 2);
      g2.fill();
      g2.strokeStyle = 'rgba(147,197,253,0.95)';
      g2.lineWidth = 8;
      g2.stroke();
    }
    const lensTex = new THREE.CanvasTexture(c);
    const lens = new THREE.Sprite(new THREE.SpriteMaterial({ map: lensTex, transparent: true, depthTest: false, depthWrite: false }));
    lens.renderOrder = 21;
    lens.scale.setScalar(2.5);
    scene.add(lens);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x93c5fd, transparent: true, depthTest: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat);
    line.renderOrder = 21;
    scene.add(line);
    const title = textSprite(
      weak ? `CH₃COOH ⇌ CH₃COO⁻ + H⁺  (điện li yếu, α ≈ ${fmtQ(alpha * 100, 2)} %)` : `${strong.startsWith('h2so4') ? 'H₂SO₄ → H⁺ + HSO₄⁻' : strong === 'hno3' ? 'HNO₃ → H⁺ + NO₃⁻' : 'HCl → H⁺ + Cl⁻'}  (điện li hoàn toàn)`,
      { color: '#fde68a', size: 0.2 }
    );
    const note = textSprite(weak ? 'phóng đại, minh họa: phần lớn vẫn là phân tử CH₃COOH' : 'phóng đại, minh họa: toàn bộ là ion', { color: '#cbd5e1', bg: 'rgba(15,23,42,0.8)', size: 0.13 });
    scene.add(title, note);
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    let e = 0;
    let swap = 0;
    const DUR = 11;
    const cleanup = () => {
      [...bodies].forEach(kill);
      [lens, title, note, line].forEach((o) => scene.remove(o));
      lens.material.dispose();
      lensTex.dispose();
      title.material.dispose();
      note.material.dispose();
      line.geometry.dispose();
      lineMat.dispose();
    };
    animator.task((dt) => {
      e += dt;
      swap += dt;
      const G = ctx.vesselGeom(vessel);
      if (!G) {
        cleanup();
        return true;
      }
      const fade = e < 0.5 ? e / 0.5 : e > DUR - 1 ? Math.max(0, DUR - e) : 1;
      const cam = ctx.camera;
      cam.updateMatrixWorld();
      right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
      up.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
      const center = new THREE.Vector3(G.center.x, G.mouthY + 1.6, G.center.z);
      lens.position.copy(center);
      lens.material.opacity = fade;
      title.position.copy(center).addScaledVector(up, 1.42);
      title.material.opacity = fade;
      note.position.copy(center).addScaledVector(up, -1.36);
      note.material.opacity = fade;
      const pos = line.geometry.attributes.position;
      const bot = center.clone().addScaledVector(up, -1.25);
      pos.setXYZ(0, bot.x, bot.y, bot.z);
      pos.setXYZ(1, G.center.x, G.surfaceY, G.center.z);
      pos.needsUpdate = true;
      lineMat.opacity = fade;
      // axit yếu: cân bằng động — một phân tử phân li, đồng thời một cặp ion kết hợp lại
      if (weak && swap > 2.2) {
        swap = 0;
        const mols = bodies.filter((b) => b.text === MOL);
        const h = bodies.find((b) => b.text === 'H⁺');
        const an = bodies.find((b) => b.text === anion);
        if (mols.length && h && an) {
          const m = mols[Math.floor(Math.random() * mols.length)];
          const [mu, mw] = [m.u, m.w];
          kill(m);
          const a = rand(0, 6.28);
          spawn('H⁺', mu, mw, Math.cos(a) * 0.5, Math.sin(a) * 0.5);
          spawn(anion, mu, mw, -Math.cos(a) * 0.5, -Math.sin(a) * 0.5);
          const [hu, hw] = [(h.u + an.u) / 2, (h.w + an.w) / 2];
          kill(h);
          kill(an);
          spawn(MOL, hu, hw);
        }
      }
      for (const b of bodies) {
        b.u += b.vu * dt;
        b.w += b.vw * dt;
        const r = Math.hypot(b.u, b.w);
        if (r > R0 * 0.85) {
          b.u *= (R0 * 0.85) / r;
          b.w *= (R0 * 0.85) / r;
          b.vu = -b.vu + rand(-0.1, 0.1);
          b.vw = -b.vw + rand(-0.1, 0.1);
        }
        b.vu = clamp(b.vu * 0.995, -0.5, 0.5);
        b.vw = clamp(b.vw * 0.995, -0.5, 0.5);
        b.s.position.copy(center).addScaledVector(right, b.u).addScaledVector(up, b.w);
        b.s.material.opacity = fade;
      }
      if (e >= DUR) {
        cleanup();
        return true;
      }
      return false;
    });
  }

  // ---------------- nút cao su ----------------
  const STOPPERABLE = new Set(['erlenmeyer', 'testtube', 'roundflask', 'distilling-flask', 'filter-flask', 'volumetric-flask', 'graduated-cylinder']);
  function toggleStopper(root) {
    if (!root || !isVessel(root) || !STOPPERABLE.has(root.userData.itemId)) return;
    if (mistake) return;
    const vid = vidOf(root);
    const rx = rxOf(vid);
    rx.stopper = !rx.stopper;
    rx.pressureMl = 0;
    rx.stopperAt = Date.now();
    log(rx.stopper ? `Đã đậy nút cao su vào ${ctx.nameOf(root)}.` : `Đã mở nút cao su của ${ctx.nameOf(root)}.`);
    ctx.updateVesselLiquid(root);
    save();
    ctx.showToast(rx.stopper ? `Đã đậy nút ${ctx.nameOf(root)}.` : `Đã mở nút ${ctx.nameOf(root)}.`);
    ctx.renderInfo();
  }

  // ============================================================
  // Bước làm sai: cảnh báo đỏ + hậu quả
  // ============================================================
  function trigger(key, root) {
    if (mistake) return;
    const def = MISTAKES[key];
    const ex = EXPERIMENTS[def.exp - 1];
    mistake = { key, root };
    const at = root.getWorldPosition(new THREE.Vector3());
    const G = isVessel(root) ? ctx.vesselGeom(root) : null;
    const mouthY = G?.mouthY ?? at.y + 1.8;
    ctx.world?.focusOn(new THREE.Vector3(at.x, mouthY, at.z), key === 'so2-outside' ? 11 : 8);
    const gloved = Boolean(ctx.world?.ppe?.gloves);
    if (key === 'acid-water') consequenceSplash(root, { heat: true, gloved });
    else if (key === 'pressure') consequenceExplode(root, gloved);
    else if (key === 'so2-outside') consequenceGas(root);
    else if (key === 'litmus-stock') consequenceContaminate(root);
    else if (key === 'direct-heat') consequenceBump(root, gloved);
    log(`⚠ LÀM SAI (thí nghiệm ${def.exp}: ${ex.title}): ${def.wrong} Hậu quả: ${def.result}`);
    save();
    showWarning(def, ex, gloved);
    ctx.renderInfo();
  }

  function showWarning(def, ex, gloved) {
    const el = document.createElement('div');
    el.className = 'rx-alert-backdrop';
    el.innerHTML = `
      <div class="rx-alert" role="alertdialog" aria-modal="true" aria-label="Cảnh báo làm sai quy trình">
        <div class="rx-alert-head">⚠ SAI QUY TRÌNH — Thí nghiệm ${ex.n}: ${esc(ex.title)}</div>
        <div class="rx-alert-body">
          <p><b>Bước làm sai:</b> ${esc(def.wrong)}</p>
          <p><b>Vì sao nguy hiểm:</b> ${esc(def.why)}</p>
          <p><b>Hậu quả:</b> ${esc(def.result)}${gloved && ['acid-water', 'pressure', 'direct-heat'].includes(mistake.key) ? ' (Găng tay giảm bớt tổn thương nhưng vẫn bị thủng/bỏng.)' : ''}</p>
          <p><b>Cách làm đúng:</b> ${esc(def.correct)}</p>
          <p class="rx-alert-must">Phải rửa sạch dụng cụ, xử lý hóa chất đổ ra và làm lại thí nghiệm từ đầu.</p>
        </div>
        <button class="btn btn-danger rx-alert-btn" data-rx-reset>Rửa sạch và làm lại từ đầu</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('[data-rx-reset]').addEventListener('click', resetAll);
    mistake.el = el;
  }

  // ---------------- các hiệu ứng hậu quả ----------------
  function addFx(obj) {
    scene.add(obj);
    fx.push(obj);
    return obj;
  }
  function stain(x, z, color, r) {
    const m = new THREE.Mesh(DISC, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.75, roughness: 0.2, depthWrite: false }));
    m.position.set(x, 0.012 + Math.random() * 0.004, z);
    m.scale.setScalar(r);
    m.renderOrder = 3;
    return addFx(m);
  }
  function droplet(pos, vel, color, size = 0.03, stainR = 0.08) {
    const m = new THREE.Mesh(SPH, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.85, roughness: 0.1 }));
    m.scale.setScalar(size);
    m.position.copy(pos);
    scene.add(m);
    parts.push({ m, v: vel, kind: 'drop', color, stainR });
  }
  function puff(pos, { color = 0xffffff, op = 0.5, grow = 0.9, life = 2, rise = 0.6, drift = null, size = 0.4 } = {}) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color, transparent: true, opacity: op, depthWrite: false }));
    s.position.copy(pos);
    s.scale.setScalar(size);
    s.renderOrder = 8;
    scene.add(s);
    parts.push({ m: s, kind: 'puff', life: 0, max: life, op, grow, rise, size, drift: drift ?? new THREE.Vector3(rand(-0.1, 0.1), 0, rand(-0.1, 0.1)) });
  }
  function liquidColorNow(root) {
    const id = vidOf(root);
    return liquidColor(id) ?? liquidColorFor(S.mixtures[id] || []);
  }

  // bàn tay đặt cạnh bình, giật lại khi bị bắn; vết bỏng lan dần
  function hand(root, { gloved, cuts = false, label = 'Bỏng hóa chất' }) {
    const p = root.getWorldPosition(new THREE.Vector3());
    const G = isVessel(root) ? ctx.vesselGeom(root) : null;
    const cam = ctx.camera.position.clone();
    const dir = new THREE.Vector3(cam.x - p.x, 0, cam.z - p.z).normalize();
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const h = addFx(buildHand(gloved));
    const y = Math.max(0.4, (G?.mouthY ?? p.y + 1.5) * 0.75);
    const near = p.clone().addScaledVector(dir, 0.9).addScaledVector(side, 0.75).setY(y);
    const far = p.clone().addScaledVector(dir, 1.7).addScaledVector(side, 1.15).setY(y + 0.35);
    h.position.copy(near);
    h.lookAt(new THREE.Vector3(p.x, y, p.z));
    h.rotateY(Math.PI);
    const spots = [];
    const spotMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.7, transparent: true, opacity: 0.95 });
    const blisterMat = new THREE.MeshStandardMaterial({ color: 0xfde2c8, roughness: 0.3, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(SPH, i % 3 === 2 ? blisterMat : spotMat);
      s.position.set(rand(-0.24, 0.24), 0.09, rand(-0.55, 0.25));
      s.scale.set(0.001, 0.001, 0.001);
      h.add(s);
      spots.push({ s, r: i % 3 === 2 ? rand(0.035, 0.05) : rand(0.06, 0.12), blister: i % 3 === 2, delay: i * 0.18 });
    }
    if (cuts) {
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, rand(0.18, 0.3)), new THREE.MeshStandardMaterial({ color: 0x8b0000, roughness: 0.4 }));
        c.position.set(rand(-0.2, 0.2), 0.092, rand(-0.4, 0.2));
        c.rotation.y = rand(-0.8, 0.8);
        h.add(c);
      }
    }
    const tag = addFx(textSprite(gloved ? `${label} (găng tay bị thủng)` : label, { color: '#fff', bg: 'rgba(185,28,28,0.92)', size: 0.3 }));
    let e = 0;
    animator.task((dt) => {
      e += dt;
      if (!h.parent) return true;
      // giật tay lại sau khi bị bắn
      const k = smooth((e - 0.15) / 0.35);
      h.position.lerpVectors(near, far, k);
      h.position.y += Math.sin(clamp(e * 18, 0, Math.PI)) * 0.1;
      spots.forEach((o) => {
        const t = clamp((e - 0.3 - o.delay) / 1.4, 0, 1);
        const r = o.r * smooth(t);
        o.s.scale.set(r, o.blister ? r * 0.8 : r * 0.12, r);
        if (!o.blister) o.s.material.color.setHex(t < 1 ? 0xdc2626 : 0x7f1d1d);
      });
      if (e > 0.6 && Math.random() < dt * 3) puff(h.position.clone().add(new THREE.Vector3(rand(-0.2, 0.2), 0.15, rand(-0.2, 0.2))), { color: 0xd6d3d1, op: 0.35, size: 0.18, life: 1.4, rise: 0.4 });
      tag.position.copy(h.position).add(new THREE.Vector3(0, 0.55, 0));
      return false; // còn tới khi rửa sạch
    });
    return h;
  }

  // 1. Nước vào axit đặc: sôi bùng, axit bắn
  function consequenceSplash(root, { gloved }) {
    const G = ctx.vesselGeom(root);
    const color = 0xf3f0d8;
    const vid = vidOf(root);
    S.temperatures[vid] = 100;
    let e = 0;
    animator.task((dt) => {
      e += dt;
      const g = ctx.vesselGeom(root) ?? G;
      if (!g || mistake?.key !== 'acid-water') return true;
      const burst = e < 2.2 ? 1 : e < 6 ? 0.25 : 0.05;
      if (Math.random() < dt * 60 * burst) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(1.2, 3.2) * (e < 2.2 ? 1 : 0.6);
        droplet(new THREE.Vector3(g.center.x + Math.cos(a) * g.radius * 0.4, g.surfaceY + 0.05, g.center.z + Math.sin(a) * g.radius * 0.4), new THREE.Vector3(Math.cos(a) * sp * 0.45, rand(2.5, 4.5), Math.sin(a) * sp * 0.45), color, rand(0.02, 0.04), rand(0.05, 0.12));
      }
      if (Math.random() < dt * 14 * burst) puff(new THREE.Vector3(g.center.x + rand(-0.2, 0.2), g.mouthY + 0.1, g.center.z + rand(-0.2, 0.2)), { color: 0xf8fafc, op: 0.55, size: 0.5, grow: 1.6, rise: 1.0, life: 2.4 });
      return e > 20;
    });
    hand(root, { gloved, label: 'Bỏng axit H₂SO₄ đặc' });
  }

  // 2. Bình đậy kín đang sinh khí: nút bật, bình nổ vỡ
  function consequenceExplode(root, gloved) {
    const G = ctx.vesselGeom(root);
    const vid = vidOf(root);
    const color = liquidColorNow(root);
    const R = runtime(vid);
    // nút cao su bay lên
    const m = ctx.mouthOf(root) ?? { r: 0.3 };
    const plug = addFx(new THREE.Mesh(new THREE.CylinderGeometry(m.r * 1.18, m.r * 0.86, 0.32, 20), std(0x7a2e22, { roughness: 0.8 })));
    plug.position.set(G.center.x, G.mouthY + 0.05, G.center.z);
    const pv = new THREE.Vector3(rand(-1, 1), 9, rand(-1, 1));
    // ẩn bình, thay bằng mảnh vỡ
    root.userData.broken = true;
    rxOf(vid).stopper = false;
    if (R.stopper) R.stopper.visible = false;
    root.userData.inner.visible = false;
    root.children.forEach((c) => c.name === 'dynamic-liquid' && (c.visible = false));
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xd8ecf8, transparent: true, opacity: 0.55, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
    const shards = [];
    for (let i = 0; i < 26; i++) {
      const geo = new THREE.BufferGeometry();
      const s = rand(0.08, 0.22);
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, s, rand(-0.05, 0.05), rand(-0.1, 0.1), rand(-0.1, 0.1), s * rand(0.6, 1.2), rand(-0.05, 0.05)], 3));
      geo.computeVertexNormals();
      const sh = addFx(new THREE.Mesh(geo, glassMat));
      const a = rand(0, Math.PI * 2);
      const y = rand(G.bottomY + 0.1, G.mouthY);
      sh.position.set(G.center.x + Math.cos(a) * G.radius, y, G.center.z + Math.sin(a) * G.radius);
      const sp = rand(2, 5.5);
      shards.push({ m: sh, v: new THREE.Vector3(Math.cos(a) * sp, rand(1.5, 5), Math.sin(a) * sp), w: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), rest: false });
    }
    // dung dịch axit phun ra + vũng chất lỏng trên bàn
    for (let i = 0; i < 70; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(0.8, 3.5);
      droplet(new THREE.Vector3(G.center.x, rand(G.bottomY, G.surfaceY + 0.1), G.center.z), new THREE.Vector3(Math.cos(a) * sp, rand(1, 4), Math.sin(a) * sp), color, rand(0.02, 0.045), rand(0.05, 0.12));
    }
    const pool = stain(G.center.x, G.center.z, color, 0.1);
    for (let i = 0; i < 6; i++) puff(new THREE.Vector3(G.center.x, G.mouthY * 0.7, G.center.z), { color: 0xffffff, op: 0.6, size: 0.6, grow: 2.4, rise: 0.8, life: 1.4 });
    // tia chớp vụ nổ
    const flash = addFx(new THREE.PointLight(0xfff1c1, 30, 8));
    flash.position.set(G.center.x, G.mouthY, G.center.z);
    const boom = addFx(textSprite('NỔ BÌNH!', { color: '#fff', bg: 'rgba(220,38,38,0.95)', size: 0.5 }));
    boom.position.set(G.center.x, G.mouthY + 1.6, G.center.z);
    let e = 0;
    animator.task((dt) => {
      e += dt;
      if (!plug.parent) return true;
      flash.intensity = Math.max(0, 30 * (1 - e / 0.35));
      if (plug.position.y > 0.17 || pv.y > 0) {
        pv.y -= 9 * dt;
        plug.position.addScaledVector(pv, dt);
        plug.rotation.x += dt * 12;
        if (plug.position.y <= 0.17) {
          plug.position.y = 0.17;
          pv.set(0, 0, 0);
          plug.rotation.set(Math.PI / 2, 0, 0);
        }
      }
      shards.forEach((o) => {
        if (o.rest) return;
        o.v.y -= 9 * dt;
        o.m.position.addScaledVector(o.v, dt);
        o.m.rotation.x += o.w.x * dt;
        o.m.rotation.y += o.w.y * dt;
        o.m.rotation.z += o.w.z * dt;
        if (o.m.position.y <= 0.015) {
          o.m.position.y = 0.015;
          o.m.rotation.set(-Math.PI / 2, o.m.rotation.y, 0);
          o.rest = true;
        }
      });
      pool.scale.setScalar(0.1 + 0.9 * smooth(e / 1.5) * clamp(0.6 + G.radius, 0.6, 1.4));
      boom.material.opacity = e < 3 ? 1 : Math.max(0.0, 1 - (e - 3));
      return e > 30;
    });
    hand(root, { gloved, cuts: true, label: 'Đứt tay + bỏng axit' });
  }

  // 3. Khí độc SO₂ thoát ra phòng
  function consequenceGas(root) {
    const G = ctx.vesselGeom(root);
    const label = addFx(textSprite('Khí SO₂ độc thoát ra phòng (không màu – vùng lan được tô để dễ thấy)', { color: '#fff', bg: 'rgba(161,98,7,0.92)', size: 0.3 }));
    label.position.set(G.center.x, G.mouthY + 1.4, G.center.z);
    toxic = document.createElement('div');
    toxic.className = 'rx-toxic';
    toxic.innerHTML = '<span>Khụ khụ… cay mắt, khó thở</span>';
    ctx.viewportEl.appendChild(toxic);
    let e = 0;
    animator.task((dt) => {
      e += dt;
      if (mistake?.key !== 'so2-outside') return true;
      const cam = ctx.camera.position;
      if (Math.random() < dt * 9) {
        const toCam = new THREE.Vector3(cam.x - G.center.x, 0, cam.z - G.center.z).normalize().multiplyScalar(rand(0.4, 1.0));
        puff(new THREE.Vector3(G.center.x + rand(-0.2, 0.2), G.mouthY + 0.1, G.center.z + rand(-0.2, 0.2)), {
          color: 0xd9d4a8, op: 0.42, size: 0.5, grow: 2.2, rise: 0.35, life: 5, drift: toCam.add(new THREE.Vector3(rand(-0.3, 0.3), 0, rand(-0.3, 0.3))),
        });
      }
      return false;
    });
  }

  // 4. Chai gốc bị nhiễm bẩn
  function consequenceContaminate(bottle) {
    const sample = S.samples?.[vidOf(bottle)];
    if (sample) sample.contaminated = true;
    const p = bottle.getWorldPosition(new THREE.Vector3());
    const liq = bottle.getObjectByName('stock-liquid');
    const from = liq?.material.color.clone();
    const dirty = new THREE.Color(0x8e6a9e);
    const dye = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x7e3fa0, transparent: true, opacity: 0.7, roughness: 0.6, depthWrite: false });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(SPH, mat);
      m.scale.setScalar(rand(0.02, 0.05));
      m.renderOrder = 6;
      scene.add(m);
      dye.push({ m, a: rand(0, 6.28), r: rand(0.05, 0.5), y: rand(0.15, 0.9), w: rand(0.6, 1.6), fiber: i % 4 === 0 });
      fx.push(m);
    }
    const tag = addFx(textSprite('CHAI GỐC BỊ NHIỄM BẨN – PHẢI LOẠI BỎ', { color: '#fff', bg: 'rgba(185,28,28,0.95)', size: 0.3 }));
    tag.position.set(p.x, p.y + 2.8, p.z);
    let e = 0;
    animator.task((dt) => {
      e += dt;
      if (mistake?.key !== 'litmus-stock') return true;
      if (liq && from) liq.material.color.copy(from).lerp(dirty, smooth(e / 4) * 0.75);
      dye.forEach((d) => {
        d.a += dt * d.w;
        const spread = smooth(e / 3);
        d.m.position.set(p.x + Math.cos(d.a) * d.r * spread, p.y + d.y * (0.3 + 0.7 * spread) + Math.sin(e * 2 + d.a) * 0.03, p.z + Math.sin(d.a) * d.r * spread);
        if (d.fiber) d.m.scale.set(0.012, 0.06, 0.012);
      });
      return false;
    });
  }

  // 5. Đun trực tiếp ống tráng bạc: sôi bùng, phụt dung dịch, cặn đen
  function consequenceBump(root, gloved) {
    const vid = vidOf(root);
    const rx = rxOf(vid);
    rx.bumped = true;
    rx.mirror = 0;
    addMix(vid, 'ag');
    ctx.updateVesselLiquid(root);
    const color = 0xe5e7eb;
    let e = 0;
    let lost = 0;
    animator.task((dt) => {
      e += dt;
      if (mistake?.key !== 'direct-heat') return true;
      const g = ctx.vesselGeom(root);
      if (!g) return true;
      const k = e < 1.8 ? 1 : e < 5 ? 0.3 : 0.05;
      if (Math.random() < dt * 70 * k) {
        droplet(new THREE.Vector3(g.center.x, g.mouthY + 0.02, g.center.z), new THREE.Vector3(rand(-0.8, 0.8), rand(3.5, 6), rand(-0.8, 0.8)), color, rand(0.02, 0.035), rand(0.04, 0.1));
      }
      if (Math.random() < dt * 10 * k) puff(new THREE.Vector3(g.center.x, g.mouthY + 0.1, g.center.z), { color: 0xffffff, op: 0.5, size: 0.35, grow: 1.4, rise: 1.2, life: 2 });
      // một phần dung dịch bị phụt ra ngoài
      if (e < 1.8 && lost < 0.4) {
        const d = dt * 0.25;
        lost += d;
        const v = volOf(vid);
        if (v > 0.2) S.liquidVolumes[vid] = Math.max(0.2, v * (1 - d));
      }
      return e > 20;
    });
    hand(root, { gloved, label: 'Bỏng do dung dịch nóng phụt ra' });
  }

  // ---------------- rửa sạch và làm lại ----------------
  function resetAll() {
    const key = mistake?.key;
    if (gasJob) gasJob.cancelled = true;
    mistake?.el?.remove();
    mistake = null;
    toxic?.remove();
    toxic = null;
    fx.splice(0).forEach((o) => {
      o.parent?.remove(o);
      o.traverse?.((c) => {
        if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
      });
    });
    parts.splice(0).forEach((p) => {
      scene.remove(p.m);
      p.m.material?.dispose();
    });
    rt.clear();
    // làm lại từ đầu: rửa sạch mọi bình trên bàn, thay chai bị nhiễm bẩn, thay giấy quỳ mới
    for (const root of ctx.placed) {
      const id = vidOf(root);
      if (isVessel(root)) {
        root.userData.broken = false;
        root.userData.inner.visible = true;
        S.liquidVolumes[id] = 0;
        S.mixtures[id] = [];
        S.pourRecords[id] = [];
        if (S.reactedVessels) delete S.reactedVessels[id];
        S.temperatures[id] = 25;
        delete S.rx[id];
        ctx.refreshVessel(root);
      }
      const sample = S.samples?.[id];
      if (sample?.contaminated) {
        // thay chai mới: đầy như lúc lấy ra
        const f = sample.amount > 0 ? sample.initialAmount / sample.amount : 1;
        for (const k of ['massG', 'volumeMl', 'moles', 'soluteMassG']) if (sample[k] != null && sample.amount > 0) sample[k] *= f;
        sample.contaminated = false;
        sample.amount = sample.initialAmount;
        ctx.refreshStock(root);
        const tag = 'Đã thay chai hóa chất mới (chai bẩn đã loại bỏ).';
        log(tag);
      }
      if (root.userData.itemId === 'litmus' && S.litmus[id]) {
        delete S.litmus[id];
        const wet = root.getObjectByName('litmus-wet');
        wet?.material.color.setHex(LITMUS.purple);
      }
    }
    log(`Đã rửa sạch dụng cụ, xử lý hóa chất đổ ra; bắt đầu làm lại thí nghiệm từ đầu${key ? ` (sau lỗi: ${MISTAKES[key].wrong})` : ''}.`);
    save();
    ctx.showToast('Đã rửa sạch toàn bộ dụng cụ. Hãy làm lại thí nghiệm từ đầu theo đúng quy trình.');
    ctx.renderInfo();
  }

  // ============================================================
  // Cập nhật mỗi khung hình
  // ============================================================
  let saveTimer = 0;
  function update(dt) {
    const now = Date.now();
    // hạt đang bay
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.kind === 'drop') {
        p.v.y -= 9 * dt;
        p.m.position.addScaledVector(p.v, dt);
        if (p.m.position.y <= 0.02) {
          scene.remove(p.m);
          p.m.material.dispose();
          parts.splice(i, 1);
          if (mistake && fx.length < 400) stain(p.m.position.x, p.m.position.z, p.color, p.stainR);
        }
      } else if (p.kind === 'puff') {
        p.life += dt;
        p.m.position.y += p.rise * dt;
        p.m.position.addScaledVector(p.drift, dt);
        p.m.scale.setScalar(p.size * (1 + p.life * p.grow));
        p.m.material.opacity = p.op * Math.max(0, 1 - p.life / p.max);
        if (p.life >= p.max) {
          scene.remove(p.m);
          p.m.material.dispose();
          parts.splice(i, 1);
        }
      } else if (p.kind === 'bubble') {
        p.v += dt * 0.6;
        p.m.position.y += p.v * dt;
        p.m.position.x += Math.sin(p.life++ * 0.3) * 0.0015;
        if (!(p.m.position.y < p.top())) {
          scene.remove(p.m);
          parts.splice(i, 1);
        }
      }
    }

    for (const root of ctx.placed) {
      if (!isVessel(root) || root.userData.broken) continue;
      const vid = vidOf(root);
      const rx = S.rx[vid];
      if (!rx) continue;
      const R = runtime(vid);
      const c = chem(vid);
      // vẩn đục tan dần
      if (R.turbid) {
        R.turbid.t += dt;
        const k = R.turbid.t / R.turbid.dur;
        R.turbid.op = Math.max(0, 0.82 * (1 - smooth(k)));
        if (R.turbidMat) R.turbidMat.opacity = Math.max(R.turbidBase ?? 0, R.turbid.op);
        if (k >= 1) {
          R.turbid = null;
          ctx.updateVesselLiquid(root);
        }
      }
      // 2. Đá vôi tan dần trong HCl, sủi bọt CO₂
      let gasRate = 0;
      if (c.caco3 > 1e-9 && c.acid > 1e-9 && c.V > 0) {
        const CH = c.acid / (c.V / 1000);
        const mass = c.caco3 * M_CACO3;
        const rate = 0.0015 * Math.pow(mass, 2 / 3) * Math.sqrt(clamp(CH / 2, 0.02, 3));
        // phần rất nhỏ còn lại: phản ứng nốt cho gọn (tránh đuôi tiệm cận kéo dài)
        let dn = Math.min(rate * dt, c.caco3, c.acid / 2);
        if (c.caco3 - dn < 2e-6 || c.acid / 2 - dn < 2e-6) dn = Math.min(c.caco3, c.acid / 2);
        gasRate = rate;
        rx.co2 = (rx.co2 || 0) + dn;
        rx.hclUsed = (rx.hclUsed || 0) + 2 * dn;
        let left = dn;
        for (const r of recs(vid)) {
          if (r.chemicalId !== 'caco3' || left <= 0) continue;
          const take = Math.min(r.moles, left);
          r.moles -= take;
          r.massG = r.moles * M_CACO3;
          left -= take;
        }
        addMix(vid, 'cacl2');
        rx.reacting = true;
        // bọt khí từ các cục đá vôi
        R.acc += dt * clamp(rate * 60000, 10, 120);
        const G = ctx.vesselGeom(root);
        if (G && G.surfaceY - G.bottomY > 0.04) {
          const bmat = (R.bubMat ??= new THREE.MeshStandardMaterial({ color: 0xf2f9ff, transparent: true, opacity: 0.6, roughness: 0.1, depthWrite: false }));
          while (R.acc >= 1) {
            R.acc -= 1;
            const b = new THREE.Mesh(SPH, bmat);
            b.scale.setScalar(rand(0.018, 0.042));
            const a = rand(0, 6.28);
            const rr = rand(0, G.radius * 0.6);
            b.position.set(G.center.x + Math.cos(a) * rr, G.bottomY + 0.05, G.center.z + Math.sin(a) * rr);
            scene.add(b);
            parts.push({ m: b, v: rand(0.4, 0.7), kind: 'bubble', life: rand(0, 20), top: () => (ctx.vesselGeom(root)?.surfaceY ?? 0) - 0.01 });
          }
          // lớp bọt trên mặt
          if (Math.random() < dt * 6) puff(new THREE.Vector3(G.center.x + rand(-G.radius, G.radius) * 0.5, G.surfaceY + 0.01, G.center.z + rand(-G.radius, G.radius) * 0.5), { color: 0xffffff, op: 0.35, size: 0.07, grow: 0.6, rise: 0.02, life: 0.8 });
        } else R.acc = 0;
        R.rebuild += dt;
        if (R.rebuild > 1) {
          R.rebuild = 0;
          ctx.updateVesselLiquid(root);
        }
      } else if (rx.reacting) {
        rx.reacting = false;
        const co2Ml = (rx.co2 || 0) * MOLAR_VOLUME_ML;
        const done = c.caco3 <= 1e-9 ? 'Đá vôi đã tan hết' : 'Axit HCl đã phản ứng hết, đá vôi còn dư';
        if (c.caco3 <= 1e-9) delMix(vid, 'caco3');
        if (c.acid <= 1e-9) delMix(vid, 'hcl', 'hcl_dil');
        const msg = `${done}. Đã thoát ra ≈ ${fmtQ(co2Ml, 4)} mL khí CO₂ (≈ ${fmtQ(rx.co2)} mol). CaCO₃ + 2HCl → CaCl₂ + CO₂↑ + H₂O.`;
        log(msg);
        ctx.showToast(msg);
        ctx.updateVesselLiquid(root);
        save();
        ctx.renderInfo();
      }
      // bình đậy kín khi đang sinh khí → áp suất tăng → nổ
      const gasOn = gasRate > 0 || (rx.gasUntil && now < rx.gasUntil);
      if (rx.stopper && gasOn && !mistake) {
        const add = gasRate > 0 ? gasRate * MOLAR_VOLUME_ML * dt : 40 * dt;
        rx.pressureMl = (rx.pressureMl || 0) + add;
        const cap = ctx.capacityOf(root.userData.itemId) ?? 250;
        const head = Math.max(5, cap - c.V);
        rx.pressure = 1 + rx.pressureMl / head;
        rx.stopperActive = (rx.stopperActive || 0) + dt;
        if (R.stopper) {
          const k = clamp((rx.pressure - 1) / 1.3, 0, 1);
          R.stopper.position.y = R.stopperY + Math.abs(Math.sin(now * 0.05)) * 0.04 * k;
          R.stopper.rotation.z = Math.sin(now * 0.07) * 0.08 * k;
        }
        if (rx.pressure >= 2.3 || rx.stopperActive > 3.5) trigger('pressure', root);
      }
      // 5. tráng bạc khi đun nóng; đun trực tiếp thì làm sai
      const T = S.temperatures?.[vid] ?? 25;
      const heat = heatSourceOf(root);
      const hasT = (S.mixtures[vid] || []).includes('tollens');
      if (hasT && heat?.direct && T >= 72 && !rx.bumped && !mistake) trigger('direct-heat', root);
      if (hasT && c.glu > 1e-9 && T >= 50 && !rx.bumped && (rx.mirror || 0) < 1) {
        const before = rx.mirror || 0;
        rx.mirror = Math.min(1, before + (dt * (T - 45)) / 140);
        if (R.mirrorMat) R.mirrorMat.opacity = clamp(rx.mirror * 1.05, 0, 0.97);
        if (before === 0 || Math.floor(before * 10) !== Math.floor(rx.mirror * 10)) ctx.updateVesselLiquid(root);
        if (rx.mirror >= 1) {
          const agMol = Math.min(c.ag - (rx.agUsed || 0), 2 * c.glu);
          rx.agUsed = (rx.agUsed || 0) + agMol;
          rx.gluUsed = (rx.gluUsed || 0) + agMol / 2;
          rx.agMass = agMol * M_AG;
          addMix(vid, 'ag', 'gluconate');
          const msg = `Lớp bạc sáng như gương đã bám trên thành ${ctx.nameOf(root)} (≈ ${fmtQ(rx.agMass, 3)} g Ag). C₆H₁₂O₆ + 2[Ag(NH₃)₂]OH → C₅H₁₁O₅COONH₄ + 2Ag↓ + 3NH₃ + H₂O.`;
          log(msg);
          ctx.showToast(msg);
          save();
          ctx.renderInfo();
        }
      }
    }
    saveTimer += dt;
    if (saveTimer > 3) {
      saveTimer = 0;
      if (Object.values(S.rx).some((r) => r.reacting)) save();
    }
  }

  // ============================================================
  // Bảng thông tin
  // ============================================================
  function vesselHtml(root) {
    if (!isVessel(root)) return '';
    const vid = vidOf(root);
    const rx = S.rx[vid] || {};
    const c = chem(vid);
    const lines = [];
    if (root.userData.broken) lines.push('<p class="sample-warn">Bình đã vỡ. Bấm "Rửa sạch và làm lại từ đầu".</p>');
    if (c.caco3 > 1e-9 || rx.co2 > 0) {
      lines.push(`<p>Đá vôi còn: <b>${fmtQ(c.caco3 * M_CACO3, 3)} g</b> · HCl còn: <b>${fmtQ(c.acid, 3)} mol</b></p>`);
      lines.push(`<p>CO₂ đã thoát ra: <b>≈ ${fmtQ((rx.co2 || 0) * MOLAR_VOLUME_ML, 4)} mL</b>${rx.reacting ? ' · <span class="rx-live">đang sủi bọt</span>' : ''}</p>`);
    }
    if (rx.baso4 > 0) lines.push(`<p>Kết tủa BaSO₄: <b>≈ ${fmtQ(rx.baso4 * M_BASO4, 3)} g</b> (${fmtQ(rx.baso4)} mol)</p>`);
    if (c.br0 > 0) {
      const pct = (c.brLeft / c.br0) * 100;
      lines.push(`<p>Br₂ còn: <b>${fmtQ(c.brLeft, 3)} mol</b> (${fmtQ(pct, 3)} % ban đầu) · ${c.brLeft <= 1e-9 ? 'đã mất màu hoàn toàn' : 'dung dịch còn màu vàng cam'}</p>`);
      if (rx.so2 > 0) lines.push(`<p>SO₂ đã sục vào: ≈ ${fmtQ(rx.so2 * MOLAR_VOLUME_ML, 4)} mL (${fmtQ(rx.so2)} mol)</p>`);
    }
    if (c.ag > 0 && c.nh3 > 0) {
      lines.push(c.tollens ? '<p>Có thuốc thử Tollens [Ag(NH₃)₂]OH.</p>' : `<p class="sample-warn">Kết tủa nâu Ag₂O chưa tan: cần NH₃ ≥ 3 lần số mol AgNO₃ (đang có ${fmtQ(c.nh3 / c.ag, 3)} lần).</p>`);
    }
    if (c.tollens && c.glu > 0 && !(rx.mirror >= 1) && !rx.bumped) lines.push('<p>Có glucozơ + Tollens: đun cách thủy 60–70 °C để tạo gương bạc.</p>');
    if (rx.mirror > 0 && !rx.bumped) lines.push(`<p>Gương bạc: <b>${fmtQ(rx.mirror * 100, 3)} %</b>${rx.agMass ? ` · ≈ ${fmtQ(rx.agMass, 3)} g Ag` : ''}</p>`);
    if (rx.bumped) lines.push('<p class="sample-warn">Bạc tách ra thành bột đen do đun trực tiếp, không tạo được gương.</p>');
    if (rx.stopper) lines.push(`<p>Đang đậy nút cao su${rx.pressure > 1.01 ? ` · áp suất ≈ <b>${fmtQ(rx.pressure, 3)} atm</b>` : ''}.</p>`);
    const btns = [];
    if (STOPPERABLE.has(root.userData.itemId) && !root.userData.broken) {
      btns.push(`<button class="btn" data-action="rx" data-op="stopper">${rx.stopper ? 'Mở nút cao su' : 'Đậy nút cao su'}</button>`);
    }
    if (!lines.length && !btns.length) return '';
    return `<div class="relation-box rx-box"><strong>Phản ứng trong bình</strong>${lines.join('')}${btns.length ? `<div class="info-actions">${btns.join('')}</div>` : ''}</div>`;
  }

  function itemHtml(root) {
    const id = root.userData.itemId;
    if (id === 'litmus') {
      const st = S.litmus[vidOf(root)];
      return `<div class="relation-box rx-box">${
        st
          ? `<p>Giấy quỳ đã dùng (nhúng vào ${esc(st.from)}): <b style="color:#${new THREE.Color(st.color).getHexString()}">${esc(st.text)}</b>${st.pH != null ? ` · pH ≈ ${fmtQ(st.pH, 3)}` : ''}.</p><p class="sample-hint">Giấy quỳ chỉ dùng một lần: bấm Xóa để bỏ vào thùng rác, lấy mẩu mới để thử tiếp.</p>`
          : `<p>Giấy quỳ tím còn mới.</p><button class="btn btn-primary" data-action="pour-start">Nhúng vào cốc/bình (P)</button><p class="sample-hint">Bấm nút (hoặc phím P), chọn cốc có dung dịch rồi bấm P lần nữa.</p>`
      }</div>`;
    }
    if (id === 'so2') {
      return `<div class="relation-box rx-box"><button class="btn btn-primary" data-action="pour-start">Sục khí vào cốc/bình (P)</button><p class="sample-hint">Đặt bình khí và cốc nước brom trong tủ hút đang bật quạt. Bấm nút, chọn cốc rồi bấm P lần nữa.</p></div>`;
    }
    const s = S.samples?.[vidOf(root)];
    if (s?.contaminated) return '<div class="relation-box rx-box"><p class="sample-warn">Chai đã nhiễm bẩn (nhúng giấy quỳ vào chai gốc): không được dùng nữa.</p></div>';
    return '';
  }

  function guideHtml() {
    return `<details class="rx-guide" data-keep="rx-guide">
      <summary><strong>Hướng dẫn 5 thí nghiệm phản ứng</strong></summary>
      ${EXPERIMENTS.map(
        (x) => `<details class="rx-exp" data-keep="rx-exp-${x.n}"><summary>${x.n}. ${esc(x.title)}</summary>
          <p class="rx-eq">${esc(x.eq)}</p>
          <ol>${x.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          <p class="rx-wrong">⚠ Bước dễ làm sai: ${esc(x.wrong)}</p></details>`
      ).join('')}
    </details>`;
  }

  function handleAction(btn) {
    const op = btn.dataset.op;
    if (op === 'stopper') toggleStopper(ctx.getSelected());
  }

  return {
    handlesSource,
    pour,
    checkPour,
    checkSource,
    blockedTarget,
    afterPour,
    decorate,
    liquidColor,
    update,
    vesselHtml,
    itemHtml,
    guideHtml,
    handleAction,
    productName: (id) => PRODUCT_NAMES[id] ?? null,
    get mistakeActive() {
      return Boolean(mistake);
    },
    gasBusy: () => Boolean(gasJob),
    reset: resetAll,
  };
}
