# 部署方案（现役版 · 2026-08-13 实测）

目标：不落地本地、任何时间打开网页即玩、全程免费、微信内可直接打开。

## 现役方案：CloudBase 一个环境搞定一切（静态托管 + 云函数 + 数据库）

| 部分 | 部署位置 | 费用 | 说明 |
|---|---|---|---|
| 前端（单机/好友房 UI + 规则引擎 + 语音） | CloudBase 免费体验环境·静态托管 | 免费 | `tcb hosting deploy dist`，国内节点，微信内直接打开 |
| 联机后端（好友房接口 + TRTC 签名） | 同环境·云函数 room-api | 免费 | HTTP 网关路由，数据库 rooms 集合 |
| 实时语音 | 腾讯云 TRTC（单独开通，免费 10000 分钟） | 免费额度 | 云函数签发 userSig，前端 trtc-sdk-v5 接入 |

- **线上地址**：`https://qzmj-d8ge0bj5g9257711b-1463592371.tcloudbaseapp.com`（envId=`qzmj-d8ge0bj5g9257711b`，CloudBase 免费二级域名）
- **单机永远可用**：规则引擎完全跑在浏览器里，单机零后端依赖——即使后端故障，打开网页照样玩单机
- **微信分享**：index.html 已配 og:title/og:description/og:image（分享卡显示麻将主题图）；换新链接（如 `?r=xxx`）可绕开微信抓取缓存

## 已排除的选项（历史结论）
- **EdgeOne Pages**：原计划用它（域名短如 qzmj.edgeone.app），实际未采用——CloudBase 静态托管一个环境全包，少一个平台
- **Cloudflare Pages / GitHub Pages**：国内访问不稳定，微信内打开风险高
- **自建服务器**：违背「免费」和「随时可用」

## 部署命令（根目录运行）

```bash
# 1) 前端构建 + 静态托管
npx vite build
npx tcb hosting deploy dist -e qzmj-d8ge0bj5g9257711b

# 2) 云函数（先 build 再 deploy；deploy 有交互提示，管道 printf '\n' 走默认）
bash cloudfunctions/room-api/build.sh
printf '\n' | npx tcb fn deploy room-api --force

# 3) 云函数环境变量（TRTC 密钥；改 cloudbaserc.json envVariables 后推送）
npx tcb config update fn room-api     # 交互选 Merge，或控制台配置
```

## 云函数目录约定（CloudBase CLI 只认这种结构）
- 根目录 `cloudbaserc.json`（CLI 从项目根运行才读得到；放函数目录里会被忽略）
- `functionRoot: "cloudfunctions"`，函数代码 = `cloudfunctions/room-api/`（index.js + package.json）
- `cloudfunctions/room-api/build.sh` 把 `index.ts` + server/room.ts esbuild 成根目录 `index.js`（`--external:@cloudbase/node-sdk`，`installDependency: true`）

## 云函数环境变量
- `TRTC_SDKAPPID` / `TRTC_SECRETKEY`：TRTC 控制台应用密钥（2026-08-12 已配置），用于 getTrtcSign 签发 userSig
- 未配置时 getTrtcSign 返回「语音未开通」，前端按钮降级提示，不影响打牌

## 踩过的坑
- `fn deploy --dir <目录>` 表面成功但代码不生效——用根 cloudbaserc.json 标准结构
- `--deployMode zip` 有 1.5MB 限制易报错，用默认 COS 上传
- 验证生效：`npx tcb fn code download room-api <dest>` 后 grep 新逻辑关键字，或 `fn detail` 看 Code size
- 验证前端：浏览器打开线上地址（headless 可用 agent-browser 实测 UI 与语音按钮）
- 旧部署包（room-api*.zip）不要放函数目录（会被当代码上传）
