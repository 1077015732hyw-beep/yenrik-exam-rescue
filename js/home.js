/* ==========================================================================
   home.js — 首页控制器
   载入 data/files.json → 渲染推荐 / 最近加入 / 全部书架 → 分类、排序、搜索
   ========================================================================== */

import { $, esc, debounce, loadLibrary, matches, sorters } from './util.js';
import { cardHTML, ledgerRowHTML, renderFilters, createRevealObserver } from './catalog.js';
import { listProgress } from './progress.js';
import { initHero } from './hero.js';

const ALL = '全部资料';

const el = {
  featured:   $('[data-featured]'),
  recent:     $('[data-recent]'),
  filters:    $('[data-filters]'),
  grid:       $('[data-grid]'),
  empty:      $('[data-empty]'),
  emptyHint:  $('[data-empty-hint]'),
  reset:      $('[data-reset]'),
  count:      $('[data-result-count]'),
  note:       $('[data-shelf-note]'),
  sort:       $('[data-sort]'),
  searchForm: $('[data-search-form]'),
  search:     $('[data-search-input]'),
  searchClear:$('[data-search-clear]'),
  quick:      $('[data-quick-cats]'),
  statTotal:  $('[data-stat-total]'),
  statCats:   $('[data-stat-cats]'),
  statUpdated:$('[data-stat-updated]'),
};

const state = { category: ALL, q: '', sort: 'date-desc' };
let library = null;
let reveal = null;
let filters = null;

const SORT_LABELS = {
  'date-desc': '最新入库',
  'date-asc': '最早入库',
  'title-asc': '名称排序',
  'pages-desc': '页数最多',
  'size-desc': '文件最大',
};

/* ---------- URL 状态同步 ---------- */
function readStateFromURL() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  const sort = params.get('sort');
  const category = params.get('category');
  if (q) state.q = q;
  if (sort && SORT_LABELS[sort]) state.sort = sort;
  if (category) state.category = category;
}

function syncURL() {
  const params = new URLSearchParams();
  if (state.category !== ALL) params.set('category', state.category);
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.sort !== 'date-desc') params.set('sort', state.sort);
  const query = params.toString();
  const url = location.pathname + (query ? `?${query}` : '') + location.hash;
  history.replaceState(null, '', url);
}

/* ---------- 数据筛选 ---------- */
function visibleItems() {
  const filtered = library.items.filter(
    (item) => (state.category === ALL || item.category === state.category) && matches(item, state.q),
  );
  return filtered.sort(sorters[state.sort] || sorters['date-desc']);
}

/* ---------- 各区块渲染 ---------- */
function renderHero() {
  if (el.statTotal) el.statTotal.textContent = String(library.total);
  if (el.statCats) el.statCats.textContent = String(library.categories.length);
  if (el.statUpdated) el.statUpdated.textContent = library.latest || '—';

  if (!el.quick) return;
  const max = 5;
  el.quick.innerHTML = library.categories
    .slice(0, max)
    .map((name) => `<button type="button" data-quick-cat="${esc(name)}">${esc(name)}<span class="mono" style="margin-left:.35rem;color:var(--ink-4)">${library.counts.get(name) || 0}</span></button>`)
    .join('');
  el.quick.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-quick-cat]');
    if (!btn) return;
    setCategory(btn.dataset.quickCat, { scroll: true });
  });
}

function renderFeatured() {
  if (!el.featured) return;
  const byDate = [...library.items].sort(sorters['date-desc']);
  let picks = byDate.filter((item) => item.featured);
  if (picks.length < 4) {
    const rest = byDate.filter((item) => !item.featured);
    picks = [...picks, ...rest.slice(0, 4 - picks.length)];
  }
  picks = picks.slice(0, 4);
  const progress = listProgress();
  el.featured.innerHTML = picks
    .map((item, i) => cardHTML(item, { feature: true, index: i, progress: progress[item.id] }))
    .join('');
}

function renderRecent() {
  if (!el.recent) return;
  const recent = [...library.items].sort(sorters['date-desc']).slice(0, 4);
  el.recent.innerHTML = recent.map(ledgerRowHTML).join('');
}

