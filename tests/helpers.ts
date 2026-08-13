/**
 * 测试基建：手动构造确定性牌局状态。
 *
 * 物理校验：TileAllocator 严格限制同种牌 ≤ 4 张（花牌 1 张），
 * 任何夹具写出「物理上不可能存在的一桌牌」都会直接报错——这是特性。
 *
 * junk 填充：从「间隔 3」的牌池取牌（同池内不可能成顺，各座位去重），
 * 用于构造对他人出牌零响应的散牌手。junkAvoid 须包含出牌 kind 及其 ±1±2。
 */
import type { GameState, Meld, Phase, PlayerState, RuleConfig, YoujinStage } from '../src/engine/index.js';

export class TileAllocator {
  private nextCopy = new Map<number, number>();

  remaining(kind: number): number {
    const used = this.nextCopy.get(kind) ?? 0;
    return (kind >= 34 ? 1 : 4) - used;
  }

  id(kind: number): number {
    if (this.remaining(kind) < 1) throw new Error(`kind ${kind} 超过物理上限`);
    const copy = this.nextCopy.get(kind) ?? 0;
    this.nextCopy.set(kind, copy + 1);
    return kind >= 34 ? 136 + (kind - 34) : kind * 4 + copy;
  }

  ids(kinds: number[]): number[] {
    return kinds.map((k) => this.id(k));
  }

  /** 所有未使用的非花牌实例（填充牌墙中段用） */
  unusedNonFlowerIds(): number[] {
    const out: number[] = [];
    for (let kind = 0; kind < 34; kind++) {
      for (let copy = this.nextCopy.get(kind) ?? 0; copy < 4; copy++) {
        out.push(kind * 4 + copy);
      }
    }
    return out;
  }
}

/** 手牌规格：kind 数组（可含 'fill' 表示用 junk 补到 16 张）或 'junk'（整手散牌 16 张） */
export type HandSpec = (number | 'fill')[] | 'junk';

/** 间隔取牌池：同池任意两张不同牌间隔 ≥3 或跨池间隔 ≤1 但绝不三连 → 不成顺 */
const JUNK_POOL = [
  0, 3, 6, 9, 12, 15, 18, 21, 24,       // 各花色 1/4/7
  1, 4, 7, 10, 13, 16, 19, 22, 25,      // 各花色 2/5/8（与前池混排最长连号 2，不成顺）
  27, 28, 29, 30, 31, 32, 33,           // 字牌
];

export interface MkStateOptions {
  hands: HandSpec[];
  /** junk 回避的 kind（通常 = 出牌 kind ±2、以及需要控制数量的牌） */
  junkAvoid?: number[];
  goldKind?: number;
  wallHead?: number[]; // 摸牌端（index 0 先被摸到）
  wallTail?: number[]; // 补牌端，数组第 0 个最先被 pop 出
  dealer?: number;
  current?: number;
  phase?: Phase;
  youjin?: YoujinStage[];
  melds?: Meld[][];
  config?: RuleConfig;
}

export function mkState(opts: MkStateOptions): GameState {
  const alloc = new TileAllocator();
  const avoid = new Set(opts.junkAvoid ?? []);

  // 第一遍：分配显式手牌
  const explicit: number[][] = [];
  const needFill: boolean[] = [];
  for (let seat = 0; seat < 4; seat++) {
    const spec = opts.hands[seat] ?? 'junk';
    if (spec === 'junk') {
      explicit.push([]);
      needFill.push(true);
    } else {
      const nums = spec.filter((x): x is number => typeof x === 'number');
      explicit.push(nums);
      needFill.push(spec.includes('fill'));
    }
  }
  const handIds = explicit.map((kinds) => alloc.ids(kinds));

  // 第二遍：分配牌墙两端（先于 junk，保证脚本牌必定拿到）
  const headIds = alloc.ids(opts.wallHead ?? []);
  const tailIds = alloc.ids(opts.wallTail ?? []); // 注：pop 顺序

  // 第三遍：junk 填充（感知剩余量，自动跳过耗尽与回避的 kind）
  for (let seat = 0; seat < 4; seat++) {
    if (!needFill[seat]) continue;
    const have = new Set(explicit[seat]);
    const want = 16 - (explicit[seat]?.length ?? 0); // 按张数补，不是按种数
    if (want <= 0) continue;
    const junk: number[] = [];
    for (const k of JUNK_POOL) {
      if (junk.length >= want) break;
      if (have.has(k) || avoid.has(k) || alloc.remaining(k) < 1) continue;
      have.add(k);
      junk.push(k);
    }
    if (junk.length < want) throw new Error(`seat${seat} junk 填充不足（差 ${want - junk.length} 张）`);
    handIds[seat]!.push(...alloc.ids(junk));
  }

  const players = [0, 1, 2, 3].map((seat): PlayerState => ({
    seat,
    hand: handIds[seat]!,
    flowers: [],
    melds: opts.melds?.[seat] ?? [],
    discards: [],
    youjin: opts.youjin?.[seat] ?? 0,
  })) as GameState['players'];

  // pop 从数组末尾取 → 反转放到末尾
  const wall = [...headIds, ...alloc.unusedNonFlowerIds(), ...tailIds.reverse()];

  return {
    wall,
    goldKind: opts.goldKind ?? 31, // 默认「中」为金
    goldIndicator: -1, // 手动构造的状态不涉及指示牌
    players,
    dealer: opts.dealer ?? 0,
    current: opts.current ?? 0,
    phase: opts.phase ?? { t: 'awaitDraw' },
    responses: [],
    eligible: [],
    shuangyouSeat: (opts.youjin ?? []).indexOf(2),
    config: opts.config ?? { rounds: 4, liujuFloor: 16 },
    log: [],
  };
}

/** 常用牌型片段（kind） */
export const K = {
  wan: (r: number) => r - 1, // 一万=0
  tiao: (r: number) => 9 + r - 1,
  tong: (r: number) => 18 + r - 1,
  east: 27, south: 28, west: 29, north: 30,
  zhong: 31, fa: 32, bai: 33,
};
