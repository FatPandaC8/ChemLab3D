// ============================================================
// ChemLab 3D — Định lượng mẫu nguyên tố (g, mg, mol, mL)
// Không phụ thuộc Three.js hay giao diện, có thể kiểm thử riêng.
//
// Quy tắc:
// - 1 g = 1000 mg; n = m / M (m tính bằng g, M tính bằng g/mol).
// - Chỉ đổi khối lượng <-> thể tích khi có cơ sở:
//   chất rắn/lỏng dùng khối lượng riêng ρ (V = m / ρ),
//   chất khí dùng thể tích mol khí lý tưởng ở 25 °C, 1 bar (24,79 L/mol).
// - Thể tích suy ra từ khối lượng (hoặc ngược lại) luôn được đánh dấu "ước tính",
//   phân biệt với lượng người dùng nhập trực tiếp ("đo").
// ============================================================

export const ELEMENT_ITEM_PREFIX = 'el:';
export const MOLAR_VOLUME_ML = 24790; // mL/mol, khí lý tưởng ở 25 °C và 1 bar
export const MOLAR_VOLUME_NOTE = 'khí lý tưởng ở 25 °C, 1 bar (24,79 L/mol)';

// Nguyên tố tồn tại dạng phân tử hai nguyên tử: 1 mol khí oxi là 1 mol O₂
const DIATOMIC = new Set(['h', 'n', 'o', 'f', 'cl', 'br', 'i']);

const LIMITS = { massG: 1000, liquidMl: 1000, gasMl: 5000 };

export const elementItemId = (el) => ELEMENT_ITEM_PREFIX + el.id;

export function isRadioactive(el) {
  return el.atomicNumber === 43 || el.atomicNumber === 61 || el.atomicNumber >= 84;
}

// Đơn vị công thức dùng để tính mol: Na, Cu, S... hoặc O₂, Cl₂, Br₂...
export function formulaUnit(el) {
  if (DIATOMIC.has(el.id)) return { formula: `${el.symbol}₂`, atoms: 2 };
  return { formula: el.symbol, atoms: 1 };
}

export function molarMass(el) {
  return el.atomicMass * formulaUnit(el).atoms;
}

export function unitsFor(el) {
  if (el.phase === 'gas') return ['mL', 'mol', 'g'];
  if (el.phase === 'liquid') return ['mL', 'g', 'mol'];
  return ['g', 'mg', 'mol'];
}

export function defaultAmount(el) {
  if (el.phase === 'gas') return { amount: 100, unit: 'mL' };
  if (el.phase === 'liquid') return { amount: 10, unit: 'mL' };
  return { amount: 5, unit: 'g' };
}

const clean = (x) => (x == null ? null : Number(x.toPrecision(12)));

