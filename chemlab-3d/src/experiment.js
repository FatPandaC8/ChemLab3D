// ========================================
// ChemLab 3D — Experiment Logic
// Giai đoạn 3.1: Nhận diện thao tác
// ========================================

const CHEMICALS = {
  methane: {
    kind: 'gas',
    state: 'gas',
    flammable: true,
  },
  ethanol: {
    kind: 'chemical',
    state: 'liquid',
    flammable: true,
  },
  benzene: {
    kind: 'chemical',
    state: 'liquid',
    flammable: true,
  },
  nacl: {
    kind: 'chemical',
    state: 'solid',
  },
    na2co3: {
    kind: 'chemical',
    state: 'liquid', // nay dùng dạng dung dịch trong mục Liquid
  },
    caco3: {
    kind: 'chemical',
    state: 'solid',
  },
  cacl2: {
    kind: 'chemical',
    state: 'liquid',
  },
  cuoh2: {
    kind: 'chemical',
    state: 'solid',
  },
  na2so4: {
    kind: 'chemical',
    state: 'liquid',
  },
  copper: {
    kind: 'chemical',
    state: 'solid',
  },
  sulfur: {
    kind: 'chemical',
    state: 'solid',
    flammable: true,
  },
  water: {
    kind: 'chemical',
    state: 'liquid',
  },
  hcl: {
    kind: 'chemical',
    state: 'liquid',
    corrosive: true,
  },
    naoh: {
    kind: 'chemical',
    state: 'liquid',
    corrosive: true,
  },
  cuso4: {
    kind: 'chemical',
    state: 'liquid',
    hazardous: true,
  },
  o2: {
    kind: 'gas',
    state: 'gas',
    oxidizer: true,
  },
  h2: {
    kind: 'gas',
    state: 'gas',
    flammable: true,
  },
  co2: {
    kind: 'gas',
    state: 'gas',
  },
  // Dung dịch bổ sung trong mục Liquid
  hno3: { kind: 'chemical', state: 'liquid', corrosive: true, oxidizer: true },
  h2so4: { kind: 'chemical', state: 'liquid', corrosive: true },
  ch3cooh: { kind: 'chemical', state: 'liquid' },
  nh3: { kind: 'chemical', state: 'liquid', corrosive: true },
  agno3: { kind: 'chemical', state: 'liquid', corrosive: true },
  bacl2: { kind: 'chemical', state: 'liquid', hazardous: true },
  kmno4: { kind: 'chemical', state: 'liquid', oxidizer: true },
  h2o2: { kind: 'chemical', state: 'liquid', oxidizer: true },
  fecl3: { kind: 'chemical', state: 'liquid', corrosive: true },
  phenolphthalein: { kind: 'chemical', state: 'liquid', flammable: true },
  // Hóa chất cho 5 thí nghiệm (lab-reactions.js)
  hcl_dil: { kind: 'chemical', state: 'liquid', corrosive: true },
  h2so4_dil: { kind: 'chemical', state: 'liquid', corrosive: true },
  brwater: { kind: 'chemical', state: 'liquid', hazardous: true },
  glucose: { kind: 'chemical', state: 'liquid' },
  so2: { kind: 'gas', state: 'gas', hazardous: true },
  litmus: { kind: 'chemical', state: 'solid', tool: true }, // giấy quỳ: dùng như "nguồn" để nhúng vào bình
};

// Dung dịch loãng dùng chung phản ứng với dạng đặc
const ALIAS = { hcl_dil: 'hcl', h2so4_dil: 'h2so4' };

