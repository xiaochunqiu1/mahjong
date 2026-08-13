import { describe, it, expect } from 'vitest';
import { sortHandForDisplay } from '../src/game/sortHand.js';

const K = (k: number, copy = 0) => k * 4 + copy;

describe('手牌展示排序', () => {
  it('万条筒按花色分组、组内按点数升序', () => {
    // 混合乱序：七筒(24)、三萬(2)、一条(9)、五筒(22)、九萬(8)、二条(10)
    const hand = [K(24), K(2), K(9), K(22), K(8), K(10)];
    const kinds = sortHandForDisplay(hand, 31).map((t) => Math.floor(t / 4));
    expect(kinds).toEqual([2, 8, 9, 10, 22, 24]); // 三萬→九萬，一条→二条，五筒→七筒
  });

  it('金（百搭）固定排最前', () => {
    const hand = [K(31), K(3), K(20)]; // 中(金)、四萬、三筒
    const kinds = sortHandForDisplay(hand, 31).map((t) => Math.floor(t / 4));
    expect(kinds).toEqual([31, 3, 20]);
  });

  it('风与箭排在各花色之后，箭组内 中发白 顺序', () => {
    const hand = [K(33), K(27), K(31), K(0)]; // 白、东、中、一万
    const kinds = sortHandForDisplay(hand, -1).map((t) => Math.floor(t / 4));
    expect(kinds).toEqual([0, 27, 31, 33]);
  });

  it('同种多张相邻', () => {
    const hand = [K(5, 1), K(5, 0), K(6)]; // 六萬×2、七萬
    const kinds = sortHandForDisplay(hand, 31).map((t) => Math.floor(t / 4));
    expect(kinds).toEqual([5, 5, 6]);
  });
});
