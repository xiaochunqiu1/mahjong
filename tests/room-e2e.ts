/**
 * 好友房联机冒烟测试（mock server）。
 * 流程：建房 → 加入(2号) → 双方准备 → 开局 → 双方轮流出牌 → bot 陪打 → 直至结束。
 * 运行：npx tsx tests/room-e2e.ts  （需先启动 mock: npx tsx server/mock.ts）
 */

import type { RoomView } from '../server/room.ts';

const BASE = 'http://127.0.0.1:8787';

async function call(action: string, body: any): Promise<any> {
  const r = await fetch(`${BASE}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${action} 失败: ${j.error ?? JSON.stringify(j)}`);
  return j;
}

let failures = 0;
function check(cond: boolean, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}`); }
}

async function main() {
  console.log('== 1. 建房 ==');
  const host = await call('createRoom', { name: '小明', rounds: 4 });
  const roomId = host.roomId;
  const hostToken = host.token;
  check(/^\d{4}$/.test(roomId), `房间码 4 位数字: ${roomId}`);
  check(host.view.players.filter((p: any) => p.isBot).length === 3, '建房后 3 个 bot 补位');
  check(host.view.seat === 0, '房主坐 1 号位');

  console.log('== 2. 加入 ==');
  const p2 = await call('joinRoom', { roomId, name: '小红' });
  const p2Token = p2.token;
  check(p2.view.players.filter((p: any) => !p.isBot).length === 2, '加入后 2 真人');
  check(p2.view.seat === 1, '2 号加入者坐 2 号位');

  console.log('== 3. 准备 ==');
  await call('setReady', { roomId, token: hostToken, ready: true });
  await call('setReady', { roomId, token: p2Token, ready: true });
  const poll = await call('poll', { roomId, token: hostToken });
  check(poll.view.players.filter((p: any) => !p.isBot).every((p: any) => p.ready), '两个真人都已准备');

  console.log('== 4. 开局 ==');
  const start = await call('startMatch', { roomId, token: hostToken });
  check(start.view.roomPhase === 'playing', '对局开始');
  check(start.view.self !== null && start.view.self.hand.length >= 16, '房主拿到手牌');

  console.log('== 5. 对局推进（真人动作 + bot 陪打）==');
  let view: RoomView = start.view;
  let steps = 0;
  const maxSteps = 900; // 4 局全打完的步数预算（约 520 步）
  let seat = view.seat;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  while (view.roomPhase === 'playing' && steps < maxSteps) {
    steps++;
    view = (await call('poll', { roomId, token: seat === 0 ? hostToken : p2Token })).view;
    // 当前轮到我（出牌/摸牌）或可响应 → 提交动作
    if ((view.yourTurn || view.canRespond) && view.legal && view.legal.length > 0) {
      const acts = view.legal;
      let act = acts.find((a: any) => a.type === 'draw')
        ?? acts.find((a: any) => a.type === 'pass')
        ?? acts.find((a: any) => a.type === 'discard' && !a.declare)
        ?? acts[0];
      view = (await call('submitAction', { roomId, token: seat === 0 ? hostToken : p2Token, action: act })).view;
    }
    // 等待 bot 行动（真实客户端 1s 轮询，bot 2s 行动；测试 mock 用 fast 模式）
    await sleep(40);
    if (steps % 50 === 0) {
      console.log(`  ...第 ${steps} 步, round=${view.roundNo}/${view.rounds} phase=${view.phase?.t} wall=${view.wallCount} scores=${JSON.stringify(view.scores)}`);
    }
    // 换视角看另一边（交替）
    seat = view.seat === 0 ? 1 : 0;
  }
  check(view.roomPhase === 'over', `整场结束（round=${view.roundNo}/${view.rounds}, ${steps} 步）`);
  console.log(`  ...最终 scores=${JSON.stringify(view.scores)} overResult=${JSON.stringify(view.overResult)}`);

  console.log('== 6. 离开房间 ==');
  const left = await call('leaveRoom', { roomId, token: p2Token });
  check(left.ok, '2 号玩家离开成功');

  console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('测试异常:', e); process.exit(1); });
