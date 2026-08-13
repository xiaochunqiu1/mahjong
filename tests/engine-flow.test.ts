/**
 * 验收测试 · 回合流程
 * 覆盖：三种杠、响应优先级（胡>杠/碰>吃、仅下家吃、一炮最近者）、
 *       金牌无响应、流局、单/双/三游完整状态转换、固定积分。
 */
import { describe, it, expect } from 'vitest';
import {
  applyAction, legalActions, kindOf,
  type GameAction, type GameState,
} from '../src/engine/index.js';
import { mkState, K } from './helpers.js';

const G = K.zhong; // 金 = 中（31），mkState 默认

/** 听五万的两手牌（kind 全局不冲突） */
const LISTEN_A = [0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, 27, 27, 4, 6];
const LISTEN_B = [12, 12, 12, 21, 21, 21, 14, 15, 16, 23, 24, 25, 28, 28, 4, 6];
/** 单游牌型：5 组面子 + 金 + 五万（17 张） */
const DANYOU_17 = [0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, 27, 27, 27, G, 5];
/** 单游宣告后的手牌：5 组面子 + 金（16 张） */
const DANYOU_16 = [0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, 27, 27, 27, G];

function has(acts: GameAction[], pred: (a: GameAction) => boolean): boolean {
  return acts.some(pred);
}
const discardOf = (s: GameState, seat: number, kind: number): GameAction => ({
  type: 'discard',
  tile: s.players[seat]!.hand.find((t) => kindOf(t) === kind)!,
});
const over = (s: GameState) => (s.phase as { t: 'over'; result: import('../src/engine/index.js').RoundResult }).result;

// ---------------------------------------------------------------- 杠

