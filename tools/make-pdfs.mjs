#!/usr/bin/env node
/**
 * tools/make-pdfs.mjs
 * ---------------------------------------------------------------------------
 * 生成个人数字图书馆的学习资料 PDF。 / Regenerate all study-material PDFs.
 *
 * 输入 / Input : data/sources.json （只读，不修改 / read-only）
 * 正文 / Body  : tools/content/*.mjs （每个条目一份中文正文与结构化内容块）
 * 输出 / Output: pdf/**\/*.pdf （路径以 sources.json 的 "file" 字段为准）
 *                .build/<id>.html （中间产物，可随时删除）
 *                tools/pdf-manifest.json （页数 + 字节数清单）
 *
 * 流程 / Pipeline:
 *   1. 读取 sources.json 与内容模块；
 *   2. 为每个条目拼一份自包含的打印用 HTML（无外链字体、无外部请求）；
 *   3. 写入 .build/<id>.html；
 *   4. 用 headless Chrome 打印为 PDF（--no-pdf-header-footer，避免页眉页脚）；
 *   5. 读取 PDF 原始字节统计页数，若某一节被挤到下一页，则按更紧凑的字号重排，
 *      保证「封面 1 页 + 每节 1 页」的总页数落在 6~10 页；
 *   6. 写出 tools/pdf-manifest.json。
 *
 * 运行 / Run: node tools/make-pdfs.mjs [--only <id>[,<id>...]] [--keep-html]
 * ---------------------------------------------------------------------------
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = path.join(ROOT, "data/sources.json");
const BUILD_DIR = path.join(ROOT, ".build");
// 每次运行使用独立且干净的 profile，避免 SingletonLock 冲突
// fresh throw-away profile per run so a stale SingletonLock can never abort Chrome
const CHROME_PROFILE = path.join(BUILD_DIR, `chrome-profile-${process.pid}`);
const MANIFEST = path.join(ROOT, "tools/pdf-manifest.json");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// 内容模块 / content modules（键为文档 id）
const CONTENT_MODULES = ["biology", "chemistry", "physics", "mathematics", "english-other"];

const CONTENT = {};
for (const name of CONTENT_MODULES) {
  const mod = await import(new URL(`./content/${name}.mjs`, import.meta.url).href);
  Object.assign(CONTENT, mod.default ?? mod);
}

/* ------------------------------------------------------------------ *
 * 工具函数 / helpers
 * ------------------------------------------------------------------ */

const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** 允许正文里的少量内联标签，其余转义 / keep a small inline-tag whitelist */
const INLINE = /<\/?(?:b|i|em|strong|code|sub|sup|br)\s*\/?>/gi;
const inline = (s) => {
  const parts = String(s ?? "").split(INLINE);
  const tags = String(s ?? "").match(INLINE) ?? [];
  let out = "";
  parts.forEach((p, i) => {
    out += esc(p) + (tags[i] ? tags[i].toLowerCase().replace(/\s+/g, "") : "");
  });
  return out;
};

/** 汉字计数 / count CJK ideographs */
const hanCount = (s) => (String(s).match(/[\u4e00-\u9fa5]/g) ?? []).length;

/* ------------------------------------------------------------------ *
 * 版面样式 / stylesheet
 * ------------------------------------------------------------------ */

