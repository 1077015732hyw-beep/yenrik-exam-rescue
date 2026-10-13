/* ==========================================================================
   viewer.js — 阅读页：资料信息 + 按类型分派的在线预览
   支持的类型（由扩展名判定，JSON 里可用 "type" 覆盖）：
     · pdf   → PDF.js，单页翻页 / 缩放 / 适应宽度
     · image → 图片查看（适应宽度 / 缩放）
     · dxf   → 自研二维图纸渲染（js/dxf-view.js）
     · stl   → 自研三维模型渲染（js/stl-view.js）
     · 其它（dwg/step/office/压缩包…）→ 明确提示 + 醒目的下载入口
   所有类型都在用户点击/进入后才加载文件，且都复用「暂时无法在线预览」兜底。
   ========================================================================== */

import { $, $$, esc, icon, resolve, loadLibrary, formatDateLong, isSmallScreen, debounce } from './util.js';
import { getProgress, saveProgress } from './progress.js';
import { fileType, unsupportedHint } from './filetypes.js';
import { createDxfView } from './dxf-view.js';
import { createStlView } from './stl-view.js';

/* PDF.js 本地优先、CDN 兜底；cmaps/字体等非常用资源按需从 CDN 取。
   本地文件刻意使用 .js 后缀：静态托管（如 GitHub Pages）对 .mjs 的 MIME
   处理并不一致，而 .js 一定以 application/javascript 返回，ES Module 才不会被拦。 */
const PDFJS_LOCAL   = { lib: 'vendor/pdfjs/pdf.js', worker: 'vendor/pdfjs/pdf.worker.js' };
const PDFJS_CDN     = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
const LOAD_TIMEOUT  = 25000;
const ZOOM_STEP     = 0.15;
const ZOOM_MIN      = 0.25;
const ZOOM_MAX      = 4;

const el = {
  title:       $('[data-doc-title]'),
  copyLink:    $('[data-copy-link]'),
  copyLinkText:$('[data-copy-link-text]'),
  hint:        $('[data-hint]'),
  stage:       $('[data-stage]'),
  image:       $('[data-image]'),
  coverIcon:   $('[data-cover-icon]'),
  coverType:   $('[data-cover-type]'),
  wireframe:   $('[data-wireframe]'),
  resetView:   $('[data-reset-view]'),
  cat:         $('[data-doc-cat]'),
  catText:     $('[data-doc-cat-text]'),
  catDot:      $('[data-doc-dot]'),
  cover:       $('[data-cover]'),
  coverTitle:  $('[data-cover-title]'),
  coverLatin:  $('[data-cover-latin]'),
  coverDesc:   $('[data-cover-desc]'),
  meta:        $('[data-meta]'),
  tags:        $('[data-tags]'),
  related:     $('[data-related]'),
  relatedList: $('[data-related-list]'),
  panel:       $('[data-panel]'),
  panelToggle: $('[data-panel-toggle]'),
  panelToggleText: $('[data-panel-toggle-text]'),
  reader:      $('[data-reader]'),
  stage:       $('[data-stage]'),
  canvas:      $('[data-canvas]'),
  bar:         $('.reader__bar'),
  progress:    $('[data-progress]'),
  progressBar: $('[data-progress] i'),
  status:      $('[data-status]'),
  loadingHint: $('[data-loading-hint]'),
  errorHint:   $('[data-error-hint]'),
  overlayStart:   $('[data-overlay-start]'),
  overlayLoading: $('[data-overlay-loading]'),
  overlayError:   $('[data-overlay-error]'),
  pageInput:   $('[data-page-input]'),
  pageTotal:   $('[data-page-total]'),
  zoomLabel:   $('[data-zoom-label]'),
  prev:        $('[data-prev]'),
  next:        $('[data-next]'),
  zoomIn:      $('[data-zoom-in]'),
  zoomOut:     $('[data-zoom-out]'),
  fit:         $('[data-fit]'),
  fullscreen:  $('[data-fullscreen]'),
  retry:       $('[data-retry]'),
};

const state = {
  item: null,
  library: null,
  pdf: null,
  pdfjs: null,
  page: 1,
  scale: 1,
  fitWidth: true,
  task: null,
  renderToken: 0,
  started: false,
  loading: false,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  // 手机端首次渲染时提示「左右滑动翻页」
  swipeHint: window.matchMedia('(max-width: 860px)').matches,
  swipeHintShown: false,
  resumeChecked: false,
  type: null,          // filetypes.js 判定出的类型
  mode: 'pdf',         // 预览方式：pdf / image / dxf / stl / none
  view: null,          // dxf / stl 渲染器实例
  imageScale: 1,       // 图片缩放（1 = 适应宽度）
};

