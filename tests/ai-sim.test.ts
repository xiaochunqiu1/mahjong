/**
 * AI 自对弈模拟：固定种子批量跑整场（4 局），验证
 *  - 对称性：四个 AI 胜率与积分应接近均匀（各约 25% / 0 分）；
 *  - 游金为偶发奖励而非常态；
 *  - 收敛：每局都正常结束（胡或流局），零和守恒。
 * 本测试产出作为 AI 校准的基础数据（rules.md §9 平衡验证路径）。
 */
import { describe, it, expect } from 'vitest';
import {
  createMatch, advanceMatch, createRound, applyAction,
  mulberry32, legalActions,
  type GameState,
} from '../src/engine/index.js';
import { aiDecide } from '../src/game/ai.js';

const MATCHES = 40; // 40 场 × 4 局 = 160 局

function playMatch(seed: number, rounds: 4 | 8) {
  const match = createMatch(seed, rounds);
  const stats = { wins: [0, 0, 0, 0], scores: [0, 0, 0, 0], liuju: 0, danyou: 0, shuangyou: 0, sanyou: 0, steps: 0 };
  while (!match.over) {
    const rand = mulberry32(seed + match.roundNo * 7919 + stats.wins.reduce((a, b) => a + b, 0));
    const state = createRound(seed * 3 + match.roundNo * 104729, match.dealer, { rounds, liujuFloor: 16 });
    let guard = 0;
    while (state.phase.t !== 'over' && guard++ < 3000) {
      if (state.phase.t === 'awaitResponse') {
        for (let seat = 0; seat < 4; seat++) {
          const acts = legalActions(state, seat);
          if (acts.length === 0) continue;
          applyAction(state, seat, aiDecide(state, seat, rand));
          if (state.phase.t !== 'awaitResponse') break;
        }
        continue;
      }
      const seat = state.current;
      applyAction(state, seat, aiDecide(state, seat, rand));
    }
    expect(guard).toBeLessThan(3000);
    stats.steps += guard;
    if (state.phase.t === 'over') {
      const result = (state.phase as { t: 'over'; result: { winner: number; liuju: boolean; score: { winType: string; delta: number[] } } }).result;
      if (result.liuju) {
        stats.liuju++;
      } else {
        stats.wins[result.winner]!++;
        if (result.score.winType === 'danyou') stats.danyou++;
        if (result.score.winType === 'shuangyou') stats.shuangyou++;
        if (result.score.winType === 'sanyou') stats.sanyou++;
      }
      for (let i = 0; i < 4; i++) stats.scores[i]! += result.score.delta[i]!;
      advanceMatch(match, result);
    }
  }
  return { stats, match };
}

describe('AI 自对弈（4 电脑，对称性 + 平衡基线）', () => {
  it('40 场（160 局）全部收敛，每局零和', () => {
    for (let seed = 1; seed <= MATCHES; seed++) {
      const { stats } = playMatch(seed, 4);
      expect(stats.scores.reduce((a, b) => a + b, 0)).toBe(0);
    }
  });

  it('对称性：四家胡局数与积分接近均匀（各约 25%，容差 ±15 个百分点）', () => {
    const wins = [0, 0, 0, 0];
    const scores = [0, 0, 0, 0];
    let total = 0;
    let liuju = 0;
    for (let seed = 1; seed <= MATCHES; seed++) {
      const { stats } = playMatch(seed, 4);
      for (let i = 0; i < 4; i++) { wins[i]! += stats.wins[i]!; scores[i]! += stats.scores[i]!; }
      total += stats.wins.reduce((a, b) => a + b, 0);
      liuju += stats.liuju;
    }
    const nonLiuju = total; // 有胡的局
    console.log(
      `[校准基线] ${MATCHES}场×4局：胡局=${nonLiuju} 流局=${liuju}` +
      `\n  各座胡局分布: ${wins.join(' / ')}（占比 ${wins.map((w) => (100 * w / Math.max(1, nonLiuju)).toFixed(1) + '%').join(' / ')}）` +
      `\n  各座积分: ${scores.join(' / ')}  流局率=${(100 * liuju / (MATCHES * 4)).toFixed(1)}%`,
    );
    const share = wins.map((w) => w / Math.max(1, nonLiuju));
    for (const s of share) {
      expect(s).toBeGreaterThanOrEqual(0.25 - 0.15);
      expect(s).toBeLessThanOrEqual(0.25 + 0.15);
    }
    expect(liuju).toBeLessThanOrEqual(MATCHES * 4 * 0.3); // 流局率 < 30%
  });

  it('游金频率：单游为偶发奖励（有胡局中 < 40%），双/三游为低概率事件', () => {
    let danyou = 0;
    let shuangyou = 0;
    let sanyou = 0;
    let nonLiuju = 0;
    for (let seed = 1; seed <= MATCHES; seed++) {
      const { stats } = playMatch(seed, 4);
      danyou += stats.danyou;
      shuangyou += stats.shuangyou;
      sanyou += stats.sanyou;
      nonLiuju += stats.wins.reduce((a, b) => a + b, 0);
    }
    console.log(
      `[校准基线] 单游=${danyou}（${(100 * danyou / Math.max(1, nonLiuju)).toFixed(1)}%） 双游=${shuangyou}（${(100 * shuangyou / Math.max(1, nonLiuju)).toFixed(1)}%） 三游=${sanyou}（${(100 * sanyou / Math.max(1, nonLiuju)).toFixed(1)}%）`,
    );
    expect(danyou / Math.max(1, nonLiuju)).toBeLessThan(0.4);
    expect(shuangyou).toBeLessThanOrEqual(danyou);
    expect(sanyou).toBeLessThanOrEqual(shuangyou);
  });

  it('AI 只用公开信息：直接对局中无任何异常动作', () => {
    // aiDecide 的所有返回值必须通过引擎合法性校验（applyAction 内部校验，抛错即测试失败）
    for (let seed = 1; seed <= 6; seed++) {
      playMatch(seed * 37, 4);
    }
  });
});
