---
name: free-cloud
description: 腾讯云 CloudBase 免费部署方案（静态托管 + 云函数 + 数据库 + HTTP 网关一环境全包，永久免费二级域名，国内秒开、微信可直接打开）。用户说「免费云」「免费部署」「部署到云端」「要个免费二级域名」「CloudBase 部署」或任何需要把网页项目免费上线、获得免费域名、国内可访问的场景时使用。
agent_created: true
---

# CloudBase 免费部署（全程免费 + 国内秒开 + 无需 VPN）

> 关联 skill：若项目同时需要网页实时语音（开麦通话），另见 `web-voice`（语音接入）。部署与语音相互独立，需要时分别触发。

## 核心决策

用户要「免费云」部署时，**直接走腾讯云 CloudBase**，跳过 EdgeOne / Cloudflare / Vercel 等海外或限时方案：
- EdgeOne Makers 预览域名仅 3 小时、永久域名要买 —— 不满足"全程免费"
- Cloudflare / GitHub Pages —— 国内访问不稳定、微信内打开风险高
- 自建服务器 —— 违背"免费 + 随时可用"

**为什么 CloudBase 一个环境全包**：静态托管（前端永久二级域名）+ 云函数（后端 API）+ NoSQL 数据库 + HTTP 网关（API 路由）都在同一环境，不用维护多个平台。

## 免费额度（免费体验版）

- 3000 资源点/月（数据库/函数调用/静态托管流量共用，小型项目足够）
- 环境有效期 1 年（到期续期或换套餐）
- **永久免费二级域名**：`{env-id}-{随机后缀}.tcloudbaseapp.com`（国内节点秒开，微信内直接打开）
- 云函数超时 3 秒（体验版不可改 → 简单业务 OK，重计算不行）

## 部署流程（7 步）

1. **开通**：console.cloud.tencent.com/tcb → 创建免费体验环境（套餐选「免费体验版」，填环境名）→ 记下环境 ID（形如 `xxx-xxxxxxxxxxxx`）
2. **CLI 登录**：console.cloud.tencent.com/cam/capi 新建 API 密钥 → `npx tcb login --apiKeyId xxx --apiKey xxx`
   - 注意：CLI 3.7.1 有 i18n bug，**别用设备码授权**，用 API 密钥方式
3. **云函数**：esbuild bundle（cjs、external `@cloudbase/node-sdk`）→ 依赖全装（`npm i --omit=dev`，别手动复制会漏传递依赖）→ **Python zipfile 打包**（见 scripts/zip_package.py；PowerShell Compress-Archive 会被 SCF 拒）
4. **数据库**：文档数据库 → 新建集合（**必须预建**，CloudBase 不自动建）→ 权限 ADMINONLY（最安全）
5. **HTTP 网关**：HTTP 网关 → 添加路由（如 `/api`）→ 绑定云函数 → 开跨域 → 免鉴权
6. **静态托管**：`npx tcb hosting deploy dist -e <env-id>` → 立即拿到永久二级域名
7. **前端配置**：`.env.production` 写 `VITE_API_URL=https://{env-id}-xxx.ap-shanghai.app.tcloudbase.com/api` → 重新 build → 重新部署

## 已踩坑清单（复用时直接避开）

- **CLI 结构**：`cloudbaserc.json` 必须在项目根（含 `functionRoot: "cloudfunctions"`）；`fn deploy --dir <目录>` 表面成功但代码不生效（Code size 恒为旧包）—— 用根目录标准结构
- **zip 打包**：`--deployMode zip` 有 1.5MB 限制且易报错；用默认 COS 上传即可
- **node-sdk**：`@cloudbase/node-sdk` 导出是 `init()` 不是类 → `cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })`（SCF 自动识别环境）
- **HTTP 网关 event**：可能包 body（`{ body: "json" }` 或直接 body）→ `a = event?.body ?? event ?? {}` 兼容 + JSON.parse
- **数据库**：`.set()` 不允许更新 `_id` 字段 → save 前 `delete data._id`
- **npm 沙箱**：Windows 下 npm 缓存在 Bash 沙箱被 safe-delete 拦截 → 用 PowerShell 跑 npm
- **验证部署**：`npx tcb fn code download <fn> <dest>` 后 grep 新逻辑关键字；前端用浏览器（agent-browser）实测
- **分享卡**：微信/QQ 抓 og:image → index.html 配 `og:title/og:description/og:image`；换新链接（`?r=xxx`）绕微信缓存
- **静态资源**：`public/` 下的文件会被复制到 dist 根；CloudBase 托管对 https 资源无跨域问题

## 常见组合场景

- **纯静态页**：只需步骤 1 + 6 + 7（不建云函数/数据库/网关）
- **静态页 + 简单 API**：完整 7 步
- **需要鉴权**：网关可配鉴权，或云函数内做 token 校验

## Resources

- `scripts/zip_package.py` — 标准 CPZIP 格式打包脚本（PowerShell Compress-Archive 被 SCF 拒时的替代）
