/**
 * 响应窗口优先级时序回归测试（2026-09-23 用户反馈）：
 * "bot 有胡/碰（高优先级）时应先表态，而不是等真人点'吃'之后才反应"
 *
 * 复现场景：阿珍(seat3, bot)打出 4万 → 真人(seat0)持 2万3万 可吃，小美(seat1, bot)持 4万4万 可碰。
 * 期望时序：小美的碰应尽快表态（窗口在真人点吃前关闭），真人的吃按钮根本不该等到"点了才被顶掉"。
 *
 * 修复前 bug：
 * 1. bot 的碰/胡被 botStepMs(2200ms) 拟人节流统一压制，不区分优先级
 * 2. 真人提交"吃"会重置 botTickAt（节流续期）——真人越快点，bot 表态越晚
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomManager, type RoomState, type SeatPlayer } from '../server/room.js';
import { createMatch, applyAction, legalActions } from '../src/engine/index.js';
import { mkState, K } from './helpers.js';

/** 构造：seat3 打出 4万 进入响应窗口；withPeng=true 时 seat1 小美持 4万4万 可碰，seat0 真人可吃 */
function buildState(withPeng = true) {
  const wan2 = K.wan(2), wan3 = K.wan(3), wan4 = K.wan(4);
  const state = mkState({
    hands: [[wan2, wan3, 'fill'], withPeng ? [wan4, wan4, 'fill'] : 'junk', 'junk', [wan4, 'fill']],
    junkAvoid: [K.wan(1), K.wan(2), K.wan(3), K.wan(4), K.wan(5), K.wan(6)],
    phase: { t: 'awaitDiscard' },
    current: 3,
    goldKind: K.zhong, // 中为金，4万 非金
  });
  const tile = state.players[3]!.hand.find((id) => Math.floor(id / 4) === wan4)!;
  applyAction(state, 3, { type: 'discard', tile });
  if (state.phase.t !== 'awaitResponse') throw new Error('构造失败：未进入响应窗口');
  return state;
}

function mkSeat(seat: number, isBot: boolean, name: string): SeatPlayer {
  return { seat, name, token: isBot ? `b${seat}` : 't0', online: true, ready: true, isBot };
}

describe('响应窗口优先级时序：bot 的胡/碰先于真人表态（2026-09-23 用户反馈）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // AI 决策确定性（< level 0.9 → 选最优/碰）
  });

  it('好友房：小美能碰时应在真人点吃之前表态（喊牌可见，最终碰赢过吃）', async () => {
    let room: RoomState | null = null;
    const mem = {
      async load(id: string) { return room; },
      async save(r: RoomState) { room = r; },
    };
    const mgr = new RoomManager(mem as never);
    const T0 = 1_000_000;
    room = {
      id: '1000', createdAt: T0, phase: 'playing', rounds: 9999,
      players: [mkSeat(0, false, '真人'), mkSeat(1, true, '小美'), mkSeat(2, true, '阿强'), mkSeat(3, true, '阿珍')],
      hostToken: 't0', version: 1, lastEvent: '',
      match: createMatch(1, 9999), state: buildState(), roundNo: 1,
      botTickAt: T0, turnStartedAt: T0, botSeatLast: 0, // 模拟出牌刚发生（submitAction discard 会重置节流）
      waitingNext: false, nextReady: [], trusted: [false, false, false, false],
      huTally: { human: 0, bot: 0 },
    };

    // 出牌后 500ms，真人客户端 poll 驱动 tickBots —— 小美的碰应已表态（不再被 2.2s 节流压着）
    vi.setSystemTime(T0 + 500);
    const v1 = await mgr.poll('1000', 't0');
    const s1 = room.state!;
    expect(s1.phase.t).toBe('awaitResponse');                    // 收集制：等所有人表态，窗口仍开
    expect(s1.responses[1]?.type).toBe('peng');                  // 小美的碰已提交（时序修复核心）
    expect(v1.pendingResponses?.[1]).toBe('peng');                // 且真人事前可见（喊牌语义）

    // 真人此时点"吃"（现实场景：没注意小美的喊牌）→ 提交即触发裁决（纯 pass 家已自动表态）
    vi.setSystemTime(T0 + 800);
    const chi = legalActions(s1, 0).find((a) => a.type === 'chi')!;
    await mgr.submitAction('1000', 't0', chi);
    const s2 = room.state!;
    expect(s2.phase.t).toBe('awaitDiscard');                    // 立即裁决，无干等窗口
    expect(s2.current).toBe(1);                                  // 碰 > 吃（D2 优先级正确）：小美碰后出牌
    expect(s2.players[1]!.melds.length).toBe(1);                 // 小美碰成副露
    expect(s2.players[0]!.melds.length).toBe(0);                  // 真人的吃被顶掉
    expect(v1.pendingResponses?.[1]).toBe('peng');               // 复查：吃之前喊牌可见
  });

  it('好友房：真人响应类动作（吃）不再给 bot 节流续期', async () => {
    let room: RoomState | null = null;
    const mem = {
      async load(id: string) { return room; },
      async save(r: RoomState) { room = r; },
    };
    const mgr = new RoomManager(mem as never);
    const T0 = 2_000_000;
    room = {
      id: '2000', createdAt: T0, phase: 'playing', rounds: 9999,
      players: [mkSeat(0, false, '真人'), mkSeat(1, true, '小美'), mkSeat(2, true, '阿强'), mkSeat(3, true, '阿珍')],
      hostToken: 't0', version: 1, lastEvent: '',
      match: createMatch(1, 9999), state: buildState(false), roundNo: 1, // 无碰局面：真人吃是唯一高优响应，其余 bot 只能过
      botTickAt: T0, turnStartedAt: T0, botSeatLast: 0,
      waitingNext: false, nextReady: [], trusted: [false, false, false, false],
      huTally: { human: 0, bot: 0 },
    };

    // 真人在节流期内点吃（bot 无高优先级动作，且纯 pass 家引擎已自动表态 → 吃是唯一待决响应）
    vi.setSystemTime(T0 + 300);
    const chi = legalActions(room.state!, 0).find((a) => a.type === 'chi')!;
    expect(chi).toBeTruthy();
    await mgr.submitAction('2000', 't0', chi);
    // 真人的"吃"是响应类动作：不应重置 botTickAt（修复前 bug：续期 2.2s）
    expect(room.botTickAt).toBe(T0);              // 保持出牌时刻，未被吃的提交续期
    const s2 = room.state!;
    expect(s2.phase.t).toBe('awaitDiscard');      // 无竞争 → 吃直接生效，真人进入出牌阶段
    expect(s2.current).toBe(0);
  });
});