const REACTIONS = {
  'hcl+naoh': {
    reactants: ['hcl', 'naoh'],
    products: ['nacl', 'water'],
    equation: 'HCl + NaOH → NaCl + H₂O',
    message:
      'Đã phát hiện phản ứng trung hòa: HCl + NaOH → NaCl + H₂O.',
  },

  // CaCO₃ + HCl: phản ứng diễn ra dần theo thời gian (lab-reactions.js), không đổi tức thì ở đây

  'bacl2+h2so4': {
    reactants: ['bacl2', 'h2so4'],
    products: ['baso4', 'hcl_dil'],
    productsText: 'BaSO₄↓ (kết tủa trắng) + HCl',
    equation: 'BaCl₂ + H₂SO₄ → BaSO₄↓ + 2HCl',
    message: 'Phản ứng tạo kết tủa trắng BaSO₄.',
  },

  'hcl+na2co3': {
    reactants: ['hcl', 'na2co3'],
    products: ['nacl', 'water', 'co2'],
    equation: 'Na₂CO₃ + 2HCl → 2NaCl + H₂O + CO₂↑',
    message:
      'Phản ứng tạo khí CO₂: xuất hiện bọt khí trong dung dịch.',
  },

  'naoh+cuso4': {
    reactants: ['naoh', 'cuso4'],
    products: ['cuoh2', 'na2so4'],
    equation: 'CuSO₄ + 2NaOH → Cu(OH)₂↓ + Na₂SO₄',
    message:
      'Phản ứng tạo kết tủa Cu(OH)₂ màu xanh lam.',
  },
};

function findReaction(chemicalIds) {
  const ids = chemicalIds.map((id) => ALIAS[id] ?? id);
  return Object.values(REACTIONS).find((reaction) =>
    reaction.reactants.every((reactantId) =>
      ids.includes(reactantId)
    )
  ) ?? null;
}

const VESSELS = new Set([
  'beaker',
  'erlenmeyer',
  'roundflask',
  // Bình và dụng cụ chứa bổ sung
  'testtube',
  'graduated-cylinder',
  'volumetric-flask',
  'distilling-flask',
  'filter-flask',
  'crucible',
  'evaporating-dish',
  // Dụng cụ có khóa xả
  'burette',
  'separatory-funnel',
]);

export function getSampleInfo(sampleId) {
  // Mẫu nguyên tố lấy từ bảng tuần hoàn có mã dạng "el:na"
  if (typeof sampleId === 'string' && sampleId.startsWith('el:')) {
    return {
      id: sampleId,
      kind: 'element',
      elementId: sampleId.slice(3),
    };
  }

  if (CHEMICALS[sampleId]) {
    return {
      id: sampleId,
      ...CHEMICALS[sampleId],
    };
  }

  if (VESSELS.has(sampleId)) {
    return {
      id: sampleId,
      kind: 'vessel',
      state: 'empty',
    };
  }

  if (sampleId === 'rack') {
    return {
      id: sampleId,
      kind: 'rack',
    };
  }

  if (['bunsen', 'stand', 'balance'].includes(sampleId)) {
    return {
      id: sampleId,
      kind: 'equipment',
    };
  }

  return {
    id: sampleId,
    kind: 'unknown',
  };
}

export function createExperimentState() {
  return {
    selectedSampleId: null,
    log: [],
    mixtures: {},
    liquidLevels: {},
    reactedVessels: {},
    liquidVolumes: {},
    pourRecords: {},
    samples: {}, // mẫu nguyên tố trên bàn, theo instanceId
    temperatures: {}, // nhiệt độ từng bình (°C)
    rx: {}, // trạng thái phản ứng theo thời gian, nút đậy... (lab-reactions.js)
    litmus: {}, // màu giấy quỳ đã dùng
  };
}

export function selectSample(state, sampleId) {
  const sample = getSampleInfo(sampleId);

  state.selectedSampleId = sampleId;

  state.log.push({
    type: 'selection',
    message: `Đã chọn ${sampleId}.`,
    time: new Date().toLocaleTimeString(),
  });

  return sample;
}




