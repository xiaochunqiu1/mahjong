/**
 * 前端联机层：对接 CloudBase 云函数（生产）或本地 mock（开发）。
 *
 * 环境切换：
 * - 生产：import.meta.env.VITE_USE_MOCK !== '1' → @cloudbase/js-sdk callFunction
 * - 开发：VITE_USE_MOCK=1（或未配置 SDK）→ fetch 本地 mock（http://127.0.0.1:8787）
 */

const MOCK_BASE = 'http://127.0.0.1:8787';
let cloudbaseSdk: any = null;

// ---- 联机视图类型（与服务端 RoomView 对齐，前端内联避免跨目录引用）----

export interface OnlineRoomView {
  roomId: string;
  roomPhase: 'lobby' | 'playing' | 'over';
  version: number;
  lastEvent: string;
  rounds: number;
  roundNo: number;
  dealer: number;
  scores: [number, number, number, number];
  players: { seat: number; name: string; online: boolean; ready: boolean; isBot: boolean }[];
  seat: number;
  goldKind: number;
  wallCount: number;
  self: { hand: number[]; flowers: number[]; melds: { type: string; kind: number; tiles: number[]; fromSeat?: number }[]; discards: number[]; youjin: 0 | 1 | 2 } | null;
  others: {
    seat: number; name: string; handCount: number; flowers: number[]; melds: { type: string; kind: number; tiles: number[]; fromSeat?: number }[]; discards: number[]; youjin: 0 | 1 | 2; isBot: boolean;
  }[];
  phase: { t: string; discard?: number; from?: number } | null;
  current: number;
  waitingNext: boolean;   // 本局已结算，等待所有在场真人点"下一局"
  nextReady: number[];    // 已同意"下一局"的真人座位
  trusted: boolean[];     // 托管中的座位（AI 代打）
  lastDiscardSeat: number | null;  // 最近出牌人的座位（服务端解析，客户端牌河高亮用）
  yourTurn: boolean;
  canRespond: boolean;
  legal: any[] | null;
  deadline?: number | null;   // 当前 phase 截止时间戳（罗盘倒计时）
  overResult: { winner: number; winType: string; liuju: boolean; delta: [number, number, number, number] } | null;
}

/** 是否需要 mock（开发调试） */
function useMock(): boolean {
  const env = (import.meta as any).env ?? {};
  if (env.VITE_USE_MOCK === '1') return true;
  if ((import.meta as any).env?.PROD) return false; // 生产一定走云函数
  return true; // 开发默认走 mock（本地联调）
}

/** 懒加载 @cloudbase/js-sdk（生产环境） */
async function getCloudbase(): Promise<any> {
  if (cloudbaseSdk) return cloudbaseSdk;
  const mod = await import('@cloudbase/js-sdk');
  const app = mod.default.init({ env: (import.meta as any).env?.VITE_TCB_ENV ?? '' });
  cloudbaseSdk = app;
  return cloudbaseSdk;
}

async function callMock(action: string, payload: any): Promise<any> {
  const r = await fetch(`${MOCK_BASE}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error ?? '请求失败');
  return j;
}

async function callCloud(action: string, payload: any): Promise<any> {
  const url = (import.meta as any).env?.VITE_TCB_URL;
  if (!url) throw new Error('未配置 VITE_TCB_URL');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error ?? '请求失败');
  return j;
}

async function call(action: string, payload: any): Promise<any> {
  return useMock() ? callMock(action, payload) : callCloud(action, payload);
}

// ---- 业务 API（7 接口 + poll）----

export async function apiCreateRoom(name: string, rounds: number): Promise<{ roomId: string; token: string; view: OnlineRoomView }> {
  const r = await call('createRoom', { name, rounds });
  return { roomId: r.roomId, token: r.token, view: r.view };
}

export async function apiJoinRoom(roomId: string, name: string): Promise<{ token: string; view: OnlineRoomView }> {
  const r = await call('joinRoom', { roomId, name });
  return { token: r.token, view: r.view };
}

export async function apiSetReady(roomId: string, token: string, ready: boolean): Promise<OnlineRoomView> {
  const r = await call('setReady', { roomId, token, ready });
  return r.view;
}

export async function apiStartMatch(roomId: string, token: string): Promise<OnlineRoomView> {
  const r = await call('startMatch', { roomId, token });
  return r.view;
}

export async function apiNextRound(roomId: string, token: string): Promise<OnlineRoomView> {
  const r = await call('nextRound', { roomId, token });
  return r.view;
}

export async function apiSubmitAction(roomId: string, token: string, action: any): Promise<OnlineRoomView> {
  const r = await call('submitAction', { roomId, token, action2: action });
  return r.view;
}

export async function apiUntrust(roomId: string, token: string): Promise<OnlineRoomView> {
  const r = await call('untrust', { roomId, token });
  return r.view;
}

export async function apiResumeSeat(roomId: string, token: string): Promise<OnlineRoomView> {
  const r = await call('resumeSeat', { roomId, token });
  return r.view;
}

export async function apiLeaveRoom(roomId: string, token: string): Promise<void> {
  await call('leaveRoom', { roomId, token });
}

export async function apiPoll(roomId: string, token?: string): Promise<OnlineRoomView> {
  const r = await call('poll', { roomId, token });
  return r.view;
}

// ---- TRTC 语音（开麦）----

export interface TrtcSign {
  sdkAppId: number;
  userId: string;
  userSig: string;
  trtcRoomId: string;
}

export async function apiGetTrtcSign(roomId: string, token: string): Promise<TrtcSign> {
  const r = await call('getTrtcSign', { roomId, token });
  return { sdkAppId: r.sdkAppId, userId: r.userId, userSig: r.userSig, trtcRoomId: r.trtcRoomId };
}