const CSS = `
@page { size: A4; margin: 20mm 18mm; }

* { box-sizing: border-box; }
html { background: #fffdf9; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  font-family: "Songti SC", Georgia, "Times New Roman", serif;
  font-size: calc(10.6pt * var(--k));
  line-height: 1.74;
  color: #1a1a1a;
  background: #fffdf9;
  text-rendering: optimizeLegibility;
}
.sans { font-family: "Heiti SC", "Helvetica Neue", Helvetica, Arial, sans-serif; }

/* ---------- 封面 / cover page ---------- */
.cover { min-height: 246mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; }
.cover-top { padding-top: 6mm; }
.en-title { font-family: "Heiti SC","Helvetica Neue",Helvetica,Arial,sans-serif; font-size: 8.6pt;
  letter-spacing: .30em; text-transform: uppercase; color: #6f6a60; }
.cover h1 { font-family: "Heiti SC",Helvetica,Arial,sans-serif;
  font-size: 27pt; line-height: 1.32; font-weight: 600; letter-spacing: .02em; margin: 7mm 0 4mm; color: #14140f; }
.hair { border: 0; border-top: 1px solid #d8d4cc; margin: 0; }
.cover-meta { display: flex; flex-wrap: wrap; gap: 0 9mm; font-size: 8.8pt; color: #6f6a60;
  letter-spacing: .04em; padding: 3mm 0 0; }
.cover-meta b { font-weight: 600; color: #3d3931; }
.cover-mid { padding-top: 14mm; }
.cover-label { font-family: "Heiti SC",Helvetica,Arial,sans-serif; font-size: 8.2pt;
  letter-spacing: .22em; color: #8a8378; margin: 0 0 2.5mm; }
.cover-desc { margin: 0 0 9mm; color: #33302a; text-align: justify; }
.abstract { border-top: 1px solid #d8d4cc; border-bottom: 1px solid #d8d4cc; padding: 4.5mm 0 5mm;
  margin: 0 0 9mm; color: #2b2823; text-align: justify; font-size: .98em; }
.abstract p { margin: 0 0 2.2mm; }
.abstract p:last-child { margin-bottom: 0; }
.kw { color: #3d3931; font-size: .96em; margin: 0 0 9mm; }
.toc { margin: 0; padding: 0; list-style: none; counter-reset: toc; }
.toc li { counter-increment: toc; padding: 1.7mm 0 1.7mm 11mm; border-top: 1px solid #ece7dd;
  position: relative; color: #2b2823; font-size: .97em; }
.toc li:last-child { border-bottom: 1px solid #ece7dd; }
.toc li::before { content: counter(toc, decimal-leading-zero); position: absolute; left: 0; top: 1.9mm;
  font-size: 8.2pt; letter-spacing: .12em; color: #9a9388; }
.cover-foot { margin-top: auto; border-top: 1px solid #d8d4cc; padding-top: 3mm;
  font-size: 8.2pt; letter-spacing: .12em; color: #8a8378; display: flex; justify-content: space-between; }

/* ---------- 章节 / sections ---------- */
.section { page-break-before: always; break-before: page; }
.runhead { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm;
  font-size: 8.1pt; letter-spacing: .10em; color: #8a8378;
  border-bottom: 1px solid #d8d4cc; padding-bottom: 2mm; margin-bottom: 7.5mm; }
.runhead .run-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.runhead .run-sec { white-space: nowrap; }
h2.sec-title { font-family: "Heiti SC",Helvetica,Arial,sans-serif;
  font-size: 16.5pt; line-height: 1.42; font-weight: 600; margin: 0 0 6mm; color: #14140f; letter-spacing: .01em; }
.sec-no { display: inline-block; vertical-align: .18em; margin-right: 3.2mm; padding: .6mm 1.8mm;
  border: 1px solid #d8d4cc; font-size: 8.4pt; letter-spacing: .16em; color: #8a8378; font-weight: 400; }
.lead p { margin: 0 0 3.4mm; text-align: justify; text-justify: inter-ideograph; }
.lead p:last-child { margin-bottom: 0; }

/* ---------- 内容块 / content blocks ---------- */
.blk { border: 1px solid #d8d4cc; background: #fffefb; padding: 3.6mm 4.2mm 3.2mm;
  margin: 5mm 0 0; page-break-inside: avoid; break-inside: avoid; }
.blk-title { font-family: "Heiti SC",Helvetica,Arial,sans-serif; font-size: 8.4pt;
  letter-spacing: .12em; color: #4a443c; margin: 0 0 2.8mm; padding-bottom: 1.8mm;
  border-bottom: 1px solid #ece7dd; }
.blk-title::before { content: "▪"; color: #b9b1a1; margin-right: 1.6mm; }
.blk table { width: 100%; border-collapse: collapse; font-size: .93em; }
.blk th, .blk td { border: 1px solid #cfc9bf; padding: 1.5mm 2.2mm; text-align: left; vertical-align: top; }
.blk th { background: #f2eee5; font-weight: 600; font-family: "Heiti SC",Helvetica,Arial,sans-serif;
  font-size: .92em; letter-spacing: .03em; color: #3d3931; }
.blk dl { display: grid; grid-template-columns: 33mm 1fr; margin: 0; }
.blk dt { border-top: 1px solid #ece7dd; padding: 1.7mm 3mm 1.7mm 0; font-weight: 600; color: #26231e; }
.blk dd { border-top: 1px solid #ece7dd; padding: 1.7mm 0; margin: 0; color: #36322c; }
.blk dt:first-of-type, .blk dd:first-of-type { border-top: 0; }
.blk ul, .blk ol { margin: 0; padding: 0; list-style: none; }
.blk li { position: relative; padding-left: 5.2mm; margin-bottom: 1.8mm; color: #26231e; }
.blk li:last-child { margin-bottom: 0; }
.blk li::before { content: "·"; position: absolute; left: 1.2mm; top: -.2mm; color: #9a9388; font-weight: 700; }
.blk.box { border-left: 3px solid #1a1a1a; background: #faf6ec; }
.blk.box li::before { content: "▸"; font-size: .8em; top: .3mm; }
.blk.steps li { padding-left: 0; margin-bottom: 2.2mm; }
.blk.steps li::before { content: none; }
.blk.steps li + li { border-top: 1px solid #ece7dd; padding-top: 2.2mm; }
.blk.fig { background: #fffefb; }

/* 条形图 / bar figure */
.bars { margin: 0; }
.bar-row { display: flex; align-items: center; gap: 3mm; margin-bottom: 1.9mm; font-size: .92em; }
.bar-row:last-child { margin-bottom: 0; }
.bar-label { flex: 0 0 36mm; color: #26231e; }
.bar-track { flex: 1 1 auto; height: 4.2mm; background: #f2eee5; border: 1px solid #e2dccf; }
.bar-track i { display: block; height: 100%; background: #bdb5a4; }
.bar-val { flex: 0 0 44mm; color: #4a443c; font-size: .9em; }

/* 流程图 / flow figure */
.flow { display: flex; flex-wrap: wrap; align-items: center; gap: 1.8mm 2mm; }
.flow-node { border: 1px solid #cfc9bf; background: #faf7f0; padding: 1.8mm 3mm; font-size: .9em; color: #26231e; }
.flow-arrow { color: #b9b1a1; font-size: .9em; }

/* 层级图 / layered figure */
.levels { margin: 0; }
.level-row { display: flex; align-items: baseline; gap: 3mm; margin-bottom: 1.7mm; font-size: .93em; }
.level-idx { flex: 0 0 7mm; text-align: center; font-size: .82em; color: #8a8378; border: 1px solid #e2dccf; }
.level-name { flex: 0 0 38mm; font-weight: 600; color: #26231e; }
.level-desc { flex: 1 1 auto; color: #36322c; }
`;

