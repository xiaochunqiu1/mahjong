#!/usr/bin/env node
/**
 * TRTC userSig 生成（TLS-Sig v2）—— 可直接拷进 Node 后端 / 云函数。
 *
 * 用法：
 *   node genUserSig.js <sdkAppId> <secretKey> <userId> [expireSeconds]
 *
 * 注意：这是服务端代码，密钥绝不能放前端！
 * 官方参考：github.com/Tencent-RTC/tls-sig-api-v2-node（TLSSigAPIv2.js）
 */
const { createHmac } = require('node:crypto');
const { deflateSync } = require('node:zlib');

function genUserSig(sdkAppId, secretKey, userId, expire = 7200) {
  const currTime = Math.floor(Date.now() / 1000);
  // 1) HMAC-SHA256 签 4 行 TLS 字段，每行尾 \n（含最后一行）
  const sigContent =
    `TLS.identifier:${userId}\n` +
    `TLS.sdkappid:${sdkAppId}\n` +
    `TLS.time:${currTime}\n` +
    `TLS.expire:${expire}\n`;
  const signature = createHmac('sha256', secretKey).update(sigContent).digest('base64');
  // 2) sigDoc JSON（含 TLS.ver:'2.0'）→ zlib 压缩 → base64 → base64url 转义
  const sigDoc = {
    'TLS.ver': '2.0',
    'TLS.identifier': String(userId),
    'TLS.sdkappid': Number(sdkAppId),
    'TLS.time': currTime,
    'TLS.expire': expire,
    'TLS.sig': signature,
  };
  const compressed = deflateSync(Buffer.from(JSON.stringify(sigDoc))).toString('base64');
  return compressed.replace(/\+/g, '*').replace(/\//g, '-').replace(/=/g, '_');
}

if (require.main === module) {
  const [sdkAppId, secretKey, userId, expire] = process.argv.slice(2);
  if (!sdkAppId || !secretKey || !userId) {
    console.error('用法: node genUserSig.js <sdkAppId> <secretKey> <userId> [expireSeconds]');
    process.exit(1);
  }
  console.log(genUserSig(sdkAppId, secretKey, userId, expire ? Number(expire) : 7200));
}

module.exports = { genUserSig };
