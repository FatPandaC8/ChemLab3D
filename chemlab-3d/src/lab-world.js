// ============================================================
// ChemLab 3D — Thao tác với đồ vật trong phòng thí nghiệm
// Tủ / ngăn kéo (mở, lấy, cất đồ), bồn rửa (vòi, cống, rửa, hứng nước),
// ổ điện và thiết bị điện, van gas và đèn Bunsen, ghế, sổ ghi chép, bảng trắng,
// máy đo pH, cân phân tích, máy ly tâm, tủ hút, đèn, rèm, cửa, đồ bảo hộ...
// main.js chỉ gọi các hàm công khai: pick, select, panelHtml, placedHtml,
// handleAction, update, clampToSurfaces, onDrop, onRemove, serialize, restore.
// ============================================================
import * as THREE from 'three';
import { STORAGES, recommendedStorage, PPE, CORROSIVE } from './lab-storage-defs.js';
import { chemistPanelHtml, fillChemistPhoto } from './lab-chemists.js';
import { estimatePH } from './lab-ph.js';
import { STOCK_SPECS, liquidColorFor } from './lab-models.js';
import { DEFAULT_BOARD, ROOM } from './lab-room.js';
import { getElement } from './elements.js';

const POWERED = new Set(['hot-plate', 'balance', 'magnetic-stirrer', 'heating-mantle', 'ph-meter']);
const LAMPS = new Set(['bunsen', 'spirit-lamp']);
const CABLE_MAX = 22; // dây điện / ống gas dài tối đa (đơn vị cảnh ≈ 2,2 m)

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)).toLocaleString('vi-VN') : '?');
const btn = (op, label, { arg = '', primary = false, disabled = false, danger = false } = {}) =>
  `<button class="btn${primary ? ' btn-primary' : ''}${danger ? ' btn-danger' : ''}" data-action="w" data-op="${op}" data-arg="${esc(arg)}"${disabled ? ' disabled' : ''}>${label}</button>`;
const ease = (x) => x * x * (3 - 2 * x);