export function pourIntoVessel(
  state,
  sourceId,
  targetId,
  targetInstanceId = targetId,
  volumeMl = 10,
) {
  state.lastReaction = null;
  const source = getSampleInfo(sourceId);
  const target = getSampleInfo(targetId);

  if (!CHEMICALS[sourceId]) {
    return recordResult(
      state,
      false,
      'Mẫu được chọn chưa được khai báo là hóa chất có thể chuyển.',
    );
  }

  if (target.kind !== 'vessel') {
    return recordResult(
      state,
      false,
      'Đích nhận phải là cốc hoặc bình thí nghiệm phù hợp.',
    );
  }

  if (source.state === 'gas') {
    return recordResult(
      state,
      false,
      'Chưa hỗ trợ chuyển khí. Cần xây dựng cơ chế dẫn khí riêng.',
    );
  }

  const vesselId = String(targetInstanceId);

if (!Number.isFinite(volumeMl) || volumeMl <= 0) {
  return recordResult(
    state,
    false,
    'Thể tích phải là số lớn hơn 0 mL.',
  );
}

if (!state.liquidVolumes) {
  state.liquidVolumes = {};
}

state.liquidVolumes[vesselId] =
  (state.liquidVolumes[vesselId] ?? 0) + volumeMl;
  if (!state.pourRecords) {
  state.pourRecords = {};
}

if (!state.pourRecords[vesselId]) {
  state.pourRecords[vesselId] = [];
}

state.pourRecords[vesselId].push({
  chemicalId: sourceId,
  volumeMl: volumeMl,
});

  if (!state.mixtures[vesselId]) {
    state.mixtures[vesselId] = [];
  }

  if (!state.reactedVessels) {
    state.reactedVessels = {};
  }

  state.mixtures[vesselId].push(sourceId);
  if (!state.liquidLevels) {
  state.liquidLevels = {};
}

if (!state.liquidLevels) {
  state.liquidLevels = {};
}

state.liquidLevels[vesselId] = Math.min(
  (state.liquidVolumes[vesselId] / 50) * 0.8,
  0.8,
);

  const chemicals = state.mixtures[vesselId];
  const reaction = findReaction(chemicals);

  console.log('[ChemLab] Đã lưu hóa chất:', {
    sourceId,
    vesselId,
    mixtures: state.mixtures,
  });
  if (reaction && !state.reactedVessels[vesselId]) {
    state.reactedVessels[vesselId] = true;
    state.mixtures[vesselId] = [...reaction.products];
    state.lastReaction = {
        vesselId,
        products: [...reaction.products],
        hasGas: reaction.products.includes('co2'),
    };

    return recordResult(
      state,
      true,
      `Đã phát hiện phản ứng: ${reaction.equation}. Sản phẩm mô phỏng: ${reaction.productsText ?? reaction.products.join(' + ')}. Đã rót ${sourceId}: ${fmtNum(volumeMl)} mL. Tổng thể tích: ${fmtNum(state.liquidVolumes[vesselId])} mL.`,
    );
  }

  return recordResult(
    state,
    true,
    `Đã rót ${sourceId}: ${fmtNum(volumeMl)} mL vào ${targetId} (mã cốc: ${vesselId}). Tổng thể tích đã rót: ${fmtNum(state.liquidVolumes[vesselId])} mL.${mixtureNotes(state, vesselId)}`,
  );
}

// ------------------------------------------------------------
// Mẫu nguyên tố (lấy từ bảng tuần hoàn theo g, mg, mol hoặc mL)
// ------------------------------------------------------------
const AQUEOUS = new Set([
  'water', 'hcl', 'naoh', 'cuso4', 'cacl2', 'na2so4',
  'hno3', 'h2so4', 'ch3cooh', 'nh3', 'agno3', 'bacl2', 'na2co3', 'kmno4', 'h2o2', 'fecl3',
  'hcl_dil', 'h2so4_dil', 'brwater', 'glucose',
]);
const clean = (x) => (x == null ? null : Number(x.toPrecision(12)));
const fmtNum = (n) => String(Number(Number(n).toPrecision(6))).replace('.', ',');

export function registerSample(state, instanceId, record) {
  if (!state.samples) state.samples = {};
  state.samples[String(instanceId)] = record;
}

export function removeSample(state, instanceId) {
  if (state.samples) delete state.samples[String(instanceId)];
}