// Đổi một lượng người dùng nhập thành đủ các đại lượng
export function toQuantity(el, amountInput, unit) {
  const amount = typeof amountInput === 'string' ? Number(amountInput.replace(',', '.')) : Number(amountInput);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Lượng mẫu phải là số lớn hơn 0.' };
  }
  if (!unitsFor(el).includes(unit)) {
    return { ok: false, error: `Không dùng được đơn vị ${unit} cho ${el.nameVi}.` };
  }

  const M = molarMass(el);
  const rho = el.densityGcm3; // g/cm³ = g/mL
  const isGas = el.phase === 'gas';
  const condensedRho = !isGas && rho != null && rho > 0 ? rho : null;

  let massG = null;
  let volumeMl = null;
  let moles = null;
  let massKind = 'measured';
  let volumeKind = null;

  if (unit === 'g' || unit === 'mg') {
    massG = unit === 'mg' ? amount / 1000 : amount;
    moles = massG / M;
    if (isGas) {
      volumeMl = moles * MOLAR_VOLUME_ML;
      volumeKind = 'estimated';
    } else if (condensedRho) {
      volumeMl = massG / condensedRho;
      volumeKind = 'estimated';
    }
  } else if (unit === 'mol') {
    moles = amount;
    massG = moles * M;
    massKind = 'estimated';
    if (isGas) {
      volumeMl = moles * MOLAR_VOLUME_ML;
      volumeKind = 'estimated';
    } else if (condensedRho) {
      volumeMl = massG / condensedRho;
      volumeKind = 'estimated';
    }
  } else if (unit === 'mL') {
    volumeMl = amount;
    volumeKind = 'measured';
    if (isGas) {
      moles = volumeMl / MOLAR_VOLUME_ML;
      massG = moles * M;
      massKind = 'estimated';
    } else {
      if (!condensedRho) {
        return { ok: false, error: 'Chưa có khối lượng riêng nên không đổi được mL sang khối lượng. Hãy nhập theo g.' };
      }
      massG = volumeMl * condensedRho;
      moles = massG / M;
      massKind = 'estimated';
    }
  }

  if (massG > LIMITS.massG) {
    return { ok: false, error: `Mẫu quá lớn (tối đa ${LIMITS.massG} g cho một lần lấy).` };
  }
  if (volumeMl != null && el.phase === 'liquid' && volumeMl > LIMITS.liquidMl) {
    return { ok: false, error: `Mẫu quá lớn (tối đa ${LIMITS.liquidMl} mL chất lỏng).` };
  }
  if (volumeMl != null && isGas && volumeMl > LIMITS.gasMl) {
    return { ok: false, error: `Mẫu quá lớn (tối đa ${LIMITS.gasMl} mL chất khí).` };
  }

  return {
    ok: true,
    amount: clean(amount),
    unit,
    massG: clean(massG),
    volumeMl: clean(volumeMl),
    moles: clean(moles),
    massKind,
    volumeKind,
    formula: formulaUnit(el).formula,
  };
}

// Bản ghi mẫu lưu theo từng instanceId trên bàn
export function createSampleRecord(el, quantity) {
  return {
    elementId: el.id,
    itemId: elementItemId(el),
    symbol: el.symbol,
    nameVi: el.nameVi,
    category: el.category,
    phase: el.phase,
    formula: quantity.formula,
    unit: quantity.unit,
    amount: quantity.amount, // lượng còn lại, theo đơn vị người dùng đã chọn
    initialAmount: quantity.amount,
    massG: quantity.massG,
    volumeMl: quantity.volumeMl,
    moles: quantity.moles,
    massKind: quantity.massKind,
    volumeKind: quantity.volumeKind,
    illustrative: isRadioactive(el) || el.atomicNumber >= 104,
    createdAt: Date.now(),
  };
}

// ------------------------------------------------------------
// Hiển thị
// ------------------------------------------------------------
const NUM = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 12, useGrouping: false });

export function fmtQ(n, sig = 4) {
  if (n == null || !Number.isFinite(n)) return '?';
  if (n === 0) return '0';
  return NUM.format(Number(n.toPrecision(sig)));
}

const est = (kind) => (kind === 'estimated' ? '≈ ' : '');

// Các dòng mô tả một lượng chất (dùng cho xem trước và bảng thông tin)
export function describeQuantity(q, phase) {
  const lines = [];
  lines.push(
    q.massG == null
      ? `Khối lượng${q.solute ? ' dung dịch' : ''}: chưa xác định (thiếu khối lượng riêng)`
      : `Khối lượng${q.solute ? ' dung dịch' : ''}: ${est(q.massKind)}${fmtQ(q.massG)} g`
  );
  if (q.moles != null && q.formula) {
    lines.push(`Lượng chất: ≈ ${fmtQ(q.moles)} mol ${q.formula}${q.solute ? ' (chất tan)' : ''}`);
  }
  if (q.soluteMassG != null && q.formula) {
    lines.push(`Khối lượng chất tan: ≈ ${fmtQ(q.soluteMassG)} g ${q.formula}`);
  }
  if (q.volumeMl != null) {
    const unit = phase === 'solid' ? 'cm³' : 'mL';
    const tag =
      q.volumeKind === 'measured'
        ? ''
        : phase === 'gas'
          ? ` (ước tính, ${MOLAR_VOLUME_NOTE})`
          : ' (ước tính từ khối lượng riêng)';
    lines.push(`Thể tích: ${est(q.volumeKind)}${fmtQ(q.volumeMl)} ${unit}${tag}`);
  } else if (phase !== 'gas') {
    lines.push('Thể tích: chưa xác định (thiếu khối lượng riêng)');
  }
  if (q.massKind === 'estimated' && q.massG != null) {
    lines.push(
      phase === 'gas'
        ? `Khối lượng và số mol được ước tính theo ${MOLAR_VOLUME_NOTE}.`
        : 'Khối lượng được ước tính, không phải đo trực tiếp.'
    );
  }
  return lines;
}