/* ------------------------------------------------------------------ *
 * 内容块渲染 / block renderers
 * ------------------------------------------------------------------ */

function blockHtml(b) {
  const title = b.title ? `<div class="blk-title">${inline(b.title)}</div>` : "";
  switch (b.t) {
    case "dl":
      return `<div class="blk dl">${title}<dl>${(b.items ?? [])
        .map(([k, v]) => `<dt>${inline(k)}</dt><dd>${inline(v)}</dd>`)
        .join("")}</dl></div>`;

    case "table":
      return `<div class="blk table">${title}<table><thead><tr>${(b.head ?? [])
        .map((h) => `<th>${inline(h)}</th>`)
        .join("")}</tr></thead><tbody>${(b.rows ?? [])
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`;

    case "box":
      return `<div class="blk box">${title}<ul>${(b.items ?? [])
        .map((i) => `<li>${inline(i)}</li>`)
        .join("")}</ul></div>`;

    case "steps":
      return `<div class="blk steps">${title}<ol>${(b.items ?? [])
        .map((i) => `<li>${inline(i)}</li>`)
        .join("")}</ol></div>`;

    case "fig": {
      const kind = b.kind ?? "bars";
      if (kind === "flow") {
        const nodes = b.nodes ?? [];
        const inner = nodes
          .map((n, i) => `<span class="flow-node">${inline(n)}</span>${i < nodes.length - 1 ? '<span class="flow-arrow">→</span>' : ""}`)
          .join("");
        return `<div class="blk fig">${title}<div class="flow">${inner}</div></div>`;
      }
      if (kind === "levels") {
        const rows = (b.items ?? [])
          .map(([name, desc], i) => {
            const indent = i * 4; // 阶梯式缩进，形成层级感 / staircase indent
            return `<div class="level-row" style="margin-left:${indent}mm"><span class="level-idx">${i + 1}</span><span class="level-name">${inline(name)}</span><span class="level-desc">${inline(desc)}</span></div>`;
          })
          .join("");
        return `<div class="blk fig">${title}<div class="levels">${rows}</div></div>`;
      }
      // bars（默认）
      const rows = (b.items ?? [])
        .map(([label, val, pct]) => {
          const w = Math.max(2, Math.min(100, Number(pct) || 0));
          return `<div class="bar-row"><span class="bar-label">${inline(label)}</span><span class="bar-track"><i style="width:${w}%"></i></span><span class="bar-val">${inline(val ?? "")}</span></div>`;
        })
        .join("");
      return `<div class="blk fig">${title}<div class="bars">${rows}</div></div>`;
    }

    default:
      return "";
  }
}

