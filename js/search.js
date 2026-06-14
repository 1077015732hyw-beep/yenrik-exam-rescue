import { formatNumber, getLocalDownloads, recordDownload } from "./stats.js";

const BASE_PATH = "/yenrik-exam-rescue/";

// 搜索页只按资料标题匹配，筛选器用于进一步缩小学科和类型范围。
export function initializeSearchPage({ subjects, resources }) {
  const params = new URLSearchParams(window.location.search);
  const input = document.querySelector("[data-search-input]");
  const form = document.querySelector("[data-search-form]");
  const subjectFilter = document.querySelector("[data-subject-filter]");
  const typeFilter = document.querySelector("[data-type-filter]");
  const results = document.querySelector("[data-search-results]");
  const resultCount = document.querySelector("[data-result-count]");

  if (!input || !form || !subjectFilter || !typeFilter || !results) {
    return;
  }

  const subjectMap = mapSubjects(subjects);
  fillSubjectFilter(subjectFilter, subjects);
  fillTypeFilter(typeFilter, resources);

  input.value = params.get("q") || "";
  subjectFilter.value = params.get("subject") || "";
  typeFilter.value = params.get("type") || "";

  const render = () => {
    const filtered = filterResources(resources, {
      query: input.value,
      subject: subjectFilter.value,
      type: typeFilter.value
    });

    renderResourceList(filtered, subjectMap, results);
    if (resultCount) {
      resultCount.textContent = `${formatNumber(filtered.length)} 个结果`;
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    syncQueryParams(input.value, subjectFilter.value, typeFilter.value);
    render();
  });

  input.addEventListener("input", render);
  subjectFilter.addEventListener("change", () => {
    syncQueryParams(input.value, subjectFilter.value, typeFilter.value);
    render();
  });
  typeFilter.addEventListener("change", () => {
    syncQueryParams(input.value, subjectFilter.value, typeFilter.value);
    render();
  });

  render();
}

export function wireGlobalSearch() {
  document.querySelectorAll("[data-global-search]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = form.querySelector('input[name="q"]');
      const query = input ? input.value.trim() : "";
      const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
      window.location.href = `${BASE_PATH}pages/search.html${suffix}`;
    });
  });
}

export function filterResources(resources, filters) {
  const query = normalizeText(filters.query);
  const subject = filters.subject || "";
  const type = filters.type || "";

  return resources.filter((resource) => {
    const matchesTitle = !query || normalizeText(resource.title).includes(query);
    const matchesSubject = !subject || resource.subject === subject;
    const matchesType = !type || resource.type === type;
    return matchesTitle && matchesSubject && matchesType;
  });
}

export function renderResourceList(resources, subjectsMap, target, options = {}) {
  if (!target) {
    return;
  }

  if (!resources.length) {
    target.innerHTML = '<div class="empty-state">没有找到匹配资料。</div>';
    return;
  }

  target.innerHTML = resources.map((resource) => {
    const subject = subjectsMap.get(resource.subject);
    const subjectName = subject ? subject.name : resource.subject;
    const downloads = Number(resource.downloads || 0) + getLocalDownloads(resource.id);
    const rating = "★".repeat(Number(resource.rating || 0));

    return `
      <article class="resource-card">
        <a class="resource-cover" href="${BASE_PATH}pages/resource.html?id=${encodeURIComponent(resource.id)}" aria-label="预览 ${escapeHtml(resource.title)}">
          <img src="${resource.cover}" alt="">
        </a>
        <div class="resource-body">
          <div class="resource-meta-row">
            <span class="pill">${escapeHtml(subjectName)}</span>
            <span class="pill">${escapeHtml(resource.type)}</span>
          </div>
          <h3>${escapeHtml(resource.title)}</h3>
          <p>${escapeHtml(resource.description)}</p>
          <div class="resource-meta-row">
            <span class="rating" aria-label="${resource.rating} 星">${rating}</span>
            <span class="pill">${formatNumber(resource.pages)} 页</span>
            <span class="pill">${formatNumber(downloads)} 次下载</span>
            <span class="pill">${escapeHtml(resource.updated)}</span>
          </div>
        </div>
        <div class="resource-actions">
          <a class="button primary" href="${BASE_PATH}pages/resource.html?id=${encodeURIComponent(resource.id)}">预览</a>
          <a class="button ghost" href="${resource.file}" download data-download-id="${escapeHtml(resource.id)}">下载</a>
        </div>
      </article>
    `;
  }).join("");

  // 下载次数为纯前端统计，写入 localStorage，不依赖后端。
  target.querySelectorAll("[data-download-id]").forEach((link) => {
    link.addEventListener("click", () => {
      recordDownload(link.dataset.downloadId);
    });
  });

  if (options.limitMessage && resources.length >= options.limitMessage) {
    target.insertAdjacentHTML("beforeend", `<p class="notice">仅展示最新 ${options.limitMessage} 份资料，更多内容可进入搜索页。</p>`);
  }
}

export function mapSubjects(subjects) {
  return new Map(subjects.map((subject) => [subject.id, subject]));
}

function fillSubjectFilter(select, subjects) {
  subjects.forEach((subject) => {
    const option = document.createElement("option");
    option.value = subject.id;
    option.textContent = subject.name;
    select.append(option);
  });
}

function fillTypeFilter(select, resources) {
  [...new Set(resources.map((resource) => resource.type))].sort().forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    select.append(option);
  });
}

function syncQueryParams(query, subject, type) {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim());
  }
  if (subject) {
    params.set("subject", subject);
  }
  if (type) {
    params.set("type", type);
  }
  const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
  window.history.replaceState({}, "", next);
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