export const amountLabel = (amount, unit) => `${fmtQ(amount, 6)} ${unit}`;

// Khối thông tin mẫu khi chọn mẫu trên bàn (cột phải)
const escHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function sampleSummaryHtml(sample) {
  if (!sample) {
    return `<div class="sample-summary"><p class="bench-saved">Không tìm thấy dữ liệu định lượng của mẫu này.</p></div>`;
  }
  const empty = sample.amount <= 0;
  const lines = empty ? [] : describeQuantity(sample, sample.phase);
  const canPour = !empty && sample.phase !== 'gas';
  return `
    <div class="sample-summary">
      <strong>Mẫu đã lấy</strong>
      <p class="sample-amount-line">${
        empty ? 'Đã dùng hết' : `Còn lại: <b>${escHtml(amountLabel(sample.amount, sample.unit))}</b>`
      } <span>/ ban đầu ${escHtml(amountLabel(sample.initialAmount, sample.unit))}</span></p>
      ${lines.length ? `<ul>${lines.map((l) => `<li>${escHtml(l)}</li>`).join('')}</ul>` : ''}
      ${sample.illustrative ? '<p class="sample-warn">☢ Nguyên tố phóng xạ hoặc nhân tạo: mẫu chỉ mang tính minh họa.</p>' : ''}
      ${
        sample.phase === 'gas'
          ? '<p class="sample-warn">Mẫu khí được giữ trong bình thu khí; chưa hỗ trợ dẫn khí sang bình khác.</p>'
          : ''
      }
      ${
        canPour
          ? `<button class="btn btn-primary" data-action="pour-start">Cho vào cốc/bình (P)</button>
             <p class="sample-hint">Bấm nút (hoặc phím P), sau đó chọn cốc/bình nhận rồi bấm P lần nữa.</p>`
          : ''
      }
    </div>`;
}

// ------------------------------------------------------------
// Hóa chất trong thư viện (Liquid, Gas): lấy ra bàn theo mL, g hoặc mol
// item.stock: { label, phase, defaultMl, densityGmL?, molarMass?, solute?, molarity?, soluteMolarMass?, conc? }
// Lượng tồn trong chai luôn được theo dõi bằng mL; g và mol được đổi sang mL:
// - Dung dịch: mol chất tan → V = n / C_M;  g chất tan → n = m / M(chất tan)
// - Chất lỏng tinh khiết: g → V = m / ρ;  mol → m = n·M
// - Chất khí: mol → V = n · 24,79 L/mol;  g → n = m / M
// ------------------------------------------------------------
export function stockUnits(item) {
  const s = item?.stock;
  if (!s) return [];
  const f = s.solute ?? s.formula ?? '';
  if (s.molarity) {
    const u = [{ id: 'mL', label: 'mL dung dịch' }, { id: 'mol', label: `mol ${f}` }];
    if (s.soluteMolarMass) u.push({ id: 'g', label: `g ${f}` });
    return u;
  }
  const u = [{ id: 'mL', label: 'mL' }];
  if (s.phase === 'gas') {
    u.push({ id: 'mol', label: `mol ${f}`.trim() });
    if (s.molarMass) u.push({ id: 'g', label: `g ${f}`.trim() });
  } else if (s.densityGmL) {
    u.push({ id: 'g', label: `g ${f}`.trim() });
    if (s.molarMass) u.push({ id: 'mol', label: `mol ${f}`.trim() });
  }
  return u;
}