/* ------------------------------------------------------------------ *
 * 整页渲染 / page renderers
 * ------------------------------------------------------------------ */

function coverHtml(entry, sections, totalPages) {
  const abs = String(entry.abstract ?? "").split(/\n{1,}/).filter(Boolean);
  const keywords = (entry.keywords ?? []).join(" · ");
  return `
<div class="cover">
  <div class="cover-top">
    <div class="en-title">${esc(entry.titleEn)}</div>
    <hr class="hair" style="margin-top:4mm">
    <h1>${esc(entry.title)}</h1>
    <div class="cover-meta">
      <span>类别 <b>${esc(entry.category)}</b></span>
      <span>编号 <b>${esc(entry.id)}</b></span>
      <span>更新 <b>${esc(entry.date ?? "")}</b></span>
      <span>篇幅 <b>${totalPages} 页 / ${sections.length} 节</b></span>
    </div>
  </div>

  <div class="cover-mid">
    <div class="cover-label">内容简介</div>
    <p class="cover-desc">${inline(entry.description ?? "")}</p>

    <div class="cover-label">摘要 · 适用范围</div>
    <div class="abstract">${abs.map((p) => `<p>${inline(p)}</p>`).join("")}</div>

    ${keywords ? `<div class="cover-label">关键词</div><div class="kw">${esc(keywords)}</div>` : ""}

    <div class="cover-label">目录</div>
    <ol class="toc">${sections.map((s) => `<li>${inline(s.h)}</li>`).join("")}</ol>
  </div>

  <div class="cover-foot">
    <span>个人学习档案 · 内部学习资料</span>
    <span>${esc(entry.titleEn)}</span>
  </div>
</div>`;
}

