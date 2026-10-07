#!/usr/bin/env node
/**
 * build-data.mjs — 由资料源清单生成站点运行时数据 data/files.json
 *
 * 用法：
 *   node tools/build-data.mjs
 *
 * 流程：
 *   1. 读取 data/sources.json（人工维护的清单）
 *   2. 直接从磁盘上的 PDF 读取真实文件大小，并尽力统计页数
 *      （统计不到时退回 tools/pdf-manifest.json 或清单里的 pagesHint）
 *   3. 输出 data/files.json —— 首页与阅读页只读这一个文件
 *
 * 只把 PDF 放进 pdf/<subject>/，并在 sources.json 增加一条，然后运行本脚本即可。
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const p = (rel) => join(root, rel);

const readJSON = (rel, fallback = null) => {
  try {
    return JSON.parse(readFileSync(p(rel), 'utf8'));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw new Error(`无法读取 ${rel}: ${error.message}`);
  }
};

/** 人类可读的文件大小 */
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 尽力统计 PDF 页数：统计 /Type /Page 对象出现的次数 */
function countPages(buffer) {
  const text = buffer.toString('latin1');
  const direct = text.match(/\/Type\s*\/Page(?![s])/g);
  if (direct && direct.length > 1) return direct.length;
  // 压缩对象流（xref stream）里也有 /Type/Page，宽松再数一次
  const loose = text.match(/\/Type\s*\/Page\b/g);
  if (loose && loose.length > 1) return loose.length;
  const countField = text.match(/\/Count\s+(\d+)/);
  if (countField) return Number(countField[1]);
  return null;
}

const sources = readJSON('data/sources.json');
const manifest = readJSON('tools/pdf-manifest.json', { files: {} }) || { files: {} };
const previous = readJSON('data/files.json', { files: [] }) || { files: [] };
const prevById = new Map((previous.files || []).map((f) => [f.id, f]));

const rows = [];
const files = [];
const warnings = [];

for (const src of sources.files || []) {
  const rel = String(src.file || '').replace(/^\.\//, '');
  const abs = p(rel);
  const meta = manifest.files?.[src.file] || manifest.files?.[rel] || {};

  let bytes = null;
  let pages = null;

  if (existsSync(abs)) {
    const stat = statSync(abs);
    bytes = stat.size;
    try {
      pages = countPages(readFileSync(abs));
    } catch (error) {
      warnings.push(`${src.file}: 页数统计失败（${error.message}）`);
    }
  } else {
    warnings.push(`${src.file}: 文件不存在，请把 PDF 放进 pdf/ 目录`);
  }

  if (!pages) pages = meta.pages || src.pagesHint || prevById.get(src.id)?.pages || null;
  const size = bytes ? formatSize(bytes) : (meta.bytes ? formatSize(meta.bytes) : prevById.get(src.id)?.size || '—');

  files.push({
    id: src.id,
    title: src.title,
    titleEn: src.titleEn || '',
    category: src.category,
    description: src.description || '',
    file: src.file,
    size,
    pages,
    date: src.date,
    featured: src.featured === true,
    keywords: Array.isArray(src.keywords) ? src.keywords : [],
  });

  rows.push([src.id, src.category, size, pages ? `${pages} 页` : '—', src.file]);
}

const latest = files.map((f) => f.date).filter(Boolean).sort().pop() || '';

const out = {
  $comment:
    '由 tools/build-data.mjs 生成：首页与阅读页读取本文件。新增资料请编辑 data/sources.json 后重新运行脚本，' +
    '也可以直接在本文件里追加一条记录（字段：id/title/category/description/file/size/pages/date/featured/keywords）。',
  categories: sources.categories || [],
  updatedAt: latest,
  files,
};

writeFileSync(p('data/files.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n已生成 data/files.json —— ${files.length} 份资料\n`);
console.log(`${pad('ID', 26)}${pad('分类', 10)}${pad('大小', 10)}${pad('页数', 8)}路径`);
console.log('-'.repeat(78));
for (const [id, cat, size, pages, file] of rows) {
  console.log(`${pad(id, 26)}${pad(cat, 10)}${pad(size, 10)}${pad(pages, 8)}${file}`);
}
if (warnings.length) {
  console.log('\n提示：');
  for (const w of warnings) console.log(`  · ${w}`);
}
console.log('');
