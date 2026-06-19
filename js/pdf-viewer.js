/**
 * pdf-viewer.js — PDF Viewer with Lazy Loading + CDN Fallback
 *
 * Uses PDF.js (Mozilla) to render PDF pages to <canvas>.
 * Works on ALL mobile browsers (iOS Safari, WeChat, Chrome, etc.)
 *
 * PDF is loaded LAZILY — file info + download shown immediately,
 * PDF content only fetched when user clicks "在线预览".
 *
 * CDN fallback: jsdelivr → unpkg → graceful degradation
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
      <p class="back-link"><a href="../index.html">← 返回首页</a></p>
      <h1>未找到资料</h1>
      <p>没有找到这份资料，请从课程页面重新选择。</p>
      <div class="viewer-actions">
        <a class="button primary" href="../index.html">返回首页</a>
      </div>`;
    viewer.innerHTML = '<div class="empty-state">请从课程页面重新选择资料。</div>';
    return;
  }

  document.title = `${resource.title} | 期末复习材料`;
  const pdfPath = resolvePdfPath(resource.file);

  // Render sidebar with file info
  meta.innerHTML = `
    <p class="back-link"><a href="${resolvePagePath(subject?.page)}">← 返回${escapeHtml(subject?.name || "课程")}</a></p>
    <h1>${escapeHtml(resource.title)}</h1>
    <p>${escapeHtml(resource.description)}</p>
    <time datetime="${escapeHtml(resource.updated)}">更新于 ${escapeHtml(resource.updated)}</time>
    <div class="viewer-actions">
      <a class="button primary" href="${pdfPath}" target="_blank" rel="noopener">在新窗口打开</a>
      <a class="button ghost" href="${pdfPath}" download>下载 PDF</a>
    </div>`;

  // Show placeholder with "start preview" button (lazy loading)
  viewer.innerHTML = `
    <div class="pdf-placeholder">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <path d="M14 2v6h6"/>
      </svg>
      <h3>在线预览</h3>
      <p>点击下方按钮加载 PDF 预览，支持翻页和缩放。</p>
      <button class="button primary" type="button" data-pdf-start>开始预览</button>
    </div>`;

  const startBtn = viewer.querySelector("[data-pdf-start]");
  startBtn.addEventListener("click", () => startPdfPreview(pdfPath, viewer));
}

async function startPdfPreview(pdfPath, viewer) {
  // Replace placeholder with loading state
  viewer.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>正在加载 PDF.js 渲染引擎…</p>
    </div>`;

  try {
    if (!pdfjsLib) {
      pdfjsLib = await loadPdfjs();
    }

    // Show loading while fetching PDF
    viewer.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>正在加载 PDF 文件…</p>
      </div>`;

    const loadingTask = pdfjsLib.getDocument(pdfPath);
    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    currentPage = 1;

    // Render viewer UI
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
        </div>
      </div>
      <div class="pdf-canvas-container" data-pdf-canvas-container></div>`;

    // Wire up controls
    viewer.querySelector("[data-pdf-prev]").addEventListener("click", () => {
      if (currentPage > 1) { currentPage--; renderPage(); }
    });
    viewer.querySelector("[data-pdf-next]").addEventListener("click", () => {
      if (currentPage < totalPages) { currentPage++; renderPage(); }
    });
    viewer.querySelector("[data-pdf-zoom-in]").addEventListener("click", () => {
      currentScale = Math.min(currentScale + 0.25, 3);
      renderPage();
    });
    viewer.querySelector("[data-pdf-zoom-out]").addEventListener("click", () => {
      currentScale = Math.max(currentScale - 0.25, 0.5);
      renderPage();
    });

    await renderPage();
  } catch (err) {
    console.error("PDF preview error:", err);
    viewer.innerHTML = `
      <div class="pdf-placeholder">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4M12 16h.01"/>
        </svg>
        <h3>预览不可用</h3>
        <p>可能是网络问题导致渲染引擎加载失败，你可以直接下载 PDF 查看。</p>
        <a class="button primary" href="${pdfPath}" download>下载 PDF</a>
      </div>`;
  }
}

async function renderPage() {
  if (isRendering) { pendingPage = currentPage; return; }
  isRendering = true;

  const container = document.querySelector("[data-pdf-canvas-container]");
  const currentEl = document.querySelector("[data-pdf-current]");
  if (!container || !pdfDoc) { isRendering = false; return; }

  // Update page info
  if (currentEl) currentEl.textContent = currentPage;

  // Update button states
  const prevBtn = document.querySelector("[data-pdf-prev]");
  const nextBtn = document.querySelector("[data-pdf-next]");
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

  // Show loading
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
  } catch (err) {
    console.error("Page render error:", err);
  } finally {
    isRendering = false;
    if (pendingPage !== null) {
      const p = pendingPage;
      pendingPage = null;
      currentPage = p;
      renderPage();
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

/* ---- Helpers ---- */
function resolvePdfPath(file) {
  if (!file) return "#";
  if (file.startsWith("http://") || file.startsWith("https://")) return file;
  const cleaned = file.replace(/^\/+/, "").replace(/^yenrik-exam-rescue\//, "");
  return "../" + cleaned;
}

function resolvePagePath(page) {
  if (!page) return "../index.html";
  if (page.startsWith("http://") || page.startsWith("https://")) return page;
  const cleaned = page.replace(/^\/+/, "").replace(/^yenrik-exam-rescue\//, "");
  if (cleaned.startsWith("pages/")) return "./" + cleaned.slice(6);
  return "../" + cleaned;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
