/**
 * app.js — Yanta Archive · 雁塔提名
 *
 * Features:
 * - Continue Reading (localStorage)
 * - Recent browsing history (localStorage)
 * - Tag system
 * - Recent updates from updates.json
 * - Site statistics
 * - Dark mode with system detection
 * - Entry modal with tabs (welcome / changelog / disclaimer)
 * - PWA registration
 */

import { initPdfViewer } from "./pdf-viewer.js";

/* ---- Auto-detect base path ---- */
const BASE_PATH = new URL(import.meta.url).pathname.replace(/js\/app\.js$/, "");

const DATA_PATHS = {
  subjects: `${BASE_PATH}data/subjects.json`,
  resources: `${BASE_PATH}data/resources.json`,
  updates: `${BASE_PATH}data/updates.json`,
};
const MODAL_VERSION = "2026-06-20-v4";
const STORAGE_KEYS = {
  theme: "ya-theme",
  modalVersion: "ya-modal-version",
  readingProgress: "ya-reading-progress",
  recent: "ya-recent",
};

/* ---- Init ---- */
document.addEventListener("DOMContentLoaded", async () => {
  setupTheme();
  setupNavigation();
  setupPWA();

  const pageType = document.body.dataset.page;

  if (pageType === "home" || pageType === "course" || pageType === "resource") {
    try {
      const [subjects, resources] = await Promise.all([
        getJSON(DATA_PATHS.subjects),
        getJSON(DATA_PATHS.resources),
      ]);

      if (pageType === "home") {
        let updateCount = 0;
        try { updateCount = (await getJSON(DATA_PATHS.updates)).length; } catch {}
        renderStats(subjects, resources, updateCount);
        renderContinueReading(subjects, resources);
        renderRecent(subjects, resources);
        renderCourseMeta(subjects, resources);
        showEntryModal(subjects, resources);
      }
      if (pageType === "course") {
        renderCourseResources(resources);
        renderBreadcrumb();
      }
      if (pageType === "resource") {
        initPdfViewer({ subjects, resources });
        recordRecent();
        renderBreadcrumb();
      }
    } catch (error) {
      console.error("Data loading error:", error);
      showLoadError();
    }
  }

  if (pageType === "about" || pageType === "exam-rescue") {
    renderBreadcrumb();
  }
});

