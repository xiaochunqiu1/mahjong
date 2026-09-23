/**
 * 响应窗口时序回归测试（2026-09-23 用户终版语义）：
 * 用户原话要点："系统判断，其他家有碰杠胡的，就不要等我吃的表态了，他们直接碰杠胡就对了；
 * 碰杠胡的动作间隔要和吃一样"——即 bot 按固定时刻表（出牌后 botStepMs 拟人间隔）自主表态，
 * 与真人是否/何时表态完全无关；碰/胡的优先级由引擎裁决（胡>杠/碰>吃）保证。
 *
 * 验证点：
 * 1. 节奏：出牌后 500ms bot 不秒碰（碰与吃同节奏 2.2s）；到点自然表态且气泡事前可见
 * 2. 解耦：真人极速点吃不改变 bot 的表态时刻表（不触发清算、不续期节流）——bot 到点碰走
 * 3. 吃生效：无碰/杠/胡竞争时，响应期走完（其他家 pass 表态完）吃正常生效
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

function mkRoom(id: string, T0: number, state: ReturnType<typeof buildState>): RoomState {
  return {
    id, createdAt: T0, phase: 'playing', rounds: 9999,
    players: [mkSeat(0, false, '真人'), mkSeat(1, true, '小美'), mkSeat(2, true, '阿强'), mkSeat(3, true, '阿珍')],
    hostToken: 't0', version: 1, lastEvent: '',
    match: createMatch(1, 9999), state, roundNo: 1,
    botTickAt: T0, turnStartedAt: T0, botSeatLast: 0, // 模拟出牌刚发生（submitAction discard 会重置节流）
    waitingNext: false, nextReady: [], trusted: [false, false, false, false],
    huTally: { human: 0, bot: 0 },
  };
}

describe('响应窗口时序：bot 固定时刻表自主表态（与真人动作解耦）+ 优先级裁决', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // AI 决策确定性（< level 0.9 → 选最优/碰）
  });

  function setup(id: string, T0: number, withPeng: boolean) {
    let room: RoomState | null = null;
    const mem = {
      async load() { return room; },
      async save(r: RoomState) { room = r; },
    };
    const mgr = new RoomManager(mem as never);
    room = mkRoom(id, T0, buildState(withPeng));
    return { mgr, room };
  }

  it('节奏：出牌后 500ms 小美不秒碰（碰与吃同节奏）；到点自然表态且气泡事前可见', async () => {
    const T0 = 1_000_000;
    const { mgr, room } = setup('1000', T0, true);

    vi.setSystemTime(T0 + 500);
    const v1 = await mgr.poll('1000', 't0');
    const s1 = room.state!;
    expect(s1.phase.t).toBe('awaitResponse');
    expect(s1.responses[1]).toBeNull();                          // 不秒碰（与吃同节奏，2026-09-23 终版）
    expect(v1.pendingResponses?.[1] ?? null).toBeNull();         // 还没喊，无气泡

    vi.setSystemTime(T0 + 2500);                                  // 节流期（2.2s）过后
    const v2 = await mgr.poll('1000', 't0');
    expect(room.state!.responses[1]?.type).toBe('peng');         // 小美按固定时刻表自主碰
    expect(v2.pendingResponses?.[1]).toBe('peng');               // 气泡事前可见
  });

  it('解耦：真人极速点吃不改变 bot 时刻表——bot 到点直接碰走（不触发清算、不续期节流）', async () => {
    const T0 = 3_000_000;
    const { mgr, room } = setup('3000', T0, true);

    // 真人在节流期内（出牌后 300ms）极速点吃——bot 的时刻表不受影响
    vi.setSystemTime(T0 + 300);
    const chi = legalActions(room.state!, 0).find((a) => a.type === 'chi')!;
    expect(chi).toBeTruthy();
    await mgr.submitAction('3000', 't0', chi);
    expect(room.state!.phase.t).toBe('awaitResponse');           // 不触发清算：窗口仍开
    expect(room.state!.responses[1]).toBeNull();                 // 小美未表态（时刻表未到）
    expect(room.botTickAt).toBe(T0);                             // 真人的吃不重置节流（时刻表原样）

    // 到点（出牌后 2.5s）poll：小美碰表态 → 齐了 → 裁决碰 > 吃
    vi.setSystemTime(T0 + 2500);
    await mgr.poll('1000', 't0');
    const s2 = room.state!;
    expect(s2.phase.t).toBe('awaitDiscard');
    expect(s2.current).toBe(1);                                  // 碰 > 吃（D2 优先级裁决）
    expect(s2.players[1]!.melds.length).toBe(1);                 // 小美碰成副露
    expect(s2.players[0]!.melds.length).toBe(0);                 // 真人的吃被顶掉
  });

  it('吃生效：无碰/杠/胡竞争时，吃立即生效（只能过的家由引擎自动表态，不占窗口）', async () => {
    const T0 = 2_000_000;
    const { mgr, room } = setup('2000', T0, false);              // 无碰局面：真人吃是唯一响应选项

    vi.setSystemTime(T0 + 300);
    const chi = legalActions(room.state!, 0).find((a) => a.type === 'chi')!;
    expect(chi).toBeTruthy();
    await mgr.submitAction('2000', 't0', chi);
    const s2 = room.state!;
    // 引擎对"只能 pass"的家自动表态（eligible=false + responses=pass），真人吃是唯一待决响应 → 提交即裁决生效
    expect(s2.phase.t).toBe('awaitDiscard');
    expect(s2.current).toBe(0);                                  // 真人进入出牌阶段
    expect(s2.players[0]!.melds.length).toBe(1);                 // 吃成副露
  });
});
