#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成微信分享卡 og-image:裁 AI 图 + 调整尺寸 + 加中文标题"""
from PIL import Image, ImageDraw, ImageFont
import os, sys

SRC = r"D:\WorkBuddy任务空间\任务空间\0-小项目\麻将游戏\public\A_polished_Chinese_style_Mahjo_2026-08-12T12-44-48.png"
DST = r"D:\WorkBuddy任务空间\任务空间\0-小项目\麻将游戏\public\og-image.png"

# 候选字体(Windows + macOS + Linux)
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",   # 微软雅黑 Bold
    r"C:\Windows\Fonts\msyh.ttc",     # 微软雅黑
    r"C:\Windows\Fonts\simhei.ttf",   # 黑体
    r"C:\Windows\Fonts\simsun.ttc",   # 宋体
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
]

def find_font(paths, size):
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

def find_font_plain(paths, size):
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

img = Image.open(SRC).convert("RGB")
W, H = img.size
print(f"原图尺寸: {W}x{H}")

# 裁掉右下角"AI生成 WORKBUDDY"水印:把右下 ~15% 区域用底色覆盖
# AI 图右下角水印大概在 (W-280, H-90) ~ (W, H),覆盖为绿色渐变
# 简单做法:从右侧裁掉 12% 宽度
crop_w = int(W * 0.10)  # 裁掉右侧 10% 宽度去掉水印
img = img.crop((0, 0, W - crop_w, H))
W, H = img.size
print(f"裁水印后: {W}x{H}")

# 调整到 1200x630(OG 标准)
TARGET_W, TARGET_H = 1200, 630
# 等比缩放后居中裁剪
scale = max(TARGET_W / W, TARGET_H / H)
new_w, new_h = int(W * scale), int(H * scale)
img_resized = img.resize((new_w, new_h), Image.LANCZOS)
# 居中裁剪
left = (new_w - TARGET_W) // 2
top = (new_h - TARGET_H) // 2
img_final = img_resized.crop((left, top, left + TARGET_W, top + TARGET_H))
print(f"最终尺寸: {img_final.size}")

# 加暗化叠加层(让文字更清晰)
overlay = Image.new("RGBA", img_final.size, (0, 0, 0, 0))
draw_overlay = ImageDraw.Draw(overlay)
# 左侧暗化(放标题)
draw_overlay.rectangle([(0, 0), (TARGET_W * 0.55, TARGET_H)], fill=(0, 0, 0, 110))
# 整体轻微暗化
draw_overlay.rectangle([(0, 0), (TARGET_W, TARGET_H)], fill=(0, 0, 0, 30))
img_final = img_final.convert("RGBA")
img_final = Image.alpha_composite(img_final, overlay).convert("RGB")

# 加中文标题
draw = ImageDraw.Draw(img_final)
font_title = find_font(FONT_CANDIDATES, 110)
font_sub = find_font_plain(FONT_CANDIDATES, 42)
font_tag = find_font_plain(FONT_CANDIDATES, 32)

# 标题:开麦麻将
title = "开麦麻将"
# 副标题
sub = "假期好搭档"

def text_with_shadow(draw, xy, text, font, fill, shadow=(0, 0, 0, 180), offset=4):
    x, y = xy
    draw.text((x + offset, y + offset), text, font=font, fill=shadow)
    draw.text(xy, text, font=font, fill=fill)

# 计算位置
title_bbox = draw.textbbox((0, 0), title, font=font_title)
title_w = title_bbox[2] - title_bbox[0]
title_x = 70
title_y = 200
text_with_shadow(draw, (title_x, title_y), title, font_title, fill="#ffd86b", shadow=(20, 12, 4, 220))

# 副标题
sub_bbox = draw.textbbox((0, 0), sub, font=font_sub)
sub_w = sub_bbox[2] - sub_bbox[0]
text_with_shadow(draw, (title_x, title_y + 145), sub, font=font_sub, fill="#fdfaf2", shadow=(0, 0, 0, 200))

# 保存
img_final.save(DST, "PNG", optimize=True)
print(f"保存: {DST} ({os.path.getsize(DST)} bytes)")
