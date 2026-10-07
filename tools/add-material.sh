#!/usr/bin/env bash
# ============================================================================
# tools/add-material.sh — 上架一份学习资料（给「馆长」用的）
#
#   把 PDF 放进 pdf/<学科>/ → 往 data/sources.json 追加一条记录
#   → 重建 data/files.json（自动测真实大小与页数）→ 可选：直接部署
#
# 用法：
#   bash tools/add-material.sh               # 交互式上架
#   bash tools/add-material.sh --dry-run     # 只打印将要写入的内容，不改任何文件
#   bash tools/add-material.sh --move        # 移动原文件（默认是复制，原文件保留）
#   bash tools/add-material.sh --undo        # 撤销上一次上架（恢复 sources.json 备份）
#   bash tools/add-material.sh --no-deploy   # 结尾不再询问是否部署
#
# 依赖：macOS 自带 bash(3.2) + python3；有 node 就用 node 重建索引，没有就用 python3。
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SOURCES="data/sources.json"
BACKUP="data/sources.json.bak"
DRY_RUN=0
MOVE=0
UNDO=0
ASK_DEPLOY=1

for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --move)      MOVE=1 ;;
    --undo)      UNDO=1 ;;
    --no-deploy) ASK_DEPLOY=0 ;;
    -h|--help)   sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$arg（试试 --help）" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- 工具函数
c_reset=$'\033[0m'; c_dim=$'\033[2m'; c_bold=$'\033[1m'; c_red=$'\033[31m'; c_green=$'\033[32m'
say()  { printf '%s\n' "$*"; }
dim()  { printf '%s%s%s\n' "$c_dim" "$*" "$c_reset"; }
ok()   { printf '%s✓%s %s\n' "$c_green" "$c_reset" "$*"; }
die()  { printf '%s✗ %s%s\n' "$c_red" "$*" "$c_reset" >&2; exit 1; }

need_python() {
  command -v python3 >/dev/null 2>&1 && return 0
  die "需要 python3（macOS 上装一次 Xcode Command Line Tools 就有：xcode-select --install）"
}

# 读取一行；空输入时使用默认值
ask() {
  local label="$1" default="$2" answer=""
  if [ -n "$default" ]; then
    printf '%s [%s]: ' "$label" "$default" >&2
  else
    printf '%s: ' "$label" >&2
  fi
  IFS= read -r answer || answer=""
  if [ -z "$answer" ]; then answer="$default"; fi
  printf '%s' "$answer"
}

# 数字选择菜单：choose "标题" 默认序号 "选项1
# 选项2
# ..."
# 注意：选项通过 here-string（临时输入）读取，用户输入仍读脚本自身的 stdin，
# 这样无论交互运行还是管道喂入都能正确取到选择。
choose() {
  local label="$1" default="$2" options_text="$3" i=1 line choice=""
  local options=()
  while IFS= read -r line; do
    [ -n "$line" ] && options+=("$line")
  done <<< "$options_text"
  [ "${#options[@]}" -gt 0 ] || die "没有可选项目"
  printf '%s\n' "$label" >&2
  for line in "${options[@]}"; do
    printf '  %s) %s\n' "$i" "$line" >&2
    i=$((i + 1))
  done
  while :; do
    printf '选择 [%s]: ' "$default" >&2
    IFS= read -r choice || choice=""
    [ -z "$choice" ] && choice="$default"
    case "$choice" in
      ''|*[!0-9]*) dim "! 请输入序号数字"; continue ;;
    esac
    if [ "$choice" -lt 1 ] || [ "$choice" -gt "${#options[@]}" ]; then
      dim "! 序号超出范围（1-${#options[@]}）"; continue
    fi
    break
  done
  printf '%s' "${options[$((choice - 1))]}"
}

# 网址 id：小写字母/数字/短横线，至少 3 位（它决定网址与文件名）
valid_slug() {
  case "$1" in
    *[!a-z0-9-]*|"") return 1 ;;
  esac
  [ "${#1}" -ge 3 ] || return 1
  case "$1" in
    -*|*-) return 1 ;;
  esac
  return 0
}

