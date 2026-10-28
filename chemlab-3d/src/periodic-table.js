// ============================================================
// ChemLab 3D — Bảng tuần hoàn hóa học (giao diện)
// Không phụ thuộc Three.js. Dữ liệu lấy từ ./elements.js
// main.js chỉ cần: createPeriodicTable(), renderElementInfoHtml(),
// renderPeriodicLibraryHtml() và hằng PERIODIC_CATEGORY.
// ============================================================
import {
  ELEMENTS,
  ELEMENT_BY_ID,
  CATEGORY_INFO,
  CATEGORY_ORDER,
  PHASE_LABEL_VI,
  DATA_SOURCE,
  DESCRIPTION_NOTE,
  getElementKind,
} from './elements.js';
import { unitsFor, defaultAmount, toQuantity, describeQuantity, isRadioactive } from './quantity.js';

export const PERIODIC_CATEGORY = 'Periodic Table';

const KIND_FILTERS = [
  ['all', 'Tất cả'],
  ['metal', 'Kim loại'],
  ['nonmetal', 'Phi kim'],
  ['metalloid', 'Á kim'],
];
const PHASE_FILTERS = [
  ['solid', 'Rắn'],
  ['liquid', 'Lỏng'],
  ['gas', 'Khí'],
];

const GAP = 3; // khoảng cách giữa các ô (px), khớp với CSS --pt-gap
const AXIS = 22; // độ rộng cột số chu kỳ (px)
const MIN_CELL = 34;
const MAX_CELL = 96;

// ------------------------------------------------------------
// Tiện ích
// ------------------------------------------------------------
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Bỏ dấu tiếng Việt để tìm "sat" ra "Sắt", "hidro" ra "Hiđro"
export function normalizeText(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

const SEARCH_NAMES = new Map(
  ELEMENTS.map((e) => [e.id, [e.name, e.nameVi, ...e.aliases].map(normalizeText)])
);

const SYMBOLS = new Set(ELEMENTS.map((e) => e.symbol.toLowerCase()));

export function matchesQuery(element, rawQuery) {
  const q = normalizeText(rawQuery);
  if (!q) return true;
  if (/^\d+$/.test(q)) return element.atomicNumber === Number(q);
  // Gõ đúng một ký hiệu (Fe, Na, O...) thì chỉ ra đúng nguyên tố đó
  if (SYMBOLS.has(q)) return element.symbol.toLowerCase() === q;
  const names = SEARCH_NAMES.get(element.id);
  // Chuỗi ngắn: so khớp phần đầu tên, tránh ra quá nhiều kết quả
  return q.length <= 2 ? names.some((n) => n.startsWith(q)) : names.some((n) => n.includes(q));
}

const NUM = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 10, useGrouping: false });
const fmt = (n, sig = 6) => NUM.format(Number(n.toPrecision(sig)));

const unknownText = (el) =>
  el.atomicNumber >= 104 ? 'chưa có dữ liệu đáng tin cậy' : 'chưa xác định';

function massText(el) {
  if (el.atomicMass == null) return unknownText(el);
  if (el.massType === 'isotope') {
    return `≈ ${fmt(el.atomicMass, 7)} (đồng vị tiêu biểu, số khối ${Math.round(el.atomicMass)})`;
  }
  return fmt(el.atomicMass, 7);
}

function tempText(k, el) {
  if (k == null) return unknownText(el);
  return `${fmt(k)} K (${fmt(k - 273.15)} °C)`;
}

function densityText(el) {
  const d = el.densityGcm3;
  if (d == null) return unknownText(el);
  const gL = el.phase === 'gas' ? ` (≈ ${fmt(d * 1000, 5)} g/L)` : '';
  return `${fmt(d, 6)} g/cm³${gL}`;
}

