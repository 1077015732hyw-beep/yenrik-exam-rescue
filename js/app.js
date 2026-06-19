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
const MODAL_VERSION = "2026-06-19-v1";

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
      <h2>欢迎来到 yenrik-exam-rescue</h2>
      <p class="modal-desc">2025-2026 第二学期期末复习材料，支持在线预览与下载。</p>
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
      <div class="modal-disclaimer">所有资料仅供学习参考，请以教师要求为准。</div>
      <button class="button primary" type="button" data-modal-close>进入站点</button>
    </div>`;

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("active"));
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
