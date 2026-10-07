#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_data.py — build-data.mjs 的 Python 版本（macOS 自带 python3 即可运行）

用法：
    python3 tools/build_data.py

作用与 Node 版完全一致：
    1. 读取 data/sources.json（人工维护的清单）
    2. 直接测量 pdf/ 下每个文件的大小，并尽力统计页数
    3. 写出 data/files.json —— 首页与阅读页只读这一个文件

没有安装 Node 时，deploy.sh 会自动改用本脚本。
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_json(rel, fallback=None):
    path = os.path.join(ROOT, rel)
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as error:                                # noqa: BLE001
        if fallback is not None:
            return fallback
        raise SystemExit(f"无法读取 {rel}: {error}")


def format_size(num):
    if not num or num <= 0:
        return "—"
    if num >= 1024 ** 2:
        return f"{num / 1024 ** 2:.1f} MB"
    return f"{max(1, round(num / 1024))} KB"


def count_pages(data: bytes):
    """统计 /Type /Page 出现次数（排除 /Pages）；失败时退回 /Count"""
    text = data.decode("latin-1", errors="ignore")
    direct = re.findall(r"/Type\s*/Page(?![s])", text)
    if len(direct) > 1:
        return len(direct)
    loose = re.findall(r"/Type\s*/Page\b", text)
    if len(loose) > 1:
        return len(loose)
    field = re.search(r"/Count\s+(\d+)", text)
    return int(field.group(1)) if field else None


def main():
    sources = read_json("data/sources.json")
    manifest = read_json("tools/pdf-manifest.json", {"files": {}}).get("files", {})
    previous = {f.get("id"): f for f in read_json("data/files.json", {"files": []}).get("files", [])}

    files, rows, warnings = [], [], []

    for src in sources.get("files", []):
        rel = str(src.get("file", "")).lstrip("./")
        path = os.path.join(ROOT, rel)
        meta = manifest.get(src.get("file")) or manifest.get(rel) or {}

        size_bytes, pages = None, None
        if os.path.exists(path):
            size_bytes = os.path.getsize(path)
            try:
                with open(path, "rb") as fh:
                    pages = count_pages(fh.read())
            except Exception as error:                        # noqa: BLE001
                warnings.append(f"{src.get('file')}: 页数统计失败（{error}）")
        else:
            warnings.append(f"{src.get('file')}: 文件不存在，请把 PDF 放进 pdf/ 目录")

        if not pages:
            pages = meta.get("pages") or src.get("pagesHint") or (previous.get(src.get("id")) or {}).get("pages")
        if size_bytes:
            size = format_size(size_bytes)
        elif meta.get("bytes"):
            size = format_size(meta["bytes"])
        else:
            size = (previous.get(src.get("id")) or {}).get("size", "—")

        files.append({
            "id": src.get("id"),
            "title": src.get("title"),
            "titleEn": src.get("titleEn", ""),
            "category": src.get("category"),
            "description": src.get("description", ""),
            "file": src.get("file"),
            "size": size,
            "pages": pages,
            "date": src.get("date"),
            "featured": src.get("featured") is True,
            "keywords": src.get("keywords", []),
        })
        rows.append((src.get("id"), src.get("category"), size, f"{pages} 页" if pages else "—", src.get("file")))

    latest = max([f["date"] for f in files if f.get("date")], default="")
    out = {
                "$comment": (
            "由 tools/build-data.mjs 生成：首页与阅读页读取本文件。新增资料请编辑 data/sources.json 后重新运行脚本，也可以直接在本文件里追加一条记录（字段：id/title/category/description/file/size/pages/date/featured/keywords）。"
        ),
        "categories": sources.get("categories", []),
        "updatedAt": latest,
        "files": files,
    }

    with open(os.path.join(ROOT, "data/files.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"\n已生成 data/files.json —— {len(files)} 份资料\n")
    print(f"{'ID':<26}{'分类':<10}{'大小':<10}{'页数':<8}路径")
    print("-" * 78)
    for rid, cat, size, pages, file in rows:
        print(f"{str(rid):<26}{str(cat):<10}{size:<10}{pages:<8}{file}")
    if warnings:
        print("\n提示：")
        for item in warnings:
            print(f"  · {item}")
    print()


if __name__ == "__main__":
    sys.exit(main())
