# AGENTS.md — 开麦麻将

## 项目一句话
手机横屏网页麻将（泉州 16 张游金玩法），单机 1 真人+3 电脑 / 好友房 1–4 真人联网，微信可玩，实时语音开麦。

## 怎么跑起来
- 开发：`npm run dev`（Vite，hash 路由）
- 测试：`npx vitest run`（51/51 全绿）
- 构建：`npx vite build` → `dist/`
- 部署：CloudBase 静态托管 + 云函数（见 `docs/deploy.md`）

## 技术栈与目录
- `src/engine/` 纯规则引擎（tiles/win/types/engine），禁引 UI，浏览器/云函数/测试三端可跑
- `src/game/` 会话与 AI（ai.ts + controller.ts + sound.ts + online.ts + sortHand.ts）
- `src/ui/` React 页面（Home/Rules/Settings/History/Game + 好友房 Room/OnlineGame/OGStage + 语音 VoiceSession）
- `server/room.ts` 好友房 RoomManager（引擎复用，云函数与本地 mock 共用）
- `cloudfunctions/room-api/` CloudBase 云函数入口（build.sh esbuild 打包，路由在 index.ts）
- `tests/` vitest（helpers.ts 的 TileAllocator 做物理校验，写夹具必须用 mkState）
- `docs/rules.md` 规则唯一权威，代码与文档冲突需评审，禁止静默分叉

## 关键约定
- 设计决策 D1–D6、经济红线（固定积分零和、不实现金雀/金龙等）、AI 只读公开信息，详见 `docs/rules.md`
- 跨端铁律：单机版+好友房、微信+系统浏览器必须行为一致，改一边要自查另一边
- 语音：TRTC v5（trtc-sdk-v5 CDN），userSig 服务端 TLS-Sig v2 算法（zlib+base64url），密钥在云函数环境变量 TRTC_SDKAPPID/TRTC_SECRETKEY
- 牌名语音：`cloudfunctions/tts`（百度短文本 TTS 代理，per=4132 度阿闽；返回 audio/mp3 二进制 isBase64Encoded 直出，前端 arrayBuffer 解码）。**本机 curl 对 chunked 响应误报 0 字节，验证 HTTP 接口用 Node fetch**
- 交付铁律：改完必须先验证（测试/实测）再交付，绝不让用户反复试错

## 当前状态（2026-08-14）
- 游戏名：**开麦麻将**（2026-08-13 整体改名，玩法术语"游金/单双三游"保留）
- 线上已部署：CloudBase 静态托管 `qzmj-d8ge0bj5g9257711b-1463592371.tcloudbaseapp.com`，云函数 room-api（含 getTrtcSign + 好友房 bot 节奏对齐单机 2200ms）+ **tts（百度牌名语音，/tts-api，二进制直出）**
- GitHub：github.com/xiaochunqiu1/mahjong（项目仓库，公开）+ github.com/xiaochunqiu1/my-skills（技能仓库，公开）；凭证用 global `http.https://github.com/.extraHeader`（更新跑 ~/.workbuddy/scripts/update-git-token.sh）
- 已完成：单机可玩、好友房 7 接口+轮询、语音双按钮（麦关喇叭开）、微信分享卡 og-image、BGM/喊牌/烟花优化、好友房 bot 节奏与单机一致
- 待办：真人试玩微调 aiLevel/greed（胜率 50% 校准）、方言语音（泉州话验听）、全设备横屏测试
- 语音回滚基线：`.workbuddy/backup/no-voice-20260812/restore.sh`（用户说"回到未开麦版本"时执行）
- TRTC 套餐：当前用**体验版**（SDKAppID 1600156799，2026-08-19 体验版到期后将自动降级为入门版）。**对游戏核心语音无影响**（基础音视频、麦克风/喇叭切换、userSig 签发在入门版都支持），仅失去"户内通话+卡顿优化"权益——差网络（尤其微信安卓 X5）下通话质量可能略卡；如需恢复可在腾讯云续期或改正式版。
