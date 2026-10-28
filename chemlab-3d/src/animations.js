// ============================================================
// ChemLab 3D — Hoạt cảnh chất: rót, thả chất rắn, nhỏ giọt,
// sủi bọt, kết tủa, sôi và hơi nước, khuấy.
// Mọi tọa độ trong file này là tọa độ thế giới (world).
// ============================================================
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const smooth = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

// Trọng lực "thị giác": chậm hơn thực tế để mắt kịp theo dõi
const GRAVITY = 9;

// ------------------------------------------------------------
// Tài nguyên dùng chung
// ------------------------------------------------------------
const SPHERE = new THREE.SphereGeometry(1, 12, 8);
const RING = new THREE.TorusGeometry(1, 0.06, 6, 32);
const GRAIN = new THREE.DodecahedronGeometry(1, 0);

let steamTexture = null;
function getSteamTexture() {
  if (steamTexture) return steamTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  steamTexture = new THREE.CanvasTexture(c);
  return steamTexture;
}

const liquidMaterial = (color, opacity = 0.8) =>
  new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.08, depthWrite: false });

function lighter(color, k = 0.45) {
  const c = new THREE.Color(color);
  return c.lerp(new THREE.Color(0xffffff), k);
}

export function createAnimator(scene) {
  const tasks = new Set();
  const boiling = new Map();
  let busy = 0;

  const add = (fn) => tasks.add(fn);

  function addMesh(geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 6;
    scene.add(m);
    return m;
  }
  function removeMesh(m, disposeGeo = false) {
    scene.remove(m);
    if (disposeGeo) m.geometry.dispose();
    if (m.material) m.material.dispose();
  }

  // ------------------------------------------------------------
  // Gợn sóng và giọt bắn tại chỗ chất lỏng rơi xuống
  // ------------------------------------------------------------
  function ripple(pos, color, size = 0.28) {
    const m = addMesh(RING, new THREE.MeshBasicMaterial({ color: lighter(color, 0.6), transparent: true, opacity: 0.6, depthWrite: false }));
    m.rotation.x = Math.PI / 2;
    m.position.copy(pos).add(new THREE.Vector3(0, 0.005, 0));
    let t = 0;
    add((dt) => {
      t += dt;
      const k = t / 0.6;
      m.scale.setScalar(0.04 + size * k);
      m.material.opacity = 0.6 * (1 - k);
      if (k >= 1) {
        removeMesh(m);
        return true;
      }
      return false;
    });
    // vài giọt bắn nhỏ
    for (let i = 0; i < 2; i++) {
      const d = addMesh(SPHERE, liquidMaterial(color, 0.75));
      d.scale.setScalar(0.018);
      d.position.copy(pos);
      const v = new THREE.Vector3(rand(-0.4, 0.4), rand(0.5, 0.9), rand(-0.4, 0.4));
      let life = 0;
      add((dt) => {
        life += dt;
        v.y -= GRAVITY * dt;
        d.position.addScaledVector(v, dt);
        if (life > 0.35 || d.position.y < pos.y - 0.01) {
          removeMesh(d);
          return true;
        }
        return false;
      });
    }
  }

  // ------------------------------------------------------------
  // Dòng chất lỏng theo đường cong rơi (có đầu dòng và đuôi dòng)
  // ------------------------------------------------------------
  function createStream(color, radius) {
    const mat = liquidMaterial(color, 0.78);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    mesh.renderOrder = 6;
    mesh.visible = false;
    scene.add(mesh);
    const drops = Array.from({ length: 6 }, () => {
      const d = addMesh(SPHERE, liquidMaterial(lighter(color, 0.25), 0.85));
      d.scale.setScalar(radius * 1.35);
      d.visible = false;
      return d;
    });
    let flow = 0;
    return {
      // start, end: Vector3; u0..u1: phần dòng đang hiển thị
      draw(start, end, u0, u1, dt) {
        flow += dt;
        if (u1 - u0 < 0.02) {
          mesh.visible = false;
          drops.forEach((d) => (d.visible = false));
          return;
        }
        const dir = new THREE.Vector3(end.x - start.x, 0, end.z - start.z);
        const ctrl = start.clone().addScaledVector(dir, 0.35);
        ctrl.y = start.y - Math.max(0.02, (start.y - end.y) * 0.08);
        const curve = new THREE.QuadraticBezierCurve3(start, ctrl, end);
        const pts = [];
        for (let i = 0; i <= 16; i++) pts.push(curve.getPoint(lerp(u0, u1, i / 16)));
        const old = mesh.geometry;
        mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, radius, 8, false);
        old.dispose();
        mesh.visible = true;
        drops.forEach((d, i) => {
          const u = (flow * 1.8 + i / drops.length) % 1;
          d.visible = u >= u0 && u <= u1;
          if (d.visible) d.position.copy(curve.getPoint(u));
        });
      },
      dispose() {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mat.dispose();
        drops.forEach((d) => removeMesh(d));
      },
    };
  }

  // ------------------------------------------------------------
  // Di chuyển vật nguồn: nghiêng quanh miệng (môi rót) như tay người
  // ------------------------------------------------------------
  function makeHandler({ source, mouth, targetPoint }) {
    const p0 = source.position.clone();
    const q0 = source.quaternion.clone();
    const dirW = new THREE.Vector3(targetPoint.x - p0.x, 0, targetPoint.z - p0.z);
    if (dirW.lengthSq() < 1e-6) dirW.set(1, 0, 0);
    dirW.normalize();
    const axis = new THREE.Vector3(dirW.z, 0, -dirW.x);
    const dirLocal = dirW.clone().applyQuaternion(q0.clone().invert());
    dirLocal.y = 0;
    dirLocal.normalize();
    const offset = source.userData.inner?.position ?? new THREE.Vector3();
    const lipLocal = offset.clone().addScaledVector(dirLocal, mouth.r).add(new THREE.Vector3(0, mouth.y, 0));
    const lipRest = lipLocal.clone().applyQuaternion(q0).add(p0);
    const pre = targetPoint.clone().add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(dirW, -0.35);
    const q = new THREE.Quaternion();
    return {
      dirW,
      lipRest,
      pre,
      setPose(lip, theta) {
        q.setFromAxisAngle(axis, theta).multiply(q0);
        source.quaternion.copy(q);
        source.position.copy(lip).sub(lipLocal.clone().applyQuaternion(q));
      },
      lipWorld() {
        return lipLocal.clone().applyQuaternion(source.quaternion).add(source.position);
      },
      restore() {
        source.position.copy(p0);
        source.quaternion.copy(q0);
      },
    };
  }

  // Lịch trình chung: đưa tới, nghiêng, rót, dựng lại, trả về chỗ cũ
  function scheduleTransfer({ source, mouth, targetPoint, tiltStart, tiltEnd, holdTime, onHold, onFrame, onEnd }) {
    const h = makeHandler({ source, mouth, targetPoint });
    const T = { move: 0.9, tilt: 0.65, hold: holdTime, untilt: 0.55, back: 0.85 };
    const t1 = T.move;
    const t2 = t1 + T.tilt;
    const t3 = t2 + T.hold;
    const t4 = t3 + T.untilt;
    const t5 = t4 + T.back;
    const cap = source.getObjectByName('cap');
    let e = 0;
    busy++;
    add((dt) => {
      e += dt;
      const lip = new THREE.Vector3();
      let theta = 0;
      if (e < t1) {
        const k = smooth(e / T.move);
        lip.lerpVectors(h.lipRest, h.pre, k).addScaledVector(UP, Math.sin(k * Math.PI) * 0.35);
        if (cap && k > 0.4) cap.visible = false; // mở nắp trên đường đi
      } else if (e < t2) {
        const k = smooth((e - t1) / T.tilt);
        lip.lerpVectors(h.pre, targetPoint, k);
        theta = tiltStart * k;
      } else if (e < t3) {
        lip.copy(targetPoint);
        theta = lerp(tiltStart, tiltEnd, (e - t2) / T.hold);
      } else if (e < t4) {
        const k = smooth((e - t3) / T.untilt);
        lip.lerpVectors(targetPoint, h.pre, k);
        theta = tiltEnd * (1 - k);
      } else if (e < t5) {
        const k = smooth((e - t4) / T.back);
        lip.lerpVectors(h.pre, h.lipRest, k).addScaledVector(UP, Math.sin(k * Math.PI) * 0.35);
        if (cap && k > 0.6) cap.visible = true;
      }
      if (e < t5) h.setPose(lip, theta);
      onFrame?.({ e, dt, t2, t3, lip: h.lipWorld(), dirW: h.dirW, holding: e >= t2 && e < t3, holdK: (e - t2) / T.hold });
      if (e >= t5) {
        h.restore();
        if (cap) cap.visible = true;
        busy--;
        onEnd?.();
        return true;
      }
      return false;
    });
    return { t2, t3, t5, dirW: h.dirW };
  }

  // ------------------------------------------------------------
  // Rót chất lỏng
  // ------------------------------------------------------------
  function pour({
    source, mouth, targetPoint, streamEnd, color, volume, fracFrom = 1, fracTo = 0,
    funnel = null, onFill, onSourceDrain, onDone,
  }) {
    const hold = clamp(0.9 + volume / 35, 1.2, 4.5);
    const tiltOf = (f) => THREE.MathUtils.degToRad(clamp(48 + 55 * (1 - f), 40, 112));
    const stream = createStream(color, 0.03);
    const stream2 = funnel ? createStream(color, 0.018) : null;
    const fall = 0.25;
    const delay = funnel ? 0.6 : 0;
    let lastRipple = 0;
    let lastRipple2 = 0;
    const drainMesh = source.getObjectByName('stock-liquid');
    const drainBase = drainMesh ? drainMesh.scale.y : 1;
    let plan = null;
    plan = scheduleTransfer({
      source, mouth, targetPoint, holdTime: hold,
      tiltStart: tiltOf(fracFrom), tiltEnd: tiltOf(fracTo),
      onFrame: ({ e, dt, t2, t3, lip }) => {
        // Dòng chính: từ môi rót xuống bề mặt chất lỏng (hoặc miệng phễu)
        const end = streamEnd();
        const head = clamp((e - t2) / fall, 0, 1);
        const tail = clamp((e - t3) / fall, 0, 1);
        stream.draw(lip, end, tail, head, dt);
        if (head >= 1 && tail <= 0 && e - lastRipple > 0.18) {
          lastRipple = e;
          ripple(end, color, funnel ? 0.15 : 0.28);
        }
        // Dòng phụ: từ cuống phễu xuống bình hứng
        if (stream2) {
          const end2 = funnel.end();
          const h2 = clamp((e - t2 - delay) / fall, 0, 1);
          const t2b = clamp((e - t3 - delay) / fall, 0, 1);
          stream2.draw(funnel.tip, end2, t2b, h2, dt);
          if (h2 >= 1 && t2b <= 0 && e - lastRipple2 > 0.22) {
            lastRipple2 = e;
            ripple(end2, color, 0.18);
          }
        }
        // Chai nguồn cạn dần trong lúc rót
        if (drainMesh) {
          const k = clamp((e - t2) / (t3 - t2), 0, 1);
          const f = fracFrom > 0 ? lerp(1, fracTo / fracFrom, k) : 1;
          drainMesh.scale.y = drainBase * Math.max(0.02, f);
        }
        onSourceDrain?.(clamp((e - t2) / (t3 - t2), 0, 1));
        // Chất trong bình nhận xuất hiện dần sau khi dòng chảy chạm tới
        const fillStart = t2 + fall + delay;
        const fillEnd = t3 + fall + delay + 0.35;
        onFill?.(clamp((e - fillStart) / (fillEnd - fillStart), 0, 1));
      },
      onEnd: () => {
        stream.dispose();
        stream2?.dispose();
        onFill?.(1);
        onDone?.();
      },
    });
    return plan;
  }

  // ------------------------------------------------------------
  // Thả chất rắn: từng hạt rơi, chậm lại trong chất lỏng, lắng ở đáy
  // ------------------------------------------------------------
  function dropSolid({ source, mouth, targetPoint, landing, color, metal = false, count = 16, grain = 0.06, tilt = 70, onDone }) {
    const n = clamp(Math.round(count), 6, 40);
    const hold = clamp(0.8 + n * 0.07, 1.2, 3.2);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: metal ? 0.35 : 0.7, metalness: metal ? 0.8 : 0.05, flatShading: true });
    const grains = [];
    const piece = source.getObjectByName('solid-piece');
    const pieceScale = piece ? piece.scale.clone() : null;
    let spawned = 0;
    scheduleTransfer({
      source, mouth, targetPoint, holdTime: hold,
      tiltStart: THREE.MathUtils.degToRad(tilt * 0.75), tiltEnd: THREE.MathUtils.degToRad(tilt),
      onFrame: ({ dt, holding, holdK, lip, dirW }) => {
        if (holding) {
          const want = Math.floor(clamp(holdK / 0.85, 0, 1) * n);
          while (spawned < want) {
            const m = addMesh(GRAIN, mat);
            m.scale.setScalar(grain * rand(0.7, 1.3));
            m.position.copy(lip);
            m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
            grains.push({ m, v: dirW.clone().multiplyScalar(rand(0.3, 0.6)).add(new THREE.Vector3(rand(-0.1, 0.1), 0.1, rand(-0.1, 0.1))), landed: false, spin: rand(2, 6) });
            spawned++;
          }
          if (piece) piece.scale.copy(pieceScale).multiplyScalar(1 - 0.6 * (spawned / n));
        }
        const L = landing();
        grains.forEach((g) => {
          if (g.landed) return;
          const inLiquid = L.surfaceY > L.bottomY + 0.02 && g.m.position.y < L.surfaceY;
          g.v.y -= (inLiquid ? 2 : GRAVITY) * dt;
          if (inLiquid) g.v.multiplyScalar(Math.max(0, 1 - 4 * dt)); // lực cản của chất lỏng
          g.m.position.addScaledVector(g.v, dt);
          g.m.rotation.x += g.spin * dt;
          // giữ hạt trong lòng bình khi đã rơi xuống dưới miệng
          if (g.m.position.y < L.mouthY) {
            const dx = g.m.position.x - L.center.x;
            const dz = g.m.position.z - L.center.z;
            const d = Math.hypot(dx, dz);
            const maxR = L.radius * 0.85;
            if (d > maxR) {
              g.m.position.x = L.center.x + (dx / d) * maxR;
              g.m.position.z = L.center.z + (dz / d) * maxR;
              g.v.x *= -0.3;
              g.v.z *= -0.3;
            }
          }
          const floor = L.bottomY + g.m.scale.x * 0.6;
          if (g.m.position.y <= floor) {
            g.m.position.y = floor;
            if (Math.abs(g.v.y) > 0.8 && !inLiquid) {
              g.v.y *= -0.25; // nảy nhẹ
              g.v.x *= 0.5;
              g.v.z *= 0.5;
            } else {
              g.landed = true;
            }
          }
        });
      },
      onEnd: () => {
        onDone?.();
        // hạt mờ dần, nhường chỗ cho lớp chất rắn cố định dưới đáy
        let t = 0;
        mat.transparent = true;
        add((dt) => {
          t += dt;
          mat.opacity = 1 - t / 0.5;
          if (t >= 0.5) {
            grains.forEach((g) => scene.remove(g.m));
            mat.dispose();
            return true;
          }
          return false;
        });
      },
    });
  }

  // ------------------------------------------------------------
  // Nhỏ giọt (buret) hoặc chảy thành dòng nhỏ (phễu chiết) từ đầu khóa
  // ------------------------------------------------------------
  function drip({ tip, receiverEnd, color, volume, stopcock = null, mode = 'drops', onFill, onDone }) {
    const T = clamp(1.2 + volume / (mode === 'drops' ? 6 : 25), 1.5, 7);
    const rate = clamp((volume * 1.5) / T, 4, 16);
    const stream = mode === 'stream' ? createStream(color, 0.016) : null;
    const drops = [];
    const handle0 = stopcock ? stopcock.rotation.y : 0;
    let e = 0;
    let acc = 0;
    let lastRipple = 0;
    busy++;
    add((dt) => {
      e += dt;
      const open = e > 0.3 && e < T + 0.3;
      if (stopcock) stopcock.rotation.y = handle0 + (Math.PI / 2) * smooth(Math.min(e, T + 0.6 - e) / 0.3);
      const end = receiverEnd();
      if (mode === 'drops' && open) {
        acc += dt * rate;
        while (acc >= 1) {
          acc -= 1;
          const d = addMesh(SPHERE, liquidMaterial(color, 0.85));
          d.scale.set(0.03, 0.04, 0.03);
          d.position.copy(tip);
          drops.push({ d, v: 0, age: 0 });
        }
      }
      for (let i = drops.length - 1; i >= 0; i--) {
        const o = drops[i];
        o.v += GRAVITY * dt;
        o.age += dt;
        o.d.position.y -= o.v * dt;
        // giới hạn thời gian sống để giọt không rơi mãi nếu tọa độ đích lỗi
        if (!(o.d.position.y > end.y) || o.age > 3) {
          if (Number.isFinite(end.y)) ripple(end, color, 0.14);
          removeMesh(o.d);
          drops.splice(i, 1);
        }
      }
      if (stream) {
        const head = clamp((e - 0.3) / 0.2, 0, 1);
        const tail = clamp((e - T - 0.3) / 0.2, 0, 1);
        stream.draw(tip, end, tail, head, dt);
        if (head >= 1 && tail <= 0 && e - lastRipple > 0.2) {
          lastRipple = e;
          ripple(end, color, 0.16);
        }
      }
      onFill?.(clamp((e - 0.5) / T, 0, 1));
      if (e >= T + 0.9 && drops.length === 0) {
        if (stopcock) stopcock.rotation.y = handle0;
        stream?.dispose();
        busy--;
        onFill?.(1);
        onDone?.();
        return true;
      }
      return false;
    });
  }

  // ------------------------------------------------------------
  // Sủi bọt khí (ví dụ CO₂) trong chất lỏng
  // ------------------------------------------------------------
  function bubbles({ geom, duration = 6, rate = 30, size = 0.035 }) {
    const list = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.55, roughness: 0.1, depthWrite: false });
    let e = 0;
    let acc = 0;
    add((dt) => {
      e += dt;
      const G = geom();
      if (!G) {
        list.forEach((b) => scene.remove(b.m));
        mat.dispose();
        return true;
      }
      const k = Math.max(0, 1 - e / duration);
      if (G.surfaceY - G.bottomY > 0.05) {
        acc += dt * rate * k;
        while (acc >= 1) {
          acc -= 1;
          const m = addMesh(SPHERE, mat);
          m.scale.setScalar(size * rand(0.5, 1.2));
          const a = rand(0, Math.PI * 2);
          const r = rand(0, G.radius * 0.7);
          m.position.set(G.center.x + Math.cos(a) * r, G.bottomY + 0.03, G.center.z + Math.sin(a) * r);
          list.push({ m, v: rand(0.35, 0.6), ph: rand(0, 6) });
        }
      }
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        b.v += 0.6 * dt; // bọt nhanh dần khi nổi lên
        b.m.position.y += b.v * dt;
        b.m.position.x += Math.sin(e * 9 + b.ph) * 0.002;
        b.m.scale.multiplyScalar(1 + 0.15 * dt);
        if (b.m.position.y >= G.surfaceY - 0.01) {
          scene.remove(b.m);
          list.splice(i, 1);
        }
      }
      if (e >= duration && list.length === 0) {
        mat.dispose();
        return true;
      }
      return false;
    });
  }

  // ------------------------------------------------------------
  // Kết tủa: hạt li ti xuất hiện trong dung dịch rồi lắng dần xuống đáy
  // ------------------------------------------------------------
  function precipitate({ geom, color, duration = 5, count = 70, onSettle }) {
    const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0, roughness: 0.9, depthWrite: false });
    const parts = [];
    let e = 0;
    let settled = false;
    add((dt) => {
      e += dt;
      const G = geom();
      if (!G) {
        parts.forEach((p) => scene.remove(p.m));
        mat.dispose();
        return true;
      }
      while (parts.length < count * clamp(e / 1.5, 0, 1)) {
        const m = addMesh(GRAIN, mat);
        m.scale.setScalar(rand(0.018, 0.035));
        const a = rand(0, Math.PI * 2);
        const r = Math.sqrt(Math.random()) * G.radius * 0.8;
        m.position.set(G.center.x + Math.cos(a) * r, rand(G.bottomY + 0.04, Math.max(G.bottomY + 0.05, G.surfaceY - 0.03)), G.center.z + Math.sin(a) * r);
        parts.push({ m, v: rand(0.06, 0.16) });
      }
      mat.opacity = e < duration - 1 ? Math.min(0.85, e / 1.2) : 0.85 * Math.max(0, duration - e);
      parts.forEach((p) => {
        p.m.position.y = Math.max(G.bottomY + 0.03, p.m.position.y - p.v * dt);
      });
      if (!settled && e >= duration - 1) {
        settled = true;
        onSettle?.();
      }
      if (e >= duration) {
        parts.forEach((p) => scene.remove(p.m));
        mat.dispose();
        return true;
      }
      return false;
    });
  }

  // ------------------------------------------------------------
  // Khuấy: đũa thủy tinh xoay tròn trong bình, tạo xoáy nhẹ
  // ------------------------------------------------------------
  function stir({ tool, geom, duration = 3, onDone }) {
    const r0 = tool.rotation.y;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    const swirl = Array.from({ length: 10 }, (_, i) => {
      const m = addMesh(SPHERE, mat);
      m.scale.setScalar(0.015);
      return { m, a: (i / 10) * Math.PI * 2, r: rand(0.3, 0.75) };
    });
    let e = 0;
    let angle = 0;
    busy++;
    add((dt) => {
      e += dt;
      const speed = Math.PI * 2.4 * smooth(Math.min(e, duration - e) / 0.5);
      angle += speed * dt;
      tool.rotation.y = r0 + angle;
      const G = geom();
      swirl.forEach((s) => {
        s.a += speed * 0.8 * dt;
        if (G) s.m.position.set(G.center.x + Math.cos(s.a) * G.radius * s.r, G.surfaceY - 0.02, G.center.z + Math.sin(s.a) * G.radius * s.r);
        s.m.visible = Boolean(G) && G.surfaceY - G.bottomY > 0.05;
      });
      if (e >= duration) {
        tool.rotation.y = r0;
        swirl.forEach((s) => scene.remove(s.m));
        mat.dispose();
        busy--;
        onDone?.();
        return true;
      }
      return false;
    });
  }

  // ------------------------------------------------------------
  // Sôi: bọt hơi từ đáy và hơi nước bốc lên (chạy liên tục khi bật)
  // ------------------------------------------------------------
  function setBoiling(key, geom, intensity) {
    if (!geom || intensity <= 0) boiling.delete(key);
    else boiling.set(key, { geom, intensity, acc: 0, accSteam: 0 });
  }

  const steamMat = () =>
    new THREE.SpriteMaterial({ map: getSteamTexture(), transparent: true, opacity: 0.35, depthWrite: false });
  const boilParts = [];
  function updateBoiling(dt) {
    boiling.forEach((b) => {
      const G = b.geom();
      if (!G) return;
      if (G.surfaceY - G.bottomY > 0.04) {
        b.acc += dt * 26 * b.intensity;
        while (b.acc >= 1) {
          b.acc -= 1;
          const m = addMesh(SPHERE, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
          m.scale.setScalar(rand(0.02, 0.045));
          const a = rand(0, Math.PI * 2);
          const r = rand(0, G.radius * 0.6);
          m.position.set(G.center.x + Math.cos(a) * r, G.bottomY + 0.03, G.center.z + Math.sin(a) * r);
          boilParts.push({ m, kind: 'bubble', v: rand(0.5, 0.9), top: () => b.geom()?.surfaceY ?? 0 });
        }
      }
      if (b.intensity >= 1 && G.surfaceY - G.bottomY > 0.04) {
        b.accSteam += dt * 4;
        while (b.accSteam >= 1) {
          b.accSteam -= 1;
          const s = new THREE.Sprite(steamMat());
          s.position.set(G.center.x + rand(-0.15, 0.15), G.mouthY + 0.05, G.center.z + rand(-0.15, 0.15));
          s.scale.setScalar(0.3);
          s.renderOrder = 7;
          scene.add(s);
          boilParts.push({ m: s, kind: 'steam', life: 0, drift: new THREE.Vector3(rand(-0.1, 0.1), 0, rand(-0.1, 0.1)) });
        }
      }
    });
    for (let i = boilParts.length - 1; i >= 0; i--) {
      const p = boilParts[i];
      if (p.kind === 'bubble') {
        p.m.position.y += p.v * dt;
        if (p.m.position.y >= p.top() - 0.01) {
          removeMesh(p.m);
          boilParts.splice(i, 1);
        }
      } else {
        p.life += dt;
        p.m.position.y += 0.55 * dt;
        p.m.position.addScaledVector(p.drift, dt);
        p.m.scale.setScalar(0.3 + p.life * 0.45);
        p.m.material.opacity = 0.35 * Math.max(0, 1 - p.life / 2.2);
        if (p.life >= 2.2) {
          scene.remove(p.m);
          p.m.material.dispose();
          boilParts.splice(i, 1);
        }
      }
    }
  }

  // Hoạt cảnh tùy biến từ module khác: fn(dt) trả về true khi xong.
  // blocking: trong lúc chạy, các thao tác rót/khuấy khác phải đợi.
  function task(fn, { blocking = false } = {}) {
    if (blocking) busy++;
    add((dt) => {
      const done = fn(dt);
      if (done && blocking) busy--;
      return done;
    });
  }

  return {
    task,
    update(dt) {
      const step = Math.min(dt, 0.05); // khung hình chậm vẫn mượt, không nhảy cóc
      for (const fn of [...tasks]) if (fn(step)) tasks.delete(fn);
      updateBoiling(step);
    },
    isBusy: () => busy > 0,
    pour,
    dropSolid,
    drip,
    bubbles,
    precipitate,
    stir,
    setBoiling,
    ripple,
  };
}
