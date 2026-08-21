# 云函数打包脚本：把 TS 源码 + 引擎 + room 逻辑 bundle 成单文件 index.js
# 产物输出到函数目录根（cloudfunctions/room-api/index.js），配合根目录 cloudbaserc.json 部署。
# 用法：bash cloudfunctions/room-api/build.sh

set -e
cd "$(dirname "$0")"
ROOT=../..
OUT=.

# 用 esbuild 打包（CloudBase Nodejs 运行时直接跑产物，无需编译步骤）
npx --prefix "$ROOT" esbuild index.entry.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile=$OUT/index.js \
  --external:@cloudbase/node-sdk

echo "OK -> $OUT/index.js"