# 日期：必须是真实存在的 YYYY-MM-DD（月份天数、闰年交给 python3 判断）
valid_date() {
  case "$1" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
    *) return 1 ;;
  esac
  python3 -c 'import datetime, sys; datetime.date.fromisoformat(sys.argv[1])' "$1" 2>/dev/null
}

rebuild_index() {
  if command -v node >/dev/null 2>&1; then
    node tools/build-data.mjs >/dev/null
  else
    python3 tools/build_data.py >/dev/null
  fi
}

# ---------------------------------------------------------------- --undo
if [ "$UNDO" -eq 1 ]; then
  [ -f "$BACKUP" ] || die "没有找到备份 $BACKUP，无法撤销"
  cp "$BACKUP" "$SOURCES"
  rebuild_index
  ok "已撤销上一次上架（$SOURCES 已还原，索引已重建）"
  dim "提示：被复制进 pdf/ 的文件没有被删除，如需清理请手动删除。"
  exit 0
fi

need_python
[ -f "$SOURCES" ] || die "找不到 $SOURCES（请在仓库根目录运行本脚本）"

say ""
say "${c_bold}📚 上架新资料${c_reset}  ${c_dim}（直接回车 = 使用方括号里的默认值）${c_reset}"
say ""

# ---------------------------------------------------------------- 1. 选择 PDF
raw="$(ask "PDF 文件路径（可直接把文件拖进终端窗口）" "")"
[ -n "$raw" ] || die "没有提供文件路径"
# 去掉拖拽产生的引号与转义空格，并展开 ~
pdf="${raw%\"}"; pdf="${pdf#\"}"
pdf="${pdf%\'}"; pdf="${pdf#\'}"
pdf="${pdf//\\ / }"
case "$pdf" in
  "~/"*) pdf="$HOME/${pdf#\~/}" ;;
esac
[ -f "$pdf" ] || die "找不到文件：$pdf"

case "$pdf" in
  *.pdf|*.PDF) ;;
  *) die "只支持 PDF（当前：$(basename "$pdf")）。其他格式请先转成 PDF。" ;;
esac

bytes=$(wc -c < "$pdf" | tr -d ' ')
[ "$bytes" -gt 0 ] || die "这个文件是空的"
if [ "$bytes" -gt 104857600 ]; then
  die "文件超过 100 MB，GitHub 单文件限制放不下。建议先压缩，或改用其他托管。"
fi
if [ "$bytes" -gt 52428800 ]; then
  dim "提示：文件较大（$((bytes / 1048576)) MB），打开会慢一些。"
fi
ok "已识别：$(basename "$pdf")（$(awk -v b="$bytes" 'BEGIN{printf (b>=1048576 ? "%.1f MB" : "%d KB"), (b>=1048576 ? b/1048576 : b/1024)}')）"
say ""

# ---------------------------------------------------------------- 2. 元数据
base="$(basename "$pdf")"
base="${base%.*}"
title="$(ask "资料名称（可中文）" "$base")"
title_en="$(ask "英文名（用于卡片上的小字，可留空）" "")"

# slug：优先用文件名里的英文部分
slug="$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')"
if [ "${#slug}" -lt 3 ]; then
  slug=""
  dim "文件名里没有可用的英文，网址 id 需要你给一个短英文名（决定 viewer.html?id=… 和文件名）。"
  while :; do
    slug="$(ask "资料 id（英文小写，用短横线连接）" "material-$(date +%Y-%m-%d)")"
    valid_slug "$slug" && break
    dim "! id 只能用小写字母、数字与短横线，且至少 3 位。例如：biochemistry-pathways"
  done
fi
if ! valid_slug "$slug"; then
  dim "! 从文件名推出的 id「${slug}」不合规，请换一个。"
  while :; do
    slug="$(ask "资料 id（英文小写，用短横线连接）" "material-$(date +%Y-%m-%d)")"
    valid_slug "$slug" && break
    dim "! id 只能用小写字母、数字与短横线，且至少 3 位。"
  done