// Ghi chú cho hỗn hợp: cảnh báo an toàn và báo rõ khi chưa có dữ liệu phản ứng.
// Không tự bịa sản phẩm phản ứng.
function mixtureNotes(state, vesselId) {
  const records = state.pourRecords?.[vesselId] || [];
  const ids = new Set(state.mixtures?.[vesselId] || []);
  const notes = [];
  const hasAqueous = [...ids].some((id) => AQUEOUS.has(id));
  if (hasAqueous && records.some((r) => r.category === 'alkali-metal')) {
    notes.push(
      ' CẢNH BÁO: kim loại kiềm phản ứng mãnh liệt với nước, sinh khí H₂ dễ cháy nổ. ChemLab chưa mô phỏng phản ứng này.'
    );
  }
  if (ids.size >= 2 && [...ids].some((id) => id.startsWith('el:')) && !state.reactedVessels?.[vesselId]) {
    notes.push(' Chưa có dữ liệu phản ứng cho hỗn hợp này trong ChemLab.');
  }
  return notes.join('');
}

// Tách đúng tỉ lệ khối lượng, thể tích, số mol của phần được lấy ra khỏi mẫu
function takeFromSample(sample, value) {
  const f = Math.min(1, value / sample.amount);
  const part = (x) => (x == null ? null : clean(x * f));
  const rest = (x) => (x == null ? null : f >= 1 ? 0 : clean(x * (1 - f)));
  const moved = { massG: part(sample.massG), volumeMl: part(sample.volumeMl), moles: part(sample.moles) };
  sample.massG = rest(sample.massG);
  sample.volumeMl = rest(sample.volumeMl);
  sample.moles = rest(sample.moles);
  if (sample.soluteMassG != null) sample.soluteMassG = rest(sample.soluteMassG);
  sample.amount = f >= 1 ? 0 : clean(sample.amount - value);
  if (sample.amount < 1e-12) sample.amount = 0;
  return moved;
}

// Kiểm tra mẫu/chai còn đủ lượng không (dùng trước khi rót)
export function checkSampleAmount(state, instanceId, amount) {
  const sample = state.samples?.[String(instanceId)];
  if (!sample) return { ok: true, tracked: false }; // vật thể cũ chưa có lượng tồn: không giới hạn
  if (sample.amount <= 0) return { ok: false, tracked: true, error: `${sample.nameVi} đã dùng hết.` };
  if (amount > sample.amount * (1 + 1e-9)) {
    return {
      ok: false,
      tracked: true,
      error: `${sample.nameVi} chỉ còn ${fmtNum(sample.amount)} ${sample.unit}, không đủ ${fmtNum(amount)} ${sample.unit}.`,
    };
  }
  return { ok: true, tracked: true };
}

// Trừ lượng đã rót khỏi chai hóa chất (sau khi rót thành công)
export function consumeSample(state, instanceId, amount) {
  const sample = state.samples?.[String(instanceId)];
  if (!sample || !(amount > 0)) return null;
  return takeFromSample(sample, Math.min(amount, sample.amount));
}

// Chất không rót theo dòng chất lỏng (kết tủa, chất rắn)
const SOLID_IDS = new Set(['cuoh2', 'caco3', 'baso4', 'ag2o', 'ag']);

function liquidIdsOf(state, vesselId) {
  const records = state.pourRecords?.[vesselId] || [];
  return [...new Set(state.mixtures?.[vesselId] || [])].filter(
    (id) => !SOLID_IDS.has(id) && !records.some((r) => r.chemicalId === id && r.phase === 'solid')
  );
}

