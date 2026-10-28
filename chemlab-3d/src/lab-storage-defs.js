// ============================================================
// ChemLab 3D — Phân loại tủ, ngăn kéo trong phòng thí nghiệm
// Mỗi mục trong thư viện (Liquid, Gas, Glassware, Equipment) được xếp vào một tủ.
// Tủ không có "items" vẫn dùng để cất đồ người dùng mang vào.
// ============================================================

// tag: màu dải nhãn theo quy ước nhóm nguy hiểm thường gặp trong phòng lab
export const STORAGES = {
  // --- Tủ dưới bàn thí nghiệm chính (mặt trước)
  'b-tools': {
    name: 'Ngăn kéo · Dụng cụ cầm tay',
    short: 'DỤNG CỤ CẦM TAY',
    tag: '#64748b',
    items: ['stirring-rod', 'spatula', 'tube-holder', 'thermometer'],
    decor: 'tools',
  },
  'b-frames': {
    name: 'Tủ · Giá đỡ, giá ống nghiệm, kiềng',
    short: 'GIÁ ĐỠ & KIỀNG',
    tag: '#64748b',
    items: ['stand', 'rack', 'tripod'],
    decor: 'equip',
  },
  'b-heat': {
    name: 'Tủ · Dụng cụ đun nóng, chén sứ',
    short: 'ĐUN NÓNG & SỨ',
    tag: '#ea580c',
    items: ['bunsen', 'spirit-lamp', 'crucible', 'evaporating-dish', 'mortar'],
    decor: 'equip',
  },
  'b-safety': {
    name: 'Ngăn kéo · Đồ bảo hộ cá nhân',
    short: 'ĐỒ BẢO HỘ',
    tag: '#16a34a',
    items: [],
    ppe: true,
    decor: 'ppe',
  },

  // --- Tủ dưới bàn thí nghiệm chính (mặt sau, quay về phía quầy bồn rửa)
  'bb-small': {
    name: 'Ngăn kéo sau bàn · Dụng cụ nhỏ dự phòng',
    short: 'DỤNG CỤ NHỎ DỰ PHÒNG',
    tag: '#64748b',
    items: ['stirring-rod', 'spatula', 'thermometer', 'pipette'],
    decor: 'tools',
  },
  'bb-glass': {
    name: 'Tủ sau bàn · Dụng cụ thủy tinh dự phòng',
    short: 'THỦY TINH DỰ PHÒNG',
    tag: '#64748b',
    items: ['beaker', 'erlenmeyer', 'testtube', 'graduated-cylinder'],
    decor: 'glass',
  },
  'bb-dish': {
    name: 'Tủ sau bàn · Đồ sứ, mặt kính, đĩa Petri',
    short: 'ĐỒ SỨ & MẶT KÍNH',
    tag: '#64748b',
    items: ['crucible', 'evaporating-dish', 'mortar', 'watch-glass', 'petri-dish'],
    decor: 'equip',
  },
  'bb-heat': {
    name: 'Ngăn kéo sau bàn · Đèn cồn, kẹp, kiềng dự phòng',
    short: 'ĐÈN CỒN & KẸP',
    tag: '#ea580c',
    items: ['spirit-lamp', 'tube-holder', 'tripod'],
    decor: 'equip',
  },

  // --- Quầy sát tường sau (trái → phải)
  'c-paper': { name: 'Ngăn kéo · Cất đồ cá nhân', short: 'CẤT ĐỒ CÁ NHÂN', tag: '#64748b', items: [], decor: 'none' },
  'c-base': { name: 'Tủ bazơ', short: 'BAZƠ', tag: '#2563eb', items: ['naoh', 'nh3'], decor: 'chem' },
  'c-salt': {
    name: 'Tủ dung dịch muối',
    short: 'DUNG DỊCH MUỐI',
    tag: '#0d9488',
    items: ['cuso4', 'agno3', 'bacl2', 'na2co3', 'fecl3', 'caco3'],
    decor: 'chem',
  },
  'c-indicator': { name: 'Ngăn kéo · Chất chỉ thị', short: 'CHẤT CHỈ THỊ', tag: '#db2777', items: ['phenolphthalein', 'litmus'], decor: 'chem' },
  'c-sink': { name: 'Tủ dưới bồn rửa · Đồ vệ sinh', short: 'DƯỚI BỒN RỬA', tag: '#64748b', items: ['wash-bottle'], decor: 'clean' },
  'c-solvent': { name: 'Tủ dung môi hữu cơ (dễ cháy)', short: 'DUNG MÔI · DỄ CHÁY', tag: '#dc2626', items: ['ethanol'], decor: 'chem' },
  'c-oxidizer': { name: 'Tủ chất oxi hóa', short: 'CHẤT OXI HÓA', tag: '#ca8a04', items: ['kmno4', 'brwater'], decor: 'chem' },
  'c-water': { name: 'Ngăn kéo · Nước cất', short: 'NƯỚC CẤT', tag: '#0284c7', items: ['water'], decor: 'chem' },
  'c-volume': {
    name: 'Tủ · Dụng cụ đo thể tích',
    short: 'ĐO THỂ TÍCH',
    tag: '#64748b',
    items: ['graduated-cylinder', 'volumetric-flask', 'burette', 'pipette'],
    decor: 'glass',
  },
  'c-distill': {
    name: 'Tủ · Phễu, bộ chưng cất, lọc',
    short: 'PHỄU & CHƯNG CẤT',
    tag: '#64748b',
    items: ['funnel', 'separatory-funnel', 'condenser', 'distilling-flask', 'filter-flask'],
    decor: 'glass',
  },
  'c-misc': { name: 'Ngăn kéo · Cất đồ dùng chung', short: 'CẤT ĐỒ CHUNG', tag: '#64748b', items: [], decor: 'none' },

  // --- Tủ kính treo tường
  'w-glass1': {
    name: 'Tủ kính · Cốc, bình, ống nghiệm',
    short: 'CỐC · BÌNH · ỐNG NGHIỆM',
    tag: '#64748b',
    items: ['beaker', 'erlenmeyer', 'roundflask', 'testtube'],
    decor: 'none',
  },
  'w-glass2': { name: 'Tủ kính · Mặt kính đồng hồ, đĩa Petri', short: 'MẶT KÍNH · ĐĨA PETRI', tag: '#64748b', items: ['watch-glass', 'petri-dish'], decor: 'none' },

  // --- Tường phải
  'h-acid': {
    name: 'Tủ axit (có thông gió, dưới tủ hút)',
    short: 'AXIT · THÔNG GIÓ',
    tag: '#f8fafc',
    items: ['hcl', 'hno3', 'h2so4', 'ch3cooh', 'hcl_dil', 'h2so4_dil'],
    decor: 'chem',
  },
  elements: { name: 'Tủ mẫu nguyên tố', short: 'MẪU NGUYÊN TỐ', tag: '#f0c02c', items: [], periodic: true, decor: 'none' },
  fridge: { name: 'Tủ lạnh hóa chất (2 – 8 °C)', short: 'BẢO QUẢN LẠNH', tag: '#0284c7', items: ['h2o2', 'glucose'], decor: 'chem' },
  's-electric': {
    name: 'Tủ thiết bị điện',
    short: 'THIẾT BỊ ĐIỆN',
    tag: '#7c3aed',
    items: ['balance', 'hot-plate', 'magnetic-stirrer', 'heating-mantle', 'ph-meter'],
    decor: 'equip',
  },
  's-store': { name: 'Tủ cất đồ chung', short: 'TỦ CẤT ĐỒ', tag: '#64748b', items: [], decor: 'none' },
  gas: { name: 'Giá bình khí nén', short: 'KHÍ NÉN', tag: '#64748b', items: ['o2', 'h2', 'co2', 'methane', 'so2'], decor: 'none' },
};

// Tủ nên cất một mục thư viện (hoặc tủ chung nếu chưa phân loại)
export function recommendedStorage(itemId) {
  if (typeof itemId === 'string' && itemId.startsWith('el:')) return 'elements';
  for (const [id, s] of Object.entries(STORAGES)) if (s.items.includes(itemId)) return id;
  return 's-store';
}

// Đồ bảo hộ trong ngăn kéo bảo hộ và móc treo áo
export const PPE = {
  goggles: { name: 'Kính bảo hộ', desc: 'Bảo vệ mắt khỏi hóa chất bắn và mảnh vỡ thủy tinh.' },
  gloves: { name: 'Găng tay nitrile', desc: 'Chống axit loãng, bazơ và đa số dung môi trong thời gian ngắn.' },
  coat: { name: 'Áo blouse', desc: 'Áo dài tay bằng cotton, che quần áo và da khi làm thí nghiệm.' },
};

// Hóa chất cần đồ bảo hộ khi thao tác
export const CORROSIVE = new Set(['hcl', 'hno3', 'h2so4', 'naoh', 'nh3', 'ch3cooh', 'agno3', 'kmno4', 'fecl3']);