fi

# 分类：从 sources.json 动态读取，不改脚本也能加分类
categories="$(python3 - "$SOURCES" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
for name in data.get('categories', []):
    if name != '全部资料':
        print(name)
PY
)"
category="$(choose "学科分类：" 1 "$categories")"

# 目录映射（实验资料 / 课程资料 是跨学科的，再问一句）
case "$category" in
  生物学)   folder="biology" ;;
  化学)     folder="chemistry" ;;
  物理)     folder="physics" ;;
  数学)     folder="mathematics" ;;
  英语)     folder="english" ;;
  其他)     folder="other" ;;
  实验资料|课程资料)
    subject="$(choose "「${category}」是跨学科的，这份具体属于哪个学科？" 6 "生物学（biology）
化学（chemistry）
物理（physics）
数学（mathematics）
英语（english）
其他（other）")"
    folder="$(printf '%s' "$subject" | sed 's/.*（//; s/）//')"
    ;;
  *) folder="other" ;;
esac

description="$(ask "一句话简介" "课程学习资料")"
keywords_raw="$(ask "关键词（逗号或空格分隔，可留空）" "")"
featured_raw="$(ask "设为「推荐资料」？(y/N)" "n")"
date_default="$(date +%Y-%m-%d)"
while :; do
  date_value="$(ask "上架日期（YYYY-MM-DD）" "$date_default")"
  valid_date "$date_value" && break
  dim "! 日期格式应为 2026-10-07 这样。"
done

case "$featured_raw" in y|Y|yes|YES) featured="true" ;; *) featured="false" ;; esac
[ "$featured" = "true" ] && featured_note="是" || featured_note="否"

# ---------------------------------------------------------------- 3. 汇总确认
target="pdf/${folder}/${slug}.pdf"
say ""
say "── 即将写入 ─────────────────────────────────"
printf ' %-10s %s\n' "id" "${slug}"
printf ' %-10s %s\n' "标题" "${title}"
printf ' %-10s %s（%s）\n' "分类" "${category}" "${target}"
printf ' %-10s %s\n' "大小" "$(awk -v b="$bytes" 'BEGIN{printf (b>=1048576 ? "%.1f MB" : "%d KB"), (b>=1048576 ? b/1048576 : b/1024)}')（页数由脚本实测）"
printf ' %-10s %s\n' "日期" "${date_value}"
printf ' %-10s %s\n' "推荐" "${featured_note}"
say "─────────────────────────────────────────────"
say ""

# 重名检查
OVERWRITE=0
if python3 - "$SOURCES" "$slug" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
sys.exit(0 if any(f.get('id') == sys.argv[2] for f in data.get('files', [])) else 1)
PY
then
  dim "! data/sources.json 里已经有 id 为「${slug}」的资料。"
  while :; do
    new_slug="$(ask "换一个 id（输入 !overwrite 覆盖旧记录，直接回车取消）" "")"
    case "$new_slug" in
      "!overwrite") OVERWRITE=1; break ;;              # 保留原 id，覆盖那一条
      "")           die "已取消" ;;
    esac
    if valid_slug "$new_slug"; then
      slug="$new_slug"; break
    fi
    dim "! id 只能用小写字母、数字与短横线，且至少 3 位。"
  done
  target="pdf/${folder}/${slug}.pdf"
fi

if [ -f "$target" ]; then
  answer="$(ask "目标文件已存在（${target}），覆盖吗？(y/N)" "n")"
  case "$answer" in y|Y) ;; *) die "已取消" ;; esac
fi

if [ "$DRY_RUN" -eq 1 ]; then
  say ""
  ok "（--dry-run）以上信息检查通过，未修改任何文件。"
  exit 0
fi

answer="$(ask "确认写入？(Y/n)" "y")"
case "$answer" in n|N|no|NO) die "已取消" ;; esac

# ---------------------------------------------------------------- 4. 落盘
mkdir -p "pdf/${folder}"
if [ "$(cd "$(dirname "$pdf")" && pwd)/$(basename "$pdf")" = "$ROOT/${target}" ]; then
  dim "文件已在该位置，跳过复制"
