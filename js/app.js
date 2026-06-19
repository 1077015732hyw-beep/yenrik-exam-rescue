/**
 * app.js — Main Application Logic
 *
 * Path strategy for GitHub Pages (project site):
 * - BASE_PATH is auto-detected from import.meta.url, so it works
 *   at https://<user>.github.io/yenrik-exam-rescue/ WITHOUT hardcoding the repo name.
 * - JSON data files store paths relative to the site root (e.g. "pdf/...", "pages/...").
 * - cleanSitePath() strips any legacy "/yenrik-exam-rescue/" prefix for backward compat.
 * - All generated href/src are either BASE_PATH-absolute or relative (./ ../).
 */

import { initPdfViewer } from "./pdf-viewer.js";

/* ---- Auto-detect base path ----
   e.g. "/yenrik-exam-rescue/js/app.js" → "/yenrik-exam-rescue/"  */
const BASE_PATH = new URL(import.meta.url).pathname.replace(/js\/app\.js$/, "");

const DATA_PATHS = {
  subjects: `${BASE_PATH}data/subjects.json`,
  resources: `${BASE_PATH}data/resources.json`,
};
const MODAL_VERSION = "2026-06-20-v1";

/* ---- Init ---- */
document.addEventListener("DOMContentLoaded", async () => {
  setupTheme();
  setupNavigation();

  const pageType = document.body.dataset.page;

  if (pageType === "home" || pageType === "course" || pageType === "resource") {
    try {
      const [subjects, resources] = await Promise.all([
        getJSON(DATA_PATHS.subjects),
        getJSON(DATA_PATHS.resources),
      ]);

      if (pageType === "home") {
        renderCourseMeta(subjects, resources);
        showEntryModal(subjects, resources);
      }
      if (pageType === "course") {
        renderCourseResources(resources);
      }
      if (pageType === "resource") {
        initPdfViewer({ subjects, resources });
      }
    } catch (error) {
      console.error("Data loading error:", error);
      showLoadError();
    }
  }
});

/* ---- Theme ---- */
function setupTheme() {
  const saved = localStorage.getItem("er-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (saved === "dark" || (!saved && prefersDark)) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
  const toggle = document.querySelector("[data-theme-toggle]");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      if (isDark) {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("er-theme", "light");
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem("er-theme", "dark");
      }
    });
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!localStorage.getItem("er-theme")) {
      if (e.matches) document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
    }
  });
}

/* ---- Navigation ---- */
function setupNavigation() {
  const toggle = document.querySelector("[data-nav-toggle]");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    const isOpen = document.body.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });
  document.querySelectorAll(".site-nav a").forEach((link) => {
    link.addEventListener("click", () => {
      document.body.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.body.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
      const modal = document.querySelector("[data-modal]");
      if (modal) closeModal(modal);
    }
  });
}

