/**
 * 本地 Mock 联调服务器（Node http，纯内存存储）。
 * 与 CloudBase 云函数共享同一份 RoomManager 逻辑。
 * 启动：npx tsx server/mock.ts [port]（默认 8787）
 * 协议：POST /<action>  body={...} → JSON
 *   createRoom {name, rounds} / joinRoom {roomId, name} / setReady {roomId, token, ready}
 *   startMatch {roomId, token} / submitAction {roomId, token, action}
 *   resumeSeat {roomId, token} / leaveRoom {roomId, token} / poll {roomId, token?}
 */

import { createServer } from 'node:http';
import { RoomManager, RoomError, type RoomStorage, type RoomState } from './room.ts';

class MemStorage implements RoomStorage {
  private map = new Map<string, RoomState>();
  async load(id: string) { return this.map.get(id) ?? null; }
  async save(room: RoomState) { this.map.set(room.id, structuredClone(room)); }
}

const manager = new RoomManager(new MemStorage(), {
  botStepMs: Number(process.env.MOCK_BOT_STEP_MS ?? 2000),
});

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end('POST only'); return; }

  const url = new URL(req.url ?? '/', 'http://x');
  const action = url.pathname.replace(/^\//, '') || 'poll';
  let body = '';
  for await (const chunk of req) body += chunk;
  let payload: any = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { /* ignore */ }

  try {
    let result: unknown;
    switch (action) {
      case 'createRoom': {
        const r = await manager.createRoom(String(payload.name ?? ''), payload.rounds === 8 ? 8 : 4);
        result = { ok: true, ...r };
        break;
      }
      case 'joinRoom': {
        const r = await manager.joinRoom(String(payload.roomId ?? ''), String(payload.name ?? ''));
        result = { ok: true, ...r };
        break;
      }
      case 'setReady': {
        result = { ok: true, view: await manager.setReady(String(payload.roomId), String(payload.token), !!payload.ready) };
        break;
      }
      case 'startMatch': {
        result = { ok: true, view: await manager.startMatch(String(payload.roomId), String(payload.token)) };
        break;
      }
      case 'nextRound': {
        result = { ok: true, view: await manager.nextRound(String(payload.roomId), String(payload.token)) };
        break;
      }
      case 'submitAction': {
        result = { ok: true, view: await manager.submitAction(String(payload.roomId), String(payload.token), payload.action) };
        break;
      }
      case 'resumeSeat': {
        result = { ok: true, view: await manager.resumeSeat(String(payload.roomId), String(payload.token)) };
        break;
      }
      case 'leaveRoom': {
        result = await manager.leaveRoom(String(payload.roomId), String(payload.token));
        break;
      }
      case 'poll': {
        result = { ok: true, view: await manager.poll(String(payload.roomId), payload.token ? String(payload.token) : undefined) };
        break;
      }
      default:
        throw new RoomError(`未知接口: ${action}`);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: msg }));
  }
});

const port = Number(process.argv[2] ?? 8787);
server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-room] listening on http://127.0.0.1:${port}`);
});
