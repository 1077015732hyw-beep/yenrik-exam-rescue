# 拾卷 · 个人学习资料数字图书馆

一个纯静态的学习资料馆：一位馆长上传，几位朋友翻阅。讲义、真题、图纸按**课程**归档到「书架」上，
支持分类浏览、搜索、最近加入与推荐，并且可以**在线预览**（按需加载）或直接下载原件。

- 技术栈：HTML + CSS + 原生 JavaScript（ES Modules），无构建步骤、无框架
- 依赖：只有 [PDF.js](https://mozilla.github.io/pdf.js/)（已本地内置，CDN 仅作兜底）
- 部署：可直接放到 GitHub Pages / Cloudflare Pages / Vercel 等任意静态托管
- 定位：私人资料馆——无登录、无后端、无埋点；馆长上传，朋友随便翻
- 课程分类：有机化学 / 生物化学 / 大学物理 / 工程制图 / 中国近代史纲要 / 其他
- 在线预览：**PDF、DXF 图纸、STL 模型、图片**（DXF/STL 渲染器为自研，无第三方库）；
  DWG / STEP / Office / 压缩包给出专属说明与下载入口

---

## 1. 快速开始

```bash
# 在项目根目录启动任意静态服务器（ES Modules 与 fetch 需要 http 协议，不能直接双击打开）
python3 -m http.server 8080
# 或者：npx serve .
```

打开 <http://localhost:8080/> 即可进入图书馆。

> 直接双击 `index.html`（`file://`）时，浏览器会拦截 ES Module 与 `fetch`，
> 页面会显示「请通过静态服务器打开本站」的提示，按上面的命令启动服务器即可。
> 部署到线上托管平台后不存在这个问题。

---

## 2. 目录结构

```
/
├── index.html            图书馆首页（Hero、推荐、最近加入、全部书架）
├── viewer.html           阅读页（左侧资料信息 + 右侧 PDF 阅读器）
├── thanks.html           致谢 / 版权页（Colophon）
├── manifest.webmanifest  加到主屏幕用的 Web App Manifest
├── sw.js                 Service Worker（外壳预缓存 + 按需缓存看过的 PDF）
├── .github/workflows/
│   └── update-index.yml  纯网页上传时自动补全 data/files.json（可选，可删）
├── 404.html              静态托管平台的兜底页
├── css/
│   ├── base.css          设计令牌、重置、通用组件
│   ├── library.css       首页：Hero、3D 舞台、资料卡、书架、筛选
│   ├── viewer.css        阅读页与阅读器
│   └── thanks.css        版权页与致谢页
├── js/
│   ├── util.js           工具函数、JSON 读取与规范化、URL 解析
│   ├── catalog.js        资料卡 / 台账 / 分类导航模板
│   ├── progress.js       阅读进度记忆（localStorage，无后端）
│   ├── filetypes.js      按扩展名判定类型与可预览性
│   ├── dxf-view.js       自研 DXF 二维图纸渲染（图层颜色 / 块引用 / bulge 圆弧）
│   ├── stl-view.js       自研 STL 三维渲染（软件光栅化 + 平面着色 + 线框）
│   ├── pwa.js            注册 Service Worker / 「安装到主屏幕」入口
│   ├── hero.js           Hero 的轻微视差（只改 CSS 变量）
│   ├── home.js           首页控制器（分类、排序、搜索、状态同步）
│   └── viewer.js         PDF.js 阅读器（按需加载、翻页、缩放、全屏、复制链接）
├── data/
│   ├── files.json        运行时资料索引（首页与阅读页唯一数据来源）
│   └── sources.json      资料源清单（新增资料时编辑它，可一键重建索引）
├── pdf/
│   ├── organic-chemistry/  biochemistry/  physics/  drawing/  history/  other/
├── assets/
│   ├── icons.svg         SVG 图标精灵
│   ├── favicon.svg       站点图标
│   ├── icon-192.png / icon-512.png / icon-maskable-512.png / apple-touch-icon.png
│   └── paper-grain.webp  纸张颗粒纹理（7 KB）
├── vendor/pdfjs/         内置的 PDF.js（pdf.js + pdf.worker.js，用 .js 保证 MIME 正确）
└── tools/
    ├── build-data.mjs    由 sources.json 生成 data/files.json（读取 PDF 真实大小与页数）
    ├── build_data.py     同上，Python 版（与 Node 版输出逐字节一致）
    ├── add-material.sh   交互式上架资料（问一遍元数据 → 落盘 → 重建索引 → 可选部署）
    ├── deploy.sh         一键推送到 GitHub Pages（macOS 自带 bash + python3 即可运行）
    └── make-pdfs.mjs     示例资料的生成脚本（可选，仅用于演示数据）
```

---

## 3. 新增一份资料

**方式 A（推荐，两步）**

1. 把 PDF 放进对应学科目录，例如 `pdf/biology/general-biology.pdf`；
2. 在 `data/sources.json` 的 `files` 数组里增加一条：

```json
{
  "id": "general-biology",
  "title": "普通生物学",
  "titleEn": "General Biology",
  "category": "生物学",
  "description": "课程学习资料：细胞、遗传与进化的核心章节笔记。",
  "file": "./pdf/biology/general-biology.pdf",
  "date": "2026-10-07",
  "featured": true,
  "keywords": ["细胞", "遗传", "进化"]
}
```

3. 运行 `node tools/build-data.mjs`：脚本会读取 PDF 的真实文件大小并统计页数，
   然后重写 `data/files.json`。

**方式 B（不想用脚本）**

直接把 PDF 放进 `pdf/` 目录，然后在 `data/files.json` 的 `files` 数组里追加一条记录，
`size` / `pages` 手写即可：

```json
{
  "title": "普通生物学",
  "category": "生物学",
  "description": "课程学习资料",
  "file": "./pdf/biology/general-biology.pdf",
  "size": "24 MB",
  "pages": 186,
  "date": "2026-10-07",
  "featured": false,
  "keywords": ["细胞", "遗传"]
}
```

**两种情况都不需要改动 HTML / CSS / JS**：

- 出现新分类时，把分类名加进 `data/files.json`（或 `sources.json`）的 `categories` 数组即可，
  分类导航会自动生成并统计数量；不在数组中的分类会按出现顺序追加在最后。
- 「最近加入」按 `date` 倒序自动取最新 4 份；`featured: true` 的资料会自动进入「推荐资料」。
- `id` 建议使用文件名（英文、短横线），它决定阅读页地址 `viewer.html?id=xxx`。

---

## 4. 在线阅读（PDF.js）

- 首页**不会**加载任何 PDF 和 PDF.js，只有点击「预览」进入阅读页后才按需加载。
- 阅读页会先渲染资料信息，然后**动态 import** `vendor/pdfjs/pdf.js`；
  若本地文件缺失，自动改用 jsDelivr CDN（`pdfjs-dist@4.10.38`）。
- 浏览器处于省流模式（`navigator.connection.saveData`）或离线时，不自动请求 PDF，
  而是显示「在线阅读」按钮，由用户决定。
- 加载失败（网络、路径错误、文件损坏）时显示「暂时无法在线预览」与醒目的「下载 PDF」按钮。

阅读器快捷键：

| 按键 | 作用 |
| --- | --- |
| `←` / `→`、`PageUp` / `PageDown` | 上一页 / 下一页 |
| `Home` / `End` | 第一页 / 最后一页 |
| `+` / `-` | 放大 / 缩小 |
| `0` | 适应宽度 |
| `f` | 全屏 |

阅读页也支持移动端：阅读器占据主要屏幕，资料信息可折叠（开关在顶栏），翻页与缩放按钮 44px。

**阅读进度与分享（给朋友用的两个小功能）**

- 读到第 2 页及以后会自动记住位置（`localStorage`，键名 `shijuan:progress:v1`，纯前端、无后端）。
  下次打开这份资料会提示「上次读到第 N 页 + 继续阅读」；首页对应资料卡上会显示进度条，
  「预览」按钮变成「继续阅读」。
- 顶栏「复制链接」会复制带页码的地址（`viewer.html?id=xxx#page=7`），方便直接丢进群里；
  对方打开后会落在同一页。

---

## 4.5 支持的格式与在线预览

| 格式 | 站内预览 | 说明 |
| --- | --- | --- |
| `.pdf` | ✅ PDF.js | 翻页、缩放、适应宽度、全屏、阅读进度记忆 |
| `.dxf` | ✅ 自研二维渲染 | 图框、直线、圆、弧、多段线（含 bulge 圆角）、文字、椭圆、块引用（INSERT，支持缩放/旋转/嵌套）；按图层与 ACI 颜色上色；适应窗口 / 滚轮缩放 / 拖拽平移 |
| `.stl` | ✅ 自研三维渲染 | 二进制与 ASCII 都支持；正交投影 + 画家算法 + 平面着色（亮度分档后批量绘制，手机上也能拖）；拖拽旋转、滚轮缩放、线框切换、重置视角 |
| `.png .jpg .jpeg .webp .gif .svg .avif .bmp` | ✅ 图片查看 | 适应宽度 / 缩放 |
| `.dwg .dwt .dws` | ⛔ 仅下载 | DWG 是 AutoCAD 专有格式，浏览器无法解析。**建议馆长从 CAD 另存一份 DXF 或 PDF 一起上传**，朋友就能在线看图 |
| `.step .stp .iges .igs .obj` | ⛔ 仅下载 | 可另存一份 STL 一起上传 |
| `.doc .docx .ppt .pptx .xls .xlsx …` | ⛔ 仅下载 | 想在线翻阅请同时导出一份 PDF |
| `.zip .rar .7z …` | ⛔ 仅下载 | — |

类型由扩展名自动判定；也可在该条资料里显式写 `"type": "dxf"` 覆盖（例如把其实是 DXF 的 `.dwg` 标出来）。
不能预览的格式不会静默失败，而是显示「暂时无法在线预览」+ 该格式专属解释 + 醒目的下载按钮。

## 5. 手机端适配

手机端按「一屏能读完一页 PDF」来设计，而不是把桌面版压缩：

- **触控目标**：主要按钮 46px、阅读器工具栏按钮 44px、分类标签 42px、顶栏图标 44px；
  快捷分类与关键词标签设为 `flex: none`，宁可换行也不被压扁挤出屏幕。
- **安全区**：`viewport-fit=cover` + `env(safe-area-inset-bottom)`，底部手势条不会挡住工具栏与提示。
- **防止 iOS 聚焦放大**：所有表单控件（搜索框、排序下拉、页码输入）字号 ≥ 16px。
- **阅读器占满屏幕**：移动端阅读页用弹性布局，折叠资料信息后阅读区占 844px 中的 786px（93%）；
  「资料信息」开关移到顶栏图标，不再单独占一行；横屏 / 矮屏自动隐藏资料信息。
- **滑动翻页**：单指左右滑动翻页（55px 阈值、纵向滚动与放大后的横向拖动都不受影响），
  首次进入有 3 秒的「← 左右滑动翻页 →」浮层提示，开始翻页即收起。
- **性能**：移动端关闭全屏 fixed + `mix-blend-mode` 的纸张颗粒层、去掉筛选栏毛玻璃，
  并减少 3D 与入场动画，滚动更稳。
- **布局**：书架、推荐、致谢均为单列；320 / 360 / 390 / 430px 四档宽度下均无横向溢出。

## 5.5 加到主屏幕与离线使用（PWA）

站点带 Web App Manifest 与 Service Worker，手机浏览器里可以「添加到主屏幕」，
打开后没有地址栏，和 App 一样；看过的资料断网也能翻。

- **添加到主屏幕**：页脚有「安装到主屏幕」入口。Android/Chrome 走系统原生安装提示；
  iOS Safari 不支持该事件，入口常显，点击后给出「分享 → 添加到主屏幕」的说明。
- **离线**：外壳（HTML/CSS/JS/图标）安装时预缓存；`data/files.json` 采用 network-first，
  断网时用缓存里的索引，书架照常显示。
- **离线看 PDF**：只有**你打开过**的 PDF 才会进缓存（最多 12 份，LRU 淘汰），
  首页依然不会自动请求任何 PDF。为此阅读器关闭了 Range 分段请求
  （`disableRange: true`）——一次取回整份文件，Service Worker 才能缓存它；
  学习资料通常不到 1 MB，代价可以忽略。
- **缓存版本**：`sw.js` 顶部的 `VERSION` 变更即整体换新（旧的自动清理）。
  改完样式/脚本如果想让所有人立刻拿到新版本，把 `VERSION` 加一即可。

## 6. 视觉与动效说明

- 米白纸张底色 + 墨色文字 + 极细边框，只有一处低饱和的「印章红」作为强调色。
- Hero 中的悬浮书本、PDF 文件与透明几何体全部是 CSS 3D（`perspective` + `transform`），
  没有 WebGL、没有 3D 模型、没有视频背景；鼠标移动只改变两个 CSS 变量，交给合成层处理。
- 移动端（≤ 860px）完全移除 3D 舞台与浮动动画。
- 全站遵循 `prefers-reduced-motion`：开启后取消浮动、视差与入场动画。
- 图片只有一张 7 KB 的 WebP 纸张纹理，图标全部为内联 SVG 精灵。

---

## 6.5 三种「上架资料」的方式（都不需要后端）

静态站点没有任何服务端进程，所以**上传永远发生在 GitHub（或你的电脑）上，而不是网页里**。
三条路，按省事程度排：

| 方式 | 需要什么 | 适合 |
| --- | --- | --- |
| **A. 本地脚本（推荐，已实现）** `bash tools/add-material.sh` | 电脑上有 git + python3（macOS 自带） | 手上就有 PDF，想一次问完、一键发布 |
| **B. GitHub 网页上传** | 只要浏览器（手机也行） | 临时补一份资料，或不在电脑前 |
| **C. B + 自动补索引（已内置）** | 只要浏览器 | 同上，但连「页数/文件大小」都不用填 |

**A 的用法**（交互式，边问边填，全程不用手写 JSON）：

```bash
bash tools/add-material.sh              # 上架一份资料
bash tools/add-material.sh --dry-run    # 只检查、不写任何文件
bash tools/add-material.sh --move       # 移动原文件（默认复制，原文件留着）
bash tools/add-material.sh --undo       # 撤销上一次上架（恢复 sources.json 备份）
bash tools/add-material.sh --no-deploy  # 结尾不再问「是否部署」
```

它会：校验 PDF（类型/大小）→ 目录名由分类自动决定（实验资料、课程资料会追问具体学科）
→ 生成合规的英文 id（文件名是中文时就问你一次）→ 复制进 `pdf/<学科>/`
→ 在 `data/sources.json` 追加一条（保持原有排版，写前先备份）→ 运行索引脚本实测大小与页数
→ 问你要不要顺手部署。写错字、填错分类都可以 `--undo` 回退。

**B 的步骤**：仓库页面 → `pdf/<学科>/` → *Add file → Upload files* 上传 PDF；
再到 `data/sources.json` 里加一条记录（`title` / `category` / `description` / `file` / `date` 必填，
`pages` 和 `size` 可以随便填或留空）→ Commit。首页刷新即出现。

**C 已经开箱可用**：仓库里带了 `.github/workflows/update-index.yml`，只要 push 改动了
`pdf/**` 或 `data/sources.json`，GitHub Actions 就会自动运行 `tools/build_data.py`，
用它测出的真实字节数与页数覆写 `data/files.json` 并提交，Pages 随即发布。
不需要本地装任何东西；用不到这个工作流，直接删掉该文件也不影响站点。

另外，即使 `pages` 写错或没填，**阅读页也会用 PDF.js 实测的页数自动纠正**，
资料卡上则优雅显示「—」，所以手改 JSON 不会把页面弄坏。

> 想要「在网页里拖拽上传、朋友也能传」这种真·上传？那必须有后端（Cloudflare Pages Functions、
> Vercel Serverless，或 Supabase 之类的存储），也就脱离了纯静态。对私人资料馆来说，
> 换来的是鉴权、滥用与维护成本——不建议。

---

## 7. 部署到 GitHub Pages

目标地址：**https://1077015732hyw-beep.github.io/yenrik-exam-rescue/**

**不需要修改任何文件里的地址。** 站内所有资源（CSS/JS/图标/`data/files.json`/PDF/PDF.js）
都基于 `document.baseURI` 与相对路径解析，因此放在 `/yenrik-exam-rescue/` 这样的子路径下同样正确。
唯一需要留意的是本地 PDF.js 用 `.js` 后缀而不是 `.mjs`——静态托管对 `.mjs` 的 MIME 处理不一致，
而 `.js` 一定以 `application/javascript` 返回，ES Module 不会被浏览器拦下。

**步骤**

```bash
# 一次性：重建索引 + 初始化 + 提交 + 推送
bash tools/deploy.sh

# 或者手动
git init
git add -A
git commit -m "digital library: 拾卷"
git branch -M main
git remote add origin https://github.com/1077015732hyw-beep/yenrik-exam-rescue.git
git push -u origin main
```

**macOS 可以直接用这个脚本**：它就是普通 bash，系统自带的 `/bin/bash`（3.2）即可运行；
git 由 Xcode Command Line Tools 提供（没装过终端会提示 `xcode-select --install`）。
重建 `data/files.json` 时优先用 `node`，**没装 Node 会自动改用系统自带的 `python3`**
（`tools/build_data.py`，与 Node 版结果完全一致）。
仓库还没创建时，脚本不会丢一段 git 报错，而是提示你先建仓库，或（若装了 `gh`）直接帮你
执行 `gh repo create yenrik-exam-rescue --public --source=. --push`。
脚本可重复运行：没有改动时只做推送，不会重复提交。

然后在 GitHub 仓库页面：**Settings → Pages → Build and deployment → Source: Deploy from a branch
→ Branch: `main` / `/(root)` → Save**。等 1–2 分钟，访问
<https://1077015732hyw-beep.github.io/yenrik-exam-rescue/> 即可。

要点：

- `.nojekyll` 已在仓库根目录，避免 Jekyll 处理 `assets/`、`vendor/`、`pdf/` 等目录。
- `404.html` 会被 Pages 自动用作站点 404 页面。
- 仓库保持 **Public**（私有仓库的 Pages 需要付费计划）。
- 单文件最大约 660 KB（`vendor/pdfjs/pdf.js`），无需 Git LFS。
- 之后每次更新资料：把 PDF 放进 `pdf/` → 改 `data/sources.json` → `bash tools/deploy.sh`（会自动重建索引并推送）。

**Cloudflare Pages / Vercel**：直接导入仓库，构建命令留空，输出目录填 `/` 即可。

---

## 8. 示例数据与空书库

**当前书库是空的**：`data/sources.json` 的 `categories` 已按五门课设好，`files` 为空数组，
`pdf/` 下保留了六个课程目录。0 份资料时首页显示「书架正在补货」空态
（自动隐藏推荐 / 最近 / 筛选栏），课程分类仍然列出，方便逐步填充。

- 上架第一份资料：`bash tools/add-material.sh`
- 想再生成一批演示 PDF：`node tools/make-pdfs.mjs`（读 `data/sources.json`，需要先自行加回条目）
- 不再需要演示生成器时可删除：`rm -rf tools/content tools/make-pdfs.mjs tools/pdf-manifest.json`
