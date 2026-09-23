/**
 * 托管代打行为回归测试（2026-09-23 用户反馈）：
 * 1. 托管不碰不吃不杠不胡——响应一律过（之前用 botDecide 0.9 强度代打，会碰会胡）
 * 2. 出牌"进什么牌打什么牌"：刚摸的直接打出；无刚摸牌（接手/超时）则随机普通牌（之前打"手牌第一张废牌"）
 * 3. 响应窗口超时托管后 trusted=true 保持——前端取消按钮的显示依据
 * 4. 取消托管清除代打摸牌记录
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomManager, type RoomState, type SeatPlayer } from '../server/room.js';
import { createMatch, applyAction, legalActions } from '../src/engine/index.js';
import { mkState, K } from './helpers.js';

function buildState() {
  const wan2 = K.wan(2), wan3 = K.wan(3), wan4 = K.wan(4);
  const state = mkState({
    hands: [[wan2, wan3, 'fill'], [wan4, wan4, 'fill'], 'junk', [wan4, 'fill']],
    junkAvoid: [K.wan(1), K.wan(2), K.wan(3), K.wan(4), K.wan(5), K.wan(6)],
    phase: { t: 'awaitDiscard' },
    current: 3,
    goldKind: K.zhong,
  });
  const tile = state.players[3]!.hand.find((id) => Math.floor(id / 4) === wan4)!;
  applyAction(state, 3, { type: 'discard', tile });
  if (state.phase.t !== 'awaitResponse') throw new Error('构造失败');
  return state;
}

function mkSeat(seat: number, isBot: boolean): SeatPlayer {
  return { seat, name: `p${seat}`, token: isBot ? `b${seat}` : 't0', online: true, ready: true, isBot };
}

type TrustAct = (room: RoomState, state: import('../src/engine/index.js').GameState, seat: number) => import('../src/engine/index.js').GameAction;
type TickBots = (room: RoomState) => Promise<void>;

describe('托管代打行为（2026-09-23：不碰吃杠胡 + 进什么打什么/随机）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
  });

  function setup(state: ReturnType<typeof buildState>, trusted0 = true) {
    let room: RoomState | null = null;
    const mem = {
      async load() { return room; },
      async save(r: RoomState) { room = r; },
    };
    const mgr = new RoomManager(mem as never);
    const T0 = 1_000_000;
    room = {
      id: '1000', createdAt: T0, phase: 'playing', rounds: 9999,
      players: [mkSeat(0, false), mkSeat(1, true), mkSeat(2, true), mkSeat(3, true)],
      hostToken: 't0', version: 1, lastEvent: '',
      match: createMatch(1, 9999), state, roundNo: 1,
      botTickAt: T0 - 5000, turnStartedAt: T0 - 5000, botSeatLast: 0, // 节流早已过期
      waitingNext: false, nextReady: [],
      trusted: [trusted0, false, false, false],
      huTally: { human: 0, bot: 0 },
    };
    const mgrAny = mgr as unknown as { trustAct: TrustAct; tickBots: TickBots };
    return { mgr, room, trustAct: mgrAny.trustAct.bind(mgr), tickBots: mgrAny.tickBots.bind(mgr) };
  }

  it('响应窗口托管代打：一律过，不碰不吃（即使手里有可吃的牌）', async () => {
    const { mgr, room, tickBots } = setup(buildState(), true); // 真人 seat0 可吃 4万
    await tickBots(room!);
    const s = room.state!;
    expect(s.responses[0]?.type).toBe('pass');                  // 托管代打 = 过（修复前是 chi/peng）
    expect(s.responses[0]?.type).not.toBe('chi');
    expect(s.phase.t).toBe('awaitResponse');                    // 小美按自己节奏稍后表态（窗口仍开，正常）
  });

  it('trustAct：响应窗口一律返回 pass', () => {
    const { room, trustAct } = setup(buildState(), false);
    const act = trustAct(room!, room.state!, 0);
    expect(act.type).toBe('pass');
  });

  it('trustAct 出牌：刚摸的牌（lastDrawnT 在手）直接打出——进什么打什么', () => {
    const { room, trustAct } = setup(buildState(), false);
    const st = room.state!;
    st.phase = { t: 'awaitDiscard' };
    st.current = 0;
    const myTile = st.players[0]!.hand[st.players[0]!.hand.length - 1]!; // 手里某张牌
    room.lastDrawnT = { 0: myTile };
    const act = trustAct(room!, st, 0);
    expect(act.type).toBe('discard');
    expect((act as { tile: number }).tile).toBe(myTile);        // 进什么打什么
  });

  it('trustAct 出牌：无刚摸牌（lastDrawnT 不在手）→ 随机普通牌（不出游金宣告）', () => {
    const { room, trustAct } = setup(buildState(), false);
    const st = room.state!;
    st.phase = { t: 'awaitDiscard' };
    st.current = 0;
    room.lastDrawnT = { 0: 999999 };                            // 不在手里的假记录
    const act = trustAct(room!, st, 0);
    expect(act.type).toBe('discard');                           // 随机也是出牌（不会碰吃杠胡/宣告）
    expect((act as { declare?: string }).declare).toBeUndefined();
    expect(st.players[0]!.hand.includes((act as { tile: number }).tile)).toBe(true);
  });

  it('响应窗口超时托管后 trusted=true 保持（前端取消按钮的显示依据）', async () => {
    const { mgr, room } = setup(buildState(), false);
    vi.setSystemTime(1_000_000 + 9_000);                        // 超过 RESPONSE_MS 8s
    const v = await mgr.poll('1000', 't0');
    expect(v.trusted?.[0]).toBe(true);                          // 服务端托管标记生效
  });

  it('取消托管清除代打摸牌记录', async () => {
    const { mgr, room } = setup(buildState(), true);
    room!.lastDrawnT = { 0: 123 };
    await mgr.untrust('1000', 't0');
    expect(room!.lastDrawnT?.[0]).toBeUndefined();
    expect(room!.trusted[0]).toBe(false);
  });
});
