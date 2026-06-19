# 期末复习材料 · Exam Rescue

> 雁塔提名（Yanta Archive）旗下的大学期末复习资料库。

一个纯静态网站，基于 GitHub Pages 部署，支持 PDF 在线预览、下载、阅读进度记忆等功能。

## 功能

- **PDF 在线预览** — 基于 PDF.js，双 CDN 回退，支持翻页 / 缩放 / 键盘操作
- **继续阅读** — 自动记住上次看到哪份资料、第几页
- **最近浏览** — 首页展示最近打开过的资料
- **标签系统** — 资料支持「高频考点」「必背」「自测」等标签筛选
- **全站统计** — 首页显示资料数 / 总页数 / 科目数 / 更新次数
- **最近更新** — 首页展示更新时间线
- **暗色模式** — 跟随系统 + 手动切换，PDF 支持反色护眼
- **PWA** — 可添加到手机桌面
- **自定义 404** — 不用 GitHub 默认页面
- **面包屑导航** — 知道自己在哪
- **资料筛选与排序** — 按标签筛选、按时间或名称排序
- **分享链接** — 一键复制当前资料页地址

## 科目

| 科目 | 资料数 |
|------|--------|
| 高等数学 | 2 |
| 线性代数 | 2 |
| 马克思主义基本原理 | 2 |
| 大学英语 | 2 |

## 技术栈

- HTML / CSS / JavaScript（无框架、无后端）
- PDF.js（CDN 加载，双源回退）
- localStorage（阅读进度、最近浏览、主题偏好）
- Service Worker（离线缓存）
- GitHub Pages（托管）

## 项目结构

```
.
├── index.html              # 首页
├── 404.html                # 自定义 404
├── manifest.json           # PWA 配置
├── css/
│   └── style.css           # 全局样式
├── js/
│   ├── app.js              # 主逻辑
│   ├── pdf-viewer.js       # PDF 预览器
│   └── sw.js               # Service Worker
├── data/
│   ├── subjects.json       # 科目数据
│   ├── resources.json      # 资料数据（含标签、页数）
│   └── updates.json        # 更新记录
├── pages/
│   ├── exam-rescue.html    # 资料库入口
│   ├── advanced-math.html  # 高等数学
│   ├── linear-algebra.html # 线性代数
│   ├── marxism.html        # 马克思主义基本原理
│   ├── college-english.html# 大学英语
│   ├── resource.html       # PDF 预览页
│   ├── about.html          # 关于
│   └── acknowledgements.html # 鸣谢
├── assets/
│   ├── logos/              # Logo
│   ├── banners/            # 横幅
│   ├── covers/             # 科目封面
│   └── icons/              # 图标
└── pdf/                    # PDF 文件
    ├── advanced-math/
    ├── linear-algebra/
    ├── marxism/
    └── college-english/
```

## 本地预览

```bash
# 进入项目目录
cd yanta-archive

# 启动本地服务器（任选一种）
python3 -m http.server 8080
# 或
npx serve
```

浏览器打开 `http://localhost:8080` 即可。

## 部署到 GitHub Pages

1. 创建一个 GitHub 仓库
2. 将项目文件推送到仓库根目录
3. 进入仓库 Settings → Pages
4. Source 选择 `main` 分支，目录选 `/ (root)`
5. 保存，等待 1-2 分钟即可访问

## 更新资料

1. 将 PDF 文件放入 `pdf/` 对应科目目录
2. 编辑 `data/resources.json`，添加新资料条目
3. 编辑 `data/updates.json`，添加更新记录
4. 推送到 GitHub，自动部署

## 免责声明

所有资料均为个人整理，仅供学习参考，不构成任何考试保证。请以任课教师发布的官方材料为准。如发现资料内容有错漏，欢迎联系反馈，会及时勘误。资料仅供个人学习使用，请勿用于商业用途。

---

© 2026 雁塔提名 · Yanta Archive