function oxidationText(el) {
  if (!el.oxidationStates.length) return unknownText(el);
  return el.oxidationStates.map((n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')).join(', ');
}

function positionText(el) {
  const block = `khối ${el.block}`;
  if (el.group == null) {
    const row = el.category === 'actinide' || el.period === 7 ? 'Actinide' : 'Lanthanide';
    return `Hàng f (${row}) · chu kỳ ${el.period} · ${block}`;
  }
  return `Nhóm ${el.group} · chu kỳ ${el.period} · ${block}`;
}

function phaseText(el) {
  const base = PHASE_LABEL_VI[el.phase] ?? unknownText(el);
  return el.phasePredicted ? `${base} (dự đoán)` : base;
}

function yearText(el) {
  if (el.yearDiscovered === 'ancient') return 'Từ thời cổ đại';
  return el.yearDiscovered ?? unknownText(el);
}

const shortMass = (el) =>
  el.massType === 'isotope' ? `[${Math.round(el.atomicMass)}]` : fmt(el.atomicMass, 5);

function tooltip(el) {
  return `${el.nameVi} (${el.name}) · Z = ${el.atomicNumber} · ${shortMass(el)} · ${
    CATEGORY_INFO[el.category].label
  } · ${phaseText(el)}`;
}

// Vị trí ô trên lưới: hàng 1 là số nhóm, hàng 2–8 là chu kỳ 1–7,
// hàng 9 là khoảng trống, hàng 10–11 là Lanthanide và Actinide.
// Cột 1 là số chu kỳ, cột 2–19 là nhóm 1–18.
function cellPlace(el) {
  if (el.group != null) return { row: el.period + 1, col: el.group + 1 };
  const first = el.period === 6 ? 57 : 89;
  return { row: el.period === 6 ? 10 : 11, col: 4 + (el.atomicNumber - first) };
}

// ------------------------------------------------------------
// HTML cho bảng thông tin bên phải
// ------------------------------------------------------------
export function renderElementInfoHtml(el) {
  if (!el) {
    return `
      <div class="info-card">
        <span class="info-badge">Bảng tuần hoàn</span>
        <h2 class="info-title">Chọn một nguyên tố</h2>
        <p class="info-desc">Nhấp vào một ô trong bảng tuần hoàn để xem số liệu, tính chất, ứng dụng và lưu ý an toàn.</p>
      </div>`;
  }

  const rows = [
    ['Nguyên tử khối', massText(el)],
    ['Vị trí', positionText(el)],
    ['Phân loại', CATEGORY_INFO[el.category].label],
    ['Trạng thái (≈ 25 °C, 1 atm)', phaseText(el)],
  ];
  if (el.elementalForm) {
    rows.push(['Dạng đơn chất phổ biến', `${el.elementalForm.formula} — ${el.elementalForm.note}`]);
  }
  rows.push(
    ['Cấu hình electron', el.electronConfig || unknownText(el)],
    ['Số oxi hóa phổ biến', oxidationText(el)],
    ['Nhiệt độ nóng chảy', tempText(el.meltingK, el)],
    ['Nhiệt độ sôi', tempText(el.boilingK, el)],
    ['Khối lượng riêng', densityText(el)],
    ['Độ âm điện (Pauling)', el.electronegativity == null ? unknownText(el) : fmt(el.electronegativity, 4)],
    ['Năng lượng ion hóa thứ nhất', el.ionizationEv == null ? unknownText(el) : `${fmt(el.ionizationEv, 5)} eV`],
    ['Năm phát hiện', yearText(el)]
  );

  const notes = [...el.notes];
  if (el.densityGcm3 != null) notes.push('Khối lượng riêng: dữ liệu nguồn không ghi điều kiện đo.');

  return `
    <div class="info-card element-info">
      <span class="info-badge">Nguyên tố · ${esc(CATEGORY_INFO[el.category].label)}</span>
      <div class="element-head">
        <div class="element-tile" data-cat="${el.category}"${el.phasePredicted ? ' data-predicted' : ''}>
          <span class="element-tile-z">${el.atomicNumber}</span>
          <span class="element-tile-sym">${esc(el.symbol)}</span>
          <span class="element-tile-mass">${esc(shortMass(el))}</span>
        </div>
        <div>
          <h2 class="info-title">${esc(el.nameVi)}</h2>
          <p class="info-formula">${esc(el.name)} · ${esc(el.symbol)} · Z = ${el.atomicNumber}</p>
        </div>
      </div>
      <p class="info-desc">${esc(el.highlight)}</p>
      ${sampleFormHtml(el)}
      <dl class="prop-list">${rows
        .map(([k, v]) => `<div class="prop-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
        .join('')}</dl>
      <p class="info-desc"><strong>Ứng dụng:</strong> ${esc(el.uses)}</p>
      <p class="info-safety"><strong>An toàn:</strong> ${esc(el.hazard)}</p>
      ${
        notes.length
          ? `<ul class="info-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
          : ''
      }
      <p class="info-source">Nguồn số liệu: ${esc(DATA_SOURCE)}. ${esc(DESCRIPTION_NOTE)}</p>
    </div>`;
}

// ------------------------------------------------------------
// Form lấy mẫu theo g / mg / mol / mL
// ------------------------------------------------------------
const UNIT_LABEL = { g: 'g', mg: 'mg', mol: 'mol', mL: 'mL' };

function previewHtml(el, amount, unit) {
  if (!String(amount ?? '').trim()) return '<li class="sample-empty">Nhập lượng cần lấy để xem quy đổi (g, mol, mL).</li>';
  const q = toQuantity(el, amount, unit);
  if (!q.ok) return `<li class="sample-error">${esc(q.error)}</li>`;
  return describeQuantity(q, el.phase)
    .map((l) => `<li>${esc(l)}</li>`)
    .join('');
}

function sampleFormHtml(el) {
  const { unit } = defaultAmount(el);
  const warn = [];
  if (el.atomicNumber >= 104) {
    warn.push('Thực tế mới chỉ tạo được vài nguyên tử của nguyên tố này; mẫu chỉ mang tính minh họa.');
  } else if (isRadioactive(el)) {
    warn.push('Nguyên tố phóng xạ: mẫu chỉ mang tính minh họa, không thao tác với mẫu thật.');
  }
  if (el.phase === 'gas') warn.push('Mẫu khí được chứa trong bình thu khí; chưa hỗ trợ dẫn khí sang bình khác.');
  const hint =
    el.phase === 'gas'
      ? 'Chất khí: nhập theo mL (hoặc mol, g).'
      : el.phase === 'liquid'
        ? 'Chất lỏng: nhập theo mL (hoặc g, mol).'
        : 'Chất rắn: nhập theo g hoặc mg (hoặc mol).';
  return `
    <div class="sample-form" data-element-id="${el.id}">
      <div class="sample-form-title">Lấy mẫu để làm thí nghiệm</div>
      <p class="sample-hint">${hint}</p>
      <div class="sample-row">
        <input type="text" inputmode="decimal" class="sample-amount-input" data-sample-amount
          value="" placeholder="Nhập lượng cần lấy" aria-label="Lượng mẫu" autocomplete="off" />
        <select class="sample-unit" data-sample-unit aria-label="Đơn vị">
          ${unitsFor(el)
            .map((u) => `<option value="${u}"${u === unit ? ' selected' : ''}>${UNIT_LABEL[u]}</option>`)
            .join('')}
        </select>
      </div>
      <ul class="sample-preview" data-sample-preview>${previewHtml(el, '', unit)}</ul>
      ${warn.map((w) => `<p class="sample-warn">${esc(w)}</p>`).join('')}
      <button class="btn btn-primary" data-action="add-element" data-element-id="${el.id}">
        Lấy mẫu lên bàn thí nghiệm
      </button>
    </div>`;
}

// Đọc giá trị form lấy mẫu trong vùng chứa (cột phải)
export function readSampleForm(container) {
  const form = container.querySelector('.sample-form');
  if (!form) return null;
  return {
    elementId: form.dataset.elementId,
    amount: form.querySelector('[data-sample-amount]').value.trim(),
    unit: form.querySelector('[data-sample-unit]').value,
  };
}

// Cập nhật phần xem trước khi gõ số hoặc đổi đơn vị; Enter để lấy mẫu
export function bindSampleForm(container, onSubmit) {
  const update = (e) => {
    const form = e.target.closest?.('.sample-form');
    if (!form) return;
    const el = ELEMENT_BY_ID[form.dataset.elementId];
    const v = readSampleForm(container);
    if (!el || !v) return;
    form.querySelector('[data-sample-preview]').innerHTML = previewHtml(el, v.amount, v.unit);
  };
  container.addEventListener('input', update);
  container.addEventListener('change', update);
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches?.('[data-sample-amount]')) {
      e.preventDefault();
      onSubmit();
    }
  });
}

