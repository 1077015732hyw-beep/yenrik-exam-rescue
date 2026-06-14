import { initializeResourcePage } from "./viewer.js";

const BASE_PATH = "/yenrik-exam-rescue/";
const DATA_PATHS = {
  subjects: `${BASE_PATH}data/subjects.json`,
  resources: `${BASE_PATH}data/resources.json`
};

document.addEventListener("DOMContentLoaded", async () => {
  setupTheme();
  setupNavigation();

  try {
    const [subjects, resources] = await Promise.all([
      getJSON(DATA_PATHS.subjects),
      getJSON(DATA_PATHS.resources)
    ]);

    if (document.body.dataset.page === "course") {
      renderCourseResources(resources);
    }

    if (document.body.dataset.page === "resource") {
      initializeResourcePage({ subjects, resources });
    }
  } catch (error) {
    console.error(error);
    showLoadError();
  }
});

async function getJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

function setupTheme() {
  const savedTheme = localStorage.getItem("exam-rescue-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = savedTheme || (prefersDark ? "dark" : "light");

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = nextTheme;
      localStorage.setItem("exam-rescue-theme", nextTheme);
    });
  });
}

function setupNavigation() {
  const current = document.body.dataset.page;
  document.querySelector(`[data-nav-link="${current}"]`)?.classList.add("is-active");

  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-site-nav]");
  if (!toggle || !nav) {
    return;
  }

  toggle.addEventListener("click", () => {
    document.body.classList.toggle("nav-open");
    toggle.setAttribute("aria-label", document.body.classList.contains("nav-open") ? "关闭导航" : "打开导航");
  });

  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      document.body.classList.remove("nav-open");
    }
  });
}

function renderCourseResources(resources) {
  const courseId = document.body.dataset.course;
  const target = document.querySelector("[data-course-resources]");
  if (!courseId || !target) {
    return;
  }

  const courseResources = resources.filter((resource) => resource.subject === courseId);
  if (!courseResources.length) {
    target.innerHTML = '<div class="empty-state">暂无资料。</div>';
    return;
  }

  target.innerHTML = courseResources.map((resource) => `
    <article class="resource-card">
      <div class="resource-body">
        <h2>${escapeHtml(resource.title)}</h2>
        <p>${escapeHtml(resource.description)}</p>
        <time datetime="${escapeHtml(resource.updated)}">更新时间：${escapeHtml(resource.updated)}</time>
      </div>
      <div class="resource-actions">
        <a class="button primary" href="${BASE_PATH}pages/resource.html?id=${encodeURIComponent(resource.id)}">在线查看</a>
        <a class="button ghost" href="${resource.file}" download>下载PDF</a>
      </div>
    </article>
  `).join("");
}

function showLoadError() {
  document.querySelectorAll("[data-course-resources], [data-resource-meta], [data-pdf-viewer]").forEach((target) => {
    target.innerHTML = '<div class="empty-state">资料加载失败，请检查路径或 JSON 文件。</div>';
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