// Vì sao chất này chỉ lấy được theo mL (để ghi chú trong form)
export function stockUnitNote(item) {
  return stockUnits(item).length > 1
    ? null
    : 'Chỉ lấy được theo mL: chưa đủ dữ liệu (nồng độ mol, khối lượng riêng) để quy đổi chính xác sang g hoặc mol.';
}

// Đổi lượng nhập theo mL / g / mol thành thể tích (mL) lấy từ chai
export function stockAmountToMl(item, amount, unit = 'mL') {
  const s = item?.stock;
  if (!s) return { ok: false, error: 'Mục này không phải hóa chất.' };
  if (!stockUnits(item).some((u) => u.id === unit)) {
    return { ok: false, error: `Không lấy ${item.name} theo ${unit} được (thiếu dữ liệu quy đổi).` };
  }
  let ml = null;
  if (unit === 'mL') ml = amount;
  else if (s.molarity) {
    const n = unit === 'mol' ? amount : amount / s.soluteMolarMass;
    ml = (n / s.molarity) * 1000;
  } else if (s.phase === 'gas') {
    const n = unit === 'mol' ? amount : amount / s.molarMass;
    ml = n * MOLAR_VOLUME_ML;
  } else {
    const m = unit === 'g' ? amount : amount * s.molarMass;
    ml = m / s.densityGmL;
  }
  return { ok: true, ml: clean(ml) };
}

const unitText = (item, unit) => stockUnits(item).find((u) => u.id === unit)?.label ?? unit;

export function toStockQuantity(item, amountInput, unit = 'mL') {
  const spec = item?.stock;
  if (!spec) return { ok: false, error: 'Mục này không phải hóa chất.' };
  const amount = typeof amountInput === 'string' ? Number(amountInput.trim().replace(',', '.')) : Number(amountInput);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: `Lượng phải là số lớn hơn 0 ${unit}.` };
  const conv = stockAmountToMl(item, amount, unit);
  if (!conv.ok) return conv;
  const ml = conv.ml;
  const isGas = spec.phase === 'gas';
  const max = isGas ? LIMITS.gasMl : LIMITS.liquidMl;
  if (ml > max * (1 + 1e-9)) {
    return {
      ok: false,
      error: `Tối đa ${max} mL cho một lần lấy${unit === 'mL' ? '' : ` (${fmtQ(amount)} ${unitText(item, unit)} ≈ ${fmtQ(ml)} mL)`}.`,
    };
  }

  let massG = null;
  let moles = null;
  let soluteMassG = null;
  if (isGas) {
    moles = ml / MOLAR_VOLUME_ML;
    massG = spec.molarMass ? moles * spec.molarMass : null;
  } else {
    if (spec.densityGmL) massG = ml * spec.densityGmL;
    if (spec.molarity) {
      moles = (spec.molarity * ml) / 1000; // mol chất tan
      if (spec.soluteMolarMass) soluteMassG = moles * spec.soluteMolarMass;
    } else if (spec.molarMass && massG != null) moles = massG / spec.molarMass;
  }
  return {
    ok: true,
    amount: clean(ml),
    unit: 'mL',
    inputAmount: clean(amount),
    inputUnit: unit,
    inputLabel: unitText(item, unit),
    volumeMl: clean(ml),
    massG: clean(massG),
    soluteMassG: clean(soluteMassG),
    moles: clean(moles),
    massKind: massG == null ? null : 'estimated',
    volumeKind: unit === 'mL' ? 'measured' : 'estimated',
    formula: spec.solute ?? spec.formula ?? null,
    solute: Boolean(spec.molarity),
  };
}

