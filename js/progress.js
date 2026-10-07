/* ==========================================================================
   progress.js — 阅读进度记忆（localStorage，纯前端，无后端）
   朋友们的使用场景：翻过很多本，下次回来想知道「我上次读到哪儿」。
   只记录读到第 2 页及以后的位置；第 1 页不记，避免制造虚假的进度。
   ========================================================================== */

const KEY = 'shijuan:progress:v1';
const MAX_ENTRIES = 300;

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};          // 隐私模式 / file:// 下 localStorage 可能不可用
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* 存不进去就算了，不影响阅读 */
  }
}

/** 全部进度（首页用来在资料卡上显示「读到第几页」） */
export function listProgress() {
  return readAll();
}

/** 单份资料的上次阅读位置；没读过或只读到第 1 页则返回 null */
export function getProgress(id) {
  if (!id) return null;
  const entry = readAll()[id];
  if (!entry || !Number.isFinite(entry.page) || entry.page < 2) return null;
  return entry;
}

/** 记录进度（页码 >= 2 才有意义） */
export function saveProgress(id, page, pages) {
  if (!id || !Number.isFinite(page) || page < 2) return;
  const all = readAll();
  all[id] = {
    page,
    pages: Number.isFinite(pages) ? pages : null,
    at: Date.now(),
  };
  const keys = Object.keys(all);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete all[k]);
  }
  writeAll(all);
}

/** 「读到 3 / 9 页」文案 */
export function progressLabel(entry) {
  if (!entry) return '';
  return entry.pages ? `读到 ${entry.page} / ${entry.pages} 页` : `读到第 ${entry.page} 页`;
}

/** 进度百分比（0–100） */
export function progressPercent(entry) {
  if (!entry || !entry.pages || entry.pages < 2) return 0;
  return Math.max(4, Math.min(100, Math.round((entry.page / entry.pages) * 100)));
}