export function createLabWorld(ctx) {
  const R = ctx.room.registry;
  const refs = R.refs;
  const scene = ctx.scene;

  // ---------------- trạng thái ----------------
  const state = {
    storages: Object.fromEntries(Object.keys(STORAGES).map((id) => [id, []])), // đồ người dùng cất vào
    power: {}, // instanceId -> { outlet, on }
    gas: {}, // instanceId -> { valve }
    lit: {}, // instanceId -> true (đèn đang cháy)
    sink: { water: false, drainOpen: true, level: 0 },
    hood: { sashUp: false, light: true, fan: true },
    lightsOn: true,
    blindsDown: false,
    doorOpen: false,
    ppe: { goggles: false, gloves: false, coat: false },
    board: [...DEFAULT_BOARD],
    timer: { set: 300, left: 300, running: false },
    counterStir: true,
    spectroOn: false,
    microOn: false,
    firstAidOpen: false,
    extCharge: 100, // áp suất bình chữa cháy (%)
    sandUses: 6, // số lần đổ cát còn lại
    trash: 0, // số món trong thùng rác
    waste: { vol: 0, ids: [], dirty: false }, // cốc chất thải
    coolant: {}, // instanceId ống sinh hàn -> { valve, on }
  };
  let sel = null; // đồ vật trong phòng đang chọn
  const cables = new Map(); // instanceId -> { mesh, key }
  const leds = new Map(); // instanceId -> mesh
  const stirBars = new Map(); // instanceId -> mesh
  const tweens = [];
  const particles = [];
  let sitting = null;
  let anaTare = 0;
  let centrifugeSpin = 0;
  let lastClockSec = -1;
  let lastPH = null; // { name, result }
  let lastSpectro = null;
  const drafts = { note: '', board: null, timer: null }; // nội dung đang gõ (giữ lại khi bảng thông tin vẽ lại)

  for (const st of Object.values(R.storages)) {
    for (const p of st.parts) {
      if (p.type === 'slide') p.base = p.obj.position.x;
    }
  }

  // ---------------- tiện ích ----------------
  const placed = () => ctx.placed;
  const itemName = (id) => ctx.itemById[id]?.name ?? id;
  const isVessel = (root) => ctx.getSampleInfo(root.userData.itemId).kind === 'vessel';
  const iid = (root) => String(root.userData.instanceId);
  const worldPos = (o) => o.getWorldPosition(new THREE.Vector3());
  const toast = (m, t) => ctx.showToast(m, t);
  const vol = (root) => ctx.experimentState.liquidVolumes?.[iid(root)] ?? 0;
  const benchVessels = (withLiquid = true) => placed().filter((p) => isVessel(p) && (!withLiquid || vol(p) > 0));

  function addTween(obj, to, dur, { arc = 0, onDone } = {}) {
    tweens.push({ obj, from: obj.position.clone(), to: to.clone(), t: 0, dur, arc, onDone });
  }

  // ---------------- chọn đồ vật trong phòng ----------------
  function pick(raycaster) {
    const hits = raycaster.intersectObjects(R.items, true);
    const found = [];
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.interactive) o = o.parent;
      if (o && o.visible !== false && !found.includes(o)) found.push(o);
    }
    if (!found.length) return null;
    // tủ đang mở: bấm xuyên qua cánh kính / khung để lấy món đồ bên trong
    const first = found[0].userData.interactive;
    if (first.kind === 'cabinet' && storageOpen(first.storage)) {
      const inside = found.find((o) => {
        const i = o.userData.interactive;
        return (i.kind === 'cabinetItem' || i.kind === 'elementJar' || i.kind === 'cabinetBottle' || i.kind === 'ppeItem') && (!i.storage || i.storage === first.storage);
      });
      if (inside) return inside;
    }
    return found[0];
  }

  function select(obj) {
    if (!obj) {
      sel = null;
      return;
    }
    const info = obj.userData.interactive;
    sel = { obj, ...info };
    // một số đồ vật phản hồi ngay khi bấm
    switch (info.kind) {
      case 'cabinet': {
        const st = R.storages[info.storage];
        const part = st?.parts.find((p) => p.obj === obj);
        if (part?.type === 'slide') setStorageOpen(info.storage, !storageOpen(info.storage));
        else if (part) part.target = part.target ? 0 : 1;
        break;
      }
      case 'faucet':
        setWater(!state.sink.water);
        break;
      case 'drain':
        state.sink.drainOpen = !state.sink.drainOpen;
        toast(state.sink.drainOpen ? 'Đã mở nắp cống: nước trong bồn thoát đi.' : 'Đã đóng nắp cống: nước sẽ giữ lại trong bồn.');
        break;
      case 'door':
        state.doorOpen = !state.doorOpen;
        break;
      case 'lights':
        setLights(!state.lightsOn);
        break;
      case 'blinds':
        state.blindsDown = !state.blindsDown;
        ctx.lights.fill.intensity = state.blindsDown ? 0.35 : 0.9;
        break;
      case 'counterStirrer':
        state.counterStir = !state.counterStir;
        break;
      case 'firstAid':
        state.firstAidOpen = !state.firstAidOpen;
        break;
      default:
        break;
    }
  }

  function clearSelection() {
    sel = null;
  }

  function setWater(on) {
    state.sink.water = on;
    toast(on ? 'Đã mở vòi nước.' : 'Đã khóa vòi nước.');
  }

  function setLights(on) {
    state.lightsOn = on;
    refs.panelLight.emissiveIntensity = on ? 2.4 : 0.12;
    ctx.lights.sun.intensity = on ? 2.1 : 0.45;
    ctx.lights.hemi.intensity = on ? 0.5 : 0.18;
    toast(on ? 'Đã bật đèn trần.' : 'Đã tắt đèn trần (chỉ còn ánh sáng từ cửa sổ).');
  }

  // ---------------- tủ: mở, lấy đồ, cất đồ ----------------
  function storageOpen(id) {
    return (R.storages[id]?.parts ?? []).some((p) => p.target > 0);
  }
  function setStorageOpen(id, open) {
    for (const p of R.storages[id]?.parts ?? []) if (p.type !== 'slide' || p.dist) p.target = open ? 1 : 0;
  }
  function storageAnchor(id) {
    const a = R.storages[id]?.anchor;
    return a ? a() : new THREE.Vector3(0, 2, 0);
  }

  // Lấy một mục thư viện ra bàn, bay từ tủ ra chỗ trống trên bàn
  async function takeItem(itemId, fromPos) {
    const item = ctx.itemById[itemId];
    if (!item) return;
    let root = null;
    if (item.stock) {
      const picked = await ctx.askAmount({
        container: ctx.viewportEl,
        title: `Lấy ${item.name} ra bàn`,
        units: ctx.stockUnits(item),
        lines: [item.stock.conc ? `Nồng độ: ${item.stock.conc}` : item.formula],
        confirmLabel: 'Lấy ra',
        preview: (v, u) => {
          const q = ctx.toStockQuantity(item, v, u);
          if (!q.ok) return '';
          const parts = [`≈ ${fmt(q.volumeMl, 3)} mL`];
          if (q.moles != null && q.formula) parts.push(`≈ ${fmt(q.moles, 4)} mol ${q.formula}`);
          return parts.join(' · ');
        },
        validate: (v, u) => {
          const q = ctx.toStockQuantity(item, v, u);
          return q.ok ? null : q.error;
        },
      });
      if (!picked) return;
      root = ctx.addToBench(itemId, String(picked.value), picked.unit);
    } else {
      root = ctx.addToBench(itemId);
    }
    if (root && fromPos) {
      const target = root.position.clone();
      root.position.copy(fromPos);
      addTween(root, target, 0.9, { arc: 1.5 });
    }
  }

  // Cất vật đang chọn trên bàn vào tủ
  function storeSelected(storageId) {
    const root = ctx.getSelected();
    if (!root || !STORAGES[storageId]) return;
    if (burning(root)) {
      toast('Không thể cất vật đang cháy. Hãy dập lửa trước.', 'error');
      return;
    }
    if (ctx.animatorBusy()) {
      toast('Hãy đợi thao tác đang thực hiện xong.');
      return;
    }
    onRemove(root);
    setStorageOpen(storageId, true);
    const rec = { itemId: root.userData.itemId, instanceId: iid(root), name: ctx.nameOf(root) };
    const dest = storageAnchor(storageId);
    ctx.selectPlaced(null);
    addTween(root, dest, 0.9, {
      arc: 1.2,
      onDone: () => {
        ctx.stashPlaced(root);
        state.storages[storageId].push(rec);
        toast(`Đã cất ${rec.name} vào ${STORAGES[storageId].name}.`);
        setTimeout(() => setStorageOpen(storageId, false), 600);
        ctx.renderInfo();
      },
    });
  }

  function takeStored(storageId, index) {
    const list = state.storages[storageId];
    const rec = list?.[index];
    if (!rec) return;
    list.splice(index, 1);
    const root = ctx.restoreStored(rec);
    if (root) {
      const target = root.position.clone();
      root.position.copy(storageAnchor(storageId));
      addTween(root, target, 0.9, { arc: 1.5 });
      applyDeviceState(root);
    }
    ctx.renderInfo();
  }

  // ---------------- điện: ổ cắm, dây, bật / tắt ----------------
  const outletUser = (index) => Object.entries(state.power).find(([, p]) => p.outlet === index)?.[0] ?? null;
  const valveUser = (index) => Object.entries(state.gas).find(([, p]) => p.valve === index)?.[0] ?? null;

  function plug(root) {
    const p = worldPos(root);
    let best = null;
    for (const o of refs.outlets) {
      if (outletUser(o.index)) continue;
      const d = p.distanceTo(o.plug);
      if (d <= CABLE_MAX && (!best || d < best.d)) best = { o, d };
    }
    if (!best) {
      toast('Không còn ổ điện trống trong tầm dây (ổ điện ở máng kỹ thuật phía sau bàn chính).', 'error');
      return;
    }
    state.power[iid(root)] = { outlet: best.o.index, on: false };
    toast(`Đã cắm điện ${ctx.nameOf(root)} vào ổ số ${best.o.index + 1}. Bấm "Bật" để chạy máy.`);
  }
  function unplug(id) {
    delete state.power[id];
    const c = cables.get(id);
    if (c) {
      scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      cables.delete(id);
    }
  }
  function connectGas(root) {
    const p = worldPos(root);
    let best = null;
    for (const v of refs.valves) {
      if (v.type !== 'gas' || valveUser(v.index)) continue;
      const d = p.distanceTo(v.nozzle);
      if (d <= CABLE_MAX && (!best || d < best.d)) best = { v, d };
    }
    if (!best) {
      toast('Không còn van gas trống trong tầm ống (van vàng ở máng kỹ thuật phía sau bàn chính).', 'error');
      return;
    }
    state.gas[iid(root)] = { valve: best.v.index };
    toast(`Đã nối ống gas của đèn Bunsen vào ${best.v.label.toLowerCase()}.`);
  }
  function disconnectGas(id) {
    delete state.gas[id];
    delete state.lit[id];
    const c = cables.get(`gas:${id}`);
    if (c) {
      scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      cables.delete(`gas:${id}`);
    }
  }

  const cableMat = new THREE.MeshStandardMaterial({ color: 0x1f2328, roughness: 0.7 });
  const hoseMat = new THREE.MeshStandardMaterial({ color: 0xd9541e, roughness: 0.6 });
  function updateLine(key, from, to, mat, radius) {
    const sig = `${from.x.toFixed(2)},${from.y.toFixed(2)},${from.z.toFixed(2)}|${to.x.toFixed(2)},${to.z.toFixed(2)}`;
    let c = cables.get(key);
    if (c && c.sig === sig) return;
    const mid1 = new THREE.Vector3().lerpVectors(from, to, 0.3);
    const mid2 = new THREE.Vector3().lerpVectors(from, to, 0.7);
    mid1.y = Math.min(from.y, to.y, 0) + 0.04;
    mid2.y = Math.min(from.y, to.y, 0) + 0.04;
    if (Math.abs(from.y) > 1) mid1.y = from.y - 0.4; // thiết bị không ở mặt bàn chính
    const curve = new THREE.CatmullRomCurve3([from, mid1, mid2, to]);
    const geo = new THREE.TubeGeometry(curve, 40, radius, 8, false);
    if (!c) {
      c = { mesh: new THREE.Mesh(geo, mat), sig };
      c.mesh.castShadow = true;
      scene.add(c.mesh);
      cables.set(key, c);
    } else {
      c.mesh.geometry.dispose();
      c.mesh.geometry = geo;
      c.sig = sig;
    }
  }
  function deviceBack(root, toward) {
    const box = new THREE.Box3().setFromObject(root.userData.inner);
    const c = box.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(toward.x - c.x, 0, toward.z - c.z).normalize();
    const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.45;
    return new THREE.Vector3(c.x + dir.x * r, box.min.y + 0.12, c.z + dir.z * r);
  }

  function ledFor(root) {
    const id = iid(root);
    let m = leds.get(id);
    if (!m || m.parent !== root) {
      m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0x000000 }));
      const box = new THREE.Box3().setFromObject(root.userData.inner);
      const local = root.worldToLocal(new THREE.Vector3(box.max.x - 0.2, box.max.y - 0.05, box.max.z));
      m.position.copy(local);
      root.add(m);
      leds.set(id, m);
    }
    return m;
  }

  // Trạng thái đã lưu → gắn lên vật (sau khi lấy ra từ tủ hoặc tải bản lưu)
  function applyDeviceState(root) {
    const id = iid(root);
    root.userData.lit = Boolean(state.lit[id]);
  }

  // ---------------- bồn rửa ----------------
  const sink = refs.sink;
  function inSinkXZ(p, margin = 0.25) {
    return p.x > sink.x0 + margin && p.x < sink.x1 - margin && p.z > sink.z0 + margin && p.z < sink.z1 - margin;
  }
  const inSink = (root) => root.parent === scene && root.position.y < -0.5 && inSinkXZ(root.position, 0);

  async function fillFromTap(root) {
    if (!state.sink.water) {
      toast('Hãy mở vòi nước trước (bấm vào tay gạt vòi).', 'error');
      return;
    }
    const id = iid(root);
    const before = { vol: vol(root), ids: [...(ctx.experimentState.mixtures?.[id] || [])] };
    const ml = await ctx.askAmount({
      container: ctx.viewportEl,
      title: `Hứng nước máy vào ${ctx.nameOf(root)}`,
      units: [{ id: 'mL', label: 'mL' }],
      lines: ['Nước máy được tính như nước cất trong mô phỏng.'],
      confirmLabel: 'Hứng nước',
      validate: (v) => ctx.capacityError(root.userData.itemId, id, v),
    });
    if (!ml) return;
    root.position.x = sink.spout.x;
    root.position.z = sink.spout.z + 0.2;
    const res = ctx.pourIntoVessel(ctx.experimentState, 'water', root.userData.itemId, id, ml.value);
    if (!res.success) {
      toast(res.message, 'error');
      return;
    }
    ctx.saveExperimentState(ctx.experimentState);
    const after = vol(root);
    const dur = Math.min(6, 1 + ml.value / 50);
    let t = 0;
    tweens.push({
      custom: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        ctx.updateVesselLiquid(root, { volume: before.vol + (after - before.vol) * k, ids: [...before.ids, 'water'] });
        return k >= 1;
      },
      onDone: () => {
        ctx.updateVesselLiquid(root);
        toast(`Đã hứng ${fmt(ml.value, 2)} mL nước vào ${ctx.nameOf(root)}.`);
        ctx.renderInfo();
      },
    });
  }

  function clearContents(root) {
    const id = iid(root);
    const s = ctx.experimentState;
    if (s.mixtures) s.mixtures[id] = [];
    if (s.pourRecords) s.pourRecords[id] = [];
    if (s.liquidVolumes) s.liquidVolumes[id] = 0;
    if (s.liquidLevels) s.liquidLevels[id] = 0;
    if (s.reactedVessels) delete s.reactedVessels[id];
    if (s.temperatures) s.temperatures[id] = 25;
    ctx.refreshVessel(root);
  }

  function washVessel(root, rinse) {
    if (rinse && !state.sink.water) {
      toast('Hãy mở vòi nước trước khi rửa.', 'error');
      return;
    }
    const had = vol(root) > 0 || (ctx.experimentState.mixtures?.[iid(root)] || []).length > 0;
    const startRot = root.rotation.z;
    let t = 0;
    const dur = rinse ? 2.4 : 1.6;
    root.position.x = sink.spout.x;
    root.position.z = sink.spout.z + 0.2;
    tweens.push({
      custom: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        root.rotation.z = startRot + Math.sin(k * Math.PI) * (rinse ? 0.5 * Math.sin(t * 9) : 1.6);
        return k >= 1;
      },
      onDone: () => {
        root.rotation.z = startRot;
        clearContents(root);
        if (rinse) root.userData.wet = performance.now() / 1000;
        if (!state.sink.drainOpen && had) state.sink.level = Math.min(0.9, state.sink.level + 0.05);
        ctx.experimentState.log.push({
          type: 'success',
          message: rinse ? `Đã rửa sạch ${ctx.nameOf(root)} bằng nước máy.` : `Đã đổ bỏ dung dịch trong ${ctx.nameOf(root)} vào bồn rửa (nên tráng lại bằng nước).`,
          time: new Date().toLocaleTimeString(),
        });
        ctx.saveExperimentState(ctx.experimentState);
        toast(rinse ? `${ctx.nameOf(root)} đã được rửa sạch.` : `Đã đổ bỏ dung dịch trong ${ctx.nameOf(root)}.`);
        ctx.renderInfo();
      },
    });
  }

  // ---------------- máy đo pH ----------------
  function measurePH(vesselId, sourceName) {
    const root = placed().find((p) => iid(p) === vesselId);
    if (!root) return;
    const s = ctx.experimentState;
    const result = estimatePH(s.pourRecords?.[vesselId] || [], vol(root), STOCK_SPECS, { reacted: Boolean(s.reactedVessels?.[vesselId]) });
    lastPH = { name: ctx.nameOf(root), result, by: sourceName };
    const text = result.ok ? `pH ${result.approx ? '≈ ' : ''}${fmt(result.pH, 2)}` : 'Không đo được';
    drawScreen(refs.equipment.phCanvas, refs.equipment.phTex, result.ok ? fmt(result.pH, 2) : '--.--', 'pH');
    s.log.push({ type: 'info', message: `Đo pH ${ctx.nameOf(root)}: ${text}.`, time: new Date().toLocaleTimeString() });
    ctx.saveExperimentState(s);
    toast(`${ctx.nameOf(root)}: ${text}`);
  }

  function drawScreen(canvas, tex, big, small = '') {
    const g = canvas.getContext('2d');
    g.fillStyle = '#07140b';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#4ade80';
    g.font = `bold ${Math.round(canvas.height * 0.62)}px "Courier New", monospace`;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(big, canvas.width - (small ? 60 : 12), canvas.height / 2 + 2);
    if (small) {
      g.font = `bold ${Math.round(canvas.height * 0.3)}px Arial`;
      g.fillText(small, canvas.width - 10, canvas.height / 2 + 4);
    }
    tex.needsUpdate = true;
  }

  // ---------------- hiệu ứng hạt (rửa mắt, bình chữa cháy) ----------------
  const dropGeo = new THREE.SphereGeometry(1, 6, 5);
  function spray({ origin, dir, spread, speed, color, size, count, life, gravity = 9.8, opacity = 0.7 }) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(dropGeo, mat);
      m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      m.position.copy(origin);
      const v = dir.clone().normalize().multiplyScalar(speed * (0.7 + Math.random() * 0.6));
      v.x += (Math.random() - 0.5) * spread;
      v.y += (Math.random() - 0.5) * spread;
      v.z += (Math.random() - 0.5) * spread;
      scene.add(m);
      particles.push({ m, v, life: life * (0.6 + Math.random() * 0.6), gravity, delay: Math.random() * 2.5, grow: color === 0xffffff, s0: m.scale.x, age: 0 });
      m.visible = false;
    }
  }

  // ---------------- ghế: ngồi, đứng, nâng hạ ----------------
  function sit(index) {
    const st = refs.stools[index];
    if (!st) return;
    const seat = st.userData.seat;
    const p = worldPos(st);
    const seatTop = 6.45 + (seat?.position.y ?? 0) + ROOM_FY();
    if (!sitting) sitting = { prevPos: ctx.camera.position.clone(), prevTarget: ctx.controls.target.clone(), index };
    sitting.index = index;
    camTween(new THREE.Vector3(p.x, seatTop + 6.2, p.z + 0.5), new THREE.Vector3(p.x * 0.6, 0.8, -1.5));
    toast('Đã ngồi xuống ghế. Bấm "Đứng dậy" để trở lại góc nhìn cũ.');
  }
  function stand() {
    if (!sitting) return;
    camTween(sitting.prevPos, sitting.prevTarget);
    sitting = null;
  }
  let camAnim = null;
  function camTween(pos, target) {
    camAnim = { p0: ctx.camera.position.clone(), t0: ctx.controls.target.clone(), p1: pos.clone(), t1: target.clone(), t: 0 };
  }
  const ROOM_FY = () => refs.room.floorY;

  // ---------------- mặt đặt đồ: bàn chính, quầy, tủ hút ----------------
  function surfaces() {
    const bc = refs.backCounter;
    const sc = refs.sideCounter;
    const hs = refs.hood.surface;
    return [
      { x0: -ctx.benchW / 2 + 0.6, x1: ctx.benchW / 2 - 0.6, z0: -ctx.benchD / 2 + 0.6, z1: ctx.benchD / 2 - 0.6 },
      { x0: bc.x0, x1: bc.x1, z0: bc.z0, z1: bc.z1 },
      { x0: sc.x0, x1: sc.x1, z0: sc.z0, z1: sc.z1 },
      { x0: hs.x0, x1: hs.x1, z0: hs.z0, z1: hs.z1 },
    ];
  }
  function clampToSurfaces(v) {
    let best = null;
    for (const r of surfaces()) {
      const x = THREE.MathUtils.clamp(v.x, r.x0, r.x1);
      const z = THREE.MathUtils.clamp(v.z, r.z0, r.z1);
      const d = Math.hypot(v.x - x, v.z - z);
      if (!best || d < best.d) best = { x, z, d };
    }
    v.x = best.x;
    v.z = best.z;
    v.y = 0;
  }
  function onDrop(root) {
    if (root.userData.attach || root.parent !== scene) return;
    if (inSinkXZ(root.position)) {
      root.position.y = sink.bottomY + 0.03;
      return;
    }
    const pan = refs.anaBalance.pan;
    if (Math.hypot(root.position.x - pan.x, root.position.z - pan.z) < refs.anaBalance.radius) {
      root.position.x = pan.x;
      root.position.z = pan.z;
      root.position.y = pan.y;
      return;
    }
    root.position.y = 0;
  }
  const onAnaBalance = (root) => {
    const pan = refs.anaBalance.pan;
    return root.parent === scene && Math.abs(root.position.y - pan.y) < 0.01 && Math.hypot(root.position.x - pan.x, root.position.z - pan.z) < 0.05;
  };

  function onRemove(root) {
    const id = iid(root);
    const f = burning(root);
    if (f) removeFire(f, 'vật đã được dời khỏi phòng.');
    disconnectCoolant(id);
    unplug(id);
    disconnectGas(id);
    const bar = stirBars.get(id);
    if (bar) {
      bar.parent?.remove(bar);
      stirBars.delete(id);
    }
    leds.delete(id);
  }

  // ---------------- cập nhật mỗi khung hình ----------------
  function update(dt) {
    const k = Math.min(1, dt * 4);
    // cánh tủ, ngăn kéo, cửa kính trượt
    for (const st of Object.values(R.storages)) {
      for (const p of st.parts) {
        if (Math.abs(p.open - p.target) < 1e-3) continue;
        p.open += (p.target - p.open) * k;
        if (Math.abs(p.open - p.target) < 1e-3) p.open = p.target;
        const e = ease(p.open);
        if (p.type === 'door') p.obj.rotation.y = p.angle * e;
        else if (p.type === 'drawer') p.obj.position.z = p.dist * e;
        else if (p.type === 'slide') p.obj.position.x = p.base + p.dist * e;
      }
    }
    // tủ lạnh: đèn trong khi mở cửa
    refs.fridge.inside.emissiveIntensity = storageOpen('fridge') ? 0.6 : 0;
    // cửa ra vào, rèm, cửa kính tủ hút
    const door = R.items.find((o) => o.userData.interactive?.kind === 'door');
    if (door) door.rotation.y += ((state.doorOpen ? 1.25 : 0) - door.rotation.y) * k;
    for (const f of refs.blinds.list) f.scale.y += ((state.blindsDown ? refs.blinds.full : refs.blinds.short) - f.scale.y) * k;
    const sash = refs.hood.sash;
    sash.position.y += ((state.hood.sashUp ? refs.hood.sashHigh : refs.hood.sashLow) - sash.position.y) * k;
    refs.hood.interior.emissiveIntensity = state.hood.light ? 0.3 : 0;
    refs.hood.flow.material.emissiveIntensity = state.hood.fan ? 0.7 : 0.05;
    if (refs.lightSwitch) refs.lightSwitch.rocker.rotation.x = state.lightsOn ? 0.2 : -0.2;
    for (const v of refs.valves) {
      const used = v.type === 'gas' && Object.entries(state.gas).some(([id, g]) => g.valve === v.index && state.lit[id]);
      v.lever.rotation.y += ((used ? Math.PI / 2 : 0) - v.lever.rotation.y) * k;
    }

    // vòi nước, nước trong bồn
    const sk = state.sink;
    const flowRate = sk.water ? 0.045 : 0;
    const drainRate = sk.drainOpen ? 0.09 : 0;
    sk.level = THREE.MathUtils.clamp(sk.level + (flowRate - drainRate) * dt, 0, 1);
    if (sk.level > 0.85 && sk.water) {
      setWater(false);
      toast('Nước trong bồn sắp tràn, đã tự khóa vòi. Hãy mở nắp cống.', 'error');
    }
    for (const h of sink.handles) h.rotation.y += ((sk.water ? 0.9 : 0) - h.rotation.y) * k;
    sink.stopper.position.y = sink.bottomY + (sk.drainOpen ? 0.25 : 0.03);
    const waterY = sink.bottomY + 0.02 + sk.level * (-sink.bottomY - 0.3);
    sink.water.visible = sk.level > 0.004;
    sink.water.position.y = waterY;
    // dòng nước: rơi tới miệng bình đang đặt dưới vòi hoặc mặt nước / đáy bồn
    sink.stream.visible = sk.water;
    if (sk.water) {
      let endY = Math.max(waterY, sink.bottomY);
      for (const p of placed()) {
        if (!inSink(p)) continue;
        if (Math.hypot(p.position.x - sink.spout.x, p.position.z - sink.spout.z) < 0.9) {
          const box = new THREE.Box3().setFromObject(p);
          endY = Math.max(endY, box.max.y);
        }
      }
      const len = Math.max(0.05, sink.spout.y - endY);
      sink.stream.scale.set(1 + 0.08 * Math.sin(performance.now() / 60), len, 1);
      sink.stream.position.set(sink.spout.x, sink.spout.y - len / 2, sink.spout.z);
    }

    // thiết bị điện: dây, đèn báo, trạng thái chạy
    const now = performance.now() / 1000;
    for (const root of placed()) {
      const id = iid(root);
      const itemId = root.userData.itemId;
      if (POWERED.has(itemId)) {
        const p = state.power[id];
        if (p) {
          const o = refs.outlets[p.outlet];
          const from = deviceBack(root, o.plug);
          if (from.distanceTo(o.plug) > CABLE_MAX + 2) {
            unplug(id);
            toast(`Dây điện của ${ctx.nameOf(root)} bị kéo căng nên đã tuột khỏi ổ.`, 'error');
          } else updateLine(id, from, o.plug, cableMat, 0.045);
        }
        root.userData.powered = Boolean(p && p.on);
        const led = ledFor(root);
        led.material.color.setHex(!p ? 0x334155 : p.on ? 0x22c55e : 0xef4444);
        led.material.emissive.setHex(!p ? 0x000000 : p.on ? 0x16a34a : 0x7f1d1d);
        const heater = root.userData.inner.getObjectByName('heater');
        if (heater?.material.emissive && (itemId === 'heating-mantle' || itemId === 'hot-plate')) {
          const hot = root.userData.powered && root.children.some((c) => c.userData.attach);
          heater.material.emissive.setHex(hot ? 0x8a1c00 : 0x000000);
        }
      }
      if (LAMPS.has(itemId)) {
        if (itemId === 'bunsen') {
          const gs = state.gas[id];
          if (gs) {
            const v = refs.valves[gs.valve];
            const from = deviceBack(root, v.nozzle);
            if (from.distanceTo(v.nozzle) > CABLE_MAX + 2) {
              disconnectGas(id);
              toast('Ống gas của đèn Bunsen bị kéo căng nên đã tuột khỏi van, đèn tắt.', 'error');
            } else updateLine(`gas:${id}`, from, v.nozzle, hoseMat, 0.07);
          } else delete state.lit[id];
        }
        root.userData.lit = Boolean(state.lit[id]);
        if (!root.userData.flames) {
          root.userData.flames = [];
          root.userData.inner.traverse((o) => o.name === 'flame' && root.userData.flames.push(o));
        }
        for (const f of root.userData.flames) f.visible = root.userData.lit;
      }
      // cá từ quay trong bình đặt trên máy khuấy đang chạy
      if (isVessel(root)) {
        const stirring = ctx.stirrerOf(root) && vol(root) > 0;
        let bar = stirBars.get(id);
        if (stirring) {
          if (!bar) {
            bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.32, 4, 8), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }));
            bar.rotation.z = Math.PI / 2;
            const G = ctx.vesselGeom(root);
            const local = G ? root.worldToLocal(G.center.clone()) : new THREE.Vector3(0, 0.1, 0);
            bar.position.copy(local).add(new THREE.Vector3(0, 0.07, 0));
            bar.renderOrder = 7;
            root.add(bar);
            stirBars.set(id, bar);
          }
          bar.rotation.y = now * 14;
        } else if (bar) {
          root.remove(bar);
          stirBars.delete(id);
        }
      }
    }
    // ống nước làm mát nối với ống sinh hàn
    for (const [id, c] of Object.entries(state.coolant)) {
      const root = placed().find((p) => iid(p) === id);
      if (!root) continue;
      const v = refs.valves[c.valve];
      updateLine(`cool:${id}`, deviceBack(root, v.nozzle), v.nozzle, coolMat, 0.06);
      coolMat.opacity = c.on ? 0.95 : 0.6;
    }
    // dụng cụ vừa rửa tự khô dần
    for (const root of placed()) {
      if (root.userData.wet && now - root.userData.wet > 90) delete root.userData.wet;
    }
    // ổ điện: đèn báo
    for (const o of refs.outlets) {
      const user = outletUser(o.index);
      const on = user && state.power[user]?.on;
      o.led.material.emissive.setHex(!user ? 0x000000 : on ? 0x16a34a : 0x7f1d1d);
    }

    updateFire(dt, now);
    refs.firstAidDoor.rotation.y += ((state.firstAidOpen ? 1.6 : 0) - refs.firstAidDoor.rotation.y) * k;
    // máy khuấy trên quầy, máy ly tâm, kính hiển vi, máy quang phổ
    if (state.counterStir) refs.counterStirrer.bar.rotation.y = now * 12;
    if (centrifugeSpin > 0) {
      centrifugeSpin -= dt;
      refs.equipment.lid.rotation.y += dt * 30;
    }
    refs.equipment.microLight.material.emissiveIntensity = state.microOn ? 1.2 : 0;
    refs.equipment.screenMat.emissiveIntensity = state.spectroOn ? 0.6 : 0.08;
    if (lastSpectro && state.spectroOn) refs.equipment.screenMat.emissive.setHex(lastSpectro.color);
    else refs.equipment.screenMat.emissive.setHex(0x3d7bd9);

    // cân phân tích: hiển thị khối lượng vật trên đĩa
    const onPan = placed().find(onAnaBalance);
    const reading = onPan ? ctx.massOfContents(onPan).g : 0; // khối lượng chất (bì dụng cụ đã trừ sẵn)
    const shown = reading - anaTare;
    const txt = `${shown.toFixed(4)} g`;
    if (refs.anaBalance.last !== txt) {
      refs.anaBalance.last = txt;
      drawScreen(refs.anaBalance.canvas, refs.anaBalance.tex, shown.toFixed(4), 'g');
    }

    // đồng hồ treo tường + đồng hồ bấm giờ
    const date = new Date();
    if (date.getSeconds() !== lastClockSec) {
      lastClockSec = date.getSeconds();
      refs.clock.map.userData.draw(date);
    }
    const tm = state.timer;
    if (tm.running) {
      tm.left = Math.max(0, tm.left - dt);
      if (tm.left === 0) {
        tm.running = false;
        toast('Đồng hồ bấm giờ: hết giờ!', 'error');
        ctx.renderInfo();
      }
    }
    const tt = `${String(Math.floor(tm.left / 60)).padStart(2, '0')}:${String(Math.floor(tm.left % 60)).padStart(2, '0')}`;
    if (refs.timer.last !== tt) {
      refs.timer.last = tt;
      drawScreen(refs.timer.canvas, refs.timer.tex, tt);
      const el = ctx.infoEl.querySelector('[data-timer-left]');
      if (el) el.textContent = tt;
    }

    // chuyển động bay (lấy ra / cất vào tủ) và thao tác có thời lượng
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      let done;
      if (tw.custom) done = tw.custom(dt);
      else {
        tw.t += dt / tw.dur;
        const e = ease(Math.min(1, tw.t));
        tw.obj.position.lerpVectors(tw.from, tw.to, e);
        tw.obj.position.y += Math.sin(Math.min(1, tw.t) * Math.PI) * tw.arc;
        done = tw.t >= 1;
      }
      if (done) {
        tweens.splice(i, 1);
        tw.onDone?.();
      }
    }
    // hạt nước / bột chữa cháy
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.m.visible = true;
      p.life -= dt;
      p.v.y -= p.gravity * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.age += dt;
      if (p.grow) p.m.scale.setScalar(p.s0 * (1 + p.age * (p.smoke ? 0.5 : 1.2)));
      if (p.smoke && p.m.position.y > ROOM.ceilY - 1) p.v.y = 0; // khói dồn dưới trần
      if (p.life <= 0 || p.m.position.y < ROOM_FY()) {
        scene.remove(p.m);
        particles.splice(i, 1);
      }
    }
    // camera khi ngồi / đứng
    if (camAnim) {
      camAnim.t = Math.min(1, camAnim.t + dt / 0.8);
      const e = ease(camAnim.t);
      ctx.camera.position.lerpVectors(camAnim.p0, camAnim.p1, e);
      ctx.controls.target.lerpVectors(camAnim.t0, camAnim.t1, e);
      if (camAnim.t >= 1) camAnim = null;
    }
  }


  // ================================================================
  // CHÁY DO SAI SÓT THÍ NGHIỆM, BÁO CHÁY VÀ CHỮA CHÁY
  // Nguyên nhân gây cháy trong mô phỏng (theo hiện tượng có thật):
  //  - Hơi cồn (etanol) trong cốc / chai để gần ngọn lửa trần (đèn cồn, đèn Bunsen) bắt lửa.
  //  - Kim loại kiềm K, Rb, Cs (hoặc từ 1 g Na) cho vào nước: phản ứng tỏa nhiệt mạnh, khí H₂ bốc cháy.
  // ================================================================
  const FIRST_AID = [
    { name: 'Băng gạc vô trùng', use: 'Băng vết cắt, vết bỏng sau khi đã làm mát.' },
    { name: 'Nước muối sinh lý', use: 'Rửa vết thương, rửa mắt bổ sung.' },
    { name: 'Thuốc mỡ trị bỏng nhẹ', use: 'Bôi sau khi làm mát vết bỏng nhẹ bằng nước sạch.' },
    { name: 'Kéo, nhíp, găng tay dùng một lần', use: 'Cắt băng, gắp dị vật nhỏ.' },
  ];
  const fires = [];
  const alarm = { active: false, silenced: false, cause: '', t: 0 };
  const sprinkler = { active: false, idle: 0, t: 0, emit: 0 };
  const exposure = new Map();
  const metalChecked = new Set();
  const AQUEOUS = new Set(['water', 'hcl', 'naoh', 'cuso4', 'hno3', 'h2so4', 'ch3cooh', 'nh3', 'agno3', 'bacl2', 'na2co3', 'kmno4', 'h2o2', 'fecl3']);
  const METAL_FIRE = { 'el:k': 0xc58bff, 'el:rb': 0xff4b6e, 'el:cs': 0x9b7bff, 'el:fr': 0xff6b3d, 'el:na': 0xffb02e };
  const flameGeo = new THREE.ConeGeometry(0.5, 1.6, 16, 1, true);
  flameGeo.translate(0, 0.8, 0);
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0x52525b, transparent: true, opacity: 0.16, depthWrite: false });
  const fireLight = new THREE.PointLight(0xff7a2a, 0, 18, 1.6);
  scene.add(fireLight); // thêm sẵn một lần để không phải biên dịch lại vật liệu khi có cháy

  const isStockEthanol = (root) => root.userData.itemId === 'ethanol' && ctx.experimentState.samples?.[iid(root)];
  function ethanolMl(root) {
    if (isStockEthanol(root)) return ctx.experimentState.samples[iid(root)].amount ?? 0;
    return (ctx.experimentState.pourRecords?.[iid(root)] || []).filter((r) => r.chemicalId === 'ethanol').reduce((a, r) => a + (r.volumeMl || 0), 0);
  }
  const burning = (root) => fires.find((f) => f.root === root) ?? null;
  function topOf(root) {
    const b = new THREE.Box3().setFromObject(root.userData.inner);
    return new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
  }
  function litFlames() {
    return placed()
      .filter((p) => LAMPS.has(p.userData.itemId) && p.userData.lit)
      .map((p) => ({ root: p, pos: topOf(p) }));
  }

  function ignite(root, kind, cause, color = 0xff8a2a) {
    if (burning(root)) return;
    const g = new THREE.Group();
    const mk = (c, op, sx, sy) => {
      const m = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      m.scale.set(sx, sy, sx);
      g.add(m);
      return m;
    };
    const cones = [mk(color, 0.8, 1.2, 1.3), mk(0xffd34d, 0.85, 0.75, 1.0), mk(kind === 'ethanol' ? 0x4f7dff : 0xffffff, 0.75, 0.4, 0.6)];
    g.userData.interactive = { kind: 'fire' };
    scene.add(g);
    R.items.push(g);
    const f = { root, kind, cause, g, cones, size: kind === 'metal' ? 0.75 : 0.35, age: 0, fuel: 0, smoke: 0, water: 0, flared: false, refresh: 0 };
    if (kind === 'metal') {
      const rec = (ctx.experimentState.pourRecords?.[iid(root)] || []).find((r) => METAL_FIRE[r.chemicalId]);
      f.fuel = 12 + (rec?.massG ?? 1) * 8;
    }
    fires.push(f);
    exposure.delete(iid(root));
    ctx.experimentState.log.push({ type: 'error', message: `🔥 CHÁY tại ${ctx.nameOf(root)}: ${cause}`, time: new Date().toLocaleTimeString() });
    ctx.saveExperimentState(ctx.experimentState);
    toast(`🔥 CHÁY! ${cause}`, 'error');
    sel = { obj: g, kind: 'fire' };
    ctx.selectPlaced(null);
    ctx.renderInfo();
  }

  function removeFire(f, message) {
    const i = fires.indexOf(f);
    if (i < 0) return;
    fires.splice(i, 1);
    scene.remove(f.g);
    f.g.children.forEach((c) => c.material.dispose());
    const k = R.items.indexOf(f.g);
    if (k >= 0) R.items.splice(k, 1);
    if (sel?.obj === f.g) sel = null;
    ctx.experimentState.log.push({ type: 'success', message: `Đám cháy tại ${ctx.nameOf(f.root)} đã tắt: ${message}`, time: new Date().toLocaleTimeString() });
    ctx.saveExperimentState(ctx.experimentState);
    toast(`Đã tắt đám cháy tại ${ctx.nameOf(f.root)}: ${message}${!fires.length && alarm.active ? ' Hãy đặt lại hệ thống báo cháy.' : ''}`);
    updateBanner();
    ctx.renderInfo();
  }

  // Dụng cụ chữa cháy dùng lên một đám cháy
  function useOnFire(tool, index) {
    const f = fires[index];
    if (!f) return;
    const at = topOf(f.root);
    const camDir = new THREE.Vector3().subVectors(ctx.camera.position, at).setY(0).normalize();
    const from = at.clone().addScaledVector(camDir, 3).add(new THREE.Vector3(0, 1.4, 0));
    if (tool === 'extinguish') {
      if (state.extCharge <= 0) {
        toast('Bình chữa cháy đã hết áp suất, cần nạp lại.', 'error');
        return;
      }
      state.extCharge = Math.max(0, state.extCharge - 34);
      spray({ origin: from, dir: at.clone().sub(from), spread: 1.2, speed: 7, color: 0xffffff, size: 0.16, count: 140, life: 0.9, gravity: 0.5, opacity: 0.4 });
      setTimeout(() => {
        if (!fires.includes(f)) return;
        if (f.kind === 'metal') {
          f.size = 1;
          toast('Bình bột ABC không dập được đám cháy kim loại kiềm (lửa còn bùng lên). Hãy dùng CÁT KHÔ.', 'error');
        } else removeFire(f, 'đã phun bình chữa cháy bột ABC vào gốc lửa.');
      }, 1000);
    } else if (tool === 'blanket') {
      if (f.kind === 'metal') {
        toast('Không dùng chăn chống cháy cho đám cháy kim loại kiềm. Hãy dùng cát khô.', 'error');
        return;
      }
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 2.2), new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.95 }));
      cloth.position.copy(at).add(new THREE.Vector3(0, 3, 0));
      scene.add(cloth);
      let t = 0;
      tweens.push({
        custom: (dt) => {
          t += dt;
          cloth.position.y = at.y + 0.1 + Math.max(0, 3 - t * 6);
          return t > 4;
        },
        onDone: () => {
          scene.remove(cloth);
          toast('Đã gỡ chăn chống cháy sau khi lửa tắt hẳn (chăn đã dùng được bỏ đi).');
        },
      });
      setTimeout(() => fires.includes(f) && removeFire(f, 'đã trùm chăn chống cháy, lửa tắt do thiếu không khí.'), 700);
    } else if (tool === 'sand') {
      if (state.sandUses <= 0) {
        toast('Xô cát đã hết, hãy đổ đầy lại.', 'error');
        return;
      }
      state.sandUses -= 1;
      spray({ origin: at.clone().add(new THREE.Vector3(0, 2.5, 0)), dir: new THREE.Vector3(0, -1, 0), spread: 0.8, speed: 2, color: 0xd8c08a, size: 0.07, count: 120, life: 1.2, gravity: 9.8, opacity: 0.95 });
      setTimeout(() => {
        if (!fires.includes(f)) return;
        if (!isStockEthanol(f.root)) clearContents(f.root);
        removeFire(f, 'đã phủ cát khô lên đám cháy (dụng cụ bị lẫn cát, cần làm sạch).');
      }, 900);
    }
  }

  function fireTargetsHtml(op, label) {
    return `<div class="world-list">${fires
      .map((f, i) => `<div class="world-row"><span>🔥 ${esc(ctx.nameOf(f.root))} <small>${f.kind === 'metal' ? 'kim loại kiềm' : 'hơi cồn'}</small></span>${btn(op, `${label} đám cháy`, { arg: i, primary: true, danger: true })}</div>`)
      .join('')}</div>`;
  }

  function firePanel() {
    if (!fires.length) return card('Đám cháy', 'Không còn đám cháy', '', '<p class="info-desc">Đám cháy đã được dập tắt.</p>');
    const f = fires.find((x) => x.g === sel?.obj) ?? fires[0];
    const i = fires.indexOf(f);
    const metal = f.kind === 'metal';
    return card(
      '🔥 ĐÁM CHÁY',
      `Cháy tại ${ctx.nameOf(f.root)}`,
      `Đang cháy ${Math.round(f.age)} giây`,
      `<p class="info-desc">${esc(f.cause)}</p>
       <p class="sample-warn">${metal ? 'Đám cháy kim loại kiềm: KHÔNG dùng nước, bình CO₂ hay bột ABC. Phủ CÁT KHÔ lên đám cháy.' : 'Đám cháy chất lỏng dễ cháy: khóa van gas / đậy đèn cồn, rồi dùng chăn chống cháy hoặc bình chữa cháy bột. Không dùng nước.'}</p>
       <ol class="info-notes"><li>Báo động cho mọi người (bấm nút BÁO CHÁY cạnh cửa nếu chuông chưa kêu).</li><li>Tắt nguồn lửa: khóa van gas, đậy đèn cồn.</li><li>Dập lửa bằng dụng cụ phù hợp.</li><li>Lửa lớn, không kiểm soát được: rời phòng theo lối ra.</li></ol>
       ${actions(
         btn('lampsOff', 'Khóa van gas / tắt đèn'),
         btn('sand', `Đổ cát khô (còn ${state.sandUses})`, { arg: i, primary: metal }),
         btn('blanket', 'Trùm chăn chống cháy', { arg: i, primary: !metal }),
         btn('extinguish', `Phun bình chữa cháy (${Math.round(state.extCharge)}%)`, { arg: i, danger: true }),
         alarm.active ? '' : btn('alarmOn', 'Bấm nút báo cháy', { danger: true })
       )}`
    );
  }

  function alarmPanel(kind) {
    const title = kind === 'smokeDetector' ? 'Đầu báo khói' : kind === 'callPoint' ? 'Nút báo cháy bằng tay' : 'Còi và đèn chớp báo cháy';
    const desc =
      kind === 'smokeDetector'
        ? 'Đầu báo khói quang điện trên trần, tự kích hoạt chuông báo cháy khi khói từ đám cháy bay tới (vài giây sau khi bắt lửa).'
        : kind === 'callPoint'
          ? 'Phát hiện cháy: đập kính, nhấn nút để kích hoạt chuông và đèn chớp báo cháy toàn phòng.'
          : 'Kêu và chớp đỏ khi hệ thống báo cháy được kích hoạt.';
    return card(
      'Hệ thống báo cháy',
      title,
      `Trạng thái: ${alarm.active ? 'ĐANG BÁO CHÁY' : 'bình thường'}`,
      `<p class="info-desc">${desc}</p>${alarm.active ? `<p class="sample-warn">${esc(alarm.cause)}</p>` : ''}
       ${actions(
         !alarm.active ? btn('alarmOn', 'Kích hoạt báo cháy', { danger: true }) : '',
         alarm.active && !alarm.silenced ? btn('silence', 'Tắt âm báo') : '',
         alarm.active ? btn('alarmReset', 'Đặt lại hệ thống báo cháy', { primary: !fires.length }) : ''
       )}`
    );
  }

  // ---- chuông báo cháy (âm thanh tạo bằng Web Audio, không cần tệp âm thanh)
  let audio = null;
  let osc = null;
  function sirenOn() {
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      gain.gain.value = 0.04;
      osc.connect(gain).connect(audio.destination);
      osc.start();
    } catch (_) {
      osc = null;
    }
  }
  function sirenOff() {
    try {
      osc?.stop();
    } catch (_) {
      /* bỏ qua */
    }
    osc = null;
  }
  document.addEventListener('pointerdown', () => audio?.state === 'suspended' && audio.resume().catch(() => {}));

  // ---- dải cảnh báo trên khung 3D
  const banner = document.createElement('div');
  banner.className = 'fire-banner';
  banner.hidden = true;
  ctx.viewportEl.appendChild(banner);
  banner.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fire-op]');
    if (!b) return;
    const opn = b.dataset.fireOp;
    if (opn === 'silence') {
      alarm.silenced = true;
      sirenOff();
    } else if (opn === 'reset') {
      if (fires.length) toast('Không thể đặt lại khi vẫn còn đám cháy.', 'error');
      else stopAlarm();
    } else if (opn === 'focus' && fires[0]) {
      const at = topOf(fires[0].root);
      camTween(at.clone().add(new THREE.Vector3(0, 7, 10)), at);
      sel = { obj: fires[0].g, kind: 'fire' };
      ctx.selectPlaced(null);
    }
    updateBanner();
    ctx.renderInfo();
  });
  function updateBanner() {
    banner.hidden = !alarm.active && !fires.length;
    if (banner.hidden) return;
    banner.innerHTML = `<strong>🔥 ${fires.length ? `CÓ ${fires.length} ĐÁM CHÁY` : 'ĐÃ DẬP TẮT ĐÁM CHÁY'}</strong>
      <span>${alarm.active ? 'Chuông báo cháy đang kêu.' : 'Chuông chưa kêu — bấm nút BÁO CHÁY cạnh cửa.'}</span>
      ${fires.length ? '<button class="btn btn-danger" data-fire-op="focus">Đến đám cháy</button>' : ''}
      ${alarm.active && !alarm.silenced ? '<button class="btn" data-fire-op="silence">Tắt âm báo</button>' : ''}
      ${alarm.active && !fires.length ? '<button class="btn btn-primary" data-fire-op="reset">Đặt lại hệ thống báo cháy</button>' : ''}`;
  }

  function startAlarm(cause) {
    if (alarm.active) return;
    alarm.active = true;
    alarm.silenced = false;
    alarm.cause = cause;
    alarm.t = 0;
    sirenOn();
    ctx.experimentState.log.push({ type: 'error', message: `Chuông báo cháy kích hoạt: ${cause}`, time: new Date().toLocaleTimeString() });
    updateBanner();
    ctx.renderInfo();
  }
  function stopAlarm() {
    alarm.active = false;
    alarm.silenced = false;
    sirenOff();
    toast('Đã đặt lại hệ thống báo cháy.');
    updateBanner();
  }

  // ---- mỗi khung hình: phát hiện nguy cơ cháy, lửa cháy, khói, đầu phun
  let scanT = 0;
  function updateFire(dt, now) {
    scanT += dt;
    if (scanT > 0.25) {
      const step = scanT;
      scanT = 0;
      const flames = litFlames();
      for (const root of placed()) {
        if (burning(root)) continue;
        const id = iid(root);
        // kim loại kiềm gặp nước
        if (isVessel(root)) {
          const s = ctx.experimentState;
          const recs = s.pourRecords?.[id] || [];
          const wet = (s.mixtures?.[id] || []).some((x) => AQUEOUS.has(x)) && vol(root) > 0;
          recs.forEach((r, k) => {
            const key = `${id}:${k}`;
            if (!wet || metalChecked.has(key) || !METAL_FIRE[r.chemicalId]) return;
            if (r.chemicalId === 'el:na' && !((r.massG ?? 0) >= 1)) return;
            metalChecked.add(key);
            const el = getElement(r.chemicalId.slice(3));
            ignite(root, 'metal', `${el?.nameVi ?? r.chemicalId} phản ứng mãnh liệt với nước, khí hiđro sinh ra bốc cháy.`, METAL_FIRE[r.chemicalId]);
          });
          if (burning(root)) continue;
        }
        // hơi cồn gần ngọn lửa trần
        const eth = ethanolMl(root);
        if (!(eth >= 0.5) || !flames.length) {
          exposure.delete(id);
          continue;
        }
        const total = isStockEthanol(root) ? eth : vol(root);
        if (!isStockEthanol(root) && eth / Math.max(total, 1e-9) < 0.2) continue; // cồn quá loãng
        const T = ctx.experimentState.temperatures?.[id] ?? 25;
        const reach = isStockEthanol(root) ? 1.3 : T >= 70 ? 4 : 1.8;
        const p = topOf(root);
        const near = flames.find((fl) => fl.root !== root && Math.hypot(fl.pos.x - p.x, fl.pos.z - p.z) < reach && fl.pos.y > p.y - 4);
        if (!near) {
          exposure.delete(id);
          continue;
        }
        const tExp = (exposure.get(id) ?? 0) + step;
        exposure.set(id, tExp);
        if (tExp >= (isStockEthanol(root) ? 3 : 1.2)) {
          ignite(root, 'ethanol', `Hơi cồn từ ${ctx.nameOf(root)} bắt lửa vì để quá gần ${ctx.nameOf(near.root)} đang cháy.`);
        }
      }
    }

    let brightest = null;
    for (const f of [...fires]) {
      f.age += dt;
      const at = topOf(f.root);
      f.g.position.copy(at);
      // lửa lớn dần, rồi tắt khi hết nhiên liệu
      if (f.kind === 'ethanol') {
        f.size = Math.min(1, f.size + dt * 0.05);
        const burn = dt * (0.25 + 0.6 * f.size);
        if (isStockEthanol(f.root)) {
          const smp = ctx.experimentState.samples[iid(f.root)];
          smp.amount = Math.max(0, smp.amount - burn);
          if (smp.amount <= 0.05) {
            smp.amount = 0;
            ctx.refreshStock?.(f.root);
            removeFire(f, 'cồn trong chai đã cháy hết.');
            continue;
          }
        } else {
          const id = iid(f.root);
          const s = ctx.experimentState;
          let left = burn;
          for (const r of s.pourRecords?.[id] || []) {
            if (r.chemicalId !== 'ethanol' || !(r.volumeMl > 0) || left <= 0) continue;
            const take = Math.min(r.volumeMl, left);
            r.volumeMl -= take;
            left -= take;
            s.liquidVolumes[id] = Math.max(0, (s.liquidVolumes[id] ?? 0) - take);
          }
          f.refresh += dt;
          if (f.refresh > 0.6) {
            f.refresh = 0;
            ctx.updateVesselLiquid(f.root);
          }
          if (ethanolMl(f.root) <= 0.05) {
            s.mixtures[id] = (s.mixtures[id] || []).filter((x) => x !== 'ethanol');
            ctx.updateVesselLiquid(f.root);
            removeFire(f, 'cồn trong bình đã cháy hết.');
            continue;
          }
        }
      } else {
        f.fuel -= dt;
        if (f.fuel <= 0) {
          removeFire(f, 'kim loại đã phản ứng hết.');
          continue;
        }
      }
      // ngọn lửa bập bùng
      const flick = 1 + 0.15 * Math.sin(now * 17 + f.age) + 0.08 * Math.sin(now * 31);
      f.cones.forEach((c, i) => {
        c.scale.y = (i === 0 ? 1.3 : i === 1 ? 1.0 : 0.6) * f.size * flick * (f.kind === 'metal' ? 1.2 : 1) * 1.6;
        c.rotation.y += dt * (1 + i);
      });
      // khói bay lên trần
      f.smoke += dt;
      if (f.smoke > 0.25) {
        f.smoke = 0;
        const m = new THREE.Mesh(dropGeo, smokeMat);
        m.scale.setScalar(0.25 + f.size * 0.3);
        m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.2 * f.size, (Math.random() - 0.5) * 0.4));
        scene.add(m);
        particles.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.6 + Math.random(), (Math.random() - 0.5) * 0.4), life: 5, gravity: 0, delay: 0, grow: true, s0: m.scale.x, age: 0, smoke: true });
      }
      // lửa lan sang chất dễ cháy gần đó
      if (f.age > 8 && f.size > 0.6) {
        for (const other of placed()) {
          if (other === f.root || burning(other) || !(ethanolMl(other) >= 0.5)) continue;
          const p = topOf(other);
          if (Math.hypot(p.x - at.x, p.z - at.z) < 2.5) ignite(other, 'ethanol', `Lửa từ ${ctx.nameOf(f.root)} lan sang ${ctx.nameOf(other)} (có cồn).`);
        }
      }
      // đầu báo khói phát hiện sau vài giây
      if (f.age > 2.5 && !alarm.active) startAlarm(`Đầu báo khói phát hiện khói từ đám cháy tại ${ctx.nameOf(f.root)}.`);
      // đầu phun nước tự động khi nhiệt độ trần tăng (cháy lâu không ai dập)
      if (f.age > 40 && !sprinkler.active) {
        sprinkler.active = true;
        toast('Đầu phun nước chữa cháy tự động (sprinkler) đã kích hoạt do nhiệt độ trần tăng cao.', 'error');
      }
      if (sprinkler.active) {
        if (f.kind === 'ethanol') {
          f.water += dt;
          if (f.water > 3) {
            removeFire(f, 'đầu phun nước tự động đã dập tắt.');
            continue;
          }
        } else if (!f.flared) {
          f.flared = true;
          f.size = 1;
          toast('Nước từ đầu phun làm đám cháy kim loại kiềm bùng mạnh hơn! Phải phủ cát khô.', 'error');
        }
      }
      if (!brightest || f.size > brightest.size) brightest = f;
    }
    // ánh lửa
    if (brightest) {
      fireLight.position.copy(brightest.g.position).add(new THREE.Vector3(0, 1, 0));
      fireLight.color.setHex(brightest.kind === 'metal' ? 0xffb36b : 0xff7a2a);
      fireLight.intensity = (4 + 2 * Math.sin(now * 23)) * brightest.size;
    } else fireLight.intensity = 0;
    // đầu phun: tưới nước, tự ngắt khi không còn cháy
    if (sprinkler.active) {
      sprinkler.emit += dt;
      if (sprinkler.emit > 0.15) {
        sprinkler.emit = 0;
        const centers = fires.map((f) => f.g.position);
        for (const h of refs.sprinklers) {
          if (centers.length && !centers.some((c) => Math.hypot(c.x - h.x, c.z - h.z) < 14)) continue;
          spray({ origin: h, dir: new THREE.Vector3(0, -1, 0), spread: 3, speed: 3, color: 0xbfe3fb, size: 0.05, count: 6, life: 3, gravity: 9.8 });
        }
      }
      if (!fires.length) {
        sprinkler.idle += dt;
        if (sprinkler.idle > 5) {
          sprinkler.active = false;
          sprinkler.idle = 0;
          toast('Đầu phun nước đã ngừng.');
        }
      } else sprinkler.idle = 0;
    }
    // còi, đèn chớp, đèn đầu báo
    if (alarm.active) {
      alarm.t += dt;
      const on = Math.floor(alarm.t / 0.35) % 2 === 0;
      refs.strobeMat.emissiveIntensity = on ? 3 : 0;
      for (const d of refs.detectors) d.led.material.emissive.setHex(on ? 0xff0000 : 0x000000);
      if (osc && audio) osc.frequency.setValueAtTime(Math.floor(alarm.t / 0.5) % 2 ? 950 : 650, audio.currentTime);
    } else {
      refs.strobeMat.emissiveIntensity = 0;
      for (const d of refs.detectors) d.led.material.emissive.setHex(Math.floor(now) % 4 === 0 ? 0x22c55e : 0x000000);
    }
    if (fires.length || alarm.active) {
      if (!updateFire.bannerT || now - updateFire.bannerT > 1) {
        updateFire.bannerT = now;
        updateBanner();
      }
    } else if (!banner.hidden) updateBanner();
  }

  // ================================================================
  // RÁC, GĂNG TAY ĐÃ DÙNG, GIẤY LAU, CỐC CHẤT THẢI, NƯỚC LÀM MÁT, KÍNH HIỂN VI
  // ================================================================
  const loose = []; // găng tay đã tháo, giấy lau trên bàn
  function spawnLoose(kind, used = false) {
    const spot = kind === 'usedGloves' ? refs.spots.gloves : refs.spots.tissue;
    const obj = kind === 'usedGloves' ? refs.makeGloves() : refs.makeTissue(used);
    const n = loose.filter((l) => l.kind === kind).length;
    obj.position.copy(spot).add(new THREE.Vector3(0, used ? 0.18 : 0.02, n * 0.9));
    obj.rotation.y = (Math.random() - 0.5) * 0.6;
    obj.userData.interactive = { kind };
    scene.add(obj);
    R.items.push(obj);
    const rec = { kind, obj, used };
    loose.push(rec);
    return rec;
  }
  function removeLoose(rec) {
    const i = loose.indexOf(rec);
    if (i >= 0) loose.splice(i, 1);
    scene.remove(rec.obj);
    const k = R.items.indexOf(rec.obj);
    if (k >= 0) R.items.splice(k, 1);
    if (sel?.obj === rec.obj) sel = null;
  }
  function throwToTrash(rec, label) {
    const t = refs.trash;
    t.lid.rotation.x = -1.2;
    addTween(rec.obj, t.mouth, 0.8, {
      arc: 1.5,
      onDone: () => {
        removeLoose(rec);
        state.trash += 1;
        setTimeout(() => (t.lid.rotation.x = 0), 300);
        toast(`Đã bỏ ${label} vào thùng rác.`);
        ctx.renderInfo();
      },
    });
  }
  const looseOf = (obj) => loose.find((l) => l.obj === obj) ?? null;

  // cốc chất thải
  function updateWasteMesh() {
    const w = refs.waste;
    const h = Math.min(1.7, (state.waste.vol / w.capacity) * 1.7);
    w.liquid.visible = state.waste.vol > 0.05;
    w.liquid.scale.y = Math.max(0.01, h);
    w.liquid.position.y = 0.05 + h / 2;
    w.liquid.material.color.setHex(state.waste.ids.length ? liquidColorFor(state.waste.ids) : 0xd9eef8);
  }
  function pourToWaste(root) {
    const id = iid(root);
    const s = ctx.experimentState;
    const v = vol(root);
    const ids = [...new Set(s.mixtures?.[id] || [])];
    if (!(v > 0) && !ids.length) {
      toast('Bình không có gì để đổ.');
      return;
    }
    if (state.waste.vol + v > refs.waste.capacity) {
      toast(`Cốc chất thải sắp đầy (${fmt(state.waste.vol, 1)} / ${refs.waste.capacity} mL). Hãy đem đổ trước.`, 'error');
      return;
    }
    state.waste.vol += v;
    state.waste.ids = [...new Set([...state.waste.ids, ...ids])];
    state.waste.dirty = true;
    clearContents(root);
    updateWasteMesh();
    s.log.push({ type: 'info', message: `Đã đổ ${fmt(v, 2)} mL từ ${ctx.nameOf(root)} vào cốc chất thải.`, time: new Date().toLocaleTimeString() });
    ctx.saveExperimentState(s);
    toast(`Đã đổ ${fmt(v, 2)} mL vào cốc chất thải.`);
  }
  function wasteToSink(rinse) {
    const w = refs.waste;
    if (rinse && !state.sink.water) {
      toast('Hãy mở vòi nước ở bồn rửa trước.', 'error');
      return;
    }
    if (!rinse && !(state.waste.vol > 0)) {
      toast('Cốc chất thải đang trống.');
      return;
    }
    const target = new THREE.Vector3(sink.spout.x, sink.bottomY + 0.03, sink.spout.z + 0.2);
    const dangerous = state.waste.ids.some((x) => ['agno3', 'bacl2', 'cuso4', 'fecl3', 'kmno4', 'cuoh2'].includes(x) || String(x).startsWith('el:'));
    addTween(w.obj, target, 1.0, {
      arc: 3,
      onDone: () => {
        let t = 0;
        tweens.push({
          custom: (dt) => {
            t += dt;
            w.obj.rotation.z = Math.sin(Math.min(1, t / 1.6) * Math.PI) * (rinse ? 0.5 * Math.sin(t * 9) : 1.7);
            return t > 1.6;
          },
          onDone: () => {
            w.obj.rotation.z = 0;
            state.waste.vol = 0;
            state.waste.ids = [];
            if (rinse) state.waste.dirty = false;
            updateWasteMesh();
            if (!state.sink.drainOpen) state.sink.level = Math.min(0.9, state.sink.level + 0.04);
            toast(
              rinse
                ? 'Đã rửa sạch cốc chất thải.'
                : `Đã đổ chất thải vào bồn rửa.${dangerous ? ' Lưu ý: ngoài thực tế, dung dịch chứa kim loại nặng, muối bạc, bari hay chất oxi hóa phải đổ vào can chất thải nguy hại, không đổ xuống cống.' : ''}`
            );
            addTween(w.obj, w.home, 1.0, { arc: 3, onDone: () => ctx.renderInfo() });
          },
        });
      },
    });
  }

  // nước làm mát cho ống sinh hàn (van xanh trên máng kỹ thuật)
  const coolMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5, transparent: true, opacity: 0.9 });
  function connectCoolant(root) {
    const v = refs.valves.find((x) => x.type === 'water');
    if (!v) return;
    const used = Object.entries(state.coolant).find(([, c]) => c.valve === v.index);
    if (used) {
      toast('Van nước làm mát đang nối với một ống sinh hàn khác.', 'error');
      return;
    }
    if (worldPos(root).distanceTo(v.nozzle) > CABLE_MAX) {
      toast('Ống sinh hàn ở quá xa van nước (van xanh ở máng sau bàn chính).', 'error');
      return;
    }
    state.coolant[iid(root)] = { valve: v.index, on: false };
    toast('Đã nối ống nước làm mát vào ống sinh hàn. Bấm "Mở nước" để cho nước chảy qua vỏ ngoài.');
  }
  function disconnectCoolant(id) {
    delete state.coolant[id];
    const c = cables.get(`cool:${id}`);
    if (c) {
      scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      cables.delete(`cool:${id}`);
    }
  }

  // kính hiển vi: hình mô phỏng (không phải ảnh thật) dựng từ thành phần mẫu
  function microscopeImage(root) {
    const c = document.createElement('canvas');
    c.width = c.height = 280;
    const g = c.getContext('2d');
    g.fillStyle = '#111';
    g.fillRect(0, 0, 280, 280);
    g.save();
    g.beginPath();
    g.arc(140, 140, 132, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#f4f1e6';
    g.fillRect(0, 0, 280, 280);
    const id = iid(root);
    const s = ctx.experimentState;
    const ids = s.mixtures?.[id] || [];
    const recs = s.pourRecords?.[id] || [];
    const isEl = root.userData.itemId.startsWith('el:');
    if (!isEl && vol(root) > 0) {
      const col = liquidColorFor(ids);
      g.fillStyle = `#${col.toString(16).padStart(6, '0')}`;
      g.globalAlpha = 0.35;
      g.fillRect(0, 0, 280, 280);
      g.globalAlpha = 1;
    }
    const rnd = (() => {
      let x = 12345;
      return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    })();
    const solids = isEl || recs.some((r) => r.phase === 'solid') || ids.some((x) => x === 'cuoh2' || x === 'caco3');
    if (solids) {
      const col = ids.includes('cuoh2') ? '#2f6fd6' : ids.includes('caco3') ? '#e8e8e8' : '#6b7280';
      for (let i = 0; i < 60; i++) {
        g.fillStyle = col;
        g.globalAlpha = 0.6 + rnd() * 0.4;
        const x = rnd() * 280;
        const y = rnd() * 280;
        const r = 3 + rnd() * 9;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + rnd();
          g[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r * (0.6 + rnd() * 0.6), y + Math.sin(a) * r * (0.6 + rnd() * 0.6));
        }
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
    }
    // vài bọt khí nhỏ trong mẫu lỏng
    if (!isEl && vol(root) > 0) {
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < 8; i++) {
        g.beginPath();
        g.arc(rnd() * 280, rnd() * 280, 4 + rnd() * 10, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.restore();
    g.fillStyle = '#fff';
    g.font = '13px Arial';
    g.fillText('100× · hình mô phỏng', 10, 270);
    return c.toDataURL('image/png');
  }
  let microResult = null;

  // ---------------- bảng thông tin: đồ vật trong phòng ----------------
  const card = (badge, title, sub, body) => `
    <div class="info-card world-card">
      <span class="info-badge">${esc(badge)}</span>
      <h2 class="info-title">${esc(title)}</h2>
      ${sub ? `<p class="info-formula">${sub}</p>` : ''}
      ${body}
    </div>`;
  const actions = (...b) => `<div class="info-actions world-actions">${b.filter(Boolean).join('')}</div>`;

  function itemRows(items, fromStorage) {
    return items
      .map((id) => {
        const it = ctx.itemById[id];
        if (!it) return '';
        return `<div class="world-row"><span><b>${esc(it.name)}</b> <small>${esc(it.formula)}</small></span>${btn('take', it.stock ? 'Lấy…' : 'Lấy ra', {
          arg: `${id}|${fromStorage}`,
        })}</div>`;
      })
      .join('');
  }

  function storagePanel(id) {
    const def = STORAGES[id];
    const open = storageOpen(id);
    const stored = state.storages[id] ?? [];
    let body = `<p class="info-desc">${open ? 'Tủ đang mở.' : 'Tủ đang đóng — bấm vào cánh tủ hoặc ngăn kéo để mở.'}</p>`;
    if (def.items.length) body += `<div class="world-list"><strong>Có sẵn trong tủ</strong>${itemRows(def.items, id)}</div>`;
    if (def.periodic) {
      body += `<p class="info-desc">Tủ chứa lọ mẫu của 118 nguyên tố. Mở bảng tuần hoàn để chọn nguyên tố và lượng cần lấy.</p>${actions(
        btn('periodic', 'Mở bảng tuần hoàn để lấy mẫu', { primary: true })
      )}`;
    }
    if (def.ppe) {
      body += `<div class="world-list"><strong>Đồ bảo hộ</strong>${['goggles', 'gloves']
        .map((k) => `<div class="world-row"><span>${esc(PPE[k].name)}<br><small>${esc(PPE[k].desc)}</small></span>${btn('ppe', state.ppe[k] ? 'Tháo ra' : 'Đeo vào', { arg: k, primary: !state.ppe[k] })}</div>`)
        .join('')}</div>`;
    }
    body += `<div class="world-list"><strong>Đồ bạn đã cất vào (${stored.length})</strong>${
      stored.length
        ? stored.map((r, i) => `<div class="world-row"><span>${esc(r.name)}</span>${btn('takeStored', 'Lấy ra', { arg: `${id}|${i}` })}</div>`).join('')
        : '<p class="bench-saved">Chưa có. Chọn một vật trên bàn rồi bấm "Cất vào tủ".</p>'
    }</div>`;
    body += actions(btn('storageOpen', open ? 'Đóng tủ' : 'Mở tủ', { arg: id, primary: !open }));
    return card('Tủ trong phòng thí nghiệm', def.name, '', body);
  }

  function chemPanel(chem, badge) {
    const it = ctx.itemById[chem];
    if (!it) return card(badge, chem, '', '');
    return card(
      badge,
      it.name,
      esc(it.formula),
      `<p class="info-desc">${esc(it.desc)}</p>${it.stock?.conc ? `<p class="info-desc">Nồng độ: ${esc(it.stock.conc)}</p>` : ''}
       <p class="info-safety"><strong>An toàn:</strong> ${esc(it.safety)}</p>
       ${CORROSIVE.has(chem) && !(state.ppe.gloves && state.ppe.goggles) ? '<p class="sample-warn">Nên đeo găng tay và kính bảo hộ (ngăn kéo "Đồ bảo hộ" dưới bàn chính) trước khi dùng chất này.</p>' : ''}
       ${actions(btn('take', 'Lấy ra bàn thí nghiệm…', { arg: `${chem}|`, primary: true }))}`
    );
  }

  function vesselPicker(op, label, list) {
    if (!list.length) return '<p class="bench-saved">Chưa có bình nào chứa dung dịch trên bàn.</p>';
    return `<div class="world-list">${list
      .map((p) => `<div class="world-row"><span>${esc(ctx.nameOf(p))} <small>${fmt(vol(p), 2)} mL</small></span>${btn(op, label, { arg: iid(p) })}</div>`)
      .join('')}</div>`;
  }

  function phResultHtml() {
    if (!lastPH) return '';
    const r = lastPH.result;
    return `<div class="relation-box"><p><b>${esc(lastPH.name)}</b>: ${
      r.ok ? `pH <b>${r.approx ? '≈ ' : ''}${fmt(r.pH, 2)}</b>` : 'không đo được'
    }</p><p><small>${esc(r.note)}</small></p></div>`;
  }

  function sinkPanel() {
    const sk = state.sink;
    const inside = placed().filter(inSink);
    return card(
      'Bồn rửa',
      'Bồn rửa inox và vòi nước',
      '',
      `<p class="info-desc">Vòi: <b>${sk.water ? 'đang chảy' : 'đã khóa'}</b> · Nắp cống: <b>${sk.drainOpen ? 'mở (nước thoát)' : 'đóng (giữ nước)'}</b> · Nước trong bồn: <b>${Math.round(sk.level * 100)}%</b></p>
       ${actions(btn('water', sk.water ? 'Khóa vòi' : 'Mở vòi', { primary: !sk.water }), btn('drain', sk.drainOpen ? 'Đóng nắp cống' : 'Mở nắp cống'))}
       <div class="world-list"><strong>Dụng cụ đang ở trong bồn</strong>${
         inside.length
           ? inside.map((p) => `<div class="world-row"><span>${esc(ctx.nameOf(p))}</span></div>`).join('') + '<p class="bench-saved">Chọn dụng cụ trong bồn để hứng nước, rửa hoặc đổ bỏ.</p>'
           : '<p class="bench-saved">Kéo cốc, bình, ống nghiệm từ bàn tới quầy sau và thả vào lòng bồn rửa.</p>'
       }</div>`
    );
  }

  function panelHtml() {
    if (!sel) return '';
    const k = sel.kind;
    switch (k) {
      case 'portrait':
        return chemistPanelHtml(sel.chemist);
      case 'cabinet':
        return storagePanel(sel.storage);
      case 'shelfBottle':
      case 'cabinetBottle':
        return chemPanel(sel.chem, 'Chai hóa chất trong phòng');
      case 'cabinetItem': {
        const it = ctx.itemById[sel.item];
        if (!it) return storagePanel(sel.storage);
        return card(
          `Trong ${STORAGES[sel.storage]?.name ?? 'tủ'}`,
          it.name,
          esc(it.formula),
          `<p class="info-desc">${esc(it.desc)}</p>
           ${it.safety ? `<p class="info-safety"><strong>An toàn:</strong> ${esc(it.safety)}</p>` : ''}
           ${actions(btn('take', it.stock ? 'Lấy ra bàn…' : 'Lấy ra bàn', { arg: `${sel.item}|${sel.storage}`, primary: true }), btn('showStorage', 'Xem cả tủ', { arg: sel.storage }))}`
        );
      }
      case 'elementJar': {
        const el = getElement(sel.element);
        if (!el) return storagePanel('elements');
        return card(
          'Lọ mẫu trong tủ nguyên tố',
          `${el.nameVi} (${el.symbol})`,
          `Số hiệu ${el.atomicNumber} · ${el.phase === 'solid' ? 'chất rắn' : el.phase === 'liquid' ? 'chất lỏng' : 'chất khí'}`,
          `<p class="info-desc">${esc(el.highlight ?? '')}</p>${el.hazard ? `<p class="info-safety"><strong>An toàn:</strong> ${esc(el.hazard)}</p>` : ''}
           <p class="info-desc">Bấm nút dưới để mở bảng tuần hoàn tại nguyên tố này, nhập lượng cần lấy (g, mg, mol hoặc mL).</p>
           ${actions(btn('periodic', 'Lấy mẫu…', { arg: el.id, primary: true }))}`
        );
      }
      case 'ppeItem':
        return card(
          'Ngăn kéo đồ bảo hộ',
          PPE[sel.ppe].name,
          '',
          `<p class="info-desc">${esc(PPE[sel.ppe].desc)} Hiện tại: <b>${state.ppe[sel.ppe] ? 'đang mang' : 'chưa mang'}</b>.</p>${actions(btn('ppe', state.ppe[sel.ppe] ? 'Tháo ra' : 'Mang vào', { arg: sel.ppe, primary: !state.ppe[sel.ppe] }))}`
        );
      case 'fire':
        return firePanel();
      case 'smokeDetector':
      case 'alarmStrobe':
      case 'callPoint':
        return alarmPanel(k);
      case 'fireBlanket':
        return card(
          'Thiết bị chữa cháy',
          'Chăn chống cháy',
          'Sợi thủy tinh chống cháy',
          `<p class="info-desc">Kéo hai dây phía dưới để rút chăn, trùm kín miệng bình hoặc chậu đang cháy để cắt nguồn không khí. Dùng cho đám cháy nhỏ của chất lỏng dễ cháy (cồn...) hoặc quần áo bắt lửa. Không dùng cho đám cháy kim loại kiềm.</p>
           ${fires.length ? fireTargetsHtml('blanket', 'Trùm chăn lên') : '<p class="bench-saved">Hiện không có đám cháy.</p>'}`
        );
      case 'sandBucket':
        return card(
          'Thiết bị chữa cháy',
          'Xô cát khô',
          `Còn ${state.sandUses} lần dùng`,
          `<p class="info-desc">Cát khô phủ lên đám cháy để cắt không khí. Đây là cách dập đám cháy kim loại kiềm (Na, K...) — không dùng nước hay bình CO₂ cho loại đám cháy này. Cũng dùng được cho đám cháy chất lỏng nhỏ.</p>
           ${fires.length ? fireTargetsHtml('sand', 'Đổ cát lên') : '<p class="bench-saved">Hiện không có đám cháy.</p>'}
           ${state.sandUses <= 0 ? actions(btn('refillSand', 'Đổ đầy cát lại')) : ''}`
        );
      case 'gasCylinder':
        return chemPanel(sel.chem, 'Bình khí nén');
      case 'take':
        return card('Đồ dùng trên bàn', sel.title, '', `<div class="world-list">${itemRows(sel.items, '')}</div>`);
      case 'faucet':
      case 'drain':
      case 'sinkBasin':
        return sinkPanel();
      case 'outlet': {
        const user = outletUser(sel.index);
        const dev = user && placed().find((p) => iid(p) === user);
        return card(
          'Ổ điện',
          `Ổ điện số ${sel.index + 1}`,
          '220 V',
          `<p class="info-desc">${dev ? `Đang cắm: <b>${esc(ctx.nameOf(dev))}</b> (${state.power[user].on ? 'đang bật' : 'đang tắt'}).` : 'Ổ đang trống. Chọn một thiết bị điện trên bàn (bếp, máy khuấy, cân, máy đo pH...) rồi bấm "Cắm điện".'}</p>
           ${dev ? actions(btn('unplug', 'Rút phích', { arg: user })) : ''}`
        );
      }
      case 'valve': {
        const v = refs.valves[sel.index];
        const user = valveUser(sel.index);
        const dev = user && placed().find((p) => iid(p) === user);
        const desc =
          v.type === 'gas'
            ? dev
              ? `Đang nối ống gas với đèn Bunsen (${state.lit[user] ? 'van mở, đèn đang cháy' : 'van khóa'}).`
              : 'Chọn đèn Bunsen trên bàn rồi bấm "Nối ống gas".'
            : (() => {
                const c = Object.entries(state.coolant).find(([, x]) => x.valve === v.index);
                const cond = c && placed().find((p) => iid(p) === c[0]);
                return cond
                  ? `Đang nối ống nước với ${ctx.nameOf(cond)} (${c[1].on ? 'nước đang chảy' : 'van khóa'}).`
                  : 'Van cấp nước làm mát cho ống sinh hàn khi chưng cất. Chọn ống sinh hàn trên bàn rồi bấm "Nối ống nước làm mát".';
              })();
        return card('Van trên máng kỹ thuật', v.label, '', `<p class="info-desc">${desc}</p>${dev && state.lit[user] ? actions(btn('lamp', 'Khóa van, tắt đèn', { arg: user })) : ''}`);
      }
      case 'stool': {
        const st = refs.stools[sel.index];
        const h = st.userData.seat.position.y;
        return card(
          'Ghế phòng thí nghiệm',
          `Ghế số ${sel.index + 1}`,
          'Ghế xoay có ben hơi nâng hạ',
          `<p class="info-desc">Độ cao mặt ghế: ${fmt(62 + h * 10, 0)} cm.</p>
           ${actions(
             sitting ? btn('stand', 'Đứng dậy', { primary: true }) : btn('sit', 'Ngồi xuống', { arg: sel.index, primary: true }),
             btn('stoolUp', 'Nâng ghế', { arg: sel.index }),
             btn('stoolDown', 'Hạ ghế', { arg: sel.index }),
             btn('stoolTurn', 'Xoay ghế', { arg: sel.index })
           )}`
        );
      }
      case 'notebook': {
        const log = ctx.experimentState.log || [];
        return card(
          'Sổ ghi chép thí nghiệm',
          'Sổ ghi chép',
          `${log.length} mục`,
          `<textarea class="world-text" data-note rows="3" placeholder="Ghi chú quan sát, kết quả...">${esc(drafts.note)}</textarea>
           ${actions(btn('note', 'Ghi vào sổ', { primary: true }))}
           <div class="experiment-log world-log">${
             log.length
               ? [...log].reverse().map((e) => `<div class="experiment-log-entry"><small>${esc(e.time)}</small><p>${esc(e.message)}</p></div>`).join('')
               : '<p class="bench-saved">Sổ còn trống.</p>'
           }</div>`
        );
      }
      case 'whiteboard':
        return card(
          'Bảng trắng',
          'Bảng trắng',
          'Mỗi dòng là một dòng trên bảng (tối đa 10 dòng)',
          `<textarea class="world-text" data-board rows="7">${esc(drafts.board ?? state.board.join('\n'))}</textarea>
           ${actions(btn('board', 'Viết lên bảng', { primary: true }), btn('boardClear', 'Xóa bảng'), btn('boardReset', 'Viết lại mẫu'))}`
        );
      case 'timer':
        return card(
          'Đồng hồ bấm giờ',
          'Đồng hồ bấm giờ',
          '',
          `<p class="world-big" data-timer-left>${String(Math.floor(state.timer.left / 60)).padStart(2, '0')}:${String(Math.floor(state.timer.left % 60)).padStart(2, '0')}</p>
           <label class="amount-dialog-row"><input class="sample-amount-input" data-timer-min inputmode="decimal" placeholder="Số phút" value="${fmt(state.timer.set / 60, 2)}" /><span class="sample-unit sample-unit-fixed">phút</span></label>
           ${actions(btn('timerStart', state.timer.running ? 'Tạm dừng' : 'Bắt đầu', { primary: true }), btn('timerReset', 'Đặt lại'))}`
        );
      case 'clock': {
        const d = new Date();
        return card('Đồng hồ treo tường', 'Đồng hồ treo tường', '', `<p class="world-big">${d.toLocaleTimeString('vi-VN')}</p><p class="info-desc">Đồng hồ chạy theo giờ máy tính của bạn.</p>`);
      }
      case 'washBottle':
        return card(
          'Bình tia nước cất',
          'Bình tia nước cất',
          '500 mL',
          `<p class="info-desc">Bình nhựa mềm, bóp để phun tia nước cất tráng rửa dụng cụ.</p>${actions(
            btn('take', 'Đặt bình tia lên bàn', { arg: 'wash-bottle|' }),
            btn('take', 'Lấy nước cất…', { arg: 'water|', primary: true })
          )}`
        );
      case 'gloveBox':
        return card(
          'Hộp găng tay',
          'Găng tay nitrile',
          '',
          `<p class="info-desc">${esc(PPE.gloves.desc)} Hiện tại: <b>${state.ppe.gloves ? 'đang đeo' : 'chưa đeo'}</b>.</p>${actions(btn('ppe', state.ppe.gloves ? 'Tháo găng tay' : 'Đeo găng tay', { arg: 'gloves', primary: !state.ppe.gloves }))}`
        );
      case 'coat':
        return card(
          'Áo blouse',
          'Áo blouse phòng thí nghiệm',
          '',
          `<p class="info-desc">${esc(PPE.coat.desc)} Hiện tại: <b>${state.ppe.coat ? 'đang mặc' : 'chưa mặc'}</b>.</p>${actions(btn('ppe', state.ppe.coat ? 'Cởi áo, treo lại' : 'Mặc áo blouse', { arg: 'coat', primary: !state.ppe.coat }))}`
        );
      case 'soap':
        return card('Bồn rửa', 'Xà phòng rửa tay', '', `<p class="info-desc">Rửa tay bằng xà phòng sau khi tháo găng và trước khi rời phòng thí nghiệm.</p>${actions(btn('washHands', 'Rửa tay', { primary: true }))}`);
      case 'towels':
        return card(
          'Giấy lau',
          'Giấy lau / khăn giấy',
          '',
          `<p class="info-desc">Rút một tờ để lau khô tay, lau mặt bàn hoặc lau khô dụng cụ vừa rửa. Giấy đã dùng bỏ vào thùng rác cạnh bàn.</p>${actions(btn('tissueOut', 'Rút một tờ giấy', { primary: true }))}`
        );
      case 'tissue': {
        const rec = looseOf(sel.obj);
        if (!rec) return '';
        const i = loose.indexOf(rec);
        if (rec.used) return card('Giấy lau', 'Giấy lau đã dùng', '', `<p class="info-desc">Tờ giấy đã vo lại sau khi dùng.</p>${actions(btn('trash', 'Bỏ vào thùng rác', { arg: i, primary: true }))}`);
        const wet = placed().filter((p) => p.userData.wet);
        return card(
          'Giấy lau',
          'Tờ giấy lau sạch',
          '',
          `${actions(btn('wipe', 'Lau tay', { arg: `${i}|hands` }), btn('wipe', 'Lau mặt bàn', { arg: `${i}|bench` }))}
           <div class="world-list"><strong>Dụng cụ còn ướt (vừa rửa)</strong>${
             wet.length
               ? wet.map((p) => `<div class="world-row"><span>${esc(ctx.nameOf(p))}</span>${btn('wipe', 'Lau khô', { arg: `${i}|${iid(p)}` })}</div>`).join('')
               : '<p class="bench-saved">Không có dụng cụ nào đang ướt.</p>'
           }</div>`
        );
      }
      case 'usedGloves': {
        const rec = looseOf(sel.obj);
        if (!rec) return '';
        return card('Găng tay đã dùng', 'Đôi găng tay nitrile đã tháo', '', `<p class="info-desc">Găng đã dính hóa chất, không đeo lại. Bỏ vào thùng rác rồi rửa tay.</p>${actions(btn('trash', 'Bỏ vào thùng rác', { arg: loose.indexOf(rec), primary: true }))}`);
      }
      case 'trashBin':
        return card(
          'Thùng rác',
          'Thùng rác đạp chân',
          `Đang có ${state.trash} món`,
          `<p class="info-desc">Dùng cho găng tay, giấy lau đã dùng. Không bỏ hóa chất lỏng, mảnh thủy tinh vỡ hay kim loại kiềm vào thùng rác thường.</p>${actions(btn('emptyTrash', 'Đổ rác', { primary: state.trash > 0, disabled: state.trash === 0 }))}`
        );
      case 'wasteBeaker': {
        const w = state.waste;
        return card(
          'Cốc chất thải',
          'Cốc chứa chất thải thí nghiệm',
          `${fmt(w.vol, 2)} / ${refs.waste.capacity} mL${w.dirty && !(w.vol > 0) ? ' · cốc chưa rửa' : ''}`,
          `<p class="info-desc">${w.ids.length ? `Đang chứa: ${esc(w.ids.map(itemName).join(', '))}.` : 'Cốc đang trống.'} Chọn một bình trên bàn rồi bấm "Đổ vào cốc chất thải" để gom dung dịch thừa.</p>
           ${actions(btn('wasteDump', 'Đem ra bồn đổ bỏ', { primary: w.vol > 0, disabled: !(w.vol > 0) }), btn('wasteWash', 'Rửa cốc chất thải', { disabled: w.vol > 0 }))}`
        );
      }
      case 'sprinkler':
        return card(
          'Hệ thống chữa cháy',
          'Đầu phun nước tự động (sprinkler)',
          sprinkler.active ? 'ĐANG PHUN NƯỚC' : 'Đang chờ',
          '<p class="info-desc">Bóng thủy tinh trong đầu phun vỡ khi nhiệt độ trần tăng cao vì đám cháy kéo dài (trong mô phỏng: sau khoảng 40 giây không ai dập lửa), nước phun xuống khu vực có cháy. Nước dập được đám cháy cồn nhưng làm đám cháy kim loại kiềm bùng mạnh hơn.</p>'
        );
      case 'gasRack':
        return storagePanel('gas');
      case 'dryingRack':
        return card('Giá phơi dụng cụ', 'Dụng cụ đã rửa sạch, đang phơi khô', '', `<div class="world-list">${itemRows(['beaker', 'erlenmeyer', 'funnel', 'graduated-cylinder'], '')}</div>`);
      case 'anaBalance': {
        const onPan = placed().find(onAnaBalance);
        return card(
          'Cân phân tích',
          'Cân phân tích 0,1 mg',
          'Có tủ kính chắn gió',
          `<p class="world-big">${esc(refs.anaBalance.last ?? '0.0000 g')}</p>
           <p class="info-desc">${onPan ? `Trên đĩa: <b>${esc(ctx.nameOf(onPan))}</b>. Số hiển thị là khối lượng chất bên trong (khối lượng dụng cụ chứa đã được trừ bì).` : 'Kéo dụng cụ hoặc mẫu tới quầy sau và thả lên đĩa cân (trong tủ kính) để cân.'}</p>
           ${actions(btn('tare', 'Trừ bì (Tare)', { primary: true }), btn('zero', 'Về 0'))}`
        );
      }
      case 'counterStirrer':
        return card(
          'Máy khuấy từ trên quầy',
          'Máy khuấy từ (đã cắm điện sẵn)',
          '',
          `<p class="info-desc">Máy đang ${state.counterStir ? 'chạy' : 'tắt'}. Bấm vào máy để bật / tắt.</p>${
            refs.counterStirrer.beaker.visible ? actions(btn('stirBeaker', 'Lấy cốc nước cất đang khuấy ra bàn', { primary: true })) : '<p class="bench-saved">Cốc nước cất đã được lấy ra bàn.</p>'
          }`
        );
      case 'centrifuge': {
        const tubes = placed().filter((p) => p.userData.itemId === 'testtube');
        return card(
          'Máy ly tâm',
          'Máy ly tâm để bàn',
          'Tách chất rắn khỏi dung dịch',
          `<p class="info-desc">Chọn ống nghiệm trên bàn để ly tâm 4 giây (cân bằng bằng ống nước đối diện).</p>${
            tubes.length
              ? `<div class="world-list">${tubes.map((p) => `<div class="world-row"><span>${esc(ctx.nameOf(p))} <small>${fmt(vol(p), 2)} mL</small></span>${btn('centrifuge', 'Ly tâm', { arg: iid(p) })}</div>`).join('')}</div>`
              : '<p class="bench-saved">Trên bàn chưa có ống nghiệm.</p>'
          }`
        );
      }
      case 'spectro':
        return card(
          'Máy quang phổ',
          'Máy quang phổ UV-Vis',
          '',
          `<p class="info-desc">Máy ${state.spectroOn ? 'đang bật' : 'đang tắt'}. Mô phỏng chưa có dữ liệu phổ hấp thụ, máy chỉ hiển thị màu của dung dịch được đặt vào cuvet.</p>
           ${actions(btn('spectroPower', state.spectroOn ? 'Tắt máy' : 'Bật máy', { primary: !state.spectroOn }))}
           ${state.spectroOn ? vesselPicker('spectro', 'Đo màu', benchVessels()) : ''}
           ${lastSpectro ? `<div class="relation-box"><p>${esc(lastSpectro.name)}: màu dung dịch <span class="world-swatch" style="background:#${lastSpectro.color.toString(16).padStart(6, '0')}"></span></p></div>` : ''}`
        );
      case 'microscope': {
        const samples = placed().filter((p) => (isVessel(p) && (vol(p) > 0 || (ctx.experimentState.mixtures?.[iid(p)] || []).length)) || p.userData.itemId.startsWith('el:'));
        return card(
          'Kính hiển vi',
          'Kính hiển vi quang học',
          `Đèn soi ${state.microOn ? 'đang bật' : 'đang tắt'}`,
          `${actions(btn('micro', state.microOn ? 'Tắt đèn soi' : 'Bật đèn soi', { primary: !state.microOn }))}
           ${
             state.microOn
               ? samples.length
                 ? `<div class="world-list"><strong>Nhỏ một giọt / một ít mẫu lên lam kính</strong>${samples.map((p) => `<div class="world-row"><span>${esc(ctx.nameOf(p))}</span>${btn('microView', 'Soi mẫu', { arg: iid(p) })}</div>`).join('')}</div>`
                 : '<p class="bench-saved">Trên bàn chưa có mẫu để soi.</p>'
               : '<p class="bench-saved">Bật đèn soi để quan sát mẫu.</p>'
           }
           ${microResult ? `<div class="relation-box"><p><b>${esc(microResult.name)}</b></p><img class="world-micro" src="${microResult.url}" alt="Hình soi mẫu" /><p><small>Hình mô phỏng dựng từ thành phần mẫu (màu dung dịch, hạt rắn, kết tủa), không phải ảnh hiển vi chụp thật.</small></p></div>` : ''}`
        );
      }
      case 'phStation':
        return card(
          'Máy đo pH trên quầy',
          'Máy đo pH (đã cắm điện)',
          'Điện cực thủy tinh',
          `<p class="info-desc">Chọn bình có dung dịch trên bàn để đo.</p>${vesselPicker('ph', 'Đo pH', benchVessels())}${phResultHtml()}`
        );
      case 'fumeHood':
        return card(
          'Tủ hút khí độc',
          'Tủ hút khí độc',
          'Làm thí nghiệm với chất bay hơi, khí độc bên trong tủ',
          `<p class="info-desc">Cửa kính: <b>${state.hood.sashUp ? 'nâng cao' : 'hạ thấp (vị trí làm việc an toàn)'}</b> · Quạt hút: <b>${state.hood.fan ? 'đang chạy' : 'tắt'}</b> · Đèn: <b>${state.hood.light ? 'bật' : 'tắt'}</b>.</p>
           <p class="info-desc">Có thể kéo cốc, bình vào trong tủ hút để làm việc với HNO₃, HCl, NH₃ đặc.</p>
           ${actions(btn('sash', state.hood.sashUp ? 'Hạ cửa kính' : 'Nâng cửa kính'), btn('fan', state.hood.fan ? 'Tắt quạt' : 'Bật quạt'), btn('hoodLight', state.hood.light ? 'Tắt đèn' : 'Bật đèn'))}
           ${!state.hood.fan ? '<p class="sample-warn">Không làm việc với chất bay hơi khi quạt hút đang tắt.</p>' : ''}`
        );
      case 'eyewash':
        return card(
          'Thiết bị an toàn',
          'Trạm rửa mắt và vòi tắm khẩn cấp',
          '',
          `<p class="info-desc">Khi hóa chất bắn vào mắt: kéo cần vàng, giữ mí mắt mở và rửa liên tục ít nhất 15 phút, rồi báo người phụ trách. Khi hóa chất đổ lên người: kéo vòi tắm phía trên.</p>${actions(
            btn('eyewash', 'Kéo cần rửa mắt', { primary: true }),
            btn('shower', 'Kéo vòi tắm')
          )}`
        );
      case 'extinguisher':
        return card(
          'Thiết bị chữa cháy',
          'Bình chữa cháy bột ABC',
          `Áp suất còn ${Math.max(0, Math.round(state.extCharge))}%`,
          `<p class="info-desc">Cách dùng: rút chốt an toàn, hướng vòi vào gốc lửa, bóp cò và quét qua lại. Dùng cho đám cháy chất rắn, chất lỏng dễ cháy (cồn) và thiết bị điện. Không hiệu quả với đám cháy kim loại kiềm — khi đó dùng cát khô.</p>
           ${fires.length ? fireTargetsHtml('extinguish', 'Phun vào') : actions(btn('extinguish', 'Phun thử / tắt các ngọn đèn đang cháy', { arg: '', danger: true }))}
           ${state.extCharge <= 0 ? actions(btn('refillExt', 'Nạp lại bình')) : ''}`
        );
      case 'firstAid':
        return card(
          'Thiết bị an toàn',
          'Tủ sơ cứu',
          state.firstAidOpen ? 'Đang mở' : 'Đang đóng — bấm vào tủ để mở',
          `<div class="world-list">${FIRST_AID.map((f, i) => `<div class="world-row"><span><b>${esc(f.name)}</b><br><small>${esc(f.use)}</small></span>${btn('aid', 'Lấy dùng', { arg: i })}</div>`).join('')}</div>
           <p class="info-desc">Bỏng hóa chất: rửa nhiều nước sạch ít nhất 15 phút. Vết thương do thủy tinh: không tự gắp mảnh vỡ lớn, báo người phụ trách.</p>`
        );
      case 'door':
        return card('Cửa ra vào', 'Cửa phòng thí nghiệm', '', `<p class="info-desc">Cửa đang ${state.doorOpen ? 'mở' : 'đóng'}. Bấm vào cánh cửa để mở / đóng.</p>`);
      case 'lights':
        return card('Công tắc', 'Đèn trần', '', `<p class="info-desc">Đèn trần đang ${state.lightsOn ? 'bật' : 'tắt'}. Bấm vào công tắc để bật / tắt.</p>`);
      case 'blinds':
        return card('Cửa sổ', 'Rèm cuốn', '', `<p class="info-desc">Rèm đang ${state.blindsDown ? 'kéo xuống (che nắng)' : 'cuốn lên'}. Bấm vào rèm để kéo xuống / cuốn lên.</p>`);
      default:
        return '';
    }
  }

  // ---------------- bảng thông tin: phần thêm cho vật đang chọn trên bàn ----------------
  function placedHtml(root) {
    const id = iid(root);
    const itemId = root.userData.itemId;
    const parts = [];
    if (POWERED.has(itemId)) {
      const p = state.power[id];
      parts.push(`<p>Nguồn điện: <b>${!p ? 'chưa cắm điện' : p.on ? `đang bật (ổ số ${p.outlet + 1})` : `đã cắm (ổ số ${p.outlet + 1}), đang tắt`}</b></p>`);
      parts.push(
        actions(
          !p ? btn('plug', 'Cắm điện', { arg: id, primary: true }) : btn('unplug', 'Rút phích', { arg: id }),
          p ? btn('power', p.on ? 'Tắt máy' : 'Bật máy', { arg: id, primary: !p.on }) : ''
        )
      );
      if (itemId === 'ph-meter') {
        parts.push(root.userData.powered ? vesselPicker('ph', 'Đo pH', benchVessels()) + phResultHtml() : '<p class="bench-saved">Cắm điện và bật máy để đo pH.</p>');
      }
    }
    if (itemId === 'bunsen') {
      const gs = state.gas[id];
      parts.push(`<p>Khí đốt: <b>${!gs ? 'chưa nối ống gas' : state.lit[id] ? 'van mở, đèn đang cháy' : 'đã nối ống, van khóa'}</b></p>`);
      parts.push(
        actions(
          !gs ? btn('gasConnect', 'Nối ống gas', { arg: id, primary: true }) : btn('gasDisconnect', 'Tháo ống gas', { arg: id }),
          gs ? btn('lamp', state.lit[id] ? 'Khóa van, tắt đèn' : 'Mở van và châm lửa', { arg: id, primary: !state.lit[id] }) : ''
        )
      );
    }
    if (itemId === 'spirit-lamp') {
      parts.push(`<p>Đèn cồn: <b>${state.lit[id] ? 'đang cháy' : 'đã đậy nắp'}</b></p>`);
      parts.push(actions(btn('lamp', state.lit[id] ? 'Đậy nắp tắt đèn' : 'Châm lửa', { arg: id, primary: !state.lit[id] })));
    }
    const f = burning(root);
    if (f) parts.push(`<p class="sample-warn">🔥 Vật này đang cháy! ${esc(f.cause)}</p>${actions(btn('showFire', 'Xử lý đám cháy', { primary: true, danger: true }))}`);
    if (itemId === 'condenser') {
      const c = state.coolant[id];
      parts.push(`<p>Nước làm mát: <b>${!c ? 'chưa nối ống' : c.on ? 'đang chảy' : 'đã nối, van khóa'}</b></p>`);
      parts.push(actions(!c ? btn('coolConnect', 'Nối ống nước làm mát', { arg: id, primary: true }) : btn('coolDisconnect', 'Tháo ống nước', { arg: id }), c ? btn('coolToggle', c.on ? 'Khóa nước' : 'Mở nước', { arg: id, primary: !c.on }) : ''));
    }
    if (root.userData.wet) parts.push('<p>Dụng cụ còn <b>ướt</b> sau khi rửa — rút giấy lau (hộp giấy cạnh bồn rửa) để lau khô, hoặc để tự khô.</p>');
    if (isVessel(root) && (vol(root) > 0 || (ctx.experimentState.mixtures?.[id] || []).length)) {
      parts.push(actions(btn('toWaste', 'Đổ vào cốc chất thải', { arg: id })));
    }
    if (isVessel(root) && inSink(root)) {
      parts.push(`<p>Đang ở trong <b>bồn rửa</b> · vòi ${state.sink.water ? 'đang chảy' : 'đã khóa'}.</p>`);
      parts.push(
        actions(
          btn('water', state.sink.water ? 'Khóa vòi' : 'Mở vòi'),
          btn('fill', 'Hứng nước…', { arg: id, primary: true }),
          btn('wash', 'Rửa sạch', { arg: id }),
          btn('dump', 'Đổ bỏ dung dịch', { arg: id })
        )
      );
    }
    if (onAnaBalance(root)) parts.push(`<p>Đang trên <b>cân phân tích</b>: ${esc(refs.anaBalance.last ?? '')}</p>`);
    if (!root.userData.attach) {
      const rec = recommendedStorage(itemId);
      parts.push(`<div class="world-store"><select class="sample-unit" data-store-target>${Object.entries(STORAGES)
        .filter(([sid]) => sid !== 'gas')
        .map(([sid, s]) => `<option value="${sid}"${sid === rec ? ' selected' : ''}>${esc(s.name)}</option>`)
        .join('')}</select>${btn('store', 'Cất vào tủ', { arg: id })}</div>`);
    }
    return parts.length ? `<div class="relation-box world-box">${parts.join('')}</div>` : '';
  }

  // ---------------- xử lý nút trong bảng thông tin ----------------
  async function handleAction(el) {
    const op = el.dataset.op;
    const arg = el.dataset.arg ?? '';
    const byId = (id) => placed().find((p) => iid(p) === id);
    switch (op) {
      case 'take': {
        const [itemId, from] = arg.split('|');
        const pos = from ? storageAnchor(from) : sel?.obj ? worldPos(sel.obj).add(new THREE.Vector3(0, 1, 0)) : null;
        await takeItem(itemId, pos);
        break;
      }
      case 'takeStored': {
        const [sid, i] = arg.split('|');
        takeStored(sid, Number(i));
        break;
      }
      case 'storageOpen':
        setStorageOpen(arg, !storageOpen(arg));
        break;
      case 'periodic':
        ctx.openPeriodicTable(arg || null);
        return;
      case 'showFire': {
        const fr = burning(ctx.getSelected());
        if (fr) {
          sel = { obj: fr.g, kind: 'fire' };
          ctx.selectPlaced(null);
        }
        break;
      }
      case 'showStorage':
        sel = { kind: 'cabinet', storage: arg, obj: sel?.obj };
        break;
      case 'aid': {
        const f = FIRST_AID[Number(arg)];
        if (f) toast(`Đã lấy ${f.name.toLowerCase()} trong tủ sơ cứu.`);
        break;
      }
      case 'blanket':
      case 'sand':
        useOnFire(op, Number(arg));
        break;
      case 'lampsOff': {
        const n = Object.keys(state.lit).length;
        state.lit = {};
        toast(n ? `Đã khóa van gas và tắt ${n} ngọn đèn. Đám cháy vẫn còn nhiên liệu, cần dập tiếp.` : 'Không có đèn nào đang cháy.');
        break;
      }
      case 'alarmOn':
        startAlarm('Kích hoạt bằng nút báo cháy');
        break;
      case 'silence':
        alarm.silenced = true;
        sirenOff();
        break;
      case 'alarmReset':
        if (fires.length) toast('Không thể đặt lại khi vẫn còn đám cháy.', 'error');
        else stopAlarm();
        break;
      case 'refillExt':
        state.extCharge = 100;
        toast('Đã nạp lại bình chữa cháy.');
        break;
      case 'refillSand':
        state.sandUses = 6;
        toast('Đã đổ đầy cát vào xô.');
        break;
      case 'store': {
        const target = ctx.infoEl.querySelector('[data-store-target]')?.value;
        storeSelected(target);
        return;
      }
      case 'ppe':
        state.ppe[arg] = !state.ppe[arg];
        if (arg === 'coat') refs.coats.children[0].visible = !state.ppe.coat;
        if (arg === 'gloves' && !state.ppe.gloves) {
          spawnLoose('usedGloves');
          toast('Đã tháo găng tay (lộn trái khi tháo). Đôi găng đã dùng đặt ở đầu bàn bên phải — hãy bỏ vào thùng rác.');
        } else toast(`${PPE[arg].name}: ${state.ppe[arg] ? 'đã mang vào' : 'đã tháo ra'}.`);
        break;
      case 'trash': {
        const rec = loose[Number(arg)];
        if (rec) throwToTrash(rec, rec.kind === 'usedGloves' ? 'đôi găng tay đã dùng' : 'giấy lau đã dùng');
        return;
      }
      case 'emptyTrash':
        state.trash = 0;
        toast('Đã đổ thùng rác.');
        break;
      case 'tissueOut':
        if (loose.filter((l) => l.kind === 'tissue').length >= 3) toast('Trên bàn đã có 3 tờ giấy lau, hãy dùng hết trước.', 'error');
        else {
          spawnLoose('tissue');
          toast('Đã rút một tờ giấy lau, đặt ở đầu bàn bên trái.');
        }
        break;
      case 'wipe': {
        const [i, what] = arg.split('|');
        const rec = loose[Number(i)];
        if (!rec || rec.used) break;
        let msg = 'Đã lau tay bằng giấy.';
        if (what === 'bench') msg = 'Đã lau mặt bàn.';
        else if (what !== 'hands') {
          const r = byId(what);
          if (r) {
            delete r.userData.wet;
            msg = `Đã lau khô ${ctx.nameOf(r)}.`;
          }
        }
        // tờ giấy đã dùng: vo lại
        const pos = rec.obj.position.clone();
        removeLoose(rec);
        const used = spawnLoose('tissue', true);
        used.obj.position.copy(pos).setY(0.18);
        sel = { obj: used.obj, kind: 'tissue' };
        toast(msg + ' Giấy đã dùng — hãy bỏ vào thùng rác.');
        break;
      }
      case 'toWaste': {
        const r = byId(arg);
        if (r) pourToWaste(r);
        break;
      }
      case 'wasteDump':
        wasteToSink(false);
        break;
      case 'wasteWash':
        wasteToSink(true);
        break;
      case 'coolConnect': {
        const r = byId(arg);
        if (r) connectCoolant(r);
        break;
      }
      case 'coolDisconnect':
        disconnectCoolant(arg);
        break;
      case 'coolToggle': {
        const c = state.coolant[arg];
        if (c) {
          c.on = !c.on;
          toast(c.on ? 'Nước làm mát đang chảy qua ống sinh hàn (vào dưới, ra trên).' : 'Đã khóa nước làm mát.');
        }
        break;
      }
      case 'microView': {
        const r = byId(arg);
        if (r) microResult = { name: ctx.nameOf(r), url: microscopeImage(r) };
        break;
      }
      case 'stirBeaker': {
        refs.counterStirrer.beaker.visible = false;
        state.counterStir = false;
        const root = ctx.addToBench('beaker');
        if (root) {
          const res = ctx.pourIntoVessel(ctx.experimentState, 'water', 'beaker', iid(root), 150);
          if (res.success) ctx.updateVesselLiquid(root);
          const target = root.position.clone();
          root.position.copy(worldPos(refs.counterStirrer.bar));
          addTween(root, target, 0.9, { arc: 2 });
          toast('Đã lấy cốc 150 mL nước cất từ máy khuấy trên quầy ra bàn.');
        }
        return;
      }
      case 'water':
        setWater(!state.sink.water);
        break;
      case 'drain':
        state.sink.drainOpen = !state.sink.drainOpen;
        break;
      case 'fill': {
        const r = byId(arg);
        if (r) await fillFromTap(r);
        break;
      }
      case 'wash':
      case 'dump': {
        const r = byId(arg);
        if (r) washVessel(r, op === 'wash');
        break;
      }
      case 'plug': {
        const r = byId(arg);
        if (r) plug(r);
        break;
      }
      case 'unplug':
        unplug(arg);
        toast('Đã rút phích cắm.');
        break;
      case 'power': {
        const p = state.power[arg];
        if (p) p.on = !p.on;
        break;
      }
      case 'gasConnect': {
        const r = byId(arg);
        if (r) connectGas(r);
        break;
      }
      case 'gasDisconnect':
        disconnectGas(arg);
        break;
      case 'lamp': {
        const r = byId(arg);
        if (!r) break;
        if (r.userData.itemId === 'bunsen' && !state.gas[arg]) {
          toast('Hãy nối ống gas vào van vàng trên máng kỹ thuật trước.', 'error');
          break;
        }
        if (state.lit[arg]) delete state.lit[arg];
        else state.lit[arg] = true;
        toast(state.lit[arg] ? `Đã châm lửa ${ctx.nameOf(r)}.` : `Đã tắt ${ctx.nameOf(r)}.`);
        break;
      }
      case 'ph':
        measurePH(arg, sel?.kind ?? 'device');
        break;
      case 'sit':
        sit(Number(arg));
        break;
      case 'stand':
        stand();
        break;
      case 'stoolUp':
      case 'stoolDown': {
        const seat = refs.stools[Number(arg)].userData.seat;
        seat.position.y = THREE.MathUtils.clamp(seat.position.y + (op === 'stoolUp' ? 0.4 : -0.4), -1.2, 0.8);
        break;
      }
      case 'stoolTurn':
        refs.stools[Number(arg)].rotation.y += Math.PI / 4;
        break;
      case 'note': {
        const text = ctx.infoEl.querySelector('[data-note]')?.value.trim();
        if (!text) return;
        ctx.experimentState.log.push({ type: 'note', message: `📝 ${text}`, time: new Date().toLocaleTimeString() });
        drafts.note = '';
        ctx.saveExperimentState(ctx.experimentState);
        toast('Đã ghi vào sổ.');
        break;
      }
      case 'board':
      case 'boardClear':
      case 'boardReset':
        state.board =
          op === 'boardClear'
            ? []
            : op === 'boardReset'
              ? [...DEFAULT_BOARD]
              : (ctx.infoEl.querySelector('[data-board]')?.value ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 10);
        refs.whiteboard.map.userData.draw(state.board);
        drafts.board = null;
        break;
      case 'timerStart': {
        const t = state.timer;
        if (!t.running) {
          const mins = Number(String(ctx.infoEl.querySelector('[data-timer-min]')?.value ?? '').replace(',', '.'));
          if (Number.isFinite(mins) && mins > 0 && (t.left === 0 || Math.abs(mins * 60 - t.set) > 0.5)) {
            t.set = Math.min(mins * 60, 99 * 60);
            t.left = t.set;
          }
          if (t.left <= 0) t.left = t.set;
        }
        t.running = !t.running;
        break;
      }
      case 'timerReset':
        state.timer.running = false;
        state.timer.left = state.timer.set;
        break;
      case 'tare': {
        const onPan = placed().find(onAnaBalance);
        anaTare = onPan ? ctx.massOfContents(onPan).g : 0;
        refs.anaBalance.last = null;
        break;
      }
      case 'zero':
        anaTare = 0;
        refs.anaBalance.last = null;
        break;
      case 'centrifuge': {
        const r = byId(arg);
        if (!r) break;
        centrifugeSpin = 4;
        const ids = ctx.experimentState.mixtures?.[arg] || [];
        const solid = ids.some((x) => x === 'cuoh2' || x === 'caco3') || (ctx.experimentState.pourRecords?.[arg] || []).some((x) => x.phase === 'solid');
        setTimeout(() => {
          toast(solid ? `Ly tâm xong: chất rắn trong ${ctx.nameOf(r)} lắng chặt ở đáy, phần dung dịch phía trên trong.` : `Ly tâm xong: ${ctx.nameOf(r)} không có chất rắn để tách.`);
        }, 4000);
        break;
      }
      case 'spectroPower':
        state.spectroOn = !state.spectroOn;
        break;
      case 'spectro': {
        const r = byId(arg);
        if (r) lastSpectro = { name: ctx.nameOf(r), color: liquidColorFor(ctx.experimentState.mixtures?.[arg] || []) };
        break;
      }
      case 'micro':
        state.microOn = !state.microOn;
        break;
      case 'sash':
        state.hood.sashUp = !state.hood.sashUp;
        break;
      case 'fan':
        state.hood.fan = !state.hood.fan;
        break;
      case 'hoodLight':
        state.hood.light = !state.hood.light;
        break;
      case 'eyewash':
        spray({ origin: refs.eyewash.bowlTop, dir: new THREE.Vector3(0, 1, 0), spread: 0.8, speed: 2.4, color: 0xbfe3fb, size: 0.06, count: 90, life: 0.9, gravity: 6 });
        toast('Đang xả nước rửa mắt.');
        break;
      case 'shower':
        spray({ origin: refs.eyewash.shower, dir: new THREE.Vector3(0, -1, 0), spread: 2.2, speed: 3, color: 0xbfe3fb, size: 0.07, count: 160, life: 2.2, gravity: 9.8 });
        toast('Đang xả vòi tắm khẩn cấp.');
        break;
      case 'extinguish': {
        if (fires.length && arg !== '') {
          useOnFire('extinguish', Number(arg));
          break;
        }
        if (state.extCharge <= 0) {
          toast('Bình chữa cháy đã hết, cần nạp lại.', 'error');
          break;
        }
        state.extCharge -= 10;
        const from = worldPos(sel?.obj ?? ctx.camera).add(new THREE.Vector3(0.6, 0, -0.8));
        from.y = ROOM_FY() + 7.6;
        spray({ origin: from, dir: new THREE.Vector3(0.5, 0.15, -1), spread: 1.5, speed: 6, color: 0xffffff, size: 0.18, count: 120, life: 1.6, gravity: 0.6, opacity: 0.35 });
        const n = Object.keys(state.lit).length;
        state.lit = {};
        toast(n ? `Đã phun tắt ${n} ngọn đèn trên bàn.` : 'Đã phun thử bình chữa cháy.');
        break;
      }
      case 'washHands':
        toast(state.ppe.gloves ? 'Hãy tháo găng tay trước khi rửa tay.' : 'Đã rửa tay bằng xà phòng.');
        break;
      case 'towel':
        toast('Đã lấy giấy lau.');
        break;
      default:
        break;
    }
    ctx.renderInfo();
  }

  function afterRender(container) {
    fillChemistPhoto(container);
    const note = container.querySelector('[data-note]');
    if (note) note.addEventListener('input', () => (drafts.note = note.value));
    const board = container.querySelector('[data-board]');
    if (board) board.addEventListener('input', () => (drafts.board = board.value));
  }

  // Cảnh báo khi dùng chất ăn mòn mà chưa mang đồ bảo hộ
  function safetyWarning(chemId) {
    if (!CORROSIVE.has(chemId)) return null;
    const miss = [];
    if (!state.ppe.gloves) miss.push('găng tay');
    if (!state.ppe.goggles) miss.push('kính bảo hộ');
    return miss.length ? `Lưu ý an toàn: bạn chưa mang ${miss.join(' và ')} khi dùng ${itemName(chemId)}.` : null;
  }

  // ---------------- lưu / tải ----------------
  function serialize() {
    return JSON.parse(
      JSON.stringify({
        v: 1,
        storages: state.storages,
        power: state.power,
        gas: state.gas,
        lit: state.lit,
        sink: state.sink,
        hood: state.hood,
        lightsOn: state.lightsOn,
        blindsDown: state.blindsDown,
        doorOpen: state.doorOpen,
        ppe: state.ppe,
        board: state.board,
        timerSet: state.timer.set,
        extCharge: state.extCharge,
        sandUses: state.sandUses,
        trash: state.trash,
        waste: state.waste,
        coolant: state.coolant,
      })
    );
  }
  function restore(data) {
    [...fires].forEach((f) => removeFire(f, 'tải lại bố cục đã lưu.'));
    if (alarm.active) stopAlarm();
    for (const id of [...cables.keys()]) {
      scene.remove(cables.get(id).mesh);
      cables.get(id).mesh.geometry.dispose();
    }
    cables.clear();
    if (!data || data.v !== 1) {
      state.power = {};
      state.gas = {};
      state.lit = {};
      return;
    }
    state.storages = Object.fromEntries(Object.keys(STORAGES).map((id) => [id, Array.isArray(data.storages?.[id]) ? data.storages[id] : []]));
    const alive = new Set(placed().map(iid));
    const keep = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([id]) => alive.has(id)));
    state.power = keep(data.power);
    state.gas = keep(data.gas);
    state.lit = keep(data.lit);
    Object.assign(state.sink, data.sink || {});
    state.sink.water = false;
    Object.assign(state.hood, data.hood || {});
    if (typeof data.lightsOn === 'boolean' && data.lightsOn !== state.lightsOn) setLights(data.lightsOn);
    state.blindsDown = Boolean(data.blindsDown);
    ctx.lights.fill.intensity = state.blindsDown ? 0.35 : 0.9;
    state.doorOpen = Boolean(data.doorOpen);
    Object.assign(state.ppe, data.ppe || {});
    refs.coats.children[0].visible = !state.ppe.coat;
    if (Array.isArray(data.board)) {
      state.board = data.board.slice(0, 10);
      refs.whiteboard.map.userData.draw(state.board);
    }
    if (data.timerSet > 0) state.timer = { set: data.timerSet, left: data.timerSet, running: false };
    if (Number.isFinite(data.extCharge)) state.extCharge = data.extCharge;
    if (Number.isFinite(data.sandUses)) state.sandUses = data.sandUses;
    if (Number.isFinite(data.trash)) state.trash = data.trash;
    if (data.waste && typeof data.waste === 'object') state.waste = { vol: data.waste.vol || 0, ids: data.waste.ids || [], dirty: Boolean(data.waste.dirty) };
    updateWasteMesh();
    state.coolant = keep(data.coolant);
    placed().forEach(applyDeviceState);
  }
  // Ghi nhận các vật đang cất trong tủ (để không xóa dữ liệu của chúng)
  const storedIds = () => new Set(Object.values(state.storages).flat().map((r) => String(r.instanceId)));

  return {
    pick,
    select,
    clearSelection,
    get selection() {
      return sel;
    },
    panelHtml,
    placedHtml,
    handleAction,
    afterRender,
    update,
    clampToSurfaces,
    onDrop,
    onRemove,
    serialize,
    restore,
    storedIds,
    safetyWarning,
    isSitting: () => Boolean(sitting),
    // dùng cho lab-reactions.js
    get ppe() {
      return { ...state.ppe };
    },
    // vật có nằm trong tủ hút đang bật quạt không
    hoodStatus(root) {
      const p = root.getWorldPosition(new THREE.Vector3());
      const hs = refs.hood.surface;
      const inside = p.x >= hs.x0 - 0.2 && p.x <= hs.x1 + 0.2 && p.z >= hs.z0 - 0.2 && p.z <= hs.z1 + 0.2;
      return { inside, fan: state.hood.fan, sashUp: state.hood.sashUp };
    },
    // đưa camera tới nhìn một điểm (điểm hiện ở nửa trên khung hình)
    focusOn(point, dist = 9) {
      const dir = ctx.camera.position.clone().sub(ctx.controls.target);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize();
      // nhìn hơi chúc xuống để chỗ xảy ra sự cố nằm ở nửa trên khung hình, không bị hộp cảnh báo che
      const target = point.clone().add(new THREE.Vector3(0, -3.2, 0));
      camTween(point.clone().addScaledVector(dir, dist).add(new THREE.Vector3(0, 2.0, 0)), target);
    },
  };
}
