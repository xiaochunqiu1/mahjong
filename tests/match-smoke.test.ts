/**
 * 验收测试 · 整场推进与随机对局冒烟
 * 覆盖：4/8 局推进、坐庄/连庄规则、流局计入局数、
 *       固定种子随机对局收敛（不崩、零和、手牌不变量）。
 */
import { describe, it, expect } from 'vitest';
import {
  createMatch, advanceMatch, createRound, applyAction, legalActions,
  mulberry32, kindOf, isFlower,
  type GameState, type RoundResult,
} from '../src/engine/index.js';

describe('整场（4/8 局）', () => {
  const mkResult = (winner: number, liuju = false): RoundResult => ({
    winner,
    liuju,
    score: {
      winType: liuju ? 'liuju' : 'zimo',
      winner: liuju ? -1 : winner,
      delta: liuju ? [0, 0, 0, 0] : (winner === 0 ? [6, -2, -2, -2] : [-2, 6, -2, -2]),
    } as RoundResult['score'],
  });

  it('赢家坐庄；庄家胡或流局则连庄', () => {
    const m = createMatch(42, 4);
    m.dealer = 0;
    advanceMatch(m, mkResult(2)); // seat2 胡 → seat2 坐庄
    expect(m.dealer).toBe(2);
    advanceMatch(m, mkResult(2)); // 庄家胡 → 连庄
    expect(m.dealer).toBe(2);
    advanceMatch(m, mkResult(-1, true)); // 流局 → 连庄
    expect(m.dealer).toBe(2);
  });

  it('流局计入局数，4 局后整场结束，积分累计', () => {
    const m = createMatch(42, 4);
    m.dealer = 0;
    advanceMatch(m, mkResult(-1, true));
    expect(m.over).toBe(false);
    expect(m.history).toHaveLength(1);
    advanceMatch(m, mkResult(0));
    advanceMatch(m, mkResult(1));
    expect(m.over).toBe(false);
    advanceMatch(m, mkResult(0));
    expect(m.over).toBe(true);
    expect(m.history).toHaveLength(4);
    // seat0 两次自摸 +12，seat1 一次 +6，零和
    expect(m.scores[0]).toBe(12 + -2);
    expect(m.scores[1]).toBe(6 + -2 + -2);
    expect(m.scores.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('随机对局冒烟（固定种子，随机合法动作）', () => {
  function playRound(seed: number): GameState {
    const rand = mulberry32(seed);
    const s = createRound(seed, seed % 4, { rounds: 4, liujuFloor: 16 });
    let steps = 0;
    while (s.phase.t !== 'over' && steps < 2000) {
      steps++;
      if (s.phase.t === 'awaitResponse') {
        // 所有有资格者随机响应（80% 过）
        for (let seat = 0; seat < 4; seat++) {
          const acts = legalActions(s, seat);
          if (acts.length === 0) continue;
          const pick = rand() < 0.8 ? acts[0]! : acts[Math.floor(rand() * acts.length)]!;
          applyAction(s, seat, pick);
          if (s.phase.t !== 'awaitResponse') break;
        }
        continue;
      }
      const seat = s.current;
      const acts = legalActions(s, seat);
      expect(acts.length).toBeGreaterThan(0);
      // 优先普通动作，偶尔用胡/杠，保证对局能推进也能覆盖分支
      const discards = acts.filter((a) => a.type === 'discard' && !a.declare);
      const others = acts.filter((a) => a.type !== 'discard');
      let pick;
      if (s.phase.t === 'awaitDiscard' && discards.length > 0 && rand() < 0.9) {
        pick = discards[Math.floor(rand() * discards.length)]!;
      } else if (others.length > 0) {
        pick = others[Math.floor(rand() * others.length)]!;
      } else {
        pick = acts[Math.floor(rand() * acts.length)]!;
      }
      applyAction(s, seat, pick);
    }
    expect(steps).toBeLessThan(2000);
    return s;
  }

  it('20 个种子全部收敛：不崩、墙不少于 16、零和、暗手无花、手牌数不变量', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = playRound(seed * 12345);
      expect(s.phase.t).toBe('over');
      expect(s.wall.length).toBeGreaterThanOrEqual(16);
      const result = (s.phase as { t: 'over'; result: RoundResult }).result;
      expect(result.score.delta.reduce((a, b) => a + b, 0)).toBe(0);
      for (const p of s.players) {
        expect(p.hand.every((t) => !isFlower(kindOf(t)))).toBe(true);
        // 暗手 + 副露*3 ∈ {16, 17}（胡牌者 17，其余 16；杠按 3 计）
        const total = p.hand.length + p.melds.length * 3;
        expect([16, 17]).toContain(total);
        // 花牌守恒：亮出的花 + 墙里的花 + 8 张 = 8
      }
      const flowersOut = s.players.reduce((n, p) => n + p.flowers.length, 0);
      const flowersInWall = s.wall.filter((t) => isFlower(kindOf(t))).length;
      expect(flowersOut + flowersInWall).toBe(8);
    }
  });
});