// Rót chất lỏng từ bình này sang bình khác (chất rắn, kết tủa ở lại bình nguồn)
export function transferLiquid(state, { fromId, toItemId, toId, volumeMl }) {
  state.lastReaction = null;
  const from = String(fromId);
  const to = String(toId);
  const have = state.liquidVolumes?.[from] ?? 0;
  if (getSampleInfo(toItemId).kind !== 'vessel') {
    return recordResult(state, false, 'Đích nhận phải là cốc hoặc bình thí nghiệm phù hợp.');
  }
  if (from === to) return recordResult(state, false, 'Bình nguồn và bình nhận phải khác nhau.');
  if (!(have > 0)) return recordResult(state, false, 'Bình nguồn không có chất lỏng.');
  const v = Number(volumeMl);
  if (!Number.isFinite(v) || v <= 0) return recordResult(state, false, 'Thể tích phải là số lớn hơn 0 mL.');
  if (v > have * (1 + 1e-9)) {
    return recordResult(state, false, `Bình nguồn chỉ còn ${fmtNum(have)} mL, không đủ ${fmtNum(v)} mL.`);
  }

  const f = Math.min(1, v / have);
  const ids = liquidIdsOf(state, from);
  // Trừ ở bình nguồn theo đúng tỉ lệ
  const left = clean(have - v);
  state.liquidVolumes[from] = left < 1e-9 ? 0 : left;
  (state.pourRecords[from] || []).forEach((r) => {
    if (r.phase === 'solid') return;
    if (r.volumeMl > 0) r.volumeMl = clean(r.volumeMl * (1 - f));
    if (r.massG != null) r.massG = clean(r.massG * (1 - f));
    if (r.moles != null) r.moles = clean(r.moles * (1 - f));
  });
  if (state.liquidVolumes[from] === 0) {
    state.mixtures[from] = (state.mixtures[from] || []).filter((id) => !ids.includes(id));
    state.pourRecords[from] = (state.pourRecords[from] || []).filter((r) => r.phase === 'solid');
  }

  // Thêm vào bình nhận; nhiệt độ hòa trộn theo thể tích
  if (!state.mixtures[to]) state.mixtures[to] = [];
  if (!state.pourRecords[to]) state.pourRecords[to] = [];
  if (!state.temperatures) state.temperatures = {};
  const before = state.liquidVolumes[to] ?? 0;
  const tFrom = state.temperatures[from] ?? 25;
  const tTo = state.temperatures[to] ?? 25;
  state.temperatures[to] = clean((tTo * before + tFrom * v) / (before + v));
  const share = v / Math.max(ids.length, 1);
  ids.forEach((id) => {
    state.mixtures[to].push(id);
    state.pourRecords[to].push({ chemicalId: id, volumeMl: clean(share), fromVessel: from });
  });
  state.liquidVolumes[to] = clean(before + v);

  if (!state.reactedVessels) state.reactedVessels = {};
  const reaction = findReaction(state.mixtures[to]);
  if (reaction && !state.reactedVessels[to]) {
    state.reactedVessels[to] = true;
    state.mixtures[to] = [...reaction.products];
    state.lastReaction = {
      vesselId: to,
      products: [...reaction.products],
      hasGas: reaction.products.includes('co2'),
    };
    return recordResult(
      state,
      true,
      `Đã rót ${fmtNum(v)} mL sang ${toItemId}. Đã phát hiện phản ứng: ${reaction.equation}. Sản phẩm mô phỏng: ${reaction.productsText ?? reaction.products.join(' + ')}.`
    );
  }
  return recordResult(
    state,
    true,
    `Đã rót ${fmtNum(v)} mL dung dịch sang ${toItemId}. Tổng thể tích trong bình nhận: ${fmtNum(state.liquidVolumes[to])} mL.${mixtureNotes(state, to)}`
  );
}

// Bay hơi khi sôi: giảm thể tích chất lỏng, giữ nguyên chất rắn
export function evaporate(state, vesselId, ml) {
  const id = String(vesselId);
  const have = state.liquidVolumes?.[id] ?? 0;
  if (!(have > 0) || !(ml > 0)) return have;
  const f = Math.min(1, ml / have);
  const left = clean(have * (1 - f));
  state.liquidVolumes[id] = left < 0.05 ? 0 : left;
  (state.pourRecords?.[id] || []).forEach((r) => {
    if (r.phase !== 'solid' && r.volumeMl > 0) r.volumeMl = clean(r.volumeMl * (1 - f));
  });
  if (state.liquidVolumes[id] === 0) {
    const ids = liquidIdsOf(state, id);
    state.mixtures[id] = (state.mixtures[id] || []).filter((x) => !ids.includes(x));
    state.pourRecords[id] = (state.pourRecords[id] || []).filter((r) => r.phase === 'solid');
  }
  return state.liquidVolumes[id];
}