// HTML cho cột thư viện bên trái khi đang mở bảng tuần hoàn
export function renderPeriodicLibraryHtml() {
  return `
    <div class="library-header">
      <h2>Bảng tuần hoàn</h2>
      <span class="library-count">${ELEMENTS.length} nguyên tố</span>
    </div>
    <div class="pt-side">
      <p>Nhấp vào một ô để xem thông tin chi tiết ở bảng bên phải.</p>
      <ul>
        <li>Màu ô cho biết họ nguyên tố (xem chú giải dưới bảng).</li>
        <li>Chữ <b>K</b> hoặc <b>L</b> ở góc ô: chất khí hoặc chất lỏng ở khoảng 25 °C, 1 atm. Ô không có chữ là chất rắn.</li>
        <li>Viền nét đứt: trạng thái chỉ là dự đoán.</li>
        <li>Ô <b>57–71</b> và <b>89–103</b> chỉ tới hai hàng Lanthanide và Actinide đặt riêng phía dưới.</li>
        <li>Tìm theo tên tiếng Việt hoặc tiếng Anh, ký hiệu, số hiệu (VD: <i>sắt</i>, <i>Fe</i>, <i>26</i>). Nhấn Enter để chọn kết quả đầu tiên.</li>
      </ul>
      <p class="library-tip">Họ nguyên tố và trạng thái là hai cách phân loại khác nhau: ví dụ thủy ngân là kim loại nhưng ở thể lỏng, brom là halogen và cũng ở thể lỏng.</p>
      <p class="library-tip">Nguồn số liệu: ${esc(DATA_SOURCE)}.</p>
    </div>`;
}