/* ---- Theme ---- */
function setupTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
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
        localStorage.setItem(STORAGE_KEYS.theme, "light");
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem(STORAGE_KEYS.theme, "dark");
      }
    });
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!localStorage.getItem(STORAGE_KEYS.theme)) {
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

/* ---- PWA ---- */
function setupPWA() {
  if ("serviceWorker" in navigator) {
    const swPath = `${BASE_PATH}js/sw.js`;
    navigator.serviceWorker.register(swPath).catch(() => {});
  }
}

/* ---- Stats ---- */
function renderStats(subjects, resources, updateCount) {
  const el = document.querySelector("[data-stats]");
  if (!el) return;
  const totalResources = resources.length;
  const totalSubjects = subjects.length;
  el.innerHTML = `
    <div class="stat-item"><strong>${totalResources}</strong><span>份资料</span></div>
    <div class="stat-item"><strong>${totalSubjects}</strong><span>门科目</span></div>
    <div class="stat-item"><strong>${updateCount}</strong><span>次更新</span></div>`;
}

/* ---- Continue Reading ---- */
function renderContinueReading(subjects, resources) {
  const el = document.querySelector("[data-continue-reading]");
  if (!el) return;
  const progress = JSON.parse(localStorage.getItem(STORAGE_KEYS.readingProgress) || "null");
  if (!progress) { el.style.display = "none"; return; }

  const resource = resources.find((r) => r.id === progress.id);
  if (!resource) { el.style.display = "none"; return; }
  const subject = subjects.find((s) => s.id === resource.subject);

  el.innerHTML = `
    <div class="section-header">
      <h2>继续阅读</h2>
    </div>
    <a class="continue-card" href="${BASE_PATH}pages/resource.html?id=${encodeURIComponent(resource.id)}">
      <span class="continue-icon">${subject?.icon || "📖"}</span>
      <div class="continue-info">
        <strong>${escapeHtml(resource.title)}</strong>
        <span>上次翻到：第 ${progress.page || 1} 页</span>
      </div>
      <span class="button small primary">继续</span>
    </a>`;
}

/* ---- Recent ---- */
function renderRecent(subjects, resources) {
  const el = document.querySelector("[data-recent]");
  if (!el) return;
  const recent = JSON.parse(localStorage.getItem(STORAGE_KEYS.recent) || "[]");
  if (recent.length === 0) { el.style.display = "none"; return; }

  const items = recent.slice(0, 4).map((id) => resources.find((r) => r.id === id)).filter(Boolean);
  if (items.length === 0) { el.style.display = "none"; return; }

  el.innerHTML = `
    <div class="section-header">
      <h2>最近浏览</h2>
    </div>
    <div class="resource-list">
      ${items.map((r) => {
    const subj = subjects.find((s) => s.id === r.subject);
    return `
          <a class="resource-card" href="${BASE_PATH}pages/resource.html?id=${encodeURIComponent(r.id)}" style="text-decoration:none;color:inherit;">
            <div class="resource-info">
              <h3>${subj?.icon || ""} ${escapeHtml(r.title)}</h3>
              <p>${escapeHtml(r.description)}</p>
            </div>
          </a>`;
  }).join("")}
    </div>`;
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
    container.innerHTML = '<div class="empty-state">这个资料架还是空的。</div>';
    return;
  }

  // Collect all tags for filter
  const allTags = [...new Set(filtered.flatMap((r) => r.tags || []))];

  const filterBar = allTags.length > 0 ? `
    <div class="filter-bar" data-filter-bar>
      ${allTags.map((tag) => `<button class="filter-chip" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}
      <select class="sort-select" data-sort>
        <option value="updated">按更新时间</option>
        <option value="title">按名称</option>
      </select>
    </div>` : "";

  container.innerHTML = filterBar + `
    <div class="resource-list" data-resource-list>
      ${filtered.map((resource) => renderResourceCard(resource)).join("")}
    </div>`;

  // Filter logic
  const list = container.querySelector("[data-resource-list]");
  const chips = container.querySelectorAll(".filter-chip");
  const sortSel = container.querySelector("[data-sort]");
  let activeTags = new Set();

  function applyFilters() {
    let items = filtered.filter((r) => {
      if (activeTags.size === 0) return true;
      return (r.tags || []).some((t) => activeTags.has(t));
    });
    if (sortSel && sortSel.value === "title") {
      items = items.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      items = items.sort((a, b) => b.updated.localeCompare(a.updated));
    }
    list.innerHTML = items.map((r) => renderResourceCard(r)).join("") || '<div class="empty-state">没有找到匹配的资料。</div>';
  }

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const tag = chip.dataset.tag;
      if (activeTags.has(tag)) { activeTags.delete(tag); chip.classList.remove("active"); }
      else { activeTags.add(tag); chip.classList.add("active"); }
      applyFilters();
    });
  });
  if (sortSel) sortSel.addEventListener("change", applyFilters);
}

function renderResourceCard(resource) {
  const tagsHtml = (resource.tags || []).map((t) => `<span class="resource-tag label">${escapeHtml(t)}</span>`).join("");
  const answerTag = resource.tag
    ? `<span class="resource-tag ${resource.tag === "answer" ? "answer" : "blank"}">${resource.tag === "answer" ? "带答案" : "空白"}</span>`
    : "";
  return `
    <article class="resource-card">
      <div class="resource-info">
        <h3>${answerTag} ${escapeHtml(resource.title)}</h3>
        <p>${escapeHtml(resource.description)}</p>
        <div class="resource-tags">${tagsHtml}</div>
        <time datetime="${escapeHtml(resource.updated)}">更新于 ${escapeHtml(resource.updated)}</time>
      </div>
      <div class="resource-actions">
        <a class="button primary" href="${BASE_PATH}pages/resource.html?id=${encodeURIComponent(resource.id)}">在线翻阅</a>
        <a class="button ghost" href="${BASE_PATH}${cleanSitePath(resource.file)}" download>下载带回</a>
      </div>
    </article>`;
}

/* ---- Record Recent ---- */
function recordRecent() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) return;
  let recent = JSON.parse(localStorage.getItem(STORAGE_KEYS.recent) || "[]");
  recent = recent.filter((r) => r !== id);
  recent.unshift(id);
  recent = recent.slice(0, 8);
  localStorage.setItem(STORAGE_KEYS.recent, JSON.stringify(recent));
}

/* ---- Breadcrumb ---- */
function renderBreadcrumb() {
  const el = document.querySelector("[data-breadcrumb]");
  if (!el) return;
  const pageType = document.body.dataset.page;
  const courseId = document.body.dataset.course;

  let crumbs = [{ label: "小岛", href: `${BASE_PATH}index.html` }];

  if (pageType === "exam-rescue") {
    crumbs.push({ label: "资料馆", current: true });
  } else if (pageType === "course") {
    crumbs.push({ label: "资料馆", href: `${BASE_PATH}pages/exam-rescue.html` });
    crumbs.push({ label: document.title.split("|")[0].trim(), current: true });
  } else if (pageType === "resource") {
    crumbs.push({ label: "资料馆", href: `${BASE_PATH}pages/exam-rescue.html` });
    crumbs.push({ label: "翻阅中", current: true });
  } else if (pageType === "about") {
    crumbs.push({ label: "关于小岛", current: true });
  } else if (pageType === "acknowledgements") {
    crumbs.push({ label: "鸣谢", current: true });
  } else if (pageType === "support") {
    crumbs.push({ label: "支持", current: true });
  }

  el.innerHTML = crumbs.map((c, i) => {
    if (c.current) return `<span class="current">${escapeHtml(c.label)}</span>`;
    const sep = i > 0 ? '<span class="separator">/</span>' : "";
    return `${sep}<a href="${c.href}">${escapeHtml(c.label)}</a>`;
  }).join("");
}

/* ---- Entry Modal ---- */
function showEntryModal(subjects, resources) {
  const stored = localStorage.getItem(STORAGE_KEYS.modalVersion);
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
          <h2>欢迎来到小岛 🏝️</h2>
          <p class="modal-desc">这里是雁塔提名的资料馆，收藏着整理好的复习材料。</p>
          <div class="modal-recent-label">最近上架</div>
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
          <h2>小岛变迁记</h2>
          <div class="changelog">
            <div class="changelog-section">
              <h3>小岛重建</h3>
              <ul>
                <li>小岛从 exam-rescue 重启为「雁塔提名 Yanta Archive」</li>
                <li>全新风貌：动森风格设计、薄荷绿主色、羊皮纸底色</li>
              </ul>
            </div>
            <div class="changelog-section">
              <h3>新功能</h3>
              <ul>
                <li>继续阅读：自动记住上次翻到哪份资料、第几页</li>
                <li>最近浏览：首页显示最近打开过的资料</li>
                <li>标签系统：资料支持「高频考点」「必背」「自测」等标签筛选</li>
                <li>全站统计：首页显示资料数、科目数、更新次数</li>
                <li>PWA 支持：可添加到手机桌面，像 App 一样使用</li>
                <li>自定义 404 页面</li>
                <li>PDF 键盘翻页（← →）+ 暗色反色模式</li>
                <li>面包屑导航、资料排序与标签筛选</li>
              </ul>
            </div>
            <div class="changelog-section">
              <h3>修复</h3>
              <ul>
                <li>修复 resources.json 格式问题，PDF 翻阅恢复正常</li>
                <li>线性代数标题错误、描述重复、id 冲突等全部修复</li>
                <li>"马克思基本主义原理"改为"马克思主义基本原理"</li>
              </ul>
            </div>
            <div class="changelog-section">
              <h3>资料勘误</h3>
              <ul>
                <li>高等数学：更新二重积分解答过程，修正最后一题题目及答案错误</li>
                <li>以后发现其他错误也会及时勘误，谢谢</li>
              </ul>
            </div>
          </div>
        </div>

        <div class="modal-panel" data-panel="disclaimer">
          <h2>免责声明</h2>
          <div class="disclaimer-text">
            <p>岛上所有资料均为个人整理，<strong>仅供学习参考</strong>，不构成任何考试保证。</p>
            <p>请务必以任课居民（教师）发布的<strong>官方材料</strong>为准。</p>
            <p>如发现资料内容有错漏，欢迎通过"关于小岛"页面联系岛主反馈，会及时勘误。</p>
            <p>本岛<strong>不承担</strong>任何因使用岛上资料所产生的直接或间接后果。</p>
            <p>资料仅供个人学习使用，请勿用于商业用途。</p>
            <p><strong>请勿大范围传播</strong>。若传播范围超过预期，小岛可能会考虑停止维护甚至关闭。</p>
          </div>
        </div>
      </div>

      <button class="button primary" type="button" data-modal-close>登上小岛</button>
    </div>`;

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("active"));

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
    localStorage.setItem(STORAGE_KEYS.modalVersion, MODAL_VERSION);
  }, 200);
}

/* ---- Helpers ---- */
async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function cleanSitePath(file) {
  if (!file) return "";
  if (/^https?:\/\//.test(file)) return file;
  let p = file.replace(/^\/+/, "");
  const segments = p.split("/");
  const knownRoots = ["pdf", "pages", "data", "assets", "css", "js"];
  if (segments.length > 1 && !knownRoots.includes(segments[0])) {
    p = segments.slice(1).join("/");
  }
  return p;
}

function showLoadError() {
  document.querySelectorAll("[data-course-resources], [data-resource-meta], [data-pdf-viewer], [data-stats], [data-continue-reading], [data-recent]").forEach((target) => {
    target.innerHTML = '<div class="empty-state">加载失败，请刷新页面重试 🔄</div>';
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