const stagePadding = () => (isSmallScreen() ? 24 : 48);

/* ============================ 覆盖层状态 ============================ */
function showOverlay(which) {
  el.overlayStart.hidden   = which !== 'start';
  el.overlayLoading.hidden = which !== 'loading';
  el.overlayError.hidden   = which !== 'error';
  if (which !== 'start') el.overlayStart.hidden = true;
}

function showError({ title, hint } = {}) {
  if (title) el.overlayError.querySelector('h2').textContent = title;
  if (hint) el.errorHint.textContent = hint;
  if (el.retry) el.retry.hidden = false;
  el.overlayError.querySelector('[data-download]').hidden = !state.item;
  showOverlay('error');
  setStatus('加载失败');
  setProgress(0, { done: true });
  setControlsEnabled(false);
}

let hintTimer = 0;

/** 通用浮层提示：可带一个操作按钮 */
function showHint(html, { action = false, duration = 3200 } = {}) {
  const hint = el.hint;
  if (!hint) return;
  hint.innerHTML = html;
  hint.classList.toggle('reader__hint--action', action);
  hint.hidden = false;
  requestAnimationFrame(() => hint.classList.add('is-on'));
  clearTimeout(hintTimer);
  hintTimer = setTimeout(hideSwipeHint, duration);
}

/** 手机端首次进入时提示「左右滑动翻页」 */
function showSwipeHint() {
  if (state.swipeHintShown) return;
  state.swipeHintShown = true;
  showHint('← 左右滑动翻页 →', { duration: 3200 });
}

/** 上次读过：提供「继续阅读」入口 */
function showResumeHint(entry) {
  showHint(
    `<span>上次读到第 ${entry.page} 页</span>` +
    `<button class="btn btn--solid" type="button" data-resume="${entry.page}">继续阅读</button>`,
    { action: true, duration: 9000 },
  );
}

function hideSwipeHint() {
  clearTimeout(hintTimer);
  const hint = el.hint;
  if (!hint || hint.hidden) return;
  hint.classList.remove('is-on');
  setTimeout(() => { hint.hidden = true; hint.innerHTML = ''; }, 360);
}

function setStatus(text) {
  if (el.status) el.status.textContent = text;
}

function setProgress(ratio, { done = false } = {}) {
  if (!el.progress) return;
  if (done) {
    el.progress.classList.add('is-done');
    el.progressBar.style.width = '100%';
    return;
  }
  el.progress.classList.remove('is-done');
  el.progressBar.style.width = `${Math.max(3, Math.min(100, ratio * 100)).toFixed(1)}%`;
}

const ALL_CONTROLS = () => [el.prev, el.next, el.pageInput, el.zoomIn, el.zoomOut,
  el.fit, el.fullscreen, el.wireframe, el.resetView];

function setControlsEnabled(on) {
  const perMode = {
    pdf:   [el.prev, el.next, el.pageInput, el.zoomIn, el.zoomOut, el.fit, el.fullscreen],
    image: [el.zoomIn, el.zoomOut, el.fit, el.fullscreen],
    dxf:   [el.zoomIn, el.zoomOut, el.fit, el.fullscreen],
    stl:   [el.zoomIn, el.zoomOut, el.fit, el.fullscreen, el.wireframe, el.resetView],
    none:  [el.fullscreen],
  };
  ALL_CONTROLS().forEach((node) => { if (node) node.disabled = true; });
  if (on) (perMode[state.mode] || perMode.pdf).forEach((node) => { if (node) node.disabled = false; });
  updatePager();
}

/** 按预览方式显示/隐藏工具栏分组 */
function applyMode(mode) {
  state.mode = mode;
  $$('[data-group="pages"]').forEach((node) => { node.hidden = mode !== 'pdf'; });
  $$('[data-group="zoom"]').forEach((node) => { node.hidden = mode === 'none'; });
  $$('[data-group="three"]').forEach((node) => { node.hidden = mode !== 'stl'; });
  el.stage?.classList.toggle('is-fixed', mode === 'dxf' || mode === 'stl');
  el.fit?.setAttribute('aria-label', mode === 'stl' ? '重置视角' : '适应宽度');
  document.body.dataset.readerMode = mode || 'none';
}

