const VISIT_KEY = "exam-rescue-visits";
const VISIT_SESSION_KEY = "exam-rescue-visited-session";
const DOWNLOAD_KEY = "exam-rescue-downloads";

// 统计完全保存在浏览器本地，适合 GitHub Pages 这种纯静态部署。
export function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

export function trackVisit() {
  if (sessionStorage.getItem(VISIT_SESSION_KEY)) {
    return getVisits();
  }

  const next = getVisits() + 1;
  localStorage.setItem(VISIT_KEY, String(next));
  sessionStorage.setItem(VISIT_SESSION_KEY, "1");
  return next;
}

export function getVisits() {
  return Number(localStorage.getItem(VISIT_KEY) || "0");
}

export function recordDownload(resourceId) {
  const store = getDownloadStore();
  store[resourceId] = (store[resourceId] || 0) + 1;
  localStorage.setItem(DOWNLOAD_KEY, JSON.stringify(store));
}

export function getLocalDownloads(resourceId) {
  return getDownloadStore()[resourceId] || 0;
}

export function getTotalDownloads(resources) {
  const base = resources.reduce((sum, resource) => sum + Number(resource.downloads || 0), 0);
  const local = Object.values(getDownloadStore()).reduce((sum, value) => sum + Number(value || 0), 0);
  return base + local;
}

export function updateStats(resources) {
  const visits = trackVisit();
  const statVisits = document.querySelector('[data-stat="visits"]');
  const statResources = document.querySelector('[data-stat="resources"]');
  const statDownloads = document.querySelector('[data-stat="downloads"]');

  if (statVisits) {
    statVisits.textContent = formatNumber(Math.max(visits, 1280 + visits));
  }
  if (statResources) {
    statResources.textContent = formatNumber(resources.length);
  }
  if (statDownloads) {
    statDownloads.textContent = formatNumber(getTotalDownloads(resources));
  }
}

function getDownloadStore() {
  try {
    return JSON.parse(localStorage.getItem(DOWNLOAD_KEY) || "{}");
  } catch {
    return {};
  }
}
