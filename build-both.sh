# 双版本构建+合并部署：
#   原版「开麦麻将」→ dist-kai/  → 部署到根 /
#   小雅版「小雅游金」→ dist-xiaoya/ → 部署到根 /xiaoya/
# 两版共用同一份代码（同源），好友房后端互通。
#
# 用法：bash build-both.sh
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

DOMAIN="https://qzmj-d8ge0bj5g9257711b-1463592371.tcloudbaseapp.com"
NODE="$(command -v node || which node || echo /c/Users/27203/.workbuddy/binaries/node/versions/22.22.2/node.exe)"

rm -rf dist-kai dist-xiaoya dist-final

# 原版（开麦麻将）→ dist-kai/
echo "=== 构建原版：开麦麻将 ==="
VITE_APP_NAME="开麦麻将" \
VITE_OG_IMAGE="$DOMAIN/og-image.png" \
"$NODE" node_modules/vite/bin/vite.js build --outDir=dist-kai --emptyOutDir 2>&1 | tail -2

# 小雅版（小雅游金）→ dist-xiaoya/
echo "=== 构建小雅版：小雅游金 ==="
VITE_APP_NAME="小雅游金" \
VITE_OG_IMAGE="$DOMAIN/xiaoya/og-image-xiaoya.png" \
"$NODE" node_modules/vite/bin/vite.js build --outDir=dist-xiaoya --emptyOutDir 2>&1 | tail -2

# 合并：原版放根，小雅版放 /xiaoya/ 子目录
echo "=== 合并部署目录 ==="
mkdir -p dist-final
cp -r dist-kai/. dist-final/
mkdir -p dist-final/xiaoya
cp -r dist-xiaoya/. dist-final/xiaoya/
echo "合并完成："
ls dist-final/ | head -5
echo "  + xiaoya/"
ls dist-final/xiaoya/ | head -5

echo "OK -> dist-final/ （根 = 原版；/xiaoya/ = 小雅版）"
