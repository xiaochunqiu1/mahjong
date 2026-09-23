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
- `cloudfunctions/room-api/` CloudBase 云函数入口（源码 index.entry.ts + build.sh esbuild 打包成 index.js，平台跑打包产物）
- `tests/` vitest（helpers.ts 的 TileAllocator 做物理校验，写夹具必须用 mkState）
- `docs/rules.md` 规则唯一权威，代码与文档冲突需评审，禁止静默分叉

## 关键约定
- 设计决策 D1–D6、经济红线（固定积分零和、不实现金雀/金龙等）、AI 只读公开信息，详见 `docs/rules.md`
- 跨端铁律：单机版+好友房、微信+系统浏览器必须行为一致，改一边要自查另一边
- 语音：TRTC v5（trtc-sdk-v5 CDN），userSig 服务端 TLS-Sig v2 算法（zlib+base64url），密钥在云函数环境变量 TRTC_SDKAPPID/TRTC_SECRETKEY
- 牌名语音：`cloudfunctions/tts`（百度短文本 TTS 代理，per=4132 度阿闽；返回 audio/mp3 二进制 isBase64Encoded 直出，前端 arrayBuffer 解码）。**本机 curl 对 chunked 响应误报 0 字节，验证 HTTP 接口用 Node fetch**
- 交付铁律：改完必须先验证（测试/实测）再交付，绝不让用户反复试错

## 当前状态（2026-09-23）
- 游戏名：**开麦麻将**（2026-08-13 整体改名，玩法术语"游金/单双三游"保留）
- 线上已部署：CloudBase 静态托管 `qzmj-d8ge0bj5g9257711b-1463592371.tcloudbaseapp.com`（根=原版 /xiaoya/=小雅版，**两版同源共用云函数**；前端改动走 build-both.sh 双构建，云函数改动一次部署两版生效），云函数 room-api **v1.0.9**（createRoom/joinRoom/setReady/startMatch/submitAction/resumeSeat/untrust/leaveRoom + poll，含 getTrtcSign）+ **tts（百度牌名语音，/tts-api，二进制直出）**
- GitHub：github.com/xiaochunqiu1/mahjong（项目仓库，公开）+ github.com/xiaochunqiu1/my-skills（技能仓库，公开）；凭证用 global `http.https://github.com/.extraHeader`（更新跑 ~/.workbuddy/scripts/update-git-token.sh）
- **好友房机器胡牌 = 配额制（2026-09-23 用户规则，取代旧"陪打永不胡"红线）**：真人数 ≤2 → 机器胡牌总数 ≤ 真人 ×1/4（胡牌占比 20%，RoomState.huTally 跨局累计，流局不计），配额内逢胡必胡；真人数 ≥3 → 机器永不胡；机器吃碰杠不设限（BOT_AI_LEVEL=0.9 与真人同强度）
- **响应窗口时序（2026-09-23）**：碰/杠/胡与吃同节奏（botStepMs 2.2s，不秒碰）；bot 固定时刻表自主表态、与真人动作解耦（真人响应动作不重置 botTickAt）；已喊出的胡/碰/杠经 view.pendingResponses 在座位显示气泡（喊牌事前可见）；只能 pass 的家引擎自动表态不占窗口
- **托管代打（2026-09-23 trustAct）**：不碰不吃不杠不胡（响应一律过）；出牌"进什么打什么"（RoomState.lastDrawnT 记录代打刚摸的牌）或随机普通牌；取消托管按钮全场景可见（前端 localUntrusted 在 trusted false→true 时自动重置）
- **多种吃法选择**：点击只选择，生效后统一喊一声"吃"（不再逐张念牌名，避免与"吃"重叠成杂音）
- 部署坑（重要）：改 server/room.ts 后必须 bump `cloudfunctions/room-api/package.json` version（1.0.0→…→1.0.9），否则 CloudBase 平台依赖指纹缓存跳过代码更新；**部署前必须 grep 新代码指纹验证前端产物**（build-both.sh 静默失败过两次）；验证用 `tcb fn invoke room-api --params '{"action":...}'`（网关域名 ap-shanghai.app.tcloudbase.com，静态域名 tcloudbaseapp.com 无 /room-api）
- 待办：真人试玩微调（机器配额 20% 体感校准）、方言语音（泉州话验听）、全设备横屏测试
- 语音回滚基线：`.workbuddy/backup/no-voice-20260812/restore.sh`（用户说"回到未开麦版本"时执行）
- TRTC 套餐：当前用**体验版**（SDKAppID 1600156799，2026-08-19 体验版到期后将自动降级为入门版）。**对游戏核心语音无影响**（基础音视频、麦克风/喇叭切换、userSig 签发在入门版都支持），仅失去"户内通话+卡顿优化"权益——差网络（尤其微信安卓 X5）下通话质量可能略卡；如需恢复可在腾讯云续期或改正式版。
