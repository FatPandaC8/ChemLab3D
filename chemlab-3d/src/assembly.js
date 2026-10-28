// ============================================================
// ChemLab 3D — Ghép dụng cụ với nhau
// Mỗi dụng cụ có các "ổ ghép" (socket). Kéo thả một vật lại gần ổ ghép
// phù hợp thì vật được giữ tại đó và di chuyển cùng vật chủ.
// Tọa độ ổ ghép tính theo mô hình gốc của vật chủ.
// ============================================================
import * as THREE from 'three';
import { setToolPose } from './lab-models.js';

// Vật đặt lên kiềng để đun
const HEATABLE = new Set(['beaker', 'erlenmeyer', 'roundflask', 'distilling-flask', 'evaporating-dish', 'crucible', 'filter-flask']);
// Vật đặt lên bếp gia nhiệt
const ON_PLATE = new Set(['beaker', 'erlenmeyer', 'roundflask', 'filter-flask', 'evaporating-dish', 'volumetric-flask']);
// Bình hứng dưới phễu, buret, phễu chiết
const RECEIVERS = new Set(['beaker', 'erlenmeyer', 'testtube', 'graduated-cylinder', 'volumetric-flask', 'filter-flask']);
const LAMPS = new Set(['bunsen', 'spirit-lamp']);
// Vật đặt lên máy khuấy từ (đáy phẳng)
const STIRRABLE = new Set(['beaker', 'erlenmeyer', 'filter-flask', 'volumetric-flask']);
const WEIGHABLE = new Set(['beaker', 'erlenmeyer', 'watch-glass', 'petri-dish', 'evaporating-dish', 'crucible', 'testtube', 'graduated-cylinder']);
// Vòng kẹp của giá đỡ giữ ở cổ bình (độ cao điểm kẹp trên mô hình gốc)
const CLAMP_ANCHOR = { roundflask: 2.3, 'distilling-flask': 2.15, testtube: 1.4 };
// Lòng bình nhận đũa thủy tinh, nhiệt kế: đáy và bán kính trong
const TOOL_HOSTS = {
  beaker: { y: 0.06, r: 0.62 },
  erlenmeyer: { y: 0.06, r: 0.6 },
  roundflask: { y: 0.25, r: 0.4 },
  'distilling-flask': { y: 0.2, r: 0.35 },
  'graduated-cylinder': { y: 0.1, r: 0.2 },
  'filter-flask': { y: 0.05, r: 0.5 },
  'evaporating-dish': { y: 0.05, r: 0.3 },
  crucible: { y: 0.07, r: 0.2 },
  testtube: { y: 0.05, r: 0.1 },
};

const receiverSocket = (label) => ({
  id: 'receiver', kind: 'place', pos: [0, 0.1, 0], accepts: (id) => RECEIVERS.has(id), label, snap: 0.9,
});

const SOCKETS = {
  rack: [-1, -0.5, 0, 0.5, 1].map((x, i) => ({
    id: `slot${i}`, kind: 'place', pos: [x, 0.14, 0], accepts: (id) => id === 'testtube', label: 'giá ống nghiệm', snap: 0.3,
  })),
  tripod: [
    { id: 'top', kind: 'place', pos: [0, 2.465, 0], accepts: (id) => HEATABLE.has(id), label: 'kiềng', snap: 0.8 },
    { id: 'under', kind: 'place', pos: [0, 0, 0], accepts: (id) => LAMPS.has(id), label: 'dưới kiềng', snap: 0.8 },
  ],
  'hot-plate': [{ id: 'top', kind: 'place', pos: [0, 0.476, 0], accepts: (id) => ON_PLATE.has(id), label: 'bếp gia nhiệt', snap: 0.8 }],
  balance: [
    {
      id: 'pan', kind: 'place', pos: [0, 0.31, -0.1],
      accepts: (id) => WEIGHABLE.has(id) || id.startsWith('el:'),
      label: 'đĩa cân', snap: 0.8,
    },
  ],
  stand: [
    { id: 'clamp', kind: 'clamp', pos: [0.7, 3.0, 0], accepts: (id) => CLAMP_ANCHOR[id] != null, label: 'vòng kẹp giá đỡ', snap: 0.9 },
    // đèn đặt ngay dưới vòng kẹp: đun trực tiếp ống nghiệm / bình đang kẹp
    { id: 'flame', kind: 'place', pos: [0.7, 0.15, 0], accepts: (id) => LAMPS.has(id), label: 'dưới vòng kẹp', snap: 0.6 },
  ],
  'magnetic-stirrer': [
    { id: 'top', kind: 'place', pos: [0, 0.49, -0.05], accepts: (id) => STIRRABLE.has(id), label: 'máy khuấy từ', snap: 0.8 },
  ],
  'heating-mantle': [
    { id: 'top', kind: 'place', pos: [0, 0.36, 0], accepts: (id) => id === 'roundflask' || id === 'distilling-flask', label: 'bếp bọc gia nhiệt', snap: 0.9 },
  ],
  // ống nghiệm đặt đứng trong cốc nước nóng: đun cách thủy
  beaker: [{ id: 'bath', kind: 'place', pos: [0, 0.06, 0], accepts: (id) => id === 'testtube', label: 'cốc nước (đun cách thủy)', snap: 0.45 }],
  funnel: [receiverSocket('dưới phễu')],
  burette: [receiverSocket('dưới buret')],
  'separatory-funnel': [receiverSocket('dưới phễu chiết')],
};
for (const [id, g] of Object.entries(TOOL_HOSTS)) {
  SOCKETS[id] = [
    ...(SOCKETS[id] || []),
    { id: 'rod', kind: 'tool', pos: [0, g.y, 0], accepts: (x) => x === 'stirring-rod', label: 'trong bình', snap: Math.max(0.5, g.r + 0.2), offset: g.r * 0.45, lean: 0.3 },
    { id: 'thermo', kind: 'tool', pos: [0, g.y, 0], accepts: (x) => x === 'thermometer', label: 'trong bình', snap: Math.max(0.5, g.r + 0.2), offset: -g.r * 0.45, lean: -0.24 },
  ];
}