elif [ "$MOVE" -eq 1 ]; then
  mv "$pdf" "$target"
  ok "已移动 → ${target}"
else
  cp "$pdf" "$target"
  ok "已复制 → ${target}"
fi

cp "$SOURCES" "$BACKUP"

# 关键词 → JSON 数组
keywords_json="$(python3 - "$keywords_raw" <<'PY'
import json, sys, re
raw = sys.argv[1] if len(sys.argv) > 1 else ''
parts = [p.strip() for p in re.split(r'[,，、\s]+', raw) if p.strip()]
print(json.dumps(parts, ensure_ascii=False))
PY
)"

entry_json="$(python3 - "$slug" "$title" "$title_en" "$category" "$description" "$target" "$date_value" "$featured" "$keywords_json" <<'PY'
import json, sys
slug, title, title_en, category, description, target, date_value, featured, keywords = sys.argv[1:10]
print(json.dumps({
    "id": slug,
    "title": title,
    "titleEn": title_en,
    "category": category,
    "description": description,
    "file": "./" + target,
    "date": date_value,
    "featured": featured == "true",
    "keywords": json.loads(keywords),
}, ensure_ascii=False))
PY
)"

# 追加到 sources.json（保持原有格式：在 files 数组末尾插入）
python3 - "$SOURCES" "$entry_json" "$OVERWRITE" <<'PY'
import json, sys, textwrap

path, entry_json, overwrite = sys.argv[1], sys.argv[2], sys.argv[3] == '1'
entry = json.loads(entry_json)
text = open(path, encoding='utf-8').read()

data = json.loads(text)
data['files'] = [f for f in data.get('files', []) if f.get('id') != entry['id']]
if overwrite:
    # 覆盖：直接按解析后的结构重写（会统一缩进，属于预期行为）
    data['files'].append(entry)
    open(path, 'w', encoding='utf-8').write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print('OVERWRITE')
    sys.exit(0)

# 追加：保持文件原有排版，只在 files 数组收尾前插入一条
block = textwrap.indent(json.dumps(entry, ensure_ascii=False, indent=2), '    ')
idx = text.rstrip().rfind('\n  ]')
if idx == -1:
    # files 还是空数组（形如 "files": []）等特殊情况：退回结构化重写
    data.setdefault('files', []).append(entry)
    open(path, 'w', encoding='utf-8').write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print('FALLBACK')
    sys.exit(0)
new_text = text[:idx] + ',\n' + block + text[idx:]
try:
    parsed = json.loads(new_text)
    assert parsed['files'][-1]['id'] == entry['id']
except Exception as error:
    raise SystemExit(f'写入后的 JSON 校验失败，已中止：{error}')
open(path, 'w', encoding='utf-8').write(new_text)
PY

ok "已写入 data/sources.json（备份：${BACKUP}）"

# ---------------------------------------------------------------- 5. 重建索引
rebuild_index
info="$(python3 - "$slug" <<'PY'
import json, sys
data = json.load(open('data/files.json', encoding='utf-8'))
item = next((f for f in data['files'] if f.get('id') == sys.argv[1]), None)
print('—' if not item else f"{item['size']} · {item['pages']} 页 · 共 {len(data['files'])} 份资料")
PY
)"
ok "索引已重建：${slug} → ${info}"

# ---------------------------------------------------------------- 6. 可选部署
if [ "$ASK_DEPLOY" -eq 1 ] && [ -f tools/deploy.sh ]; then
  say ""
  answer="$(ask "现在部署到 GitHub Pages 吗？(y/N)" "n")"
  case "$answer" in
    y|Y|yes|YES)
      say ""
      bash tools/deploy.sh
      ;;
    *) dim "已跳过部署。稍后运行： bash tools/deploy.sh" ;;
  esac
fi

say ""
ok "上架完成：${title}"
dim "阅读页： viewer.html?id=${slug}"
dim "撤销本次上架： bash tools/add-material.sh --undo"
