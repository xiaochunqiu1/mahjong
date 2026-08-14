/**
 * TTS 云函数：百度短文本在线合成代理
 *
 * 为什么需要它：微信内置浏览器（尤其 Android 旧 X5 内核）不支持 speechSynthesis，
 * 浏览器直接调百度 API 又有 CORS + 密钥暴露问题 → 云函数中转。
 *
 * 入参：GET/POST { text: "八筒", per?: 0 }
 * 返回：JSON { ok: true, audio: "<mp3 base64>" }（带 CORS）
 * 注：不用 isBase64Encoded 二进制直出——CloudBase 网关对该模式返回空 body（实测 chunked 流为 0 字节），
 *     改为 JSON 透传 base64，由前端 atob 解码为 AudioBuffer。
 *
 * 环境变量（CloudBase 云函数配置里设置）：
 *   BAIDU_TTS_API_KEY    百度 AI 开放平台应用 API Key
 *   BAIDU_TTS_SECRET_KEY 百度 AI 开放平台应用 Secret Key
 *   BAIDU_TTS_PER        发音人（默认 0 度小宇；4132 = 度阿闽闽南男声，需确认在免费包内）
 *
 * 缓存：内存 Map<text, mp3 base64>——牌名/动作词总共 ~50 种文本，第二次同文本零调用百度。
 * access_token 有效期 30 天，缓存 25 天自动刷新。
 */

let cachedToken: { token: string; expiresAt: number } | null = null;
const audioCache = new Map<string, string>(); // text|per → mp3 base64

async function getToken(apiKey: string, secretKey: string): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token;
  const url = 'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials'
    + '&client_id=' + encodeURIComponent(apiKey)
    + '&client_secret=' + encodeURIComponent(secretKey);
  const res = await fetch(url, { method: 'POST' });
  const data = await res.json() as { access_token?: string; error_description?: string };
  if (!data.access_token) throw new Error('百度 token 获取失败: ' + (data.error_description ?? 'unknown'));
  cachedToken = { token: data.access_token, expiresAt: now + 25 * 24 * 3600 * 1000 };
  return data.access_token;
}

async function synth(text: string, tok: string, per: number): Promise<Buffer> {
  const body = new URLSearchParams({
    tex: text, tok, cuid: 'qzmj-tts', ctp: '1', lan: 'zh',
    spd: '5', pit: '5', vol: '15', per: String(per), aue: '3', // aue=3 → mp3
  });
  const res = await fetch('https://tsn.baidu.com/text2audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const ct = res.headers.get('content-type') ?? '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (!ct.includes('audio')) {
    // 失败时百度返回 JSON 错误
    let msg = 'unknown';
    try { msg = JSON.parse(buf.toString('utf-8')).err_msg ?? msg; } catch { /* ignore */ }
    throw new Error('百度合成失败: ' + msg);
  }
  return buf;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function main(event: any): Promise<any> {
  if ((event?.httpMethod ?? '').toUpperCase() === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  try {
    const apiKey = process.env.BAIDU_TTS_API_KEY;
    const secretKey = process.env.BAIDU_TTS_SECRET_KEY;
    if (!apiKey || !secretKey) {
      return { statusCode: 503, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'TTS 未配置（缺少百度 Key）' }) };
    }
    // 兼容 GET query 与 POST body（含网关 { body: "json" } 包装）
    let text = ''; let per = Number(process.env.BAIDU_TTS_PER ?? 0);
    const q = event?.queryStringParameters ?? event?.query ?? {};
    if (q.text) text = String(q.text);
    let raw = event?.body ?? event ?? {};
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = {}; } }
    if (raw && typeof raw === 'object') {
      if (raw.text) text = String(raw.text);
      if (raw.per !== undefined) per = Number(raw.per);
    }
    text = text.trim();
    if (!text || text.length > 60) {
      return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'text 为空或过长' }) };
    }
    const cacheKey = per + '|' + text;
    let b64 = audioCache.get(cacheKey);
    if (!b64) {
      const tok = await getToken(apiKey, secretKey);
      const mp3 = await synth(text, tok, per);
      b64 = mp3.toString('base64');
      audioCache.set(cacheKey, b64);
    }
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      body: JSON.stringify({ ok: true, audio: b64 }),
    };
  } catch (e) {
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: (e as Error).message }) };
  }
}