/* ============================ 信息面板 ============================ */
function renderInfo(item, library) {
  document.title = `${item.title} · 阅读 · 拾卷`;

  el.title.textContent = item.title;
  el.coverTitle.textContent = item.title;
  el.coverLatin.textContent = item.titleEn || '';
  el.coverDesc.textContent = item.description || '暂无简介。';
  el.cover.dataset.cat = item.category;

  const type = state.type || fileType(item.file, item.type);
  state.type = type;
  if (el.coverType) el.coverType.textContent = type.name;
  el.coverIcon?.setAttribute('href', `assets/icons.svg#${type.icon}`);
  // 按钮文案随类型变化（不是 PDF 就不说「下载 PDF」）
  const downloadLabel = type.preview === 'pdf' ? '下载 PDF' : '下载原件';
  const readLabel = type.preview === 'pdf' ? '在线阅读' : (type.preview ? '在线查看' : '在线预览不可用');
  $$('[data-download], [data-doc-download], [data-panel-download]').forEach((a) => {
    const span = a.querySelector('span');
    if (span) span.textContent = downloadLabel;
    else if (a.classList.contains('btn')) a.textContent = downloadLabel;
  });
  $$('[data-read-now]').forEach((btn) => {
    const span = btn.querySelector('span');
    if (span) span.textContent = readLabel;
  });

  if (el.catText) el.catText.textContent = item.category;
  if (el.catDot) el.catDot.dataset.cat = item.category;
  if (el.cat) el.cat.hidden = false;

  const fileUrl = resolve(item.file);
  const suggested = `${item.title}${item.titleEn ? ' - ' + item.titleEn : ''}.pdf`;
  $$('[data-download], [data-doc-download], [data-panel-download]').forEach((a) => {
    a.href = fileUrl;
    a.setAttribute('download', suggested);
  });

  const rows = type.preview === 'pdf'
    ? [
      ['学科分类', item.category],
      ['文件大小', item.size],
      ['页数', item.pages ? `${item.pages} 页` : '—', '', 'pages'],
      ['更新时间', item.date, formatDateLong(item.date)],
      ['资料编号', item.id, '', 'full'],
      ['文件路径', item.file.replace(/^\.\//, ''), '', 'full'],
    ]
    : [
      ['学科分类', item.category],
      ['文件大小', item.size],
      ['文件类型', type.label + (type.ext ? `（.${type.ext}）` : ''), '', 'pages'],
      ['在线预览', type.preview ? '支持' : '暂不支持，可下载', '', 'pages'],
      ['资料编号', item.id, '', 'full'],
      ['文件路径', item.file.replace(/^\.\//, ''), '', 'full'],
    ];
  el.meta.innerHTML = rows
    .map(([k, v, title, flag]) => {
      const cls = flag === 'full' ? ' class="meta-table__full"' : '';
      const mark = flag === 'pages' ? ' data-meta-pages' : '';
      return `<div${cls}${mark}><dt>${esc(k)}</dt><dd title="${esc(title || v)}">${esc(v)}</dd></div>`;
    })
    .join('');

  el.tags.innerHTML = (item.keywords || [])
    .map((k) => `<span class="chip chip--plain">${esc(k)}</span>`)
    .join('');

  const related = library.items
    .filter((other) => other.category === item.category && other.id !== item.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);
  if (related.length) {
    el.related.hidden = false;
    el.relatedList.innerHTML = related
      .map((other) => `
        <a class="related__item" href="viewer.html?id=${encodeURIComponent(other.id)}">
          ${icon('i-file')}
          <span class="related__text">
            <strong>${esc(other.title)}</strong>
            <span>${esc(other.size)} · ${other.pages && fileType(other.file, other.type).preview === 'pdf'
              ? esc(other.pages) + ' 页'
              : esc(fileType(other.file, other.type).label)}</span>
          </span>
        </a>`)
      .join('');
  }
}

/* ============================ 加载 PDF ============================ */
async function loadPdfjs() {
  try {
    const lib = await import(resolve(PDFJS_LOCAL.lib));
    lib.GlobalWorkerOptions.workerSrc = resolve(PDFJS_LOCAL.worker);
    return { lib, source: 'local' };
  } catch (localError) {
    console.warn('[viewer] 本地 PDF.js 不可用，改用 CDN：', localError);
    const lib = await import(/* @vite-ignore */ PDFJS_CDN + 'pdf.mjs');
    lib.GlobalWorkerOptions.workerSrc = PDFJS_CDN + 'pdf.worker.mjs';
    return { lib, source: 'cdn' };
  }
}

/** 按类型分派：进入阅读页后/点击「在线阅读」时调用 */
async function startPreview({ force = false } = {}) {
  const type = state.type || fileType(state.item?.file, state.item?.type);
  applyMode(type.preview);
  switch (type.preview) {
    case 'pdf':   return startPdf({ force });
    case 'image': return startImage();
    case 'dxf':   return startDxf();
    case 'stl':   return startStl();
    default:      return showUnsupported(type);
  }
}

/* ---------------- 图片预览 ---------------- */
function applyImageScale() {
  const img = el.image;
  if (!img || !img.naturalWidth) return;
  const fit = Math.min(1, (el.stage.clientWidth - 48) / img.naturalWidth);
  const width = Math.round(img.naturalWidth * fit * state.imageScale);
  img.style.maxWidth = 'none';
  img.style.width = `${width}px`;
}

function startImage() {
  const img = el.image;
  const url = resolve(state.item.file);
  showOverlay('loading');
  setProgress(0.3);
  img.hidden = false;
  el.canvas.hidden = true;
  img.onload = () => {
    state.imageScale = 1;
    applyImageScale();
    showOverlay('none');
    setProgress(1, { done: true });
    setStatus(`${img.naturalWidth} × ${img.naturalHeight} 像素`);
    setControlsEnabled(true);
    document.body.classList.add('is-reading');
  };
  img.onerror = () => showError({
    title: '暂时无法在线预览',
    hint: '图片加载失败，可能文件缺失或格式不被浏览器支持。可以下载原件后用本地软件打开。',
  });
  img.src = url;
}

function zoomImage(factor) {
  state.imageScale = Math.max(0.2, Math.min(6, state.imageScale * factor));
  applyImageScale();
  setStatus(`缩放 ${(state.imageScale * 100).toFixed(0)}%`);
}

/* ---------------- DXF 图纸预览 ---------------- */
async function startDxf() {
  showOverlay('loading');
  setProgress(0.25);
  el.canvas.hidden = false;
  el.image.hidden = true;
  try {
    if (!state.view) state.view = createDxfView(el.canvas, { onStatus: (t) => setStatus(t) });
    const info = await state.view.load(resolve(state.item.file));
    showOverlay('none');
    setProgress(1, { done: true });
    setStatus(`${info.primitives} 个图元 · ${info.layers} 个图层${info.skipped ? ` · 跳过 ${info.skipped} 个实体` : ''}`);
    setControlsEnabled(true);
    document.body.classList.add('is-reading');
  } catch (error) {
    console.error('[viewer] DXF 渲染失败：', error);
    showError({
      title: '暂时无法在线预览',
      hint: '这张图纸没能解析成功。可能是 DXF 版本较新、或包含大量暂不支持的实体（如 SPLINE、HATCH）。'
        + '可以下载后用 CAD 打开，或请馆长另存一份 PDF。',
    });
  }
}

/* ---------------- STL 三维预览 ---------------- */
async function startStl() {
  showOverlay('loading');
  setProgress(0.25);
  el.canvas.hidden = false;
  el.image.hidden = true;
  try {
    if (!state.view) {
      state.view = createStlView(el.canvas, {
        onStatus: (t) => setStatus(t),
        prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
    }
    const info = await state.view.load(resolve(state.item.file));
    showOverlay('none');
    setProgress(1, { done: true });
    setStatus(`${info.triangles.toLocaleString()} 个三角面 · 拖拽旋转`);
    setControlsEnabled(true);
    document.body.classList.add('is-reading');
  } catch (error) {
    console.error('[viewer] STL 渲染失败：', error);
    showError({
      title: '暂时无法在线预览',
      hint: '这个模型没能解析成功（支持二进制与 ASCII 的 STL）。可以下载后用建模软件打开。',
    });
  }
}

/* ---------------- 不支持在线预览的类型 ---------------- */
function showUnsupported(type) {
  applyMode('none');
  showOverlay('error');
  el.overlayError.querySelector('h2').textContent = '暂时无法在线预览';
  el.errorHint.textContent = unsupportedHint(type);
  if (el.retry) el.retry.hidden = true;              // 重试没有意义
  el.overlayError.querySelector('[data-download]').hidden = false;
  setStatus(`${type.label} · 仅提供下载`);
  setProgress(0, { done: true });
  setControlsEnabled(false);
}

async function startPdf({ force = false } = {}) {
  if (state.loading) return;
  if (state.pdf && !force) return;
  if (!state.item) return;

  state.loading = true;
  state.started = true;
  applyMode('pdf');
  el.image.hidden = true;
  el.canvas.hidden = false;
  showOverlay('loading');
  setProgress(0.04);
  setStatus('加载中…');
  el.loadingHint.textContent = '正在加载 PDF 阅读组件…';

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT));

  try {
    if (!state.pdfjs || force) {
      state.pdfjs = await Promise.race([loadPdfjs(), timeout]);
    }
    const { lib } = state.pdfjs;

    el.loadingHint.textContent = '正在读取 PDF 文件…';
    setProgress(0.12);

    if (state.pdf && force) {
      try { await state.pdf.destroy(); } catch { /* 忽略 */ }
      state.pdf = null;
    }

    const fileUrl = resolve(state.item.file);
    const task = lib.getDocument({
      url: fileUrl,
      // 禁用分段（Range）请求：一次取回整份文件，Service Worker 才能缓存它，
      // 朋友看过一次之后就能离线翻。学习资料通常不到 1 MB，代价可以忽略。
      disableRange: true,
      cMapUrl: PDFJS_CDN + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: PDFJS_CDN + 'standard_fonts/',
      withCredentials: false,
    });
    task.onProgress = ({ loaded, total }) => {
      if (!total) return;
      setProgress(0.12 + (loaded / total) * 0.78);
    };

    state.pdf = await Promise.race([task.promise, timeout]);
    state.loading = false;
    syncPageCount();          // JSON 里没写页数（例如手改 files.json）时用 PDF.js 的真实值补上

    el.pageTotal.textContent = state.pdf.numPages;
    el.pageInput.max = state.pdf.numPages;
    setControlsEnabled(true);

    const hashPage = Number((location.hash.match(/page=(\d+)/) || [])[1]);
    const startPage = Number.isInteger(hashPage) && hashPage >= 1 && hashPage <= state.pdf.numPages ? hashPage : 1;

    await renderPage(startPage, { scrollTop: true });
    setProgress(1, { done: true });   // 状态栏文案由 renderPage 统一负责（含首次滑动提示）
    document.body.classList.add('is-reading');
    if (isSmallScreen()) togglePanel(false);
  } catch (error) {
    state.loading = false;
    console.error('[viewer] PDF 加载失败：', error);
    const offline = !navigator.onLine;
    showError({
      title: '暂时无法在线预览',
      hint: offline
        ? '当前网络似乎不可用，因此无法在线渲染。你仍然可以下载这份 PDF，用本地阅读器打开。'
        : '可能是文件缺失、路径不正确，或该 PDF 无法在线渲染。请下载原文后用本地阅读器打开。',
    });
  }
}

/* ============================ 渲染单页 ============================ */
async function renderPage(num, { scrollTop = false } = {}) {
  if (!state.pdf) return;
  const pageNumber = Math.max(1, Math.min(state.pdf.numPages, num));
  const token = ++state.renderToken;

  if (state.task) {
    try { state.task.cancel(); } catch { /* 忽略 */ }
    state.task = null;
  }

  const page = await state.pdf.getPage(pageNumber);
  if (token !== state.renderToken) return;

  const base = page.getViewport({ scale: 1 });
  const availW = Math.max(160, el.stage.clientWidth - stagePadding());

  let scale = state.scale;
  if (state.fitWidth) {
    // 适应宽度：以可视区域宽度为准，页面过高时纵向滚动
    scale = Math.min(availW / base.width, ZOOM_MAX);
    state.scale = scale;
  }

  const viewport = page.getViewport({ scale });
  const canvas = el.canvas;
  const ctx = canvas.getContext('2d', { alpha: false });

  canvas.hidden = false;
  canvas.width = Math.floor(viewport.width * state.dpr);
  canvas.height = Math.floor(viewport.height * state.dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const task = page.render({
    canvasContext: ctx,
    viewport,
    transform: state.dpr !== 1 ? [state.dpr, 0, 0, state.dpr, 0, 0] : undefined,
  });
  state.task = task;

  try {
    await task.promise;
  } catch (error) {
    if (error?.name === 'RenderingCancelledException') return;
    throw error;
  }
  if (token !== state.renderToken) return;

  state.page = pageNumber;
  state.task = null;
  showOverlay('none');
  updatePager();
  updateZoomLabel();
  setStatus(`第 ${pageNumber} / ${state.pdf.numPages} 页`);
  rememberProgress(pageNumber);

  if (!state.resumeChecked) {
    state.resumeChecked = true;
    const saved = getProgress(state.item?.id);
    if (saved && saved.page > 1 && saved.page <= state.pdf.numPages && saved.page !== pageNumber) {
      showResumeHint(saved);
      return;                       // 有上次进度时优先提示「继续阅读」
    }
  }
  if (state.swipeHint && pageNumber === 1) showSwipeHint();
  if (scrollTop) el.stage.scrollTop = 0;
  syncHash();
}

/** 这份文件是否已被 Service Worker 缓存（离线可读） */
async function isFileCached(url) {
  if (!('caches' in window)) return false;
  try {
    return Boolean(await caches.match(url));
  } catch {
    return false;
  }
}

/** 离线且没缓存过时的提示 */
function showOfflineStart() {
  const h2 = el.overlayStart.querySelector('h2');
  const p = el.overlayStart.querySelector('p');
  const readBtn = el.overlayStart.querySelector('[data-read-now]');
  if (h2) h2.textContent = '离线状态，这份资料还没缓存';
  if (p) p.textContent = '联网后打开一次，之后就能离线翻。现在也可以先下载原文，或等有网再看。';
  if (readBtn) readBtn.hidden = true;
  showOverlay('start');
  setStatus('当前离线');
  setControlsEnabled(false);
}

/** 用 PDF.js 实测页数回填元信息（data/files.json 里 pages 缺失或不准时自动纠正） */
function syncPageCount() {
  if (state.mode !== 'pdf') return;
  const cell = el.meta?.querySelector('[data-meta-pages] dd');
  if (!cell || !state.pdf) return;
  const text = `${state.pdf.numPages} 页`;
  if (cell.textContent.trim() === text) return;
  cell.textContent = text;
  cell.title = text;
}

function updatePager() {
  if (!el.pageInput) return;
  el.pageInput.value = String(state.page);
  if (state.pdf) el.pageTotal.textContent = state.pdf.numPages;
  if (el.prev) el.prev.disabled = !state.pdf || state.page <= 1;
  if (el.next) el.next.disabled = !state.pdf || state.page >= (state.pdf?.numPages || 1);
}

function updateZoomLabel() {
  if (!el.zoomLabel) return;
  el.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
  if (el.fit) el.fit.setAttribute('aria-pressed', String(state.fitWidth));
}

const syncHash = debounce(() => {
  if (!state.pdf) return;
  const url = `${location.pathname}${location.search}#page=${state.page}`;
  history.replaceState(null, '', url);
}, 400);

/* ============================ 交互绑定 ============================ */
const rememberProgress = debounce((page) => {
  if (!state.item || !state.pdf || state.mode !== 'pdf') return;
  saveProgress(state.item.id, page, state.pdf.numPages);
}, 500);

/** 复制带页码的分享链接（发给朋友/群里） */
async function copyShareLink() {
  const url = `${location.origin}${location.pathname}${location.search}#page=${state.page}`;
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch {
    try {
      const box = document.createElement('textarea');
      box.value = url;
      box.setAttribute('readonly', '');
      box.style.cssText = 'position:absolute;left:-9999px';
      document.body.appendChild(box);
      box.select();
      ok = document.execCommand('copy');
      box.remove();
    } catch { ok = false; }
  }
  if (!el.copyLinkText) return;
  const original = el.copyLinkText.dataset.original || el.copyLinkText.textContent;
  el.copyLinkText.dataset.original = original;
  el.copyLinkText.textContent = ok ? '已复制链接' : '复制失败';
  el.copyLink?.classList.toggle('is-done', ok);
  setTimeout(() => {
    el.copyLinkText.textContent = original;
    el.copyLink?.classList.remove('is-done');
  }, 1800);
}

function go(delta) {
  if (!state.pdf) return;
  hideSwipeHint();
  const next = state.page + delta;
  if (next < 1 || next > state.pdf.numPages) return;
  renderPage(next, { scrollTop: true }).catch(handleRenderError);
}

function zoom(delta) {
  const factor = delta > 0 ? 1.15 : 1 / 1.15;
  if (state.mode === 'image') return zoomImage(factor);
  if (state.mode === 'dxf' || state.mode === 'stl') {
    state.view?.zoomBy(factor);
    return;
  }
  if (!state.pdf) return;
  state.fitWidth = false;
  state.scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.scale + delta));
  renderPage(state.page).catch(handleRenderError);
}

function fitWidth() {
  if (state.mode === 'image') {
    state.imageScale = 1;
    applyImageScale();
    setStatus('适应宽度');
    return;
  }
  if (state.mode === 'dxf') { state.view?.fit(); return; }
  if (state.mode === 'stl') { state.view?.resetView(); setStatus('已重置视角'); return; }
  if (!state.pdf) return;
  state.fitWidth = true;
  renderPage(state.page).catch(handleRenderError);
}

function handleRenderError(error) {
  if (error?.name === 'RenderingCancelledException') return;
  console.error('[viewer] 渲染失败：', error);
  showError({
    title: '暂时无法在线预览',
    hint: '这一页渲染失败了，可以点击下方按钮在线重试，或直接下载原文。',
  });
}

function bindControls() {
  el.prev?.addEventListener('click', () => go(-1));
  el.next?.addEventListener('click', () => go(1));
  el.zoomIn?.addEventListener('click', () => zoom(ZOOM_STEP));
  el.zoomOut?.addEventListener('click', () => zoom(-ZOOM_STEP));
  el.fit?.addEventListener('click', fitWidth);
  el.retry?.addEventListener('click', () => startPreview({ force: true }));
  el.wireframe?.addEventListener('click', () => {
    if (state.mode !== 'stl' || !state.view) return;
    const next = !state.view.getWireframe();
    state.view.setWireframe(next);
    el.wireframe.setAttribute('aria-pressed', String(next));
    setStatus(next ? '线框模式' : '实体模式');
  });
  el.resetView?.addEventListener('click', () => {
    state.view?.resetView();
    setStatus('已重置视角');
  });
  el.copyLink?.addEventListener('click', copyShareLink);

  // 「继续阅读」按钮由提示浮层动态生成
  el.hint?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-resume]');
    if (!btn) return;
    const page = Number(btn.dataset.resume);
    hideSwipeHint();
    if (Number.isFinite(page)) renderPage(page, { scrollTop: true }).catch(handleRenderError);
  });

  el.pageInput?.addEventListener('change', () => {
    const value = parseInt(el.pageInput.value, 10);
    if (!Number.isFinite(value)) { updatePager(); return; }
    renderPage(value, { scrollTop: true }).catch(handleRenderError);
  });
  el.pageInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); el.pageInput.blur(); }
  });

  $$('[data-read-now]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isSmallScreen() && el.panel.classList.contains('is-open')) togglePanel(false);
      startPreview();
      el.reader.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  el.fullscreen?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.reader.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    const on = Boolean(document.fullscreenElement);
    el.fullscreen?.setAttribute('aria-pressed', String(on));
    const use = el.fullscreen?.querySelector('use');
    if (use) use.setAttribute('href', on ? 'assets/icons.svg#i-compress' : 'assets/icons.svg#i-expand');
    el.fullscreen?.setAttribute('aria-label', on ? '退出全屏' : '全屏');
    if (state.pdf) renderPage(state.page).catch(() => {});
  });

  // 移动端资料信息折叠
  el.panelToggle?.addEventListener('click', () => togglePanel(!el.panel.classList.contains('is-open')));

  bindGestures();

  // 键盘快捷键
  window.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case 'ArrowRight': case 'PageDown':
        if (state.mode === 'pdf') go(1);
        else if (state.mode === 'image' || state.mode === 'dxf' || state.mode === 'stl') zoom(1);
        break;
      case 'ArrowLeft': case 'PageUp':
        if (state.mode === 'pdf') go(-1);
        else if (state.mode === 'image' || state.mode === 'dxf' || state.mode === 'stl') zoom(-1);
        break;
      case 'Home': if (state.pdf) renderPage(1, { scrollTop: true }).catch(handleRenderError); break;
      case 'End':  if (state.pdf) renderPage(state.pdf.numPages, { scrollTop: true }).catch(handleRenderError); break;
      case '+': case '=': zoom(ZOOM_STEP); break;
      case '-': case '_': zoom(-ZOOM_STEP); break;
      case '0': fitWidth(); break;
      case 'f': case 'F': el.fullscreen?.click(); break;
      default: return;
    }
    event.preventDefault();
  });

  // 尺寸变化：适应宽度模式下重新渲染
  const onResize = debounce(() => {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (state.mode === 'image') { applyImageScale(); return; }
    if (state.mode === 'dxf' || state.mode === 'stl') { state.view?.resize(); return; }
    if (!state.pdf) return;
    if (state.fitWidth) renderPage(state.page).catch(() => {});
  }, 180);
  window.addEventListener('resize', onResize);
  if ('ResizeObserver' in window) {
    let first = true;
    new ResizeObserver(() => { if (first) { first = false; return; } onResize(); }).observe(el.stage);
  }

  window.addEventListener('pagehide', () => {
    if (state.pdf) { try { state.pdf.destroy(); } catch { /* 忽略 */ } }
  });
}

