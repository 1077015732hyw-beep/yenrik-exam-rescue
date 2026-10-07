/* ==========================================================================
   catalog.js — 资料卡 / 台账 / 分类导航的渲染模板
   只负责把数据变成 HTML，不持有状态。
   ========================================================================== */

import { esc, icon, viewerHref, resolve } from './util.js';
import { progressLabel, progressPercent } from './progress.js';

const dot = (cat) => `<i class="dot" data-cat="${esc(cat)}"></i>`;

/** 单份资料卡（数字书籍） */
export function cardHTML(item, { feature = false, index = 0, reveal = true, progress = null } = {}) {
  const href = viewerHref(item);
  const download = resolve(item.file);
  const label = progress ? progressLabel(progress) : '';
  const percent = progress ? progressPercent(progress) : 0;
  const delay = Math.min(index * 45, 320);
  // 书架网格在筛选/搜索时会反复重绘，直接静态呈现，避免闪烁；
  // 首页首屏的推荐区使用错峰入场。
  return `
  <article class="book-card${feature ? ' book-card--feature' : ''}${reveal ? ' reveal' : ''}" data-cat="${esc(item.category)}"
           data-id="${esc(item.id)}" style="--reveal-delay:${delay}ms">
    <div class="book-card__cover">
      <div class="book-card__top">
        <span class="book-card__glyph">${icon('i-pdf')} PDF</span>
        <span class="book-card__cat">${dot(item.category)}${esc(item.category)}</span>
      </div>
      <h3 class="book-card__title">
        <a href="${href}">${esc(item.title)}</a>
      </h3>
      ${item.titleEn ? `<span class="book-card__latin">${esc(item.titleEn)}</span>` : ''}
      ${item.featured ? '<span class="badge">推荐</span>' : ''}
    </div>
    <div class="book-card__body">
      <p class="book-card__desc">${esc(item.description)}</p>
      ${progress ? `<p class="book-card__progress" title="上次阅读位置">
        <i style="--p:${percent}%"></i><span>${esc(label)}</span></p>` : ''}
      <dl class="book-card__meta">
        <div><dt>文件大小</dt><dd>${esc(item.size)}</dd></div>
        <div><dt>页数</dt><dd>${item.pages ? esc(item.pages) + ' 页' : '—'}</dd></div>
        <div><dt>更新时间</dt><dd>${esc(item.date)}</dd></div>
      </dl>
    </div>
    <div class="book-card__actions">
      <a class="btn btn--ghost" href="${href}">${icon(progress ? 'i-bookmark' : 'i-eye')} ${progress ? '继续阅读' : '预览'}</a>
      <a class="btn btn--solid" href="${download}" download>${icon('i-download')} 下载</a>
    </div>
  </article>`;
}

/** 最近加入的台账行 */
export function ledgerRowHTML(item) {
  const href = viewerHref(item);
  const meta = [item.date, item.size, item.pages ? `${item.pages} 页` : ''].filter(Boolean).join(' · ');
  return `
  <a class="ledger__row" href="${href}" data-meta="${esc(meta)}">
    <span class="ledger__date">${esc(item.date)}</span>
    <span class="ledger__main">
      <span class="ledger__title serif">${esc(item.title)}</span>
      <span class="ledger__sub">${dot(item.category)}${esc(item.category)}${
        item.titleEn ? ` · <span class="mono">${esc(item.titleEn)}</span>` : ''
      }</span>
    </span>
    <span class="ledger__cell">${esc(item.size)}</span>
    <span class="ledger__cell">${item.pages ? esc(item.pages) + ' 页' : '—'}</span>
    <span class="ledger__go">${icon('i-chevron-right')}</span>
  </a>`;
}

/** 分类导航（书架分区） */
export function renderFilters(el, library, active, onSelect) {
  const tabs = [
    { name: '全部资料', count: library.total },
    ...library.categories.map((c) => ({ name: c, count: library.counts.get(c) || 0 })),
  ];
  el.innerHTML = tabs
    .map(({ name, count }) => `
      <button class="filters__tab" type="button" role="tab" data-cat="${esc(name)}"
              aria-selected="${name === active}" tabindex="${name === active ? '0' : '-1'}">
        ${esc(name)}<span class="count">${count}</span>
      </button>`)
    .join('');

  const buttons = Array.from(el.querySelectorAll('.filters__tab'));

  const select = (name, { focus = false } = {}) => {
    buttons.forEach((b) => {
      const on = b.dataset.cat === name;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
      if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    onSelect(name);
  };

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.filters__tab');
    if (btn) select(btn.dataset.cat);
  });

  el.addEventListener('keydown', (e) => {
    const idx = buttons.indexOf(document.activeElement);
    if (idx < 0) return;
    let next = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % buttons.length;
    if (e.key === 'ArrowLeft')  next = (idx - 1 + buttons.length) % buttons.length;
    if (e.key === 'Home')       next = 0;
    if (e.key === 'End')        next = buttons.length - 1;
    if (next === null) return;
    e.preventDefault();
    select(buttons[next].dataset.cat, { focus: true });
  });

  return {
    update: (name) => {
      buttons.forEach((b) => {
        const on = b.dataset.cat === name;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      });
    },
  };
}

/** 交替展示的入场动画观察器 */
export function createRevealObserver(root = document) {
  const targets = () =>
    Array.from(root.querySelectorAll('.reveal:not(.is-in)'));
  if (!('IntersectionObserver' in window)) {
    targets().forEach((el) => el.classList.add('is-in'));
    return { refresh() {} };
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  const refresh = () => targets().forEach((el) => io.observe(el));
  refresh();
  return { refresh };
}
