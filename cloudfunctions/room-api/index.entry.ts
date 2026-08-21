/**
 * CloudBase 云函数：room-api（好友房 7 接口 + poll）。
 * 与 server/room.ts 共享同一份 RoomManager 逻辑，存储层换成 CloudBase 数据库。
 *
 * 部署（CloudBase 控制台）：
 * 1. 建 Nodejs 云函数 room-api，运行时代码=本目录打包产物（见 build.sh）
 * 2. 环境变量无需配置；数据库创建 rooms 集合，权限设为「仅云函数可读写」
 * 3. 前端 @cloudbase/js-sdk callFunction({ name: 'room-api', data: { action, ... } })
 *
 * 前端联机时的动作分发：data.action 对应 room 接口。
 */

import cloudbase from '@cloudbase/node-sdk';
import { createHmac } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { RoomManager, RoomError, type RoomState } from '../../server/room.js';

// ---- CloudBase 数据库存储 ----

// init 在 SCF 容器内自动读取当前环境（SYMBOL_CURRENT_ENV），无需手写 envId
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const COLL = 'rooms';

class DbStorage {
  async load(docId: string): Promise<RoomState | null> {
    const res = await db.collection(COLL).doc(docId).get();
    if (!res.data || res.data.length === 0) return null;
    const d = res.data[0] as any;
    // 移除数据库注入的 _id / id 字段（避免 save 时冲突）
    const { _id, ...rest } = d;
    return rest as RoomState;
  }
  async save(room: RoomState): Promise<void> {
    const data = JSON.parse(JSON.stringify(room)) as any;
    delete data._id; // CloudBase 不允许更新 _id 字段
    await db.collection(COLL).doc(room.id).set(data);
  }
}

const manager = new RoomManager(new DbStorage());

// ---- TRTC 实时语音（开麦）：userSig 签名 ----

// 环境变量由 CloudBase 云函数配置（TRTC 控制台 → 应用 → 快速上手）：
//   TRTC_SDKAPPID = 控制台 SDKAppID（纯数字）
//   TRTC_SECRETKEY = 控制台 SecretKey
function getTrtcConfig(): { sdkAppId: number; secretKey: string } {
  const appId = process.env.TRTC_SDKAPPID;
  const key = process.env.TRTC_SECRETKEY;
  if (!appId || !key) {
    throw new RoomError('语音未开通：云函数缺少 TRTC_SDKAPPID/TRTC_SECRETKEY 配置');
  }
  return { sdkAppId: Number(appId), secretKey: key };
}

/** 腾讯云 TRTC userSig（TLS-Sig v2 算法）：
 *  1) HMAC-SHA256(sigContent)=sig，sigContent: 4 行 TLS 字段 \n 拼接，**每行尾 \n**（含末尾 \n）
 *  2) sigDoc = {TLS.ver:'2.0', TLS.identifier, TLS.sdkappid, TLS.time, TLS.expire, TLS.sig}
 *  3) userSig = base64url(zlib.deflateSync(base64(JSON.stringify(sigDoc))))
 *  官方 Node SDK：github.com/Tencent-RTC/tls-sig-api-v2-node (TLSSigAPIv2.js)
 *  我之前简化为手工 base64 拼接是错的(70003 用户实测报错) */
function genUserSig(sdkAppId: number, secretKey: string, userId: string, expire = 7200): string {
  const currTime = Math.floor(Date.now() / 1000);
  const sigContent = `TLS.identifier:${userId}\nTLS.sdkappid:${sdkAppId}\nTLS.time:${currTime}\nTLS.expire:${expire}\n`;
  const signature = createHmac('sha256', secretKey).update(sigContent).digest('base64');
  const sigDoc = {
    'TLS.ver': '2.0',
    'TLS.identifier': userId,
    'TLS.sdkappid': sdkAppId,
    'TLS.time': currTime,
    'TLS.expire': expire,
    'TLS.sig': signature,
  };
  const compressed = deflateSync(Buffer.from(JSON.stringify(sigDoc))).toString('base64');
  // base64url 转义
  return compressed.replace(/\+/g, '*').replace(/\//g, '-').replace(/=/g, '_');
}

/** 生成 TRTC 开麦签名：校验 token → 返回 sdkAppId/userId/userSig/trtcRoomId */
async function getTrtcSign(roomId: string, token: string) {
  const { sdkAppId, secretKey } = getTrtcConfig();
  const { seat } = await manager.resolveVoice(String(roomId), String(token));
  const userId = `u${seat}`;
  return {
    ok: true,
    sdkAppId,
    userId,
    userSig: genUserSig(sdkAppId, secretKey, userId),
    trtcRoomId: `mj_${roomId}`,
  };
}

// ---- 云函数入口 ----

interface CloudEvent {
  action: string;
  roomId?: string;
  token?: string;
  name?: string;
  rounds?: 4 | 8;
  ready?: boolean;
  action2?: unknown; // submitAction 的 GameAction
}

exports.main = async (event: CloudEvent) => {
  try {
    // CloudBase HTTP 网关事件可能是 { body: {...} } 或 { body: "json string" } 或直接 body
    let a: any = event;
    if (a && typeof a.body !== 'undefined') a = a.body;
    if (typeof a === 'string') {
      try { a = JSON.parse(a); } catch { a = {}; }
    }
    a = a ?? {};
    console.log('[room-api] event keys:', Object.keys(event || {}), 'body type:', typeof (event as any)?.body, 'a.action:', a.action);
    switch (a.action) {
      case 'createRoom': {
        const r = await manager.createRoom(String(a.name ?? ''), Number(a.rounds) > 0 ? Number(a.rounds) : 9999); // 9999=不限局数
        return { ok: true, ...r };
      }
      case 'joinRoom': {
        const r = await manager.joinRoom(String(a.roomId ?? ''), String(a.name ?? ''));
        return { ok: true, ...r };
      }
      case 'setReady': {
        return { ok: true, view: await manager.setReady(String(a.roomId), String(a.token), !!a.ready) };
      }
      case 'startMatch': {
        return { ok: true, view: await manager.startMatch(String(a.roomId), String(a.token)) };
      }
      case 'nextRound': {
        return { ok: true, view: await manager.nextRound(String(a.roomId), String(a.token)) };
      }
      case 'submitAction': {
        return { ok: true, view: await manager.submitAction(String(a.roomId), String(a.token), a.action2 as any) };
      }
      case 'resumeSeat': {
        return { ok: true, view: await manager.resumeSeat(String(a.roomId), String(a.token)) };
      }
      case 'untrust': {
        const r = await manager.untrust(String(a.roomId ?? ''), String(a.token ?? ''));
        return { ok: true, ...r };
      }
      case 'leaveRoom': {
        return await manager.leaveRoom(String(a.roomId), String(a.token));
      }
      case 'poll': {
        return { ok: true, view: await manager.poll(String(a.roomId), a.token ? String(a.token) : undefined) };
      }
      case 'getTrtcSign': {
        return await getTrtcSign(String(a.roomId), String(a.token));
      }
      default:
        throw new RoomError(`未知接口: ${a.action}`);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '未知错误' };
  }
};
