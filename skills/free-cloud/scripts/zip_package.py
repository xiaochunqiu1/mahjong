#!/usr/bin/env python3
"""CloudBase 云函数标准 zip 打包脚本。

背景：PowerShell `Compress-Archive` 打包被 CloudBase SCF 容器拒绝（unzip exit status 1），
必须用 Python zipfile（标准 CPZIP 格式）。

用法：
    python zip_package.py <函数目录> [输出zip路径]

示例：
    python zip_package.py cloudfunctions/room-api ./room-api.zip
"""
import os
import sys
import zipfile


def zip_dir(src_dir: str, out_zip: str) -> None:
    src_dir = os.path.abspath(src_dir)
    os.makedirs(os.path.dirname(os.path.abspath(out_zip)) or ".", exist_ok=True)
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(src_dir):
            # 跳过 node_modules（云函数环境自动装依赖 installDependency）与构建缓存
            dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", "dist")]
            for f in files:
                full = os.path.join(root, f)
                arc = os.path.relpath(full, src_dir)
                zf.write(full, arc)
    print(f"OK -> {out_zip}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else f"{os.path.basename(src.rstrip('/'))}.zip"
    zip_dir(src, out)