function sectionHtml(entry, s, idx, total) {
  const no = String(idx + 1).padStart(2, "0");
  const lead = String(s.lead ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return `
<section class="section">
  <div class="runhead">
    <span class="run-title">${esc(entry.title)} · ${esc(entry.titleEn)}</span>
    <span class="run-sec">第 ${idx + 1} 节 / 共 ${total} 节</span>
  </div>
  <h2 class="sec-title"><span class="sec-no">${no}</span>${inline(s.h)}</h2>
  <div class="lead">${lead.map((p) => `<p>${inline(p)}</p>`).join("")}</div>
  ${(s.blocks ?? []).map(blockHtml).join("\n  ")}
</section>`;
}

function documentHtml(entry, content, k, totalPages) {
  const sections = content.sections ?? [];
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(entry.title)} · ${esc(entry.titleEn)}</title>
<style>:root { --k: ${k}; }${CSS}</style>
</head>
<body>
${coverHtml({ ...entry, abstract: content.abstract }, sections, totalPages)}
${sections.map((s, i) => sectionHtml(entry, s, i, sections.length)).join("\n")}
</body>
</html>`;
}

/* ------------------------------------------------------------------ *
 * PDF 处理 / PDF utilities
 * ------------------------------------------------------------------ */

/** 统计页数：优先数 "/Type /Page"（排除 /Pages），再与 /Count 交叉核对 */
function countPages(buf) {
  const s = buf.toString("latin1");
  const pageObjs = (s.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  let counts = [...s.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,200}?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  if (!counts.length) counts = [...s.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  const declared = counts.length ? Math.max(...counts) : 0;
  return { pageObjs, declared };
}

/** 同步睡眠（Node 主线程上 Atomics.wait 可用）/ synchronous sleep */
const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms) => {
  try {
    Atomics.wait(sleepBuf, 0, 0, ms);
  } catch {
    // 兜底：极端环境下退回外部 sleep
    spawn("/bin/sleep", [String(ms / 1000)], { stdio: "ignore" }).unref();
  }
};

/**
 * 用 headless Chrome 打印 PDF。
 * 注意：headless Chrome 打印完成后并不总会自己退出，因此这里 spawn 之后轮询目标文件，
 * 等 PDF 写完整（体积稳定且含 %%EOF）就立刻 SIGKILL，避免脚本挂死。
 */
function printPdf(htmlPath, pdfPath) {
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  fs.rmSync(pdfPath, { force: true });

  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--disable-dev-shm-usage",
    `--crash-dumps-dir=${path.join(BUILD_DIR, "crash")}`,
    `--user-data-dir=${CHROME_PROFILE}`,
    "--no-pdf-header-footer", // 关闭 URL / 日期页眉页脚
    "--print-to-pdf-no-header", // 旧版等价开关，双保险
    "--virtual-time-budget=3000",
    `--print-to-pdf=${pdfPath}`,
    `file://${htmlPath}`,
  ];

  const child = spawn(CHROME, args, { stdio: "ignore" });
  const deadline = Date.now() + 60_000;
  let lastSize = -1;
  let ok = false;

  while (Date.now() < deadline) {
    sleepSync(120);
    if (!fs.existsSync(pdfPath)) continue;
    const size = fs.statSync(pdfPath).size;
    if (size > 0 && size === lastSize) {
      // 体积两次采样一致，再确认文件结构完整
      const tail = fs.readFileSync(pdfPath).subarray(-2048).toString("latin1");
      if (tail.includes("%%EOF")) {
        ok = true;
        break;
      }
    }
    lastSize = size;
  }

  if (child.exitCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  if (!ok) throw new Error(`Chrome 打印失败或超时 / print failed or timed out: ${htmlPath}`);
}

/* ------------------------------------------------------------------ *
 * 主流程 / main
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const onlyArg = argv.indexOf("--only");
const only = onlyArg >= 0 && argv[onlyArg + 1] ? new Set(argv[onlyArg + 1].split(",")) : null;
const patchArg = argv.indexOf("--patch");
const patchDir = patchArg >= 0 && argv[patchArg + 1] ? path.resolve(ROOT, argv[patchArg + 1]) : null;
const writeManifest = !argv.includes("--no-manifest");

/**
 * 试排用的正文覆盖：若 <patchDir>/<id>.json 存在，就用它替代 tools/content 中的正文。
 * 只用于内容压缩/校版时反复试排，最终仍需把结果并回 tools/content/*.mjs。
 */