describe('三种杠', () => {
  it('暗杠：4 张同牌可杠，杠后从牌尾补一张，仍由自己出牌', () => {
    const s = mkState({
      hands: [
        [0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32],
        'junk', 'junk', 'junk',
      ],
      wallTail: [12],
      phase: { t: 'awaitDiscard' },
    });
    expect(has(legalActions(s, 0), (a) => a.type === 'anGang' && a.kind === 0)).toBe(true);

    applyAction(s, 0, { type: 'anGang', kind: 0 });
    const p = s.players[0]!;
    expect(p.melds[0]!.type).toBe('anGang');
    expect(p.hand.filter((t) => kindOf(t) === 0)).toHaveLength(0);
    expect(p.hand).toHaveLength(14); // 17 - 4 + 1（补四条）
    expect(kindOf(p.hand[p.hand.length - 1]!)).toBe(12);
    expect(s.phase.t).toBe('awaitDiscard');
    expect(s.current).toBe(0);
  });

  it('加杠：已有碰 + 手牌第 4 张可杠，碰升级为加杠', () => {
    const s = mkState({
      hands: [
        [5, 3, 4, 6, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32, 33, 21, 22],
        'junk', 'junk', 'junk',
      ],
      melds: [[{ type: 'peng', kind: 5, tiles: [5, 5, 5], fromSeat: 1 }], [], [], []],
      wallTail: [13],
      phase: { t: 'awaitDiscard' },
    });
    expect(has(legalActions(s, 0), (a) => a.type === 'jiaGang' && a.kind === 5)).toBe(true);
    applyAction(s, 0, { type: 'jiaGang', kind: 5 });
    const m = s.players[0]!.melds[0]!;
    expect(m.type).toBe('jiaGang');
    expect(m.tiles).toHaveLength(4);
    expect(s.players[0]!.hand).toHaveLength(17); // 17 - 1加杠 + 1补
  });

  it('明杠：手牌 3 张可杠他人出牌，杠后补牌并轮到自己出牌', () => {
    const s = mkState({
      hands: [
        [7, 3, 4, 5, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32, 33, 21, 22],
        [7, 7, 7, 'fill'],
        'junk', 'junk',
      ],
      junkAvoid: [5, 6, 7, 8, 9],
      wallTail: [14],
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, discardOf(s, 0, 7));
    expect(s.phase.t).toBe('awaitResponse');
    expect(s.eligible[1]).toBe(true);
    expect(has(legalActions(s, 1), (a) => a.type === 'gang')).toBe(true);

    applyAction(s, 1, { type: 'gang' });
    const p = s.players[1]!;
    expect(p.melds[0]!.type).toBe('mingGang');
    expect(p.melds[0]!.fromSeat).toBe(0);
    expect(s.current).toBe(1);
    expect(s.phase.t).toBe('awaitDiscard');
    expect(p.hand).toHaveLength(14); // 16 - 3 + 1
  });

  it('金不能杠：4 张金不产生暗杠选项', () => {
    const s = mkState({
      hands: [
        [G, G, G, G, 3, 4, 5, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32],
        'junk', 'junk', 'junk',
      ],
      phase: { t: 'awaitDiscard' },
    });
    expect(has(legalActions(s, 0), (a) => a.type === 'anGang' || a.type === 'jiaGang')).toBe(false);
  });
});

// ---------------------------------------------------------------- 响应优先级

describe('响应优先级', () => {
  it('胡 > 碰：碰家与胡家同时响应，胡家胜', () => {
    const s = mkState({
      hands: [
        [5, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32, 33, 21, 22],
        [5, 5, 'fill'],
        LISTEN_A,
        'junk',
      ],
      junkAvoid: [3, 4, 5, 6, 7],
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, discardOf(s, 0, 5));
    expect(s.phase.t).toBe('awaitResponse');
    expect(s.eligible[1]).toBe(true);
    expect(s.eligible[2]).toBe(true);

    applyAction(s, 1, { type: 'peng' });
    expect(s.phase.t).toBe('awaitResponse'); // 未收齐不裁决
    applyAction(s, 2, { type: 'hu' });
    expect(s.phase.t).toBe('over');
    expect(over(s).score.winType).toBe('ron');
    expect(over(s).score.delta).toEqual([-3, 0, 3, 0]);
  });

  it('一炮只最近者胡：两家可胡，距出牌者近的一家胜', () => {
    const s = mkState({
      hands: [
        [5, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32, 33, 21, 22],
        LISTEN_A, // 下家，距离 1
        LISTEN_B, // 距离 2
        'junk',
      ],
      junkAvoid: [3, 4, 5, 6, 7],
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, discardOf(s, 0, 5));
    applyAction(s, 2, { type: 'hu' });
    applyAction(s, 1, { type: 'hu' });
    expect(s.phase.t).toBe('over');
    expect(over(s).winner).toBe(1);
  });

  it('仅下家可吃：非下家有搭子也无资格', () => {
    const s = mkState({
      hands: [
        [5, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32, 33, 21, 22],
        [4, 6, 'fill'], // 下家，有 4/6 可吃
        [4, 6, 'fill'], // 非下家，有搭子也无资格
        'junk',
      ],
      junkAvoid: [3, 5, 7],
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, discardOf(s, 0, 5));
    expect(s.eligible[1]).toBe(true);
    expect(s.eligible[2]).toBe(false);
    expect(s.eligible[3]).toBe(false);

    applyAction(s, 1, { type: 'chi', useKinds: [4, 6] });
    const p = s.players[1]!;
    expect(p.melds[0]!.type).toBe('chi');
    expect(p.melds[0]!.kind).toBe(4);
    expect(s.current).toBe(1);
    expect(s.phase.t).toBe('awaitDiscard');
    expect(p.hand).toHaveLength(14);
  });

  it('碰 > 吃：下家可吃、对家可碰，碰胜', () => {
    const s = mkState({
      hands: [
        [5, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32, 33, 21, 22],
        [4, 6, 'fill'], // 下家可吃
        'junk',
        [5, 5, 'fill'], // 对家可碰
      ],
      junkAvoid: [3, 5, 7],
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, discardOf(s, 0, 5));
    applyAction(s, 1, { type: 'chi', useKinds: [4, 6] });
    applyAction(s, 3, { type: 'peng' });
    expect(s.current).toBe(3);
    expect(s.players[3]!.melds[0]!.type).toBe('peng');
    expect(s.players[1]!.melds).toHaveLength(0);
  });

  it('打出的金不能被任何响应', () => {
    const s = mkState({
      hands: [
        [G, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32, 33, 21, 22],
        [G, G, 'fill'],
        'junk', 'junk',
      ],
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, discardOf(s, 0, G));
    expect(s.phase.t).toBe('awaitDraw');
    expect(s.current).toBe(1);
  });

  it('金不能参与吃碰：手持金搭子对相邻出牌无吃资格', () => {
    const s = mkState({
      hands: [
        [5, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32, 33, 21, 22],
        [G, 7, 'fill'],
        'junk', 'junk',
      ],
      junkAvoid: [3, 4, 5, 6],
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, discardOf(s, 0, 5));
    expect(s.eligible[1]).toBeFalsy(); // 无任何响应窗口（eligible 为空数组）
    expect(s.phase.t).toBe('awaitDraw');
  });
});

// ---------------------------------------------------------------- 自摸与流局

describe('自摸与流局', () => {
  it('自摸：+6，其余各 -2', () => {
    const s = mkState({
      hands: [
        [0, 0, 0, 3, 3, 3, 9, 10, 11, 18, 19, 20, 27, 27, 27, 28, 28],
        'junk', 'junk', 'junk',
      ],
      phase: { t: 'awaitDiscard' },
    });
    expect(has(legalActions(s, 0), (a) => a.type === 'hu')).toBe(true);
    applyAction(s, 0, { type: 'hu' });
    expect(over(s).score.winType).toBe('zimo');
    expect(over(s).score.delta).toEqual([6, -2, -2, -2]);
  });

  it('流局：牌墙剩 16 张时无人胡 → 流局，零和不变', () => {
    const s = mkState({
      hands: ['junk', 'junk', 'junk', 'junk'],
      phase: { t: 'awaitDraw' },
      current: 0,
    });
    s.wall = s.wall.slice(0, 17); // 17 > 16，可摸
    applyAction(s, 0, { type: 'draw' });
    expect(s.phase.t).toBe('awaitDiscard');
    s.wall = s.wall.slice(0, 16); // 模拟墙尽
    s.phase = { t: 'awaitDraw' };
    applyAction(s, 0, { type: 'draw' });
    expect(s.phase.t).toBe('over');
    expect(over(s).liuju).toBe(true);
    expect(over(s).score.delta).toEqual([0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------- 游金

describe('单游 / 双游 / 三游', () => {
  it('单游：宣告后打出普通牌，状态进入单游', () => {
    const s = mkState({
      hands: [DANYOU_17, 'junk', 'junk', 'junk'],
      junkAvoid: [3, 4, 5, 6, 7],
      phase: { t: 'awaitDiscard' },
    });
    const declare = legalActions(s, 0).find((a) => a.type === 'discard' && a.declare === 'danyou');
    expect(declare).toBeDefined();

    applyAction(s, 0, declare!);
    expect(s.players[0]!.youjin).toBe(1);
    expect(s.players[0]!.hand).toHaveLength(16); // 5 组 + 1 金
    expect(s.log.some((l) => l.includes('单游宣告'))).toBe(true);
  });

  it('单游者下次摸任意非金牌即胡：+9 / 其余 -3', () => {
    const s = mkState({
      hands: [DANYOU_17, 'junk', 'junk', 'junk'],
      junkAvoid: [3, 4, 5, 6, 7],
      wallHead: [12],
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, legalActions(s, 0).find((a) => a.type === 'discard' && a.declare === 'danyou')!);
    s.current = 0; // 快进到单游者再次摸牌
    s.phase = { t: 'awaitDraw' };
    applyAction(s, 0, { type: 'draw' });
    expect(s.phase.t).toBe('over');
    expect(over(s).score.winType).toBe('danyou');
    expect(over(s).score.delta).toEqual([9, -3, -3, -3]);
  });

  it('双游：单游者摸金可宣告，宣告后全场关闭响应', () => {
    const s = mkState({
      hands: [
        DANYOU_17,
        [7, 'fill'],
        [7, 7, 'fill'], // 有两张八筒？kind7=八万；用于验证「本可碰但响应关闭」
        'junk',
      ],
      junkAvoid: [3, 4, 5, 6, 7],
      wallHead: [G, 9], // seat0 摸金；随后 seat1 摸一条
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, legalActions(s, 0).find((a) => a.type === 'discard' && a.declare === 'danyou')!);
    s.current = 0;
    s.phase = { t: 'awaitDraw' };
    applyAction(s, 0, { type: 'draw' }); // 摸到金
    expect(s.phase.t).toBe('awaitDiscard');
    const declare2 = legalActions(s, 0).find((a) => a.type === 'discard' && a.declare === 'shuangyou');
    expect(declare2).toBeDefined();
    applyAction(s, 0, declare2!);
    expect(s.players[0]!.youjin).toBe(2);
    expect(s.shuangyouSeat).toBe(0);
    expect(s.current).toBe(1);
    expect(s.phase.t).toBe('awaitDraw');

    // seat1 摸牌后打出八万：seat2 本可碰，但双游期间响应关闭
    applyAction(s, 1, { type: 'draw' });
    expect(s.phase.t).toBe('awaitDiscard');
    applyAction(s, 1, discardOf(s, 1, 7));
    expect(s.phase.t).toBe('awaitDraw'); // 无响应窗口，直接下家
    expect(s.current).toBe(2);
  });

  it('双游者摸非金牌即胡：+18 / 其余 -6', () => {
    const s = mkState({
      hands: [DANYOU_16, 'junk', 'junk', 'junk'],
      youjin: [2, 0, 0, 0],
      wallHead: [13],
      phase: { t: 'awaitDraw' },
    });
    applyAction(s, 0, { type: 'draw' });
    expect(over(s).score.winType).toBe('shuangyou');
    expect(over(s).score.delta).toEqual([18, -6, -6, -6]);
  });

  it('三游：双游者再摸金立即胡：+27 / 其余 -9', () => {
    const s = mkState({
      hands: [DANYOU_16, 'junk', 'junk', 'junk'],
      youjin: [2, 0, 0, 0],
      wallHead: [G],
      phase: { t: 'awaitDraw' },
    });
    applyAction(s, 0, { type: 'draw' });
    expect(over(s).score.winType).toBe('sanyou');
    expect(over(s).score.delta).toEqual([27, -9, -9, -9]);
  });

  it('游金玩家不能响应他人出牌（D3）', () => {
    const s = mkState({
      hands: [
        [5, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 29, 32, 33, 21, 22],
        DANYOU_16, // 单游中
        [5, 5, 'fill'],
        'junk',
      ],
      youjin: [0, 1, 0, 0],
      junkAvoid: [3, 4, 5, 6, 7],
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, discardOf(s, 0, 5));
    expect(s.eligible[1]).toBe(false); // 单游玩家无资格
    expect(s.eligible[2]).toBe(true);
  });
});

describe('金牌不参与吃（百搭牌规则）', () => {
  it('下家手牌含金（七万），上家打六万：不推荐 567（[5, 6(金)]）吃', () => {
    // goldKind=6 → kind 6 是金牌。下家手牌有 kind 4（五万）和 kind 6（七万=金）。
    // 上家（seat0）打出六万（kind5），下家（seat1）唯一吃法 567 需 useKinds=[4,6]，
    // 其中 6 是金牌 → 必须被过滤，不应出现任何 chi 选项。
    const s = mkState({
      hands: [
        [5, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 29, 30, 32, 33, 7], // 上家：可打六万
        [4, 6, 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill'], // 下家：五万 + 七万(金)
        ['junk'],
        ['junk'],
      ],
      goldKind: 6, // 七万为金牌
      junkAvoid: [3, 4, 5, 6, 7], // 散牌避开 3-7 万，不干扰
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, discardOf(s, 0, 5)); // 上家打出六万
    const chiActs = legalActions(s, 1).filter((a) => a.type === 'chi');
    expect(chiActs).toHaveLength(0); // 567 含金被拦，无合法吃
  });

  it('无金牌掺入时，正常 456 吃不受影响', () => {
    const s = mkState({
      hands: [
        [5, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 29, 30, 32, 33, 7], // 上家：可打六万
        [3, 4, 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill'], // 下家：四万+五万
        ['junk'],
        ['junk'],
      ],
      goldKind: 31, // 中为金，与万子无关
      junkAvoid: [3, 4, 5, 6, 7],
      phase: { t: 'awaitDiscard' },
    });
    applyAction(s, 0, discardOf(s, 0, 5)); // 上家打出六万
    const chiActs = legalActions(s, 1).filter((a): a is { type: 'chi'; useKinds: [number, number] } => a.type === 'chi');
    expect(chiActs.some((a) => a.useKinds.includes(3) && a.useKinds.includes(4))).toBe(true); // 456 吃可用
  });
});