// ------------------------------------------------------------
// Lớp phủ bảng tuần hoàn (đặt trong vùng 3D)
// ------------------------------------------------------------
function buildGridHtml() {
  const parts = [];
  for (let g = 1; g <= 18; g++) {
    parts.push(`<div class="pt-axis" style="grid-row:1;grid-column:${g + 1}">${g}</div>`);
  }
  for (let p = 1; p <= 7; p++) {
    parts.push(`<div class="pt-axis" style="grid-row:${p + 1};grid-column:1">${p}</div>`);
  }
  parts.push(
    `<div class="pt-preview" style="grid-row:2 / 5;grid-column:4 / 14" aria-live="polite"></div>`,
    `<button type="button" class="pt-ph" data-frow="10" style="grid-row:7;grid-column:4" title="Lanthanide: hàng riêng phía dưới">57–71</button>`,
    `<button type="button" class="pt-ph" data-frow="11" style="grid-row:8;grid-column:4" title="Actinide: hàng riêng phía dưới">89–103</button>`,
    `<div class="pt-flabel" style="grid-row:10;grid-column:1 / 4">Lanthanide<br><span>57–71</span></div>`,
    `<div class="pt-flabel" style="grid-row:11;grid-column:1 / 4">Actinide<br><span>89–103</span></div>`
  );

  for (const el of ELEMENTS) {
    const { row, col } = cellPlace(el);
    const tip = esc(tooltip(el));
    const phaseMark = el.phase === 'gas' ? 'K' : el.phase === 'liquid' ? 'L' : '';
    parts.push(
      `<button type="button" class="pt-cell" data-id="${el.id}" data-cat="${el.category}"` +
        `${el.phasePredicted ? ' data-predicted' : ''}${el.group == null ? ` data-frow="${row}"` : ''}` +
        ` style="grid-row:${row};grid-column:${col}" title="${tip}" aria-label="${tip}">` +
        `<span class="pt-z">${el.atomicNumber}</span>` +
        (phaseMark ? `<span class="pt-phase">${phaseMark}</span>` : '') +
        `<span class="pt-sym">${esc(el.symbol)}</span>` +
        `<span class="pt-name">${esc(el.nameVi)}</span>` +
        `</button>`
    );
  }
  return parts.join('');
}