function loadPatched(id) {
  if (!patchDir) return null;
  const p = path.join(patchDir, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  return data.sections ? data : (data[id] ?? null);
}

const sources = JSON.parse(fs.readFileSync(SOURCES, "utf8"));
const entries = only ? sources.files.filter((f) => only.has(f.id)) : sources.files;

fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.rmSync(CHROME_PROFILE, { recursive: true, force: true });
fs.mkdirSync(CHROME_PROFILE, { recursive: true });
fs.mkdirSync(path.join(BUILD_DIR, "crash"), { recursive: true });

// 从松到紧的字号档位；哪一档能让「每节恰好一页」就用哪一档
const DENSITY = [1, 0.96, 0.92, 0.88, 0.84];

const manifest = { generatedAt: new Date().toISOString(), files: {} };
const report = [];
const problems = [];

for (const entry of entries) {
  const patched = loadPatched(entry.id);
  const content = patched ?? CONTENT[entry.id];
  if (!content) {
    problems.push(`${entry.id}: tools/content/*.mjs 中缺少该条目的内容`);
    continue;
  }
  const outline = entry.outline ?? [];
  if ((content.sections ?? []).length !== outline.length) {
    problems.push(`${entry.id}: sections ${content.sections?.length} != outline ${outline.length}`);
  }
  for (let i = 0; i < Math.min(outline.length, (content.sections ?? []).length); i++) {
    if (content.sections[i].h !== outline[i]) {
      problems.push(`${entry.id}: 第 ${i + 1} 节标题与 outline 不一致: "${content.sections[i].h}" != "${outline[i]}"`);
    }
  }

  const rel = entry.file.replace(/^\.\//, "");
  const pdfAbs = path.join(ROOT, rel);
  const expected = 1 + (content.sections ?? []).length; // 封面 + 每节 1 页

  let best = null;
  let writtenK = null;
  for (const k of DENSITY) {
    const html = documentHtml(entry, content, k, expected);
    const htmlAbs = path.join(BUILD_DIR, `${entry.id}.html`);
    fs.writeFileSync(htmlAbs, html, "utf8");
    printPdf(htmlAbs, pdfAbs);
    writtenK = k;

    const buf = fs.readFileSync(pdfAbs);
    const { pageObjs, declared } = countPages(buf);
    const pages = pageObjs || declared;
    const candidate = { k, pages, bytes: buf.length };

    if (!best || pages < best.pages) best = candidate;
    if (process.env.PDF_DEBUG) console.log(`    [debug] ${entry.id} k=${k} -> ${pages} 页 / ${(buf.length / 1024).toFixed(0)}KB`);
    if (pages <= expected && pages >= 6 && pages <= 10) break; // 已达标，用这一档
  }

  // 若最终停在磁盘上的不是页数最少的档位，再补渲染一次，保证「文件 = 清单 = 报告」
  if (best && best.k !== writtenK) {
    fs.writeFileSync(
      path.join(BUILD_DIR, `${entry.id}.html`),
      documentHtml(entry, content, best.k, expected),
      "utf8"
    );
    printPdf(path.join(BUILD_DIR, `${entry.id}.html`), pdfAbs);
  }

  const buf = fs.readFileSync(pdfAbs);
  const startOk = buf.subarray(0, 5).toString("latin1") === "%PDF-";
  const tail = buf.subarray(-1024).toString("latin1");
  const endOk = tail.includes("%%EOF");
  const { pageObjs, declared } = countPages(buf);
  const pages = pageObjs || declared;

  if (!startOk) problems.push(`${entry.id}: 缺少 %PDF- 头`);
  if (!endOk) problems.push(`${entry.id}: 缺少 %%EOF 尾`);
  if (pageObjs !== declared) problems.push(`${entry.id}: /Type /Page=${pageObjs} 与 /Count=${declared} 不一致`);
  if (pages < 6 || pages > 10) problems.push(`${entry.id}: 页数 ${pages} 不在 6~10`);
  if (buf.length < 20 * 1024) problems.push(`${entry.id}: 体积 ${buf.length} 字节 < 20KB`);
  if (buf.length > 600 * 1024) problems.push(`${entry.id}: 体积 ${buf.length} 字节 > 600KB`);

  manifest.files[entry.file] = { id: entry.id, pages, bytes: buf.length };
  report.push({
    id: entry.id,
    file: entry.file,
    pages,
    declared,
    kb: (buf.length / 1024).toFixed(1),
    k: best?.k,
    sections: (content.sections ?? []).length,
  });
  const fit = pages <= expected ? "每节 1 页 ✓" : `超出 ${pages - expected} 页`;
  console.log(
    `✓ ${entry.id.padEnd(30)} ${String(pages).padStart(2)} 页  ${(buf.length / 1024).toFixed(1).padStart(6)} KB  k=${best?.k}  (期望 ${expected} 页, ${fit})`
  );
}

if (writeManifest) {
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`\n共 ${report.length} 份，清单已写入 ${path.relative(ROOT, MANIFEST)}`);
} else {
  console.log(`\n共 ${report.length} 份（--no-manifest：未写清单）`);
}
if (problems.length) {
  console.error("\n发现问题 / problems:");
  for (const p of problems) console.error("  ✗ " + p);
  process.exitCode = 1;
} else {
  console.log("全部校验通过：页数 6~10、体积 20KB~600KB、%PDF- 头与 %%EOF 尾齐全。");
}
