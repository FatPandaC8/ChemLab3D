// ============================================================
// ChemLab 3D — Chân dung các nhà hóa học treo trên tường phòng lab
// Ảnh lấy lúc chạy từ Wikipedia (ảnh đại diện của bài viết, qua API công khai có CORS).
// Không có mạng: hiện chân dung vẽ đơn giản kèm tên, tiểu sử vẫn đọc được.
// ============================================================
import * as THREE from 'three';

export const CHEMISTS = [
  {
    id: 'lavoisier',
    name: 'Antoine Lavoisier',
    years: '1743 – 1794',
    country: 'Pháp',
    wiki: 'Antoine_Lavoisier',
    title: 'Cha đẻ của hóa học hiện đại',
    bio: [
      'Antoine-Laurent de Lavoisier sinh năm 1743 tại Paris. Ông dùng cân chính xác trong mọi thí nghiệm và cho thấy trong phản ứng hóa học, tổng khối lượng các chất trước và sau phản ứng không đổi: đó là định luật bảo toàn khối lượng.',
      'Ông giải thích đúng sự cháy là quá trình kết hợp với oxi, bác bỏ thuyết "phlogiston" thịnh hành khi đó, và đặt tên cho oxi (oxygène) và hiđro (hydrogène).',
      'Năm 1787 ông cùng các cộng sự đề xuất hệ thống danh pháp hóa học mới; năm 1789 xuất bản "Traité élémentaire de chimie", trong đó liệt kê các chất được coi là nguyên tố. Do từng làm việc cho tổ chức thu thuế Ferme générale, ông bị xử tử năm 1794 trong thời kỳ Cách mạng Pháp.',
    ],
    facts: ['Định luật bảo toàn khối lượng', 'Vai trò của oxi trong sự cháy', 'Danh pháp hóa học hệ thống'],
  },
  {
    id: 'dalton',
    name: 'John Dalton',
    years: '1766 – 1844',
    country: 'Anh',
    wiki: 'John_Dalton',
    title: 'Người đặt nền móng cho thuyết nguyên tử',
    bio: [
      'John Dalton là nhà hóa học, vật lý và khí tượng học người Anh, dạy học nhiều năm tại Manchester.',
      'Ông đề xuất thuyết nguyên tử hiện đại: mỗi nguyên tố gồm những nguyên tử giống nhau, các nguyên tử kết hợp theo tỉ lệ số nguyên đơn giản để tạo thành hợp chất. Ông trình bày thuyết này trong cuốn "A New System of Chemical Philosophy" (1808).',
      'Dalton còn phát biểu định luật áp suất riêng phần của hỗn hợp khí (định luật Dalton) và là người đầu tiên mô tả khoa học chứng mù màu, vốn chính ông mắc phải. Đơn vị khối lượng nguyên tử dalton (Da) được đặt theo tên ông.',
    ],
    facts: ['Thuyết nguyên tử', 'Định luật áp suất riêng phần', 'Đơn vị dalton (Da)'],
  },
  {
    id: 'avogadro',
    name: 'Amedeo Avogadro',
    years: '1776 – 1856',
    country: 'Ý',
    wiki: 'Amedeo_Avogadro',
    title: 'Phân biệt nguyên tử và phân tử',
    bio: [
      'Amedeo Avogadro là nhà khoa học người Ý, giáo sư vật lý tại Đại học Turin.',
      'Năm 1811 ông đưa ra giả thuyết: ở cùng nhiệt độ và áp suất, những thể tích bằng nhau của mọi chất khí chứa cùng số phân tử. Giả thuyết này giúp phân biệt nguyên tử với phân tử (ví dụ khí oxi gồm phân tử O₂).',
      'Ý tưởng của ông ít được chú ý khi ông còn sống; đến hội nghị Karlsruhe năm 1860, Stanislao Cannizzaro mới làm nó được chấp nhận rộng rãi. Hằng số Avogadro (6,02214076 × 10²³ mol⁻¹) được đặt theo tên ông, dù ông không phải là người đo được giá trị này.',
    ],
    facts: ['Định luật Avogadro', 'Khái niệm phân tử', 'Hằng số Avogadro mang tên ông'],
  },
  {
    id: 'mendeleev',
    name: 'Dmitri Mendeleev',
    years: '1834 – 1907',
    country: 'Nga',
    wiki: 'Dmitri_Mendeleev',
    title: 'Tác giả bảng tuần hoàn các nguyên tố',
    bio: [
      'Dmitri Ivanovich Mendeleev là nhà hóa học người Nga, giảng dạy tại Đại học Saint Petersburg.',
      'Năm 1869 ông công bố bảng tuần hoàn, sắp xếp các nguyên tố theo khối lượng nguyên tử và tính chất lặp lại. Ông để trống những ô chưa có nguyên tố và dự đoán tính chất của chúng: các nguyên tố "eka-nhôm", "eka-bo", "eka-silic" sau đó được tìm ra là gali (1875), scanđi (1879) và gemani (1886).',
      'Ông còn nghiên cứu dung dịch, dầu mỏ và về sau phụ trách cơ quan đo lường quốc gia của Nga. Nguyên tố số 101, mendelevi (Md), được đặt theo tên ông.',
    ],
    facts: ['Bảng tuần hoàn (1869)', 'Dự đoán Ga, Sc, Ge', 'Nguyên tố mendelevi (Md)'],
  },
  {
    id: 'curie',
    name: 'Marie Curie',
    years: '1867 – 1934',
    country: 'Ba Lan – Pháp',
    wiki: 'Marie_Curie',
    title: 'Người tiên phong nghiên cứu phóng xạ',
    bio: [
      'Marie Skłodowska-Curie sinh tại Warszawa (Ba Lan), học tập và làm việc tại Paris.',
      'Năm 1898, bà và chồng là Pierre Curie phát hiện hai nguyên tố mới là poloni và rađi. Bà nhận giải Nobel Vật lý năm 1903 (cùng Pierre Curie và Henri Becquerel) và giải Nobel Hóa học năm 1911.',
      'Bà là phụ nữ đầu tiên đoạt giải Nobel và là người duy nhất đoạt giải Nobel ở hai lĩnh vực khoa học khác nhau. Bà mất năm 1934 vì bệnh thiếu máu bất sản, liên quan đến việc tiếp xúc lâu dài với phóng xạ. Nguyên tố curi (Cm) được đặt theo tên vợ chồng Curie.',
    ],
    facts: ['Phát hiện poloni và rađi', 'Nobel Vật lý 1903, Nobel Hóa học 1911', 'Nguyên tố curi (Cm)'],
  },
  {
    id: 'pauling',
    name: 'Linus Pauling',
    years: '1901 – 1994',
    country: 'Hoa Kỳ',
    wiki: 'Linus_Pauling',
    title: 'Bản chất của liên kết hóa học',
    bio: [
      'Linus Pauling là nhà hóa học người Mỹ, gắn bó lâu năm với Viện Công nghệ California (Caltech).',
      'Ông áp dụng cơ học lượng tử vào hóa học, đưa ra khái niệm lai hóa orbital và thang độ âm điện Pauling (chính thang được dùng trong bảng tuần hoàn của ChemLab 3D). Cuốn "The Nature of the Chemical Bond" (1939) của ông là một trong những sách hóa học có ảnh hưởng nhất thế kỷ 20. Ông cũng đề xuất cấu trúc xoắn alpha của protein.',
      'Ông nhận giải Nobel Hóa học năm 1954 và giải Nobel Hòa bình năm 1962 vì vận động chống thử vũ khí hạt nhân, là người duy nhất được trao hai giải Nobel không chia sẻ với ai.',
    ],
    facts: ['Thang độ âm điện Pauling', 'Lai hóa orbital', 'Nobel Hóa học 1954, Nobel Hòa bình 1962'],
  },
];