/* 移动端：单指左右滑动翻页（纵向滚动、放大后的横向拖动都不受影响） */
function bindGestures() {
  const stage = el.stage;
  if (!stage) return;

  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let tracking = false;

  stage.addEventListener('touchstart', (event) => {
    tracking = false;
    if (state.mode !== 'pdf' || !state.pdf || event.touches.length !== 1) return;
    // 放大后需要横向拖动查看内容，此时不接管手势
    if (el.canvas.getBoundingClientRect().width > stage.clientWidth * 1.02) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = Date.now();
    tracking = true;
  }, { passive: true });

  stage.addEventListener('touchmove', (event) => {
    if (!tracking) return;
    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dy) > 26 && Math.abs(dy) > Math.abs(dx)) tracking = false; // 判定为纵向滚动
  }, { passive: true });

  stage.addEventListener('touchend', (event) => {
    if (!tracking) return;
    tracking = false;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Date.now() - startTime > 800) return;                 // 慢慢拖动多半是在选中文字
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    go(dx < 0 ? 1 : -1);
  }, { passive: true });

  stage.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });
}

function togglePanel(open) {
  el.panel.classList.toggle('is-open', open);
  el.panelToggle?.setAttribute('aria-expanded', String(open));
  const label = open ? '收起资料信息' : '查看资料信息';
  if (el.panelToggleText) el.panelToggleText.textContent = label;
  el.panelToggle?.setAttribute('aria-label', label);
  // 移动端收起后回到页面顶部（此时面板为 0 高度，阅读器正好占满）
  if (!open && isSmallScreen()) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================ 启动 ============================ */
async function boot() {
  document.querySelector('[data-boot-notice]')?.remove();
  const id = new URLSearchParams(location.search).get('id');

  if (el.pageInput) el.pageInput.disabled = true;
  setControlsEnabled(false);

  let library;
  try {
    library = await loadLibrary();
  } catch (error) {
    console.error('[viewer] 资料索引加载失败：', error);
    showError({
      title: '暂时无法在线预览',
      hint: '无法读取 data/files.json。请通过静态服务器访问本站（例如 python3 -m http.server）。',
    });
    return;
  }
  state.library = library;

  const item = id ? library.items.find((entry) => entry.id === id) : null;
  if (!item) {
    el.title.textContent = '未找到资料';
    el.coverTitle.textContent = '未找到这份资料';
    el.coverDesc.textContent = id
      ? `资料编号「${id}」不在 data/files.json 中，可能已被重命名或移除。`
      : '缺少资料编号参数，请从书架页点击「预览」进入。';
    showError({
      title: '没有找到这份资料',
      hint: '请返回书架重新选择。如果刚更新过 data/files.json，请确认其中的 id 与链接一致。',
    });
    return;
  }

  state.item = item;
  state.type = fileType(item.file, item.type);
  applyMode(state.type.preview);
  renderInfo(item, library);
  bindControls();

  // 已知不支持在线预览的格式：直接给出说明与下载入口，不发任何请求
  if (!state.type.preview) {
    showUnsupported(state.type);
    if (isSmallScreen()) togglePanel(false);
    return;
  }

  // 省流模式 / 离线：不主动发请求；但若这份文件已经缓存过，离线也能直接看
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const saveData = Boolean(conn?.saveData) || /2g/.test(conn?.effectiveType || '');
  if (!navigator.onLine) {
    if (await isFileCached(resolve(item.file))) {
      setStatus('离线查看（本地缓存）');
      startPreview();
    } else {
      showOfflineStart();
    }
  } else if (saveData) {
    showOverlay('start');
    setStatus('省流模式：文件未加载');
    setControlsEnabled(false);
  } else {
    startPreview();
  }

  if (isSmallScreen()) togglePanel(false);
}

boot();
