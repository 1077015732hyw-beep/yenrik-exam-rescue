import { formatNumber, getLocalDownloads, recordDownload } from "./stats.js";
import { escapeHtml, mapSubjects } from "./search.js";

const BASE_PATH = "/yenrik-exam-rescue/";

// 资源详情页通过 ?id=resource-id 定位 PDF，并提供浏览器原生 PDF 预览。
export function initializeResourcePage({ subjects, resources }) {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const resource = resources.find((item) => item.id === id) || resources[0];
  const subjectsMap = mapSubjects(subjects);
  const meta = document.querySelector("[data-resource-meta]");
  const viewer = document.querySelector("[data-pdf-viewer]");

  if (!meta || !viewer) {
    return;
  }

  if (!resource) {
    meta.innerHTML = '<div class="empty-state">没有找到资料。</div>';
    viewer.innerHTML = '<div class="empty-state">请返回搜索页选择资料。</div>';
    return;
  }

  const subject = subjectsMap.get(resource.subject);
  const downloads = Number(resource.downloads || 0) + getLocalDownloads(resource.id);
  document.title = `${resource.title} | Exam Rescue`;

  meta.innerHTML = `
    <img src="${resource.cover}" alt="">
    <div class="resource-meta-row">
      <span class="pill">${escapeHtml(subject ? subject.name : resource.subject)}</span>
      <span class="pill">${escapeHtml(resource.type)}</span>
    </div>
    <h1>${escapeHtml(resource.title)}</h1>
    <p>${escapeHtml(resource.description)}</p>
    <div class="resource-meta-row">
      <span class="pill">${formatNumber(resource.pages)} 页</span>
      <span class="pill">${formatNumber(downloads)} 次下载</span>
      <span class="pill">更新 ${escapeHtml(resource.updated)}</span>
      <span class="pill">作者 ${escapeHtml(resource.author)}</span>
    </div>
    <div class="viewer-actions">
      <a class="button primary" href="${resource.file}" download data-download-id="${escapeHtml(resource.id)}">下载 PDF</a>
      <a class="button ghost" href="${resource.file}" target="_blank" rel="noopener">新窗口打开</a>
      <a class="button ghost" href="${BASE_PATH}pages/search.html?subject=${encodeURIComponent(resource.subject)}">同学科资料</a>
    </div>
  `;

  viewer.innerHTML = `
    <object data="${resource.file}" type="application/pdf" aria-label="${escapeHtml(resource.title)} PDF 预览">
      <iframe src="${resource.file}" title="${escapeHtml(resource.title)} PDF 预览"></iframe>
    </object>
  `;

  meta.querySelectorAll("[data-download-id]").forEach((link) => {
    link.addEventListener("click", () => {
      recordDownload(link.dataset.downloadId);
    });
  });
}
