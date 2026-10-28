// ============================================================
// ChemLab 3D — Ước tính pH dung dịch cho máy đo pH
// Giải phương trình trung hòa điện tích với các hằng số axit – bazơ chuẩn (25 °C):
//   HSO₄⁻  Ka = 1,0 × 10⁻²  (pKa 1,99)
//   CH₃COOH Ka = 1,75 × 10⁻⁵ (pKa 4,76)
//   NH₄⁺   Ka = 5,6 × 10⁻¹⁰ (pKa 9,25)
//   H₂CO₃  Ka1 = 4,45 × 10⁻⁷, Ka2 = 4,69 × 10⁻¹¹ (pKa 6,35; 10,33)
//   Kw = 1,0 × 10⁻¹⁴
// Giới hạn: dùng nồng độ thay cho hoạt độ; bỏ qua thủy phân của ion kim loại (Cu²⁺, Fe³⁺…)
// và các phản ứng tạo kết tủa — khi gặp các trường hợp đó, kết quả được đánh dấu "gần đúng"
// hoặc không đưa ra con số.
// ============================================================

const KW = 1e-14;
const KA_HSO4 = 1.0e-2;
const KA_ACETIC = 1.75e-5;
const KA_NH4 = 5.6e-10;
const KA1_CO3 = 4.45e-7;
const KA2_CO3 = 4.69e-11;

// Mỗi dung dịch gốc góp gì vào cân bằng (theo mol chất tan trong 1 mol)
const CONTRIB = {
  hcl: { strongAcid: 1 },
  hno3: { strongAcid: 1 },
  h2so4: { sulfate: 1, strongAcid: 1 }, // nấc 1 phân li hoàn toàn, nấc 2 theo Ka(HSO₄⁻)
  naoh: { strongBase: 1 },
  ch3cooh: { acetic: 1 },
  nh3: { ammonia: 1 },
  na2co3: { carbonate: 1, strongBase: 2 }, // 2 Na⁺ đi kèm CO₃²⁻ (tính như cation trung hòa điện tích)
  hcl_dil: { strongAcid: 1 },
  h2so4_dil: { sulfate: 1, strongAcid: 1 },
};
// Muối trung tính, nước, dung môi: không đổi pH (trong phạm vi mô hình)
const NEUTRAL = new Set(['water', 'ethanol', 'agno3', 'bacl2', 'kmno4', 'h2o2', 'phenolphthalein', 'glucose']);
// Muối có ion kim loại thủy phân làm pH giảm (không tính được chính xác ở đây)
const HYDROLYZING = { cuso4: 'Cu²⁺', fecl3: 'Fe³⁺' };

/**
 * records: [{ chemicalId, volumeMl, phase }], volumeMl tổng: thể tích dung dịch (mL)
 * specs: STOCK_SPECS (nồng độ mol của dung dịch gốc)
 * Trả về { ok, pH?, note, approx }
 */
export function estimatePH(records, totalMl, specs, { reacted = false } = {}) {
  if (!(totalMl > 0)) return { ok: false, note: 'Bình chưa có dung dịch để đo.' };
  const V = totalMl / 1000;
  let Ca = 0; // H⁺ từ axit mạnh (mol/L)
  let Cb = 0; // cation từ bazơ mạnh (mol/L)
  let Cs = 0; // tổng sunfat
  let Cac = 0; // tổng axetic
  let Cam = 0; // tổng amoniac
  let Cco = 0; // tổng cacbonat
  const notes = [];
  let approx = false;
  for (const r of records) {
    const id = r.chemicalId;
    if (r.phase === 'solid' || String(id).startsWith('el:')) {
      return { ok: false, note: 'Bình có mẫu nguyên tố hoặc chất rắn; mô hình chưa tính được pH trong trường hợp này.' };
    }
    if (NEUTRAL.has(id)) continue;
    if (HYDROLYZING[id]) {
      approx = true;
      notes.push(`bỏ qua thủy phân của ion ${HYDROLYZING[id]} (pH thực tế thấp hơn giá trị hiển thị)`);
      continue;
    }
    const c = CONTRIB[id];
    const M = specs[id]?.molarity;
    if (!c || (!M && r.moles == null)) {
      return { ok: false, note: `Chưa có dữ liệu axit – bazơ cho ${id}, không ước tính được pH.` };
    }
    const n = r.moles != null ? r.moles : (M * (r.volumeMl || 0)) / 1000; // bản ghi đã pha loãng có sẵn số mol
    const conc = n / V;
    Ca += (c.strongAcid || 0) * conc;
    Cb += (c.strongBase || 0) * conc;
    Cs += (c.sulfate || 0) * conc;
    Cac += (c.acetic || 0) * conc;
    Cam += (c.ammonia || 0) * conc;
    Cco += (c.carbonate || 0) * conc;
  }
  const hydro = records.map((r) => HYDROLYZING[r.chemicalId]).filter(Boolean);
  if (hydro.length && Ca + Cb + Cs + Cac + Cam + Cco === 0) {
    return {
      ok: false,
      note: `Dung dịch chỉ có muối của ion ${[...new Set(hydro)].join(', ')}; ion này thủy phân làm pH nhỏ hơn 7 nhưng mô hình chưa có hằng số thủy phân nên không ước tính con số.`,
    };
  }
  if (reacted) {
    approx = true;
    notes.push('bình đã xảy ra phản ứng tạo chất mới, kết quả chỉ mang tính gần đúng');
  }
  // f(h) = điện tích dương − điện tích âm, tăng đơn điệu theo h
  const f = (h) => {
    const pos = h + Cb + Cam * (h / (h + KA_NH4));
    const neg =
      Ca + // Cl⁻, NO₃⁻ và nấc 1 của H₂SO₄
      Cs * (KA_HSO4 / (h + KA_HSO4)) + // phần SO₄²⁻ thêm một điện tích
      Cac * (KA_ACETIC / (h + KA_ACETIC)) +
      Cco * ((KA1_CO3 * h + 2 * KA1_CO3 * KA2_CO3) / (h * h + KA1_CO3 * h + KA1_CO3 * KA2_CO3)) +
      KW / h;
    return pos - neg;
  };
  // chia đôi theo log[H⁺] trong khoảng pH −2 … 16
  let lo = -16;
  let hi = 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(10 ** mid) > 0) hi = mid;
    else lo = mid;
  }
  const pH = -(lo + hi) / 2;
  if (pH < 0 || pH > 14) notes.push('dung dịch rất đặc, pH ngoài thang 0 – 14 chỉ mang tính tham khảo');
  return {
    ok: true,
    pH: Math.round(pH * 100) / 100,
    approx: approx || pH < 0 || pH > 14,
    note: ['Tính theo nồng độ (bỏ qua hệ số hoạt độ), 25 °C', ...notes].join('; ') + '.',
  };
}
