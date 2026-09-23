/**
 * 好友房机器胡牌规则（2026-09-23 用户改）：
 * - 真人数 ≤2 → 机器阵营整体 20% 概率胡（每个胡牌时机全机器合计只掷一次骰，不随机器数放大）
 * - 真人数 ≥3 → 机器永不胡
 *
 * 核心语义验证点：
 * 1. 3 真人：botTryWin 恒 null
 * 2. 同一点炮响应窗口：判定结果跨调用一致（存 RoomState，跨 poll 不重复掷骰 → 概率不被机器数放大）
 * 3. 新窗口重新掷骰；自摸时机独立掷骰
 * 4. 统计上 allow 率 ≈ 20%（二项分布 B(1000, 0.2)，±4σ 宽松断言防 flaky）
 * 5. RoomState JSON 序列化往返后判定结果保留（模拟云函数跨 poll 存取）
 */
import { describe, it, expect } from 'vitest';
import { RoomManager, type RoomState, type SeatPlayer } from '../server/room.js';
import { createRound, type GameAction, type GameState } from '../src/engine/index.js';

const CFG = { rounds: 9999, liujuFloor: 16 };

function mkPlayer(seat: number, isBot: boolean): SeatPlayer {
  return { seat, name: `p${seat}`, token: `t${seat}`, online: true, ready: true, isBot };
}

function mkRoom(seats: boolean[]): RoomState {
  return {
    id: '1000', createdAt: 0, phase: 'playing', rounds: 9999,
    players: seats.map((b, i) => mkPlayer(i, b)),
    hostToken: '', version: 1, lastEvent: '',
    match: null, state: null, roundNo: 1,
    botTickAt: 0, turnStartedAt: 0,
    waitingNext: false, nextReady: [], trusted: [false, false, false, false],
  };
}

function mkState(): GameState {
  const s = createRound(42, 0, CFG);
  s.phase = { t: 'awaitResponse', discard: 5, from: 1 }; // 有人打出 5，进入响应窗口
  return s;
}

const HU: GameAction = { type: 'hu' } as GameAction;
const ACTS: GameAction[] = [{ type: 'pass' }, HU];

type BotTryWin = (room: RoomState, state: GameState, acts: GameAction[]) => GameAction | null;
const tryWin = (mgr: RoomManager) => (mgr as unknown as { botTryWin: BotTryWin }).botTryWin.bind(mgr);

describe('好友房机器胡牌规则（2026-09-23：≤2 真人整体 20%，≥3 真人永不胡）', () => {
  const mem = { rooms: new Map<string, RoomState>(), async load(id: string) { return this.rooms.get(id) ?? null; }, async save(r: RoomState) { this.rooms.set(r.id, r); } };
  const mgr = new RoomManager(mem as never);
  const win = tryWin(mgr);

  it('3 真人房：机器永不胡（点炮窗口与自摸时机都是 null）', () => {
    const room = mkRoom([false, false, false, true]); // 3 真人 + 1 bot
    const s = mkState();
    expect(win(room, s, ACTS)).toBeNull();
    expect(win(room, s, ACTS)).toBeNull();
    s.phase = { t: 'awaitDiscard' }; // 自摸时机
    for (let i = 0; i < 50; i++) expect(win(room, s, ACTS)).toBeNull();
  });

  it('2 真人房：同一响应窗口判定跨调用一致（结果存 RoomState，不重复掷骰）', () => {
    const room = mkRoom([false, false, true, true]); // 2 真人 + 2 bot
    const s = mkState();
    const first = win(room, s, ACTS);
    expect(room.botHuGrant).toBeTruthy(); // 判定已存入 RoomState
    // 同窗口反复调用（模拟窗口内多个 bot、跨多次 poll 读取）
    for (let i = 0; i < 10; i++) {
      expect((win(room, s, ACTS) !== null)).toBe(first !== null);
    }
    // JSON 序列化往返（模拟云函数存取后判定保留）
    const persisted: RoomState = JSON.parse(JSON.stringify(room));
    expect((win(persisted, s, ACTS) !== null)).toBe(first !== null);
  });

  it('2 真人房：新响应窗口重新掷骰（log 增长 → key 变化）', () => {
    const room = mkRoom([false, false, true, true]);
    const s = mkState();
    win(room, s, ACTS);
    const grant1 = room.botHuGrant!;
    s.log.push('出牌:1:7'); // 下一窗口（log.length 变化）
    s.phase = { t: 'awaitResponse', discard: 7, from: 1 };
    win(room, s, ACTS);
    const grant2 = room.botHuGrant!;
    expect(grant2.key).not.toBe(grant1.key); // 新窗口新判定
  });

  it('2 真人房：点炮窗口 allow 率 ≈ 20%（1000 个独立窗口统计）', () => {
    const room = mkRoom([false, false, true, true]);
    const s = mkState();
    let allowed = 0;
    for (let i = 0; i < 1000; i++) {
      s.log.push(`x${i}`); // log 持续增长 → 每次窗口 key 都不同 → 独立掷骰
      if (win(room, s, ACTS)) allowed++;
    }
    // B(1000, 0.2)：μ=200，σ≈12.6 → ±4σ 区间，稳定不 flaky
    expect(allowed).toBeGreaterThanOrEqual(150);
    expect(allowed).toBeLessThanOrEqual(250);
  });

  it('2 真人房：自摸时机独立掷骰，allow 率 ≈ 20%', () => {
    const room = mkRoom([false, false, true, true]);
    const s = mkState();
    s.phase = { t: 'awaitDiscard' }; // 非响应窗口 → 自摸路径独立掷骰
    let allowed = 0;
    for (let i = 0; i < 1000; i++) {
      if (win(room, s, ACTS)) allowed++;
    }
    expect(allowed).toBeGreaterThanOrEqual(150);
    expect(allowed).toBeLessThanOrEqual(250);
  });

  it('1 真人房（3 bot）与 2 真人房（2 bot）：同为阵营 20%，概率不随机器数放大', () => {
    // 语义由"每窗口只掷一次"保证：同窗口内 3 个 bot 调用都读同一个 botHuGrant
    const room = mkRoom([false, true, true, true]); // 1 真人 + 3 bot
    const s = mkState();
    const r1 = win(room, s, ACTS);
    const r2 = win(room, s, ACTS);
    const r3 = win(room, s, ACTS);
    expect((r1 !== null) === (r2 !== null) && (r2 !== null) === (r3 !== null)).toBe(true);
  });

  it('真人中途退出（座位换 bot）后：真人数下降 → 机器从永不胡变为 20% 可胡', () => {
    const room = mkRoom([false, false, false, true]); // 3 真人
    const s = mkState();
    expect(win(room, s, ACTS)).toBeNull();
    room.players[2] = mkPlayer(2, true); // 座位 2 真人退出 → bot 托管
    expect(room.players.filter((x) => x && !x.isBot).length).toBe(2);
    // 现在允许掷骰（可能 null，但 botHuGrant 必须被写入 —— 证明判定路径已打开）
    win(room, s, ACTS);
    expect(room.botHuGrant).toBeTruthy();
  });
});
