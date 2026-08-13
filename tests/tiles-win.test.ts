/**
 * 验收测试 · 牌墙与胡牌判定
 * 覆盖：144 张唯一性、16 张玩法的胡牌判定、含金（百搭）组合、开金、补花。
 */
import { describe, it, expect } from 'vitest';
import {
  buildWall, kindOf, isFlower, isSuit,
  canWinConcealed, findDanyouDiscards, canFormFiveSets,
  createRound,
} from '../src/engine/index.js';
import { K } from './helpers.js';

const G = K.zhong; // 测试中固定以「中」为金（kind 31）

describe('牌墙', () => {
  it('144 张牌全局唯一', () => {
    const wall = buildWall();
    expect(wall.length).toBe(144);
    expect(new Set(wall).size).toBe(144);
  });

  it('非花牌每种 4 张，花牌 8 种各 1 张', () => {
    const wall = buildWall();
    const count = new Map<number, number>();
    for (const id of wall) {
      const k = kindOf(id);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    for (let k = 0; k < 34; k++) expect(count.get(k)).toBe(4);
    for (let k = 34; k < 42; k++) expect(count.get(k)).toBe(1);
    expect(count.size).toBe(42);
  });
});

describe('胡牌判定（16 张玩法：5 组面子 + 1 对将）', () => {
  it('五刻子加一对将可胡', () => {
    const hand = [0, 0, 0, 3, 3, 3, 9, 9, 9, 18, 18, 18, 27, 27, 27, 31, 31];
    expect(canWinConcealed(hand, -1, 5)).toBe(true);
  });

  it('五顺子加一对将可胡', () => {
    const hand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 18, 19, 20, 28, 28];
    expect(canWinConcealed(hand, -1, 5)).toBe(true);
  });

  it('带副露时按剩余组数判定（setsNeeded < 5）', () => {
    // 已有 2 组副露，暗手 11 张 = 3 组 + 1 对
    const hand = [0, 1, 2, 3, 3, 3, 18, 19, 20, 31, 31];
    expect(canWinConcealed(hand, -1, 3)).toBe(true);
    expect(canWinConcealed(hand, -1, 5)).toBe(false); // 张数不符
  });

  it('缺将不可胡', () => {
    const hand = [0, 0, 0, 3, 3, 3, 9, 9, 9, 18, 18, 18, 27, 27, 27, 31, 32];
    expect(canWinConcealed(hand, -1, 5)).toBe(false);
  });

  it('字牌不能组成顺子', () => {
    // 东南西 + 4 组 + 1 对：东南西不构成面子
    const hand = [0, 0, 0, 3, 3, 3, 9, 9, 9, 18, 18, 18, 27, 28, 29, 31, 31];
    expect(canWinConcealed(hand, -1, 5)).toBe(false);
  });
});

describe('含金（百搭）胡牌', () => {
  it('金可补顺子缺口', () => {
    // 4 组 + [一万,二万,金] + 一对
    const hand = [3, 3, 3, 9, 9, 9, 18, 18, 18, 12, 13, 14, 0, 1, G, 28, 28];
    expect(canWinConcealed(hand, G, 5)).toBe(true);
  });

  it('金可补刻子缺口', () => {
    const hand = [3, 3, 3, 9, 9, 9, 18, 18, 18, 12, 13, 14, 5, 5, G, 28, 28];
    expect(canWinConcealed(hand, G, 5)).toBe(true);
  });

  it('金与普通牌作将可胡（单游牌型本身也是胡牌）', () => {
    const hand = [0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, 27, 27, 27, G, 5];
    expect(canWinConcealed(hand, G, 5)).toBe(true);
  });

  it('两张金作自然将可胡', () => {
    const hand = [0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, 27, 27, 27, G, G];
    expect(canWinConcealed(hand, G, 5)).toBe(true);
  });

  it('三张金作一刻可胡', () => {
    const hand = [0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, G, G, G, 28, 28];
    expect(canWinConcealed(hand, G, 5)).toBe(true);
  });

  it('金必须被恰好用完：剩一张无法安排的金则不可胡', () => {
    // 4 组 + 一对(28,28) + 金 + 发 + 白：金+发+白不成面子，金配发/白作将则 28 成废牌
    const hand = [0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, 28, 28, G, 32, 33];
    expect(canWinConcealed(hand, G, 5)).toBe(false);
  });

  it('无金时按纯自然牌判定（goldKind = -1）', () => {
    const hand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 18, 19, 20, 28, 28];
    expect(canWinConcealed(hand, -1, 5)).toBe(true);
  });
});