function renderGrid() {
  const items = visibleItems();
  const query = state.q.trim();
  const progress = listProgress();

  el.grid.innerHTML = items
    .map((item, i) => cardHTML(item, { index: i, reveal: false, progress: progress[item.id] }))
    .join('');

  const isEmpty = items.length === 0;
  el.empty.hidden = !isEmpty;
  if (isEmpty) {
    el.emptyHint.textContent = query
      ? `没有匹配「${query}」的资料，换一个关键词试试，或回到全部资料。`
      : '这个分类暂时还没有资料。';
  }

  if (el.count) el.count.textContent = `显示 ${items.length} / ${library.total} 份`;

  if (el.note) {
    const parts = [`共 ${items.length} 份资料`];
    if (state.category !== ALL) parts.push(`分类：${state.category}`);
    if (query) parts.push(`关键词：${query}`);
    parts.push(`排序：${SORT_LABELS[state.sort]}`);
    el.note.textContent = parts.join(' · ');
  }

  if (reveal) reveal.refresh();
}

/* ---------- 交互 ---------- */
function apply({ scroll = false } = {}) {
  renderGrid();
  if (filters) filters.update(state.category);
  syncURL();
  if (scroll) {
    const target = document.getElementById('library');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function setCategory(name, { scroll = false } = {}) {
  state.category = name;
  apply({ scroll });
}

function bindSearch() {
  if (el.searchForm) {
    el.searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      state.q = el.search.value;
      apply({ scroll: true });
    });
  }
  if (el.search) {
    const onInput = debounce(() => {
      state.q = el.search.value;
      el.searchForm?.classList.toggle('has-value', Boolean(state.q));
      apply();
    }, 160);
    el.search.addEventListener('input', onInput);
    el.search.addEventListener('search', onInput);
  }
  if (el.searchClear) {
    el.searchClear.addEventListener('click', () => {
      el.search.value = '';
      state.q = '';
      el.searchForm?.classList.remove('has-value');
      apply();
      el.search.focus();
    });
  }

  // 快捷键：/ 聚焦搜索，Esc 清空
  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
    if (event.key === '/' && !typing) {
      event.preventDefault();
      el.search?.focus();
      el.search?.select();
    } else if (event.key === 'Escape' && typing && document.activeElement === el.search) {
      el.search.value = '';
      state.q = '';
      el.searchForm?.classList.remove('has-value');
      apply();
      el.search.blur();
    }
  });
}

function bindMisc() {
  if (el.sort) {
    el.sort.value = state.sort;
    el.sort.addEventListener('change', () => {
      state.sort = el.sort.value;
      apply();
    });
  }
  if (el.reset) {
    el.reset.addEventListener('click', () => {
      state.category = ALL;
      state.q = '';
      state.sort = 'date-desc';
      if (el.search) el.search.value = '';
      el.searchForm?.classList.remove('has-value');
      if (el.sort) el.sort.value = state.sort;
      apply();
    });
  }
  // 点击卡片空白处也能进入阅读页
  el.grid?.addEventListener('click', (event) => {
    if (event.target.closest('a, button')) return;
    const card = event.target.closest('.book-card');
    if (!card) return;
    const link = card.querySelector('.book-card__title a');
    if (link) location.assign(link.href);
  });
}

function renderError(error) {
  console.error('[library] 资料索引加载失败：', error);
  if (!el.grid) return;
  el.grid.innerHTML = '';
  el.empty.hidden = false;
  el.empty.querySelector('strong').textContent = '资料索引加载失败';
  el.emptyHint.innerHTML =
    '无法读取 <code>data/files.json</code>。若你是直接双击打开 HTML 文件，请改用本地静态服务器预览（例如 <code>python3 -m http.server</code>）。';
  const reset = el.empty.querySelector('[data-reset]');
  if (reset) {
    reset.addEventListener('click', () => location.reload());
    reset.lastChild.textContent = ' 重新载入';
  }
}

/* ---------- 启动 ---------- */
async function boot() {
  document.querySelector('[data-boot-notice]')?.remove();
  initHero();
  bindSearch();
  bindMisc();

  try {
    library = await loadLibrary();
  } catch (error) {
    renderError(error);
    return;
  }

  readStateFromURL();
  if (state.category !== ALL && !library.categories.includes(state.category)) {
    state.category = ALL;
  }
  if (el.search && state.q) {
    el.search.value = state.q;
    el.searchForm?.classList.add('has-value');
  }

  reveal = createRevealObserver();
  renderHero();
  renderFeatured();
  renderRecent();
  // 从阅读页返回（含 bfcache 恢复）时刷新进度显示
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) apply();   // 从阅读页返回时立刻刷新「读到第几页」
  });
  filters = renderFilters(el.filters, library, state.category, (name) => setCategory(name));
  apply();
}

boot();
