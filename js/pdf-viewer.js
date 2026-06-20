/**
 * pdf-viewer.js — PDF Viewer
 * Features: CDN fallback, keyboard nav, reading progress, dark invert
 */

const PDFJS_SOURCES = [
  {
    main: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs",
    worker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs",
  },
  {
    main: "https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.min.mjs",
    worker: "https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs",
  },
];

let pdfjsLib = null;
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let currentScale = 1.3;
let isRendering = false;
let pendingPage = null;
let isInverted = false;

const STORAGE_KEYS = {
  readingProgress: "ya-reading-progress",
};

export function initPdfViewer({ subjects, resources }) {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const resource = resources.find((item) => item.id === id);
  const subject = subjects.find((item) => item.id === resource?.subject);
  const meta = document.querySelector("[data-resource-meta]");
  const viewer = document.querySelector("[data-pdf-viewer]");

  if (!meta || !viewer) return;

  if (!resource) {
    meta.innerHTML = `
      <p class="back-link"><a href="../index.html">← 返回小岛</a></p>
      <h1>资料不见了</h1>
      <p>没有找到这份资料，请从资料馆重新选择。</p>
      <div class="viewer-actions">
        <a class="button primary" href="../index.html">返回小岛</a>
      </div>`;
    viewer.innerHTML = '<div class="empty-state">请从资料馆重新选择资料。</div>';
    return;
  }

  document.title = `${resource.title} | 雁塔提名`;
  const pdfPath = resolvePdfPath(resource.file);

  // Restore reading progress
  const progress = JSON.parse(localStorage.getItem(STORAGE_KEYS.readingProgress) || "null");
  const startPage = (progress && progress.id === id) ? (progress.page || 1) : 1;

  meta.innerHTML = `
    <p class="back-link"><a href="${resolvePagePath(subject?.page)}">← 返回${escapeHtml(subject?.name || "课程")}</a></p>
    <h1>${escapeHtml(resource.title)}</h1>
    <p>${escapeHtml(resource.description)}</p>
    <time datetime="${escapeHtml(resource.updated)}">更新于 ${escapeHtml(resource.updated)}</time>
    ${(resource.tags || []).map((t) => `<span class="resource-tag label">${escapeHtml(t)}</span>`).join(" ")}
    <div class="viewer-actions">
      <a class="button primary" href="${pdfPath}" target="_blank" rel="noopener">新窗口打开</a>
      <a class="button ghost" href="${pdfPath}" download>下载带回</a>
      <button class="button ghost" type="button" data-share-link>复制链接</button>
    </div>`;

  viewer.innerHTML = `
    <div class="pdf-placeholder">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <path d="M14 2v6h6"/>
      </svg>
      <h3>在线翻阅</h3>
      <p>点击下方按钮开始翻阅，支持翻页、缩放和键盘操作。</p>
      ${startPage > 1 ? `<p style="color:var(--primary);font-weight:600;">📖 上次翻到第 ${startPage} 页</p>` : ""}
      <button class="button primary" type="button" data-pdf-start>开始翻阅</button>
    </div>`;

  viewer.querySelector("[data-pdf-start]").addEventListener("click", () => startPdfPreview(pdfPath, viewer, id, startPage));

  // Share link
  const shareBtn = meta.querySelector("[data-share-link]");
  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      const url = window.location.href;
      navigator.clipboard.writeText(url).then(() => {
        shareBtn.textContent = "已复制 ✓";
        setTimeout(() => { shareBtn.textContent = "复制链接"; }, 2000);
      }).catch(() => {});
    });
  }
}

