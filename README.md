# 🀄 泉州游金麻将

**16 张游金 · 补花 · 单双三游 · 好友房实时语音** —— 手机横屏网页麻将，微信点开即玩，零安装零注册，单人对抗 AI 或与好友实时对战开麦。

> 🎮 **在线体验**：https://qzmj-d8ge0bj5g9257711b-1463592371.tcloudbaseapp.com
> (微信/浏览器直接打开，横屏游玩；好友房房间码 4 位数字，实时语音开麦)

---

## ✨ 功能特性

| 模块 | 能力 |
|---|---|
| **规则引擎** | 泉州 16 张游金全规则：补花开金、单/双/三游、响应收集-裁决、固定积分零和（+3/+6/+9/+18/+27）、流局连庄；纯函数无副作用，浏览器/服务端/测试三端复用 |
| **单机模式** | 1 真人 + 3 AI，不分难度档，AI 只用公开信息决策（游金宣告 > 胡 > 拒胡救援 > 轻进取），校准真人长期胜率 50% |
| **好友房** | 1–4 真人联网（电脑补齐、陪打永不胡牌），CloudBase 云函数 + 数据库，轮询同步，断线可恢复座位 |
| **实时语音** | 腾讯云 TRTC v5 接入：对局/大厅双按钮（麦克风默认关、喇叭默认开），CDN 按需加载不占首屏 |
| **游戏体验** | 牌面图案化渲染、金牌指示、烟花庆祝、方言音效框架、BGM、最近 20 场战绩本机存档 |
| **微信分享** | og:image 麻将主题分享卡，分享即显图 |

## 🛠 技术栈

- **前端**：Vite + React + TypeScript，hash 路由，`dist/` gzip ~68KB
- **规则引擎**：纯函数 TS（`src/engine/`），无任何 UI/运行时依赖
- **联机后端**：CloudBase 云函数（Node 18/20）+ 文档数据库 + HTTP 网关，与前端共享同一份引擎
- **实时语音**：腾讯云 TRTC（trtc-sdk-v5），服务端 TLS-Sig v2 签发 userSig
- **测试**：Vitest，51 项全绿（规则引擎物理校验、AI 自对弈零和/对称性、好友房状态机）

## 🚀 快速开始

```bash
npm install
npm run dev        # 本地开发（Vite）
npm test           # 51/51 测试
npm run build      # 产出 dist/
```

## 🧪 测试与质量

- `tests/`：引擎规则（胡牌判定、响应裁决、游金流程）+ AI 自对弈模拟（积分零和、四家对称、游金频率）+ 好友房服务端状态机
- 规则权威文档 `docs/rules.md` 与引擎代码一一对应，含已评审钉死的设计决策 D1–D6

## 📁 项目结构

```
src/
  engine/      纯规则引擎（tiles/win/types/engine）——浏览器/云函数/测试三端复用
  game/        会话与 AI（controller/ai/sound/online）
  ui/          React 页面（单机 Home/Game/Rules/History + 好友房 Room/OnlineGame/OGStage + 语音 VoiceSession）
server/        好友房 RoomManager（服务端逻辑，云函数与 mock 共用）
cloudfunctions/ room-api 云函数（HTTP 路由 + getTrtcSign 签名签发）
docs/          规则权威文档 + 部署方案
tests/         Vitest 测试
skills/        方法论沉淀（见下）
```

## 💡 方法论沉淀（skills/）

本项目把踩过的坑抽象成两个可复用技能（用户级 WorkBuddy skill，任何网页项目可用）：

- **`skills/free-cloud`** — 腾讯云 CloudBase 免费部署（一个环境全包：静态托管 + 云函数 + 数据库 + 网关，永久免费二级域名，国内秒开），含完整流程/命令/踩坑/打包脚本
- **`skills/web-voice`** — 网页实时语音接入（TRTC v5：userSig TLS-Sig v2 签发、麦克风/喇叭双控、v5 API 踩坑全记录），含可直接拷贝的签名脚本

> 独立仓库 [my-skills](https://github.com/) 亦收录这两份技能。

## 🚢 部署

见 `docs/deploy.md`（CloudBase 静态托管 + 云函数；配置脱敏模板 `cloudbaserc.example.json`）。

## 📄 许可

MIT License — 可自由使用、修改、分发（含商用），请保留版权声明。