function buildOverlayHtml() {
  const counts = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, ELEMENTS.filter((e) => e.category === c).length])
  );
  return `
    <div class="pt-toolbar">
      <div class="pt-row">
        <div class="pt-heading"><strong>Bảng tuần hoàn hóa học</strong><span>Periodic Table</span></div>
        <input type="search" class="pt-search" placeholder="Tìm nguyên tố: sắt, Fe, 26…"
          aria-label="Tìm nguyên tố" autocomplete="off" spellcheck="false" />
        <span class="pt-count" aria-live="polite"></span>
        <div class="pt-zoom" role="group" aria-label="Thu phóng bảng">
          <button type="button" class="pt-chip" data-zoom="out" title="Thu nhỏ">−</button>
          <button type="button" class="pt-chip" data-zoom="fit" title="Vừa khung">Vừa khung</button>
          <button type="button" class="pt-chip" data-zoom="in" title="Phóng to">+</button>
        </div>
        <button type="button" class="btn pt-close" data-pt-close>← Về bàn thí nghiệm</button>
      </div>
      <div class="pt-row" role="group" aria-label="Bộ lọc">
        ${KIND_FILTERS.map(
          ([v, label]) =>
            `<button type="button" class="pt-chip" data-kind="${v}" aria-pressed="false">${label}</button>`
        ).join('')}
        <span class="pt-sep" aria-hidden="true"></span>
        ${PHASE_FILTERS.map(
          ([v, label]) =>
            `<button type="button" class="pt-chip" data-phase-filter="${v}" aria-pressed="false">${label}</button>`
        ).join('')}
        <button type="button" class="pt-chip pt-reset" data-reset hidden>Bỏ lọc</button>
      </div>
    </div>
    <div class="pt-body">
      <div class="pt-grid">${buildGridHtml()}</div>
    </div>
    <div class="pt-legend" role="group" aria-label="Chú giải họ nguyên tố (nhấp để lọc)">
      ${CATEGORY_ORDER.map(
        (c) =>
          `<button type="button" class="pt-key" data-cat="${c}" data-cat-filter="${c}" aria-pressed="false">` +
          `<i aria-hidden="true"></i>${esc(CATEGORY_INFO[c].label)} <small>${counts[c]}</small></button>`
      ).join('')}
    </div>`;
}