async function startPdfPreview(pdfPath, viewer, resourceId, startPage) {
  viewer.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>正在准备翻阅引擎…</p></div>`;

  try {
    if (!pdfjsLib) pdfjsLib = await loadPdfjs();

    viewer.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>正在取出资料…</p></div>`;

    const loadingTask = pdfjsLib.getDocument(pdfPath);
    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    currentPage = Math.min(startPage || 1, totalPages);

    viewer.innerHTML = `
      <div class="pdf-toolbar">
        <div style="display:flex;gap:4px;">
          <button type="button" data-pdf-prev aria-label="上一页">←</button>
          <button type="button" data-pdf-next aria-label="下一页">→</button>
        </div>
        <span class="pdf-page-info">第 <span data-pdf-current>1</span> / <span data-pdf-total>${totalPages}</span> 页</span>
        <div style="display:flex;gap:4px;">
          <button type="button" data-pdf-zoom-out aria-label="缩小">−</button>
          <button type="button" data-pdf-zoom-in aria-label="放大">+</button>
          <button type="button" data-pdf-invert aria-label="反色" title="暗色反色">◐</button>
        </div>
      </div>
      <div class="pdf-canvas-container" data-pdf-canvas-container></div>`;

    viewer.querySelector("[data-pdf-prev]").addEventListener("click", () => { if (currentPage > 1) { currentPage--; renderPage(resourceId); } });
    viewer.querySelector("[data-pdf-next]").addEventListener("click", () => { if (currentPage < totalPages) { currentPage++; renderPage(resourceId); } });
    viewer.querySelector("[data-pdf-zoom-in]").addEventListener("click", () => { currentScale = Math.min(currentScale + 0.25, 3); renderPage(resourceId); });
    viewer.querySelector("[data-pdf-zoom-out]").addEventListener("click", () => { currentScale = Math.max(currentScale - 0.25, 0.5); renderPage(resourceId); });
    viewer.querySelector("[data-pdf-invert]").addEventListener("click", () => {
      isInverted = !isInverted;
      const container = viewer.querySelector("[data-pdf-canvas-container]");
      if (container) container.classList.toggle("invert", isInverted);
    });

    // Keyboard navigation
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        if (currentPage > 1) { currentPage--; renderPage(resourceId); e.preventDefault(); }
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        if (currentPage < totalPages) { currentPage++; renderPage(resourceId); e.preventDefault(); }
      }
    });

    await renderPage(resourceId);
  } catch (err) {
    console.error("PDF preview error:", err);
    viewer.innerHTML = `
      <div class="pdf-placeholder">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
        </svg>
        <h3>翻阅不可用</h3>
        <p>可能是网络问题导致引擎加载失败，你可以直接下载带回查看。</p>
        <a class="button primary" href="${pdfPath}" download>下载带回</a>
      </div>`;
  }
}

async function renderPage(resourceId) {
  if (isRendering) { pendingPage = currentPage; return; }
  isRendering = true;

  const container = document.querySelector("[data-pdf-canvas-container]");
  const currentEl = document.querySelector("[data-pdf-current]");
  if (!container || !pdfDoc) { isRendering = false; return; }

  if (currentEl) currentEl.textContent = currentPage;
  const prevBtn = document.querySelector("[data-pdf-prev]");
  const nextBtn = document.querySelector("[data-pdf-next]");
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

  container.innerHTML = '<div class="spinner" style="margin:40px auto;"></div>';

  try {
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: currentScale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    container.innerHTML = "";
    container.appendChild(canvas);
    await page.render({ canvasContext: context, viewport }).promise;

    // Save reading progress
    if (resourceId) {
      localStorage.setItem(STORAGE_KEYS.readingProgress, JSON.stringify({ id: resourceId, page: currentPage, ts: Date.now() }));
    }
  } catch (err) {
    console.error("Page render error:", err);
  } finally {
    isRendering = false;
    if (pendingPage !== null) {
      const p = pendingPage; pendingPage = null; currentPage = p; renderPage(resourceId);
    }
  }
}

async function loadPdfjs() {
  for (const source of PDFJS_SOURCES) {
    try {
      const module = await import(source.main);
      const lib = module.default || module;
      lib.GlobalWorkerOptions.workerSrc = source.worker;
      return lib;
    } catch (err) {
      console.warn(`Failed to load PDF.js from ${source.main}`, err);
    }
  }
  throw new Error("All PDF.js CDN sources failed to load");
}

/* ---- Path helpers ---- */
function resolvePdfPath(file) {
  if (!file) return "#";
  if (/^https?:\/\//.test(file)) return file;
  return "../" + cleanSitePath(file);
}

function resolvePagePath(page) {
  if (!page) return "../index.html";
  if (/^https?:\/\//.test(page)) return page;
  const cleaned = cleanSitePath(page);
  if (cleaned.startsWith("pages/")) return "./" + cleaned.slice(6);
  return "../" + cleaned;
}

function cleanSitePath(file) {
  if (!file) return "";
  let p = file.replace(/^\/+/, "");
  const segments = p.split("/");
  const knownRoots = ["pdf", "pages", "data", "assets", "css", "js"];
  if (segments.length > 1 && !knownRoots.includes(segments[0])) {
    p = segments.slice(1).join("/");
  }
  return p;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
