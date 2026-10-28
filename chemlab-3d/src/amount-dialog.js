// ============================================================
// ChemLab 3D — Hộp thoại nhập lượng (thay cho window.prompt)
// Ô nhập luôn để trống: người dùng tự nhập đúng lượng cần dùng.
// ============================================================

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function parseAmount(text) {
  const v = Number(String(text ?? '').trim().replace(',', '.'));
  return Number.isFinite(v) ? v : NaN;
}

let openDialog = null;

export function isAmountDialogOpen() {
  return Boolean(openDialog);
}

// Trả về Promise<number | null> (null khi bấm Hủy hoặc Esc)
// Có units = [{ id, label }] (nhiều đơn vị, ví dụ mL / g / mol): trả về Promise<{ value, unit } | null>
// validate(value, unitId) trả về chuỗi lỗi hoặc null nếu hợp lệ
// preview(value, unitId) (tùy chọn) trả về dòng quy đổi hiện dưới ô nhập
export function askAmount({ container, title, unit, units, lines = [], placeholder, confirmLabel = 'Xác nhận', validate, preview }) {
  const multi = Array.isArray(units) && units.length > 1;
  if (!unit) unit = units?.[0]?.id ?? '';
  if (openDialog) openDialog.cancel();
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'amount-dialog-backdrop';
    root.innerHTML = `
      <div class="amount-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="amount-dialog-title">${esc(title)}</div>
        ${lines.length ? `<ul class="amount-dialog-info">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        <label class="amount-dialog-row">
          <input type="text" inputmode="decimal" autocomplete="off" class="sample-amount-input" data-amount-input
            placeholder="${esc(placeholder ?? 'Nhập lượng cần dùng')}" aria-label="Lượng (${esc(unit)})" />
          ${
            multi
              ? `<select class="sample-unit" data-amount-unit aria-label="Đơn vị">${units
                  .map((u) => `<option value="${esc(u.id)}"${u.id === unit ? ' selected' : ''}>${esc(u.label)}</option>`)
                  .join('')}</select>`
              : `<span class="sample-unit sample-unit-fixed">${esc(units?.[0]?.label ?? unit)}</span>`
          }
        </label>
        <p class="amount-dialog-preview" data-amount-preview></p>
        <p class="amount-dialog-error" data-amount-error></p>
        <div class="amount-dialog-actions">
          <button type="button" class="btn" data-amount-cancel>Hủy</button>
          <button type="button" class="btn btn-primary" data-amount-ok>${esc(confirmLabel)}</button>
        </div>
      </div>`;
    container.appendChild(root);
    const input = root.querySelector('[data-amount-input]');
    const error = root.querySelector('[data-amount-error]');
    const unitSel = root.querySelector('[data-amount-unit]');
    const previewEl = root.querySelector('[data-amount-preview]');
    const curUnit = () => unitSel?.value ?? unit;
    const curLabel = () => units?.find((u) => u.id === curUnit())?.label ?? curUnit();
    const refreshPreview = () => {
      if (!preview) return;
      const v = parseAmount(input.value);
      previewEl.textContent = input.value.trim() && Number.isFinite(v) && v > 0 ? preview(v, curUnit()) ?? '' : '';
    };

    const close = (value) => {
      root.remove();
      openDialog = null;
      resolve(value);
    };
    const submit = () => {
      const raw = input.value.trim();
      if (!raw) {
        error.textContent = 'Hãy nhập lượng cần dùng.';
        input.focus();
        return;
      }
      const value = parseAmount(raw);
      let msg = !Number.isFinite(value) || value <= 0 ? `Lượng phải là số lớn hơn 0 ${curLabel()}.` : null;
      if (!msg && validate) msg = validate(value, curUnit());
      if (msg) {
        error.textContent = msg;
        input.focus();
        input.select();
        return;
      }
      close(multi || units ? { value, unit: curUnit() } : value);
    };

    root.querySelector('[data-amount-ok]').addEventListener('click', submit);
    root.querySelector('[data-amount-cancel]').addEventListener('click', () => close(null));
    root.addEventListener('pointerdown', (e) => {
      if (e.target === root) close(null);
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    });
    input.addEventListener('input', () => {
      error.textContent = '';
      refreshPreview();
    });
    unitSel?.addEventListener('change', () => {
      error.textContent = '';
      refreshPreview();
      input.focus();
    });
    unitSel?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close(null);
    });
    openDialog = { cancel: () => close(null) };
    requestAnimationFrame(() => input.focus());
  });
}