export function createStockRecord(item, quantity) {
  return {
    kind: 'stock',
    itemId: item.id,
    symbol: item.stock.label,
    nameVi: item.name,
    category: 'compound',
    phase: item.stock.phase,
    formula: quantity.formula,
    solute: quantity.solute,
    soluteMassG: quantity.soluteMassG ?? null,
    unit: 'mL',
    amount: quantity.amount,
    initialAmount: quantity.amount,
    massG: quantity.massG,
    volumeMl: quantity.volumeMl,
    moles: quantity.moles,
    massKind: quantity.massKind,
    volumeKind: quantity.volumeKind,
    illustrative: false,
    createdAt: Date.now(),
  };
}

export function stockPreviewHtml(item, amountInput, unit = 'mL') {
  if (!String(amountInput ?? '').trim()) return '<li class="sample-empty">Nhập lượng cần lấy để xem quy đổi (mL, g, mol).</li>';
  const q = toStockQuantity(item, amountInput, unit);
  if (!q.ok) return `<li class="sample-error">${escHtml(q.error)}</li>`;
  const lines = describeQuantity(q, item.stock.phase);
  if (unit !== 'mL') lines.unshift(`Lấy ra từ chai: ≈ ${fmtQ(q.volumeMl, 6)} mL`);
  return lines.map((l) => `<li>${escHtml(l)}</li>`).join('');
}

export function stockFormHtml(item) {
  const s = item.stock;
  const units = stockUnits(item);
  const note = stockUnitNote(item);
  const hint =
    units.length > 1
      ? `Nhập lượng theo ${units.map((u) => u.label).join(', ')}.`
      : 'Nhập thể tích theo mL.';
  return `
    <div class="stock-form" data-item-id="${escHtml(item.id)}">
      <div class="sample-form-title">Lượng lấy ra bàn thí nghiệm</div>
      <p class="sample-hint">${escHtml(hint)}${s.conc ? ` Nồng độ: ${escHtml(s.conc)}.` : ''}</p>
      <div class="sample-row">
        <input type="text" inputmode="decimal" class="sample-amount-input" data-stock-amount
          value="" placeholder="Nhập lượng cần lấy" aria-label="Lượng cần lấy" autocomplete="off" />
        ${
          units.length > 1
            ? `<select class="sample-unit" data-stock-unit aria-label="Đơn vị">${units
                .map((u) => `<option value="${u.id}">${escHtml(u.label)}</option>`)
                .join('')}</select>`
            : '<span class="sample-unit sample-unit-fixed">mL</span>'
        }
      </div>
      ${note ? `<p class="sample-hint">${escHtml(note)}</p>` : ''}
      <ul class="sample-preview" data-stock-preview>${stockPreviewHtml(item, '')}</ul>
    </div>`;
}

// Đọc form lấy hóa chất: { amount, unit }
export function readStockForm(container) {
  const form = container.querySelector('.stock-form');
  if (!form) return null;
  return {
    itemId: form.dataset.itemId,
    amount: form.querySelector('[data-stock-amount]').value,
    unit: form.querySelector('[data-stock-unit]')?.value ?? 'mL',
  };
}

// Đổi lượng của mẫu nguyên tố từ đơn vị này sang đơn vị khác (theo dữ liệu nguyên tố)
export function convertElementAmount(el, amount, fromUnit, toUnit) {
  if (fromUnit === toUnit) return { ok: true, value: amount };
  const q = toQuantity(el, amount, fromUnit);
  if (!q.ok) return q;
  const v =
    toUnit === 'g' ? q.massG : toUnit === 'mg' ? (q.massG == null ? null : q.massG * 1000) : toUnit === 'mol' ? q.moles : q.volumeMl;
  if (v == null) return { ok: false, error: `Không đổi được ${fromUnit} sang ${toUnit} cho ${el.nameVi} (thiếu khối lượng riêng).` };
  return { ok: true, value: clean(v) };
}
