# -*- coding: utf-8 -*-
"""对 covers/ 下每张封面做中文 OCR，输出 booklist.json（书名初稿，供人工校对）。

主标题选取策略（封面 OCR 的常见干扰是 大号装饰字/卷次号/英文字母/“第X版” 等）：
  1) 候选 = 含中文、去空白后长度>=2、且非“第X版/第X册”等版次标记的行；
  2) 在候选中按 文字框高度(字号) 从大到小取最大者为书名；
  3) 若无中文候选，回退到长度>=2 的非纯标点行里按高度取最大者；
  4) 若仍无，取该图第一个识别文本（空则留空待补）。

输出:
  id / file / cover / title(初选书名) / author(留空待校) / ocr(全文字，便于对照)
"""
import json
import os
import re
from rapidocr_onnxruntime import RapidOCR

BASE = os.path.dirname(os.path.abspath(__file__))
COVERS = os.path.join(BASE, "covers")
OUT = os.path.join(BASE, "booklist.json")
MIN_SCORE = 0.6

CJK_RE = re.compile(r"[一-鿿]")
EDITION_RE = re.compile(r"^第[0-9一二三四五六七八九十百]+[版册卷]")
PURE_SYMBOL_RE = re.compile(r"^[\s\dA-Za-z\.\-\+\*#/&'·~!?！？，。、,;:：;％%°]+$")

files = sorted(f for f in os.listdir(COVERS) if f.lower().endswith(".jpg"))
print(f"待识别 {len(files)} 张", flush=True)

engine = RapidOCR()
records = []
empty = 0
single_ok = 0

def clean(t):
    return (t or "").strip()

def bh(box):
    ys = [p[1] for p in box]
    return max(ys) - min(ys)

def is_good_title(text, allow_cjk_only):
    t = clean(text)
    if len(t) < 2:
        return False
    if PURE_SYMBOL_RE.match(t):          # 纯数字/字母/符号
        return False
    if EDITION_RE.match(t):              # 第X版/册/卷 之类
        return False
    if allow_cjk_only and not CJK_RE.search(t):
        return False
    return True

for idx, fn in enumerate(files, start=1):
    path = os.path.join(COVERS, fn)
    title = ""
    lines = []
    try:
        result, _ = engine(path)
        if result:
            for item in result:
                try:
                    box, text, score = item[0], clean(str(item[1])), float(item[2])
                except Exception:
                    continue
                if text and score >= MIN_SCORE:
                    lines.append({"text": text, "h": bh(box), "score": score})
    except Exception as e:
        print(f"!! {fn} OCR 出错: {e}", flush=True)

    if lines:
        # 主候选：中文、长度>=2、非版次行，按字号排序
        cand = sorted(
            (ln for ln in lines if is_good_title(ln["text"], allow_cjk_only=True)),
            key=lambda x: x["h"], reverse=True,
        )
        if cand:
            title = cand[0]["text"]
        else:
            cand2 = sorted(
                (ln for ln in lines if is_good_title(ln["text"], allow_cjk_only=False)),
                key=lambda x: x["h"], reverse=True,
            )
            if cand2:
                title = cand2[0]["text"]
                single_ok += 1
            else:
                title = lines[0]["text"]
    if not title:
        empty += 1

    records.append({
        "id": idx,
        "file": fn,
        "cover": "covers/" + fn,
        "title": title,
        "author": "",
        "ocr": " | ".join(ln["text"] for ln in lines)[:220],
    })

    if idx % 100 == 0 or idx == len(files):
        print(f"进度 {idx}/{len(files)} (空 {empty})", flush=True)

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(records, f, ensure_ascii=False, indent=1)

print(f"\n完成 -> {OUT}  共 {len(records)} 条；标题为空 {empty} 条；回退非中文标题 {single_ok} 条", flush=True)