export function addSampleToVessel(state, { sampleInstanceId, targetId, targetInstanceId, amount }) {
  state.lastReaction = null;
  const sample = state.samples?.[String(sampleInstanceId)];

  if (!sample) {
    return recordResult(state, false, 'Không tìm thấy dữ liệu của mẫu này. Hãy lấy lại mẫu từ bảng tuần hoàn.');
  }
  if (getSampleInfo(targetId).kind !== 'vessel') {
    return recordResult(state, false, 'Đích nhận phải là cốc hoặc bình thí nghiệm phù hợp.');
  }
  if (sample.phase === 'gas') {
    return recordResult(state, false, 'Chưa hỗ trợ chuyển khí. Cần xây dựng cơ chế dẫn khí riêng.');
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return recordResult(state, false, `Lượng cho vào phải lớn hơn 0 ${sample.unit}.`);
  }
  if (sample.amount <= 0) {
    return recordResult(state, false, `Mẫu ${sample.nameVi} đã dùng hết.`);
  }
  if (value > sample.amount * (1 + 1e-9)) {
    return recordResult(
      state,
      false,
      `Mẫu ${sample.nameVi} chỉ còn ${fmtNum(sample.amount)} ${sample.unit}, không đủ ${fmtNum(value)} ${sample.unit}.`
    );
  }

  const moved = takeFromSample(sample, value);

  const vesselId = String(targetInstanceId);
  if (!state.mixtures) state.mixtures = {};
  if (!state.pourRecords) state.pourRecords = {};
  if (!state.liquidVolumes) state.liquidVolumes = {};
  if (!state.mixtures[vesselId]) state.mixtures[vesselId] = [];
  if (!state.pourRecords[vesselId]) state.pourRecords[vesselId] = [];

  state.mixtures[vesselId].push(sample.itemId);
  const isLiquid = sample.phase === 'liquid';
  state.pourRecords[vesselId].push({
    chemicalId: sample.itemId,
    sampleInstanceId: String(sampleInstanceId),
    phase: sample.phase,
    category: sample.category,
    unit: sample.unit,
    amount: clean(value),
    massG: moved.massG,
    moles: moved.moles,
    volumeMl: isLiquid ? moved.volumeMl ?? 0 : 0, // chất rắn không cộng vào thể tích chất lỏng
  });
  if (isLiquid && moved.volumeMl) {
    state.liquidVolumes[vesselId] = clean((state.liquidVolumes[vesselId] ?? 0) + moved.volumeMl);
  }

  return recordResult(
    state,
    true,
    `Đã cho ${fmtNum(value)} ${sample.unit} ${sample.nameVi} (≈ ${fmtNum(moved.massG)} g) vào ${targetId}. Mẫu còn lại: ${fmtNum(sample.amount)} ${sample.unit}.${mixtureNotes(state, vesselId)}`
  );
}



function recordResult(state, success, message) {
  const result = {
    success,
    message,
    time: new Date().toLocaleTimeString(),
  };

  state.log.push({
    type: success ? 'success' : 'warning',
    ...result,
  });

  return result;
}

export function getExperimentLog(state) {
  return [...state.log];
}

const SAVE_KEY = 'chemlab3d-experiment';

export function saveExperimentState(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error('[ChemLab] Không thể lưu thí nghiệm:', error);
    return false;
  }
}

export function loadExperimentState() {
  try {
    const saved = localStorage.getItem(SAVE_KEY);
    if (!saved) return null;

    const state = JSON.parse(saved);

    if (
      !state ||
      typeof state !== 'object' ||
      !Array.isArray(state.log) ||
      typeof state.mixtures !== 'object' ||
      state.mixtures === null
    ) {
      return null;
    }

    return {
      selectedSampleId: state.selectedSampleId ?? null,
      log: state.log,
      mixtures: state.mixtures,
      reactedVessels: state.reactedVessels ?? {},
      liquidVolumes: state.liquidVolumes ?? {},
      pourRecords: state.pourRecords ?? {},
      samples: state.samples ?? {},
      temperatures: state.temperatures ?? {},
      rx: state.rx ?? {}, // trạng thái phản ứng theo thời gian (lab-reactions.js)
      litmus: state.litmus ?? {},
    };
  } catch (error) {
    console.error('[ChemLab] Không thể tải thí nghiệm:', error);
    return null;
  }
}