export function createPeriodicTable({ container, onSelect = () => {}, onClose = () => {} }) {
  const state = {
    selectedId: null,
    query: '',
    kind: 'all',
    phase: null,
    category: null,
    zoomCell: null, // null = tự vừa khung
    currentCell: 46,
  };

  const root = document.createElement('div');
  root.className = 'pt-overlay';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Bảng tuần hoàn hóa học');
  root.innerHTML = buildOverlayHtml();
  container.appendChild(root);

  const body = root.querySelector('.pt-body');
  const grid = root.querySelector('.pt-grid');
  const search = root.querySelector('.pt-search');
  const countEl = root.querySelector('.pt-count');
  const preview = root.querySelector('.pt-preview');
  const resetBtn = root.querySelector('[data-reset]');
  const cells = new Map();
  root.querySelectorAll('.pt-cell').forEach((b) => cells.set(b.dataset.id, b));

  const passes = (el) =>
    matchesQuery(el, state.query) &&
    (state.kind === 'all' || getElementKind(el) === state.kind) &&
    (!state.phase || el.phase === state.phase) &&
    (!state.category || el.category === state.category);

  function apply() {
    const filtering = Boolean(normalizeText(state.query)) || state.kind !== 'all' || state.phase || state.category;
    let n = 0;
    for (const el of ELEMENTS) {
      const ok = passes(el);
      if (ok) n++;
      const cell = cells.get(el.id);
      cell.classList.toggle('is-dim', !ok);
      cell.classList.toggle('is-hit', ok && Boolean(normalizeText(state.query)));
    }
    countEl.textContent = filtering ? `Hiển thị ${n}/${ELEMENTS.length}` : `${ELEMENTS.length} nguyên tố`;
    resetBtn.hidden = !filtering;
    root.querySelectorAll('[data-kind]').forEach((b) => setPressed(b, b.dataset.kind === state.kind));
    root.querySelectorAll('[data-phase-filter]').forEach((b) => setPressed(b, b.dataset.phaseFilter === state.phase));
    root.querySelectorAll('[data-cat-filter]').forEach((b) => setPressed(b, b.dataset.catFilter === state.category));
  }

  function setPressed(btn, on) {
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
  }

  function showPreview(el) {
    if (!el) {
      preview.innerHTML = `<p class="pt-preview-hint">Di chuột qua một ô để xem nhanh, nhấp để xem chi tiết.</p>`;
      return;
    }
    preview.innerHTML = `
      <div class="pt-preview-tile" data-cat="${el.category}">
        <span>${el.atomicNumber}</span><b>${esc(el.symbol)}</b>
      </div>
      <div class="pt-preview-text">
        <strong>${esc(el.nameVi)}</strong> <span>${esc(el.name)}</span><br>
        <small>${esc(shortMass(el))} · ${esc(CATEGORY_INFO[el.category].label)} · ${esc(phaseText(el))}</small>
      </div>`;
  }

  function setCell(px) {
    state.currentCell = px;
    grid.style.setProperty('--cell', `${px}px`);
  }

  function fit() {
    const w = body.clientWidth - 28 - AXIS - 18 * GAP;
    const h = body.clientHeight - 24 - 18 - 12 - 10 * GAP;
    // Lưới có 9 hàng ô, mỗi hàng cao 1,12 lần chiều rộng ô
    const byWidth = Math.floor(w / 18);
    const byHeight = Math.floor(h / (9 * 1.12));
    setCell(clamp(Math.min(byWidth, byHeight), MIN_CELL, 64));
  }

  function refreshSize() {
    if (state.zoomCell == null) fit();
    else setCell(state.zoomCell);
  }

  function select(id) {
    const el = ELEMENT_BY_ID[id];
    if (!el) return;
    if (state.selectedId) cells.get(state.selectedId)?.classList.remove('is-selected');
    state.selectedId = id;
    cells.get(id).classList.add('is-selected');
    showPreview(el);
    onSelect(el);
  }

  function flashRow(row) {
    const rowCells = [...root.querySelectorAll(`.pt-cell[data-frow="${row}"]`)];
    rowCells.forEach((c) => {
      c.classList.remove('is-flash');
      void c.offsetWidth; // chạy lại hiệu ứng
      c.classList.add('is-flash');
    });
    rowCells[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    setTimeout(() => rowCells.forEach((c) => c.classList.remove('is-flash')), 1400);
  }

  root.addEventListener('click', (e) => {
    const t = e.target;
    const cell = t.closest('.pt-cell');
    if (cell) return select(cell.dataset.id);
    const ph = t.closest('.pt-ph');
    if (ph) return flashRow(ph.dataset.frow);
    const kind = t.closest('[data-kind]');
    if (kind) {
      state.kind = kind.dataset.kind;
      return apply();
    }
    const ph2 = t.closest('[data-phase-filter]');
    if (ph2) {
      state.phase = state.phase === ph2.dataset.phaseFilter ? null : ph2.dataset.phaseFilter;
      return apply();
    }
    const key = t.closest('[data-cat-filter]');
    if (key) {
      state.category = state.category === key.dataset.catFilter ? null : key.dataset.catFilter;
      return apply();
    }
    if (t.closest('[data-reset]')) {
      Object.assign(state, { query: '', kind: 'all', phase: null, category: null });
      search.value = '';
      return apply();
    }
    const zoom = t.closest('[data-zoom]');
    if (zoom) {
      const z = zoom.dataset.zoom;
      if (z === 'fit') {
        state.zoomCell = null;
      } else {
        state.zoomCell = clamp(state.currentCell + (z === 'in' ? 6 : -6), MIN_CELL - 6, MAX_CELL);
      }
      return refreshSize();
    }
    if (t.closest('[data-pt-close]')) onClose();
  });

  root.addEventListener('pointerover', (e) => {
    const cell = e.target.closest('.pt-cell');
    if (cell) showPreview(ELEMENT_BY_ID[cell.dataset.id]);
  });
  grid.addEventListener('pointerleave', () => showPreview(ELEMENT_BY_ID[state.selectedId] ?? null));

  search.addEventListener('input', () => {
    state.query = search.value;
    apply();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = ELEMENTS.find(passes);
      if (first) {
        select(first.id);
        cells.get(first.id).scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    } else if (e.key === 'Escape') {
      search.value = '';
      state.query = '';
      apply();
    }
  });

  new ResizeObserver(() => {
    if (root.classList.contains('is-open')) refreshSize();
  }).observe(body);

  apply();
  showPreview(null);

  return {
    element: root,
    isVisible: () => root.classList.contains('is-open'),
    setVisible(visible) {
      root.classList.toggle('is-open', Boolean(visible));
      if (visible) requestAnimationFrame(refreshSize);
    },
    select,
    getSelected: () => ELEMENT_BY_ID[state.selectedId] ?? null,
  };
}
