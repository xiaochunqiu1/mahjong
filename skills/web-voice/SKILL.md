---
name: web-voice
description: 网页实时语音（开麦通话）接入方案，基于腾讯云 TRTC v5（trtc-sdk-v5）。用户说「网页语音」「语音接入」「网页开麦」「网页通话」「实时语音」或任何需要在网页里加多人实时语音对话的场景时使用。覆盖：TRTC 控制台开通、userSig 服务端签发（TLS-Sig v2）、前端 SDK 接入（麦克风/喇叭双控）、微信兼容、全部踩坑。
agent_created: true
---

# 网页实时语音接入（TRTC v5）

## 核心决策

网页多人实时语音（开麦通话）直接走**腾讯云 TRTC**（实时音视频）：
- 国内可用、微信内置浏览器兼容最好、自带 QoS 弱网优化（无需自建 TURN）
- 首次创建应用送 10000 分钟免费时长（麻将 4 人 1 小时 ≈ 240 分钟，够用几十小时）
- 不推荐自建 WebRTC P2P：国内 NAT 穿透差，没有 TURN 时连不上

> 关联 skill：项目上线部署见 `free-cloud`（免费云部署）。语音是开发期工作，部署是上线期工作，相互独立。

## 总体架构

```
前端(浏览器) --getTrtcSign--> 自己的后端(云函数) --签发--> userSig
前端 --trtc-sdk-v5(CDN 按需加载)--> enterRoom --> 多人实时语音
```

- TRTC 房间 ID 与业务房间一一对应（如 `mj_` + 房间码；v5 的 roomId 必须是 number）
- 用户 ID 用座位号（如 u0/u1/u2）
- **userSig 必须服务端生成**（密钥不能放前端）；有效期建议 ≥7200s

## 一、开通（用户配合，一次性的）

1. 腾讯云实名 → 开通「实时音视频 TRTC」（免费，送 10000 分钟）
2. 创建应用 → 记下 **SDKAppID**（10 位数字）和 **SecretKey**（应用信息页）
3. 把两个值配到后端环境变量（如云函数 `TRTC_SDKAPPID` / `TRTC_SECRETKEY`），未配置时接口返回「语音未开通」，前端降级提示

## 二、服务端签发 userSig（关键，容易踩坑）

userSig 是 **TLS-Sig v2** 算法，不是简单 base64 拼接：

```js
const { createHmac } = require('node:crypto');
const { deflateSync } = require('node:zlib');

function genUserSig(sdkAppId, secretKey, userId, expire = 7200) {
  const currTime = Math.floor(Date.now() / 1000);
  // 1) HMAC-SHA256 签 4 行 TLS 字段，每行尾 \n（含最后一行）
  const sigContent = `TLS.identifier:${userId}\nTLS.sdkappid:${sdkAppId}\nTLS.time:${currTime}\nTLS.expire:${expire}\n`;
  const signature = createHmac('sha256', secretKey).update(sigContent).digest('base64');
  // 2) sigDoc JSON（含 TLS.ver:'2.0'）→ zlib 压缩 → base64 → base64url 转义
  const sigDoc = { 'TLS.ver': '2.0', 'TLS.identifier': userId, 'TLS.sdkappid': sdkAppId, 'TLS.time': currTime, 'TLS.expire': expire, 'TLS.sig': signature };
  const compressed = deflateSync(Buffer.from(JSON.stringify(sigDoc))).toString('base64');
  return compressed.replace(/\+/g, '*').replace(/\//g, '-').replace(/=/g, '_');
}
```

官方参考：GitHub `Tencent-RTC/tls-sig-api-v2-node`（TLSSigAPIv2.js）。**不要用老版"4 行文本直接 base64"的写法**——服务端会报 70003 illegal。

## 三、前端接入（trtc-sdk-v5，注意与 v4 完全不同）

SDK 用 **v5**（老版 trtc-js-sdk 的 CDN URL 已 404）：

```html
<script src="https://cdn.jsdelivr.net/npm/trtc-sdk-v5@5.19.1/trtc.js"></script>
<!-- UMD，挂载 window.TRTC；建议按需加载（点开麦才加载，不占首屏） -->
```

v5 API（单实例，和 v4 的 createClient 完全不同）：

```js
const trtc = TRTC.create({ sdkAppId, userId });
await trtc.enterRoom({ roomId: 数字, userId, userSig, sdkAppId });
await trtc.startLocalAudio();   // 开麦（推流）
await trtc.stopLocalAudio();    // 关麦
// 远端音频默认自动播放（在用户手势后进房即可）
await trtc.exitRoom();
trtc.destroy();
```

**UI 双控模式（推荐）**：麦克风（说）+ 喇叭（听）两个独立按钮，默认**麦关、喇叭开**：
- 麦：`startLocalAudio()` / `stopLocalAudio()`
- 喇叭：**逐个** `trtc.muteRemoteAudio(userId, bool)` —— v5 **没有 muteAllRemoteAudio**！
  - 监听 `TRTC.EVENT.REMOTE_AUDIO_AVAILABLE` 收集 userId 集合（加集合时按当前喇叭状态静音）
  - 监听 `TRTC.EVENT.REMOTE_AUDIO_UNMOUNTED` 移除 userId
  - 喇叭状态变化时对集合 forEach 调 `muteRemoteAudio(uid, !speakerOn)`
- 所有 SDK 调用包 try/catch，**防止任何异常冒泡导致 React/页面崩溃黑屏**

## 四、常见踩坑（全部实测过）

- **70003 UserSig illegal**：签名算法不对（不是简单 base64）或字段/换行不符 → 用上方 TLS-Sig v2 代码，本地用同一 SecretKey 重算 HMAC 核对
- **v5 没有 muteAllRemoteAudio**：调用不存在的方法会 TypeError → 页面崩溃黑屏；用逐个 muteRemoteAudio
- **roomId 类型**：v5 的 enterRoom roomId 必须是 number；字符串房间码要转数字
- **CDN**：老版 `web.sdk.qcloud.com/trtc/webrtc/trtc.js` 404；用 jsdelivr 的 trtc-sdk-v5
- **自动播放策略**：enterRoom 必须在用户手势回调里触发（点开麦按钮即是手势）
- **微信兼容**：较新 X5 内核支持 WebRTC；个别老旧版本可能开麦失败，提示用户升级微信
- **部署后验证**：headless 浏览器无麦克风（getUserMedia 被拒），真实通话必须手机+电脑真机双端测；服务端签名可用 curl + 本地 HMAC 重算验证

## Resources

- `scripts/genUserSig.js` — Node 版 userSig 生成（可直接拷进后端/云函数）
