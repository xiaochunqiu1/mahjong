/**
 * 好友房机器胡牌配额制（2026-09-23 用户规则终版，仅好友房——单机房设置不变）：
 * 用户原话："胡 1000 次，真人胡的总和 800 次左右，机器胡的总和 200 次左右"
 * → 机器胡牌总数 ≤ 真人胡牌总数 × 1/4（机器占胡牌总数 20%）
 *
 * 实现语义验证点：
 * 1. 3 真人房：机器永不胡
 * 2. ≤2 真人房：配额内（bot×4 < human+3）有可胡动作必返回胡（点炮胡/自摸通用，不掷骰）
 * 3. 配额用尽（bot×4 ≥ human+3）→ 永不胡，直到真人再胡后解锁
 * 4. 结算计数：真人胡 +human、机器胡 +bot、流局不计（huTally 存 RoomState 跨局累计）
 * 5. 中途退出换 bot：按胡牌者当前座位属性归属
 * 6. 长期模拟：真人持续胡牌，机器配额循环解锁 → 机器/真人比例收敛 1:4（20%）
 */
import { describe, it, expect } from 'vitest';
import { RoomManager, type RoomState, type SeatPlayer } from '../server/room.js';
import { createMatch, type GameAction, type RoundResult } from '../src/engine/index.js';

function mkPlayer(seat: number, isBot: boolean): SeatPlayer {
  return { seat, name: `p${seat}`, token: `t${seat}`, online: true, ready: true, isBot };
}

function mkRoom(seats: boolean[], huTally?: { human: number; bot: number }): RoomState {
  return {
    id: '1000', createdAt: 0, phase: 'playing', rounds: 9999,
    players: seats.map((b, i) => mkPlayer(i, b)),
    hostToken: '', version: 1, lastEvent: '',
    match: null, state: null, roundNo: 1,
    botTickAt: 0, turnStartedAt: 0,
    waitingNext: false, nextReady: [], trusted: [false, false, false, false],
    huTally,
  };
}

const HU: GameAction = { type: 'hu' } as GameAction;
const ACTS: GameAction[] = [{ type: 'pass' }, HU];

type BotTryWin = (room: RoomState, acts: GameAction[]) => GameAction | null;
type Settle = (room: RoomState) => void;
const mgrHack = (mgr: RoomManager) => ({
  win: (mgr as unknown as { botTryWin: BotTryWin }).botTryWin.bind(mgr),
  settle: (mgr as unknown as { settleRound: Settle }).settleRound.bind(mgr),
});

/** 构造一局的终态 RoomState + 胡牌结算结果（绕开引擎直接测 settleRound 的计数逻辑） */
function settleAs(room: RoomState, winnerSeat: number, liuju: boolean): void {
  const res = { winner: winnerSeat, liuju, score: { winType: 'zimo', delta: [0, 0, 0, 0] } } as unknown as RoundResult;
  room.state = { phase: { t: 'over', result: res } } as RoomState['state'];
  room.match = createMatch(1, 9999); // 真实 MatchState（advanceMatch 需要 history/scores/dealer/config）
}

describe('好友房机器胡牌配额制（2026-09-23：机器胡牌总数 ≤ 真人 × 1/4，占胡牌总数 20%）', () => {
  const mem = { rooms: new Map<string, RoomState>(), async load(id: string) { return this.rooms.get(id) ?? null; }, async save(r: RoomState) { this.rooms.set(r.id, r); } };
  const { win, settle } = mgrHack(new RoomManager(mem as never));

  it('3 真人房：机器永不胡（任何配额状态下）', () => {
    const room = mkRoom([false, false, false, true], { human: 100, bot: 0 }); // 配额充裕也永不胡
    expect(win(room, ACTS)).toBeNull();
  });

  it('≤2 真人房：配额内有可胡动作必返回胡（不掷骰，确定性）', () => {
    expect(win(mkRoom([false, true, true, true]), ACTS)).toBe(HU);       // 1 真人，human=0 bot=0
    expect(win(mkRoom([false, false, true, true], { human: 10, bot: 2 }), ACTS)).toBe(HU); // 2×4=8 < 13 ✓
    // 无可胡动作 → null
    expect(win(mkRoom([false, true, true, true]), [{ type: 'pass' }])).toBeNull();
  });

  it('配额用尽（bot×4 ≥ human+3）→ 永不胡，真人再胡后解锁', () => {
    const room = mkRoom([false, true, true, true], { human: 0, bot: 1 });   // 4 ≥ 3 → 锁
    expect(win(room, ACTS)).toBeNull();
    room.huTally = { human: 1, bot: 1 };                                    // 4 ≥ 4 → 仍锁
    expect(win(room, ACTS)).toBeNull();
    room.huTally = { human: 2, bot: 1 };                                    // 4 < 5 ✓ 解锁
    expect(win(room, ACTS)).toBe(HU);
    room.huTally = { human: 10, bot: 3 };                                   // 12 < 13 ✓
    expect(win(room, ACTS)).toBe(HU);
    room.huTally = { human: 10, bot: 4 };                                   // 16 ≥ 13 → 锁
    expect(win(room, ACTS)).toBeNull();
  });

  it('结算计数：真人胡 +human / 机器胡 +bot / 流局不计', () => {
    const room = mkRoom([false, true, true, true]);
    settleAs(room, 0, false); settle(room);          // 真人（座位0）胡
    expect(room.huTally).toEqual({ human: 1, bot: 0 });
    settleAs(room, 1, false); settle(room);          // 机器（座位1）胡
    expect(room.huTally).toEqual({ human: 1, bot: 1 });
    settleAs(room, -1, true); settle(room);          // 流局
    expect(room.huTally).toEqual({ human: 1, bot: 1 });
    settleAs(room, 0, false); settle(room);          // 真人再胡
    expect(room.huTally).toEqual({ human: 2, bot: 1 });
  });

  it('中途退出换 bot：胡牌按当前座位属性归属', () => {
    const room = mkRoom([false, true, true, true]);
    room.players[0] = mkPlayer(0, true); // 真人 0 退出 → bot 托管
    settleAs(room, 0, false); settle(room);
    expect(room.huTally).toEqual({ human: 0, bot: 1 });
  });

  it('长期模拟：真人持续胡牌，机器配额循环 → 机器占胡牌总数收敛 20%', () => {
    const room = mkRoom([false, true, true, true]);
    let human = 0, bot = 0;
    for (let i = 0; i < 200; i++) {
      room.huTally = { human, bot };
      settleAs(room, 0, false); settle(room);          // 真人胡一局
      human = room.huTally!.human;
      if (win(room, ACTS)) {                            // 配额允许 → 机器胡一局
        settleAs(room, 1, false); settle(room);
        bot = room.huTally!.bot;
      }
    }
    const share = bot / (bot + human);
    // 长期 bot ≤ (human+3)/4 → 占比趋近 20%
    expect(bot).toBeLessThanOrEqual(Math.floor((human + 3) / 4) + 1);
    expect(share).toBeGreaterThan(0.18);
    expect(share).toBeLessThanOrEqual(0.21);
  });
});