export const chemistById = Object.fromEntries(CHEMISTS.map((c) => [c.id, c]));

// Ảnh đại diện bài Wikipedia (lấy một lần, lưu trong bộ nhớ)
const imageCache = new Map();
export function chemistImageUrl(c) {
  if (!imageCache.has(c.id)) {
    imageCache.set(
      c.id,
      fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.wiki)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.thumbnail?.source ?? j?.originalimage?.source ?? null)
        .catch(() => null)
    );
  }
  return imageCache.get(c.id);
}

// Chân dung vẽ tạm (khi chưa tải được ảnh): nền tranh, hình bán thân, tên và năm sinh – mất
function placeholderCanvas(c) {
  const cv = document.createElement('canvas');
  cv.width = 384;
  cv.height = 480;
  const ctx = cv.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, 480);
  bg.addColorStop(0, '#5b5f66');
  bg.addColorStop(1, '#2d3036');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 384, 480);
  ctx.fillStyle = '#c9c4ba';
  ctx.beginPath();
  ctx.arc(192, 175, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(192, 380, 130, 110, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = 'rgba(20,20,24,0.75)';
  ctx.fillRect(0, 392, 384, 88);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(c.name, 192, 430);
  ctx.font = '22px Inter, Arial, sans-serif';
  ctx.fillText(c.years, 192, 462);
  return cv;
}

function plaqueTexture(c) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#b8a16a';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#8a7444';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 506, 122);
  ctx.fillStyle = '#2b2416';
  ctx.textAlign = 'center';
  ctx.font = 'bold 40px Georgia, serif';
  ctx.fillText(c.name, 256, 58);
  ctx.font = '28px Georgia, serif';
  ctx.fillText(c.years, 256, 100);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Treo chân dung lên tường. place: [{ id, x, y, z, ry }]. register(obj, data) đánh dấu để click được.
export function buildPortraits(parent, places, register) {
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2f2a24, roughness: 0.45, metalness: 0.2 });
  const matMat = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.9 });
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  for (const p of places) {
    const c = chemistById[p.id];
    if (!c) continue;
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.ry ?? 0;
    const W = 4.0;
    const H = 5.0;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, H + 0.5, 0.22), frameMat);
    frame.castShadow = true;
    const mat = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, H + 0.1, 0.24), matMat);
    const fallback = new THREE.CanvasTexture(placeholderCanvas(c));
    fallback.colorSpace = THREE.SRGBColorSpace;
    const photoMat = new THREE.MeshStandardMaterial({ map: fallback, roughness: 0.55 });
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.5, H - 0.5), photoMat);
    photo.position.z = 0.13;
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 0.7),
      new THREE.MeshStandardMaterial({ map: plaqueTexture(c), roughness: 0.35, metalness: 0.4 })
    );
    plaque.position.set(0, -H / 2 - 0.85, 0.02);
    g.add(frame, mat, photo, plaque);
    parent.add(g);
    register(g, { kind: 'portrait', chemist: c.id });
    // tải ảnh thật; cắt giữa ảnh cho vừa khung dọc 4:5
    chemistImageUrl(c).then((url) => {
      if (!url) return;
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          const iw = tex.image.width;
          const ih = tex.image.height;
          const want = (W - 0.5) / (H - 0.5);
          if (iw / ih > want) {
            tex.repeat.set(want / (iw / ih), 1);
            tex.offset.set((1 - tex.repeat.x) / 2, 0);
          } else {
            tex.repeat.set(1, (iw / ih) / want);
            tex.offset.set(0, 1 - tex.repeat.y); // giữ phần đầu (trên cùng) của ảnh
          }
          photoMat.map = tex;
          photoMat.needsUpdate = true;
          fallback.dispose();
        },
        undefined,
        () => {}
      );
    });
  }
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// Bảng thông tin tiểu sử (cột phải)
export function chemistPanelHtml(id) {
  const c = chemistById[id];
  if (!c) return '';
  return `
    <div class="info-card chemist-card">
      <span class="info-badge">Chân dung trên tường</span>
      <div class="chemist-photo" data-chemist-photo="${esc(c.id)}"><span>${esc(c.name)}</span></div>
      <h2 class="info-title">${esc(c.name)}</h2>
      <p class="info-formula">${esc(c.years)} · ${esc(c.country)}</p>
      <p class="chemist-title">${esc(c.title)}</p>
      ${c.bio.map((p) => `<p class="info-desc">${esc(p)}</p>`).join('')}
      <div class="chemist-facts">${c.facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
      <p class="info-source">Ảnh: Wikipedia / Wikimedia Commons (tải khi có mạng).</p>
    </div>`;
}

// Gắn ảnh thật vào bảng thông tin sau khi vẽ
export function fillChemistPhoto(container) {
  const el = container.querySelector('[data-chemist-photo]');
  if (!el) return;
  const c = chemistById[el.dataset.chemistPhoto];
  chemistImageUrl(c).then((url) => {
    if (!url || !el.isConnected) return;
    el.innerHTML = `<img src="${esc(url)}" alt="${esc(c.name)}" loading="lazy" />`;
  });
}
