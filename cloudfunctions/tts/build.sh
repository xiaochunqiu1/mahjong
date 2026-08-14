# 云函数打包脚本：把 tts TS 源码 bundle 成单文件 index.js
# 产物输出到函数目录根（cloudfunctions/tts/index.js），配合根目录 cloudbaserc.json 部署。
# tts 零 npm 依赖（仅 Node 内置 fetch/Buffer），无需 external，installDependency=false。
# 用法：bash cloudfunctions/tts/build.sh

set -e
cd "$(dirname "$0")"
ROOT=../..
OUT=.

npx --prefix "$ROOT" esbuild index.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile=$OUT/index.js

echo "OK -> $OUT/index.js"
