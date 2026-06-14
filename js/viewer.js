const BASE_PATH = "/yenrik-exam-rescue/";

export function initializeResourcePage({ subjects, resources }) {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const resource = resources.find((item) => item.id === id);
  const subject = subjects.find((item) => item.id === resource?.subject);
  const meta = document.querySelector("[data-resource-meta]");
  const viewer = document.querySelector("[data-pdf-viewer]");

  if (!meta || !viewer) {
    return;
  }

  if (!resource) {
    meta.innerHTML = '<div class="empty-state">没有找到这份资料。</div>';
    viewer.innerHTML = '<div class="empty-state">请从课程页面重新选择资料。</div>';
    return;
  }

  document.title = `${resource.title} | 期末复习材料`;

  meta.innerHTML = `
    <p class="back-link"><a href="${subject?.page || BASE_PATH}">← 返回课程</a></p>
    <h1>${escapeHtml(resource.title)}</h1>
    <p>${escapeHtml(resource.description)}</p>
    <time datetime="${escapeHtml(resource.updated)}">更新时间：${escapeHtml(resource.updated)}</time>
    <div class="viewer-actions">
      <a class="button primary" href="${resource.file}" target="_blank" rel="noopener">在线查看</a>
      <a class="button ghost" href="${resource.file}" download>下载PDF</a>
    </div>
  `;

  viewer.innerHTML = `
    <object data="${resource.file}" type="application/pdf" aria-label="${escapeHtml(resource.title)} PDF 预览">
      <iframe src="${resource.file}" title="${escapeHtml(resource.title)} PDF 预览"></iframe>
    </object>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
