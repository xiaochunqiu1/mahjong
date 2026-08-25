import { describe, it, expect } from 'vitest';
import { applyAction, legalActions, kindOf, has } from '../src/engine/index.js';
import { mkState } from './helpers.js';

const discardOf = (s: any, seat: number, kind: number) => ({
  type: 'discard',
  tile: s.players[seat]!.hand.find((t: number) => kindOf(t) === kind),
});

// 用户 8-25 反馈:吃碰杠之后,牌河里的牌应消失(副露正常但牌河残留)
describe('吃碰杠后牌河移除', () => {
  it('碰:seat0 打三筒(20),seat1 碰 → seat0 牌河移除三筒', () => {
    const s = mkState({
      hands: [
        [20, 3, 4, 5, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32, 33, 21, 22],
        [20, 20, 'fill'],
        'junk', 'junk',
      ],
      junkAvoid: [20, 21, 22],
      wallTail: [14],
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, discardOf(s, 0, 20));
    expect(s.phase.t).toBe('awaitResponse');
    applyAction(s, 1, { type: 'peng' });
    // seat0 牌河不再含 20(被碰走)
    expect(s.players[0]!.discards.filter((k) => k === 20)).toHaveLength(0);
    // seat1 副露含 碰 三筒
    expect(s.players[1]!.melds[0]!.type).toBe('peng');
    expect(s.players[1]!.melds[0]!.kind).toBe(20);
  });

  it('吃:seat1 打五筒(23),seat2 吃 345筒 → seat1 牌河移除五筒', () => {
    const s = mkState({
      hands: [
        'junk',
        [23, 3, 4, 5, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32, 33, 21, 22],
        [21, 22, 'fill'], // 3筒4筒,配 5筒(23)吃 345
        'junk',
      ],
      junkAvoid: [23, 21, 22, 24],
      current: 1,
      wallTail: [14],
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 1, discardOf(s, 1, 23));
    expect(s.phase.t).toBe('awaitResponse');
    applyAction(s, 2, { type: 'chi', useKinds: [21, 22] });
    expect(s.players[1]!.discards.filter((k) => k === 23)).toHaveLength(0);
    expect(s.players[2]!.melds[0]!.type).toBe('chi');
  });
});
