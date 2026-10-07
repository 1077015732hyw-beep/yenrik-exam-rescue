#!/usr/bin/env bash
# ============================================================================
# tools/deploy.sh — 把资料馆推送到 GitHub Pages（macOS 可直接使用）
#
#   目标站点：https://1077015732hyw-beep.github.io/yenrik-exam-rescue/
#
# 为什么 macOS 能用：
#   · 这只是普通 bash 脚本，macOS 自带的 /bin/bash（3.2）即可运行；
#   · git 由 Xcode Command Line Tools 提供（没装过的话终端会提示安装）；
#   · 重建 data/files.json 优先用 node，没有 node 就自动改用系统自带 python3。
#
# 做什么：重建索引 → git 初始化/提交 → 推送 main 分支。
# 不做什么：不会删除文件，不会 force push，不会改你的远端历史。
# 可选环境变量：REPO_URL / BRANCH / SITE_URL
# ============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/1077015732hyw-beep/yenrik-exam-rescue.git}"
BRANCH="${BRANCH:-main}"
SITE_URL="${SITE_URL:-https://1077015732hyw-beep.github.io/yenrik-exam-rescue/}"

cd "$(dirname "$0")/.."
echo "仓库目录: $(pwd)"

# ---------- 0. 前置检查：git ----------
if ! command -v git >/dev/null 2>&1; then
  cat <<'TIP'
✗ 没有找到 git。

macOS 上安装 git 最简单的方式是装一次 Xcode Command Line Tools：

    xcode-select --install

装完在终端里执行 git --version 确认，然后重新运行本脚本。
TIP
  exit 1
fi

# ---------- 1. 重建资料索引（node 优先，其次 python3）----------
if [ -f data/sources.json ]; then
  if command -v node >/dev/null 2>&1; then
    echo "→ 重新生成 data/files.json（node，读取 PDF 真实大小与页数）"
    node tools/build-data.mjs >/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    echo "→ 重新生成 data/files.json（python3 备用脚本；未安装 node）"
    python3 tools/build_data.py >/dev/null
  else
    echo "! 既没有 node 也没有 python3，跳过索引重建（按现有 data/files.json 提交）"
    echo "  提示：如果刚新增了 PDF，索引里的页数/大小需要手动填，或装一个 python3。"
  fi
else
  echo "! 未找到 data/sources.json，跳过索引重建"
fi

# ---------- 2. 初始化仓库 ----------
if [ ! -d .git ]; then
  echo "→ git init"
  git init -q
fi

# ---------- 3. 远端 ----------
if git remote get-url origin >/dev/null 2>&1; then
  CURRENT="$(git remote get-url origin)"
  echo "→ 已有远端 origin: $CURRENT"
  if [ "$CURRENT" != "$REPO_URL" ]; then
    echo "  提示：要改成 $REPO_URL 可执行： git remote set-url origin $REPO_URL"
  fi
else
  echo "→ git remote add origin $REPO_URL"
  git remote add origin "$REPO_URL"
fi

# 远端可达性检查：仓库不存在时给出可执行的建议，而不是丢一段 git 报错。
# 注意不要用 --exit-code：刚创建、还没有任何提交的空仓库是合法的，
# 但 --exit-code 会因为「没有匹配的 ref」返回非 0，从而把首次部署误判为失败。
if ! git ls-remote origin >/dev/null 2>&1; then
  echo
  echo "! 远端暂时无法访问（仓库可能还没创建，或者没有登录权限）。"
  echo "  · 先在 GitHub 上新建一个 Public 仓库： yenrik-exam-rescue"
  echo "  · 如果你装了 GitHub CLI，也可以一条命令创建："
  echo "      gh repo create yenrik-exam-rescue --public --source=. --push"
  echo "  · 创建完再重新运行： bash tools/deploy.sh"
  echo
  if command -v gh >/dev/null 2>&1; then
    printf "检测到 gh。现在就用 gh 创建仓库并推送吗？[y/N] "
    read -r ANSWER || ANSWER=""
    case "$ANSWER" in
      y|Y|yes|YES)
        git add -A
        git diff --cached --quiet || git commit -q -m "digital library: 拾卷"
        git branch -M "$BRANCH"
        gh repo create yenrik-exam-rescue --public --source=. --push
        echo "完成。别忘了在仓库 Settings → Pages 里选择 main / (root)。"
        exit 0
        ;;
      *) echo "已跳过。手动创建仓库后再运行本脚本即可。" ; exit 1 ;;
    esac
  fi
  exit 1
fi

# ---------- 4. 提交 ----------
git add -A
if git diff --cached --quiet; then
  echo "→ 没有新的改动需要提交"
else
  git commit -q -m "digital library: 拾卷（${BRANCH}）"
  echo "→ 已提交本次改动"
fi

# ---------- 5. 推送（分支名统一为 main，兼容旧版默认 master）----------
git branch -M "$BRANCH"
echo "→ 推送到 origin/$BRANCH"
git push -u origin "$BRANCH"

cat <<TIP

完成。接下来在 GitHub 上确认一次：
  1. Settings → Pages → Source: Deploy from a branch
  2. Branch: $BRANCH  /  目录: /(root)  →  Save
  3. 等 1–2 分钟，访问： $SITE_URL
TIP
