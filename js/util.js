/* ==========================================================================
   util.js — 通用工具：DOM、转义、格式化、URL 解析
   所有内部链接都基于 document.baseURI 解析，因此部署到
   GitHub Pages / Cloudflare Pages 的子路径下也能正常工作。
   ========================================================================== */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** HTML 转义，所有来自 JSON 的文本都必须经过它 */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** 引用 SVG 图标精灵 */
export function icon(name, extraClass = '') {
  return `<svg class="icon${extraClass ? ' ' + extraClass : ''}" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;
}

/** 相对站点根目录解析资源地址 */
export function resolve(path) {
  try {
    return new URL(String(path).replace(/^\.\//, ''), document.baseURI).href;
  } catch {
    return String(path);
  }
}

/** 阅读页地址 */
export function viewerHref(item) {
  return resolve(`viewer.html?id=${encodeURIComponent(item.id)}`);
}

/** 文件可读大小（来自 JSON 的字符串，如 "1.4 MB"） */
export function sizeToBytes(text) {
  const m = String(text ?? '').match(/([\d.]+)\s*(B|KB|MB|GB)?/i);
  if (!m) return 0;
  const unit = (m[2] || 'B').toUpperCase();
  const factor = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[unit] || 1;
  return parseFloat(m[1]) * factor;
}

/** 日期显示 */
export function formatDate(value) {
  const s = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s || '—';
}

/** 中文日期（如 2026 年 10 月 5 日） */
export function formatDateLong(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return formatDate(value);
  return `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`;
}

/** 防抖 */
export function debounce(fn, wait = 140) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** 动效偏好 */
export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 小屏（移动端 / 平板竖屏） */
export const isSmallScreen = () => window.matchMedia('(max-width: 860px)').matches;

/** 读取 data/files.json（相对 baseURI，兼容子路径部署） */
export async function loadLibrary() {
  const res = await fetch(resolve('data/files.json'), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`files.json ${res.status}`);
  const data = await res.json();
  return normalizeLibrary(data);
}

const CATEGORY_FALLBACK = '其他';

/** 规范化 JSON 数据：补齐缺省字段、按日期排序、修正分类顺序 */
export function normalizeLibrary(raw) {
  const files = Array.isArray(raw?.files) ? raw.files : [];
  const items = files
    .filter((f) => f && (f.file || f.path))
    .map((f, i) => {
      const file = String(f.file || f.path);
      const id = String(f.id || file.split('/').pop().replace(/\.pdf$/i, '') || `item-${i + 1}`);
      return {
        id,
        title: String(f.title || '未命名资料'),
        titleEn: String(f.titleEn || f.title_en || ''),
        category: String(f.category || CATEGORY_FALLBACK),
        description: String(f.description || ''),
        file,
        size: String(f.size || '—'),
        pages: Number.isFinite(Number(f.pages)) ? Number(f.pages) : null,
        date: formatDate(f.date),
        featured: f.featured === true,
        keywords: Array.isArray(f.keywords) ? f.keywords.map(String) : [],
        bytes: sizeToBytes(f.size),
      };
    });

  // 分类顺序：优先使用 JSON 中声明的顺序，其余按出现顺序追加
  const declared = Array.isArray(raw?.categories) ? raw.categories.map(String) : [];
  const present = [...new Set(items.map((i) => i.category))];
  const ordered = [
    ...declared.filter((c) => c !== '全部资料' && present.includes(c)),
    ...present.filter((c) => !declared.includes(c)),
  ];

  const counts = new Map();
  for (const item of items) counts.set(item.category, (counts.get(item.category) || 0) + 1);

  const latest = items
    .map((i) => i.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .pop() || '';

  return {
    categories: ordered,
    counts,
    items,
    total: items.length,
    latest,
    updatedAt: formatDate(raw?.updatedAt || latest),
  };
}

/** 排序器 */
export const sorters = {
  'date-desc':   (a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh'),
  'date-asc':    (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'zh'),
  'title-asc':   (a, b) => a.title.localeCompare(b.title, 'zh'),
  'pages-desc':  (a, b) => (b.pages || 0) - (a.pages || 0),
  'size-desc':   (a, b) => b.bytes - a.bytes,
};

/** 多关键词匹配：空格分词，全部命中才算匹配 */
export function matches(item, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.title, item.titleEn, item.category, item.description,
    item.keywords.join(' '), item.id,
  ].join(' ').toLowerCase();
  return q.split(/\s+/).every((token) => haystack.includes(token));
}