export function socketsFor(itemId) {
  return SOCKETS[itemId] || [];
}

const innerPos = (root) => root.userData.inner?.position ?? new THREE.Vector3();

export function socketWorld(host, socket) {
  return host.localToWorld(innerPos(host).clone().add(new THREE.Vector3(...socket.pos)));
}

export function childAt(host, socketId) {
  return host.children.find((c) => c.userData.attach?.socket === socketId) ?? null;
}

export function childrenOf(host) {
  return host.children.filter((c) => c.userData.attach);
}

function isInside(node, ancestor) {
  for (let o = node; o; o = o.parent) if (o === ancestor) return true;
  return false;
}

// Tìm ổ ghép gần nhất phù hợp với vật đang kéo
export function findSnap(child, placed) {
  const id = child.userData.itemId;
  const cw = child.getWorldPosition(new THREE.Vector3());
  let best = null;
  for (const host of placed) {
    if (host === child || isInside(host, child)) continue;
    for (const s of socketsFor(host.userData.itemId)) {
      if (!s.accepts(id) || childAt(host, s.id)) continue;
      const sw = socketWorld(host, s);
      const d = Math.hypot(cw.x - sw.x, cw.z - sw.z);
      if (d <= s.snap && (!best || d < best.d)) best = { host, socket: s, d, world: sw };
    }
  }
  return best;
}

// Gắn vật vào ổ ghép của vật chủ (vật sẽ đi theo vật chủ)
export function attach(child, host, socket) {
  host.add(child);
  child.rotation.set(0, 0, 0);
  const local = innerPos(host).clone().add(new THREE.Vector3(...socket.pos));
  if (socket.kind === 'clamp') {
    local.y -= CLAMP_ANCHOR[child.userData.itemId] ?? 0;
  }
  child.position.copy(local);
  child.userData.attach = { host: host.userData.instanceId, socket: socket.id };
  if (socket.kind === 'tool') {
    setToolPose(child.userData.inner, 'leaning', { lean: socket.lean, offsetX: socket.offset });
  }
  return child;
}

// Tháo vật khỏi vật chủ, đặt lại xuống mặt bàn tại đúng chỗ đang đứng
export function detach(child, scene) {
  if (!child.userData.attach) return child;
  scene.attach(child);
  const e = new THREE.Euler().setFromQuaternion(child.quaternion, 'YXZ');
  child.rotation.set(0, e.y, 0);
  child.position.y = 0;
  delete child.userData.attach;
  if (child.userData.inner?.getObjectByName('pose')) setToolPose(child.userData.inner, 'lying');
  return child;
}

export function socketById(host, socketId) {
  return socketsFor(host.userData.itemId).find((s) => s.id === socketId) ?? null;
}

// Nguồn nhiệt cho một bình: đặt trên kiềng có đèn đang cháy bên dưới,
// hoặc trên bếp điện đã cắm điện và bật (userData.lit / userData.powered do lab-world.js đặt)
export function heatSourceOf(vessel) {
  const a = vessel.userData.attach;
  const host = vessel.parent;
  if (!a || !host?.userData) return null;
  if (host.userData.itemId === 'tripod' && a.socket === 'top') {
    const lamp = childAt(host, 'under');
    if (!lamp || !lamp.userData.lit) return null;
    return { power: lamp.userData.itemId === 'bunsen' ? 1.6 : 1.0, name: lamp.userData.itemId === 'bunsen' ? 'đèn Bunsen' : 'đèn cồn' };
  }
  if (host.userData.itemId === 'stand' && a.socket === 'clamp') {
    const lamp = childAt(host, 'flame');
    if (!lamp || !lamp.userData.lit) return null;
    const bunsen = lamp.userData.itemId === 'bunsen';
    return { power: bunsen ? 1.6 : 1.0, name: `ngọn lửa ${bunsen ? 'đèn Bunsen' : 'đèn cồn'} (đun trực tiếp)`, direct: true };
  }
  if (host.userData.itemId === 'hot-plate') return host.userData.powered ? { power: 1.3, name: 'bếp gia nhiệt' } : null;
  if (host.userData.itemId === 'heating-mantle') return host.userData.powered ? { power: 1.2, name: 'bếp bọc gia nhiệt' } : null;
  return null;
}

// Cốc nước đang chứa ống nghiệm (đun cách thủy)
export function bathOf(vessel) {
  const a = vessel.userData.attach;
  return a?.socket === 'bath' && vessel.parent?.userData?.itemId === 'beaker' ? vessel.parent : null;
}

// Máy đang khuấy bình này (bếp khuấy từ hoặc máy khuấy từ đã bật)
export function stirrerOf(vessel) {
  const host = vessel.parent;
  if (!vessel.userData.attach || !host?.userData) return null;
  const id = host.userData.itemId;
  return (id === 'hot-plate' || id === 'magnetic-stirrer') && host.userData.powered ? host : null;
}

// Ngọn lửa đèn đặt dưới kiềng chạm lưới thì bị ép thấp lại
export function flameScaleFor(lamp) {
  const a = lamp.userData.attach;
  if (!a || a.socket !== 'under') return 1;
  if (lamp.userData.itemId === 'bunsen') return 0.52;
  return 1;
}

export const ASSEMBLY_LABEL = (socket) => socket?.label ?? '';