/* ---- Entry Modal ---- */
function showEntryModal(subjects, resources) {
  const stored = localStorage.getItem("er-modal-version");
  if (stored === MODAL_VERSION) return;

  const sorted = [...resources].sort((a, b) => b.updated.localeCompare(a.updated));
  const recent = sorted.slice(0, 3);
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.setAttribute("data-modal", "");
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="欢迎">
      <img class="modal-logo" src="${BASE_PATH}assets/logos/exam-rescue.svg" alt="">

      <div class="modal-tabs">
        <button class="modal-tab active" data-tab="welcome">欢迎</button>
        <button class="modal-tab" data-tab="updates">更新日志</button>
        <button class="modal-tab" data-tab="disclaimer">免责声明</button>
      </div>

      <div class="modal-panels">
        <div class="modal-panel active" data-panel="welcome">
          <h2>欢迎来到 yenrik-exam-rescue</h2>
          <p class="modal-desc">2025–2026 第二学期期末复习材料，支持在线预览与下载。</p>
          <div class="modal-recent-label">最近更新</div>
          <div class="modal-updates">
            ${recent.map((r) => {
              const subj = subjectMap.get(r.subject);
              return `
                <div class="modal-update-item">
                  <span class="update-icon">${subj?.icon || "📄"}</span>
                  <div class="update-info">
                    <strong>${escapeHtml(r.title)}</strong>
                    <time>${escapeHtml(r.updated)}</time>
                  </div>
                </div>`;
            }).join("")}
          </div>
        </div>

        <div class="modal-panel" data-panel="updates">
          <h2>更新日志</h2>
          <div class="changelog">
            <div class="changelog-section">
              <h3>修 Bug</h3>
              <ul>
                <li>线性代数资料标题之前错写成"高等数学"，改过来了</li>
                <li>描述里有个多余的"有"字，删掉了</li>
                <li>"马克思基本主义原理"改成正确的"马克思主义基本原理"</li>
                <li>之前 8 条资料里有两条 id 重复了，现在每条都有唯一 id</li>
                <li>描述里的 <code>/n</code> 换行符字面量清掉了，现在显示正常</li>
                <li>每条资料的描述都重新写了，现在能看出区别</li>
              </ul>
            </div>
            <div class="changelog-section">
              <h3>功能修复</h3>
              <ul>
                <li>PDF 预览现在有两个 CDN 可以切换，第一个挂了会自动用第二个，再不行就给你下载链接</li>
                <li>第一次打开网站，现在会自动跟随你系统的亮色/暗色模式</li>
                <li>导航菜单的按钮加了无障碍标签，主题切换按钮移到了更合理的位置</li>
                <li>每个页面都加了手机顶栏颜色，现在打开网站手机顶栏会跟网站配色一致</li>
                <li>PDF 预览侧栏的两个按钮功能分开了："新窗口打开"和"下载 PDF"是两件不同的事</li>
                <li>如果打开一个不存在的资料链接，现在会显示友好提示，不会再白屏</li>
              </ul>
            </div>
            <div class="changelog-section">
              <h3>内容优化</h3>
              <ul>
                <li>导航栏现在全是中文：首页 / 关于 / 鸣谢 / 支持</li>
                <li>鸣谢页面重新整理了，分成"技术与工具"和"开发设备"两类，把 AMD 删掉了</li>
                <li>支持页面的二维码区域做了占位，替换说明写在 HTML 注释里了</li>
                <li>品牌名保持 <strong>yenrik-exam-rescue</strong> 不变</li>
                <li>页脚加了 © 2026 版权信息</li>
              </ul>
            </div>
            <div class="changelog-section">
              <h3>设计重做</h3>
              <ul>
                <li>配色从普通蓝色改成靛蓝色，更有高级感，logo 也同步更新了</li>
                <li>首页顶部新增了渐变标题、标签和统计栏（4 门课 / 8+ 份资料 / 免费开放）</li>
                <li>课程卡片现在鼠标悬停会往上浮，还能看到资料数量和最近更新日期</li>
                <li>资料卡片加了标签：绿色"带答案" / 橙色"空白"，一眼就能区分</li>
                <li>顶部导航栏现在是毛玻璃效果，滚动时一直贴在顶部</li>
                <li>暗色模式全新配色，深色底，支持跟随系统 + 手动切换</li>
                <li>整体排版重新做了：统一了间距、字号层级，优化了字母间距</li>
                <li>手机端按钮现在最小 44px 高，更好点</li>
              </ul>
            </div>
            <div class="changelog-section">
              <h3>资料勘误</h3>
              <ul>
                <li>高等数学：更新了二重积分部分的解答过程，修正了最后一题的题目及答案错误</li>
                <li>以后发现其他错误也会及时勘误，谢谢</li>
              </ul>
            </div>
          </div>
        </div>

        <div class="modal-panel" data-panel="disclaimer">
          <h2>免责声明</h2>
          <div class="disclaimer-text">
            <p>本网站所有资料均为个人整理，<strong>仅供学习参考</strong>，不构成任何考试保证。</p>
            <p>请务必以任课教师发布的<strong>官方材料</strong>为准，本网站资料仅供参考。</p>
            <p>如发现资料内容有错漏，欢迎通过"支持"页面联系我，我会及时勘误。</p>
            <p>本站<strong>不承担</strong>任何因使用本网站资料所产生的直接或间接后果。</p>
            <p>资料仅供个人学习使用，请勿用于商业用途。</p>
          </div>
        </div>
      </div>

      <button class="button primary" type="button" data-modal-close>进入站点</button>
    </div>`;

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("active"));

  // Tab switching
  backdrop.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      backdrop.querySelectorAll(".modal-tab").forEach((t) => t.classList.remove("active"));
      backdrop.querySelectorAll(".modal-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      backdrop.querySelector(`.modal-panel[data-panel="${target}"]`).classList.add("active");
    });
  });

  backdrop.querySelector("[data-modal-close]").addEventListener("click", () => closeModal(backdrop));
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(backdrop); });
}

function closeModal(modal) {
  modal.classList.remove("active");
  setTimeout(() => {
    modal.remove();
    localStorage.setItem("er-modal-version", MODAL_VERSION);
  }, 200);
}

/* ---- Home: course meta ---- */
function renderCourseMeta(subjects, resources) {
  subjects.forEach((subject) => {
    const card = document.querySelector(`a.course-card[href*="${subject.id}"] .course-meta`);
    if (!card) return;
    const subjectResources = resources.filter((r) => r.subject === subject.id);
    const count = subjectResources.length;
    const latest = subjectResources.map((r) => r.updated).sort().reverse()[0];
    card.innerHTML = `<span>📄 ${count} 份</span>${latest ? `<span>📅 ${latest.slice(5)}</span>` : ""}`;
  });
}

/* ---- Course page: resource list ---- */
function renderCourseResources(resources) {
  const courseId = document.body.dataset.course;
  const container = document.querySelector("[data-course-resources]");
  if (!container) return;

  const filtered = resources
    .filter((r) => r.subject === courseId)
    .sort((a, b) => b.updated.localeCompare(a.updated));

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无资料。</div>';
    return;
  }

  container.innerHTML = filtered.map((resource) => `
    <article class="resource-card">
      <div class="resource-info">
        <h3>
          ${resource.tag ? `<span class="resource-tag ${escapeHtml(resource.tag)}">${resource.tag === "answer" ? "带答案" : "空白"}</span>` : ""}
          ${escapeHtml(resource.title)}
        </h3>
        <p>${escapeHtml(resource.description)}</p>
        <time datetime="${escapeHtml(resource.updated)}">更新于 ${escapeHtml(resource.updated)}</time>
      </div>
      <div class="resource-actions">
        <a class="button primary" href="${BASE_PATH}pages/resource.html?id=${encodeURIComponent(resource.id)}">在线查看</a>
        <a class="button ghost" href="${BASE_PATH}${cleanSitePath(resource.file)}" download>下载</a>
      </div>
    </article>`).join("");
}

/* ---- Helpers ---- */
async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

/**
 * Normalize a path from JSON data to site-root-relative (no leading slash, no repo name).
 * Handles both new format ("pdf/xxx.pdf") and legacy format ("/yenrik-exam-rescue/pdf/xxx.pdf").
 */
function cleanSitePath(file) {
  if (!file) return "";
  if (/^https?:\/\//.test(file)) return file;
  let p = file.replace(/^\/+/, "");               // strip leading slashes
  // Strip repo-name prefix if present (backward compat, repo-name agnostic)
  const segments = p.split("/");
  const knownRoots = ["pdf", "pages", "data", "assets", "css", "js"];
  if (segments.length > 1 && !knownRoots.includes(segments[0])) {
    // First segment is not a known directory → assume it's a repo name, skip it
    p = segments.slice(1).join("/");
  }
  return p;
}

function showLoadError() {
  document.querySelectorAll("[data-course-resources], [data-resource-meta], [data-pdf-viewer]").forEach((target) => {
    target.innerHTML = '<div class="empty-state">资料加载失败，请刷新页面重试。</div>';
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