describe('单游牌型判定', () => {
  it('5 组面子 + 1 金 + 1 普通牌 → 返回可宣告打出的那张普通牌', () => {
    const hand = [0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, 27, 27, 27, G, 5];
    expect(findDanyouDiscards(hand, G)).toEqual([5]);
  });

  it('非 17 张或无金时不可宣告', () => {
    const hand16 = [0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, 27, 27, 27, 5];
    expect(findDanyouDiscards(hand16, G)).toEqual([]);
    const handNoGold = [0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, 27, 27, 27, 5, 5];
    expect(findDanyouDiscards(handNoGold, G)).toEqual([]);
  });

  it('canFormFiveSets：15 张恰好 5 组（其余金可参与）', () => {
    expect(canFormFiveSets([0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, 27, 27, 27], G)).toBe(true);
    expect(canFormFiveSets([0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, 27, 27, 28], G)).toBe(false);
  });
});

describe('开局：发牌 / 补花 / 开金', () => {
  it('多种子下：庄家 17 张、闲家 16 张，暗手无花，总量守恒', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const dealer = seed % 4;
      const s = createRound(seed * 7919, dealer, { rounds: 4, liujuFloor: 16 });
      for (const p of s.players) {
        expect(p.hand.length).toBe(p.seat === dealer ? 17 : 16);
        expect(p.hand.every((t) => !isFlower(kindOf(t)))).toBe(true);
      }
      const flowers = s.players.reduce((n, p) => n + p.flowers.length, 0);
      const hands = s.players.reduce((n, p) => n + p.hand.length, 0);
      expect(hands).toBe(65);
      // 守恒：手牌 + 牌墙 + 已亮花 + 翻出的金牌指示物 = 144
      expect(hands + s.wall.length + flowers + 1).toBe(144);
      expect(flowers).toBeLessThanOrEqual(8);
    }
  });

  it('开金：金牌为非花牌，指示物已移出牌墙不可被摸到（D1）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createRound(seed * 31337, 0, { rounds: 4, liujuFloor: 16 });
      expect(s.goldKind).toBeGreaterThanOrEqual(0);
      expect(s.goldKind).toBeLessThan(34);
      // 指示物：非花、kind 与 goldKind 一致、不在牌墙与任何手牌中
      expect(isFlower(kindOf(s.goldIndicator))).toBe(false);
      expect(kindOf(s.goldIndicator)).toBe(s.goldKind);
      expect(s.wall).not.toContain(s.goldIndicator);
      for (const p of s.players) expect(p.hand).not.toContain(s.goldIndicator);
      // 同种金牌在牌墙/手牌中只剩 3 张（第 4 张为指示物）
      let goldCount = 0;
      for (const id of s.wall) if (kindOf(id) === s.goldKind) goldCount++;
      for (const p of s.players) for (const id of p.hand) if (kindOf(id) === s.goldKind) goldCount++;
      expect(goldCount).toBe(3);
    }
  });

  it('序数牌/字牌/花牌分类正确', () => {
    expect(isSuit(0)).toBe(true);
    expect(isSuit(26)).toBe(true);
    expect(isSuit(27)).toBe(false);
    expect(isFlower(34)).toBe(true);
    expect(isFlower(41)).toBe(true);
    expect(isFlower(33)).toBe(false);
  });
});
