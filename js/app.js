import { renderResourceList, mapSubjects, wireGlobalSearch, escapeHtml } from "./search.js";
import { initializeSearchPage } from "./search.js";
import { updateStats } from "./stats.js";
import { initializeResourcePage } from "./viewer.js";

const BASE_PATH = "/yenrik-exam-rescue/";

// GitHub Pages 项目路径固定为 /yenrik-exam-rescue/，所有动态请求都从这里拼接。
const DATA_PATHS = {
  subjects: `${BASE_PATH}data/subjects.json`,
  resources: `${BASE_PATH}data/resources.json`,
  updates: `${BASE_PATH}data/updates.json`,
  announcements: `${BASE_PATH}data/announcements.json`
};

document.addEventListener("DOMContentLoaded", async () => {
  setupTheme();
  setupNavigation();
  wireGlobalSearch();

  try {
    const [subjects, resources, updates, announcements] = await Promise.all([
      getJSON(DATA_PATHS.subjects),
      getJSON(DATA_PATHS.resources),
      getJSON(DATA_PATHS.updates),
      getJSON(DATA_PATHS.announcements)
    ]);

    updateStats(resources);
    bootPage({ subjects, resources, updates, announcements });
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

function bootPage(data) {
  const page = document.body.dataset.page;

  // 学科卡片在首页和学科页复用，始终由 subjects.json 与 resources.json 计算生成。
  renderSubjects(data.subjects, data.resources);

  if (page === "home") {
    renderHome(data);
  }

  if (page === "subjects") {
    renderSubjectPage(data.subjects, data.resources);
  }

  if (page === "search") {
    initializeSearchPage(data);
  }

  if (page === "resource") {
    initializeResourcePage(data);
  }
}

function setupTheme() {
  const savedTheme = localStorage.getItem("exam-rescue-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initialTheme = savedTheme || (prefersDark ? "dark" : "light");
  document.documentElement.dataset.theme = initialTheme;

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
  document.querySelector(`[data-nav-link="${current === "resource" ? "search" : current}"]`)?.classList.add("is-active");

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

function renderHome({ subjects, resources, updates, announcements }) {
  const subjectMap = mapSubjects(subjects);
  const featured = [...resources]
    .sort((a, b) => new Date(b.updated) - new Date(a.updated))
    .slice(0, 5);

  renderResourceList(featured, subjectMap, document.querySelector("[data-featured-resources]"));
  renderUpdates(updates, resources);
  renderAnnouncements(announcements);
}

function renderSubjects(subjects, resources) {
  const targets = document.querySelectorAll("[data-subject-list]");
  if (!targets.length) {
    return;
  }

  const counts = resources.reduce((store, resource) => {
    store[resource.subject] = (store[resource.subject] || 0) + 1;
    return store;
  }, {});

  const html = subjects.map((subject) => `
    <a class="subject-card" style="--subject-color: ${escapeHtml(subject.color)}" href="${BASE_PATH}pages/subject.html?id=${encodeURIComponent(subject.id)}">
      <div class="subject-card-top">
        <span class="subject-icon">${escapeHtml(subject.icon)}</span>
        <span class="pill">${escapeHtml(subject.level)}</span>
      </div>
      <h3>${escapeHtml(subject.name)}</h3>
      <p>${escapeHtml(subject.description)}</p>
      <div class="subject-meta">
        <span>${counts[subject.id] || 0} 份资料</span>
        <span>颜色 ${escapeHtml(subject.color)}</span>
      </div>
    </a>
  `).join("");

  targets.forEach((target) => {
    target.innerHTML = html;
  });
}

function renderSubjectPage(subjects, resources) {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const detail = document.querySelector("[data-subject-detail]");
  const detailHeader = document.querySelector("[data-subject-detail-header]");
  const detailResources = document.querySelector("[data-subject-resources]");

  if (!id || !detail || !detailHeader || !detailResources) {
    return;
  }

  const subject = subjects.find((item) => item.id === id);
  const subjectMap = mapSubjects(subjects);
  const filtered = resources.filter((resource) => resource.subject === id);

  if (!subject) {
    detail.hidden = false;
    detailHeader.innerHTML = "<h2>未找到学科</h2>";
    detailResources.innerHTML = '<div class="empty-state">请从上方学科卡片重新选择。</div>';
    return;
  }

  document.title = `${subject.name} | Exam Rescue`;
  detail.hidden = false;
  detailHeader.innerHTML = `
    <div>
      <p class="eyebrow">Subject Detail</p>
      <h2>${escapeHtml(subject.icon)} ${escapeHtml(subject.name)}</h2>
      <p>${escapeHtml(subject.description)}</p>
    </div>
    <a class="button primary" href="${BASE_PATH}pages/search.html?subject=${encodeURIComponent(subject.id)}">筛选该学科</a>
  `;
  renderResourceList(filtered, subjectMap, detailResources);
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderUpdates(updates, resources) {
  const target = document.querySelector("[data-updates-list]");
  if (!target) {
    return;
  }

  const resourceMap = new Map(resources.map((resource) => [resource.id, resource]));
  target.innerHTML = updates.map((update) => {
    const resource = resourceMap.get(update.resource);
    const href = resource ? `${BASE_PATH}pages/resource.html?id=${encodeURIComponent(resource.id)}` : `${BASE_PATH}pages/search.html`;

    return `
      <a class="timeline-item" href="${href}">
        <span class="timeline-dot"></span>
        <span>
          <strong>${escapeHtml(update.title)}</strong>
          <small>${escapeHtml(update.date)} · ${escapeHtml(update.tag)}</small>
        </span>
      </a>
    `;
  }).join("");
}

function renderAnnouncements(announcements) {
  if (!announcements.length) {
    return;
  }

  const hero = document.querySelector(".hero-copy");
  if (!hero) {
    return;
  }

  const latest = announcements[0];
  hero.insertAdjacentHTML("beforeend", `
    <div class="notice">
      <strong>${escapeHtml(latest.title)}</strong>
      <span>${escapeHtml(latest.content)}</span>
    </div>
  `);
}

function showLoadError() {
  document.querySelectorAll("[data-subject-list], [data-featured-resources], [data-search-results], [data-pdf-viewer]").forEach((target) => {
    target.innerHTML = '<div class="empty-state">数据加载失败，请检查 GitHub Pages 路径和 JSON 文件。</div>';
  });
}
