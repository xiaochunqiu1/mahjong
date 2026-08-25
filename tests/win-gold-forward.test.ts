import { describe, it, expect } from 'vitest';
import { canWinConcealed } from '../src/engine/win.js';
import { legalActions } from '../src/engine/engine.js';
import { mkState } from './helpers.js';

// 用户 8-25 反馈"胡了但没胡按钮"——根因:canFormSets 顺子只支持向后补金(k+1/k+2),
// "8筒9筒+金=7筒"这类向前补金永远判不了 → 自摸胡按钮不出现。已修(分支二补)。
describe('顺子金补(向前补,2026-08-25 修复)', () => {
  it('user 场景:3条(金) 3万4万5万 4条5条6条 6筒6筒 8筒9筒 → 能胡', () => {
    const hand = [11, 2, 3, 4, 12, 13, 14, 23, 23, 25, 26]; // 金=3条(11)
    expect(canWinConcealed(hand, 11, 3)).toBe(true);
    const s = mkState({
      hands: [hand, 'junk', 'junk', 'junk'],
      goldKind: 11,
      melds: [[
        { type: 'peng', kind: 27, tiles: [27, 27, 27], fromSeat: 1 },
        { type: 'peng', kind: 28, tiles: [28, 28, 28], fromSeat: 2 },
      ], [], [], []],
      current: 0,
      phase: { t: 'awaitDiscard' },
    });
    const acts = legalActions(s, 0);
    expect(acts.some((a) => a.type === 'hu')).toBe(true);
  });
  it('普通向后补金仍然正常(回归)', () => {
    // 4万5万 + 金补3万或6万
    expect(canWinConcealed([11, 2, 3, 4, 12, 13, 14, 23, 23, 25, 26], 11, 3)).toBe(true);
  });
  it('不成立的手牌仍判不胡(回归)', () => {
    // 散牌 + 字牌不成立
    expect(canWinConcealed([27, 28, 29, 30, 0, 4, 8, 12, 13, 18, 19], 27, 3)).toBe(false);
  });
});
