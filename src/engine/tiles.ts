/**
 * 牌型定义与牌墙生成。
 *
 * 牌「种类」kind 编码（0..41）：
 *   0-8   一万..九万
 *   9-17  一条..九条
 *   18-26 一筒..九筒
 *   27-30 东 南 西 北
 *   31-33 中 发 白
 *   34-41 春 夏 秋 冬 梅 兰 竹 菊（花牌）
 *
 * 牌「实例」id 编码（0..143，保证 144 张全局唯一）：
 *   非花牌：id = kind * 4 + copy（copy 0..3），即 id 0..135
 *   花牌：  id = 136 + (kind - 34)，即 id 136..143
 */

export const SUIT_KINDS = 27; // 0..26 为序数牌
export const HONOR_START = 27;
export const FLOWER_START = 34;
export const KIND_COUNT = 42; // 含花牌
export const PLAY_KINDS = 34; // 非花牌种类数
export const WALL_SIZE = 144;

export const isFlower = (kind: number): boolean => kind >= FLOWER_START;
export const isSuit = (kind: number): boolean => kind >= 0 && kind < SUIT_KINDS;
export const isHonor = (kind: number): boolean =>
  kind >= HONOR_START && kind < FLOWER_START;
/** 序数牌花色：0=万 1=条 2=筒；非序数牌返回 -1 */
export const suitOf = (kind: number): number => (isSuit(kind) ? Math.floor(kind / 9) : -1);
/** 序数牌点数 1..9；非序数牌返回 -1 */
export const rankOf = (kind: number): number => (isSuit(kind) ? (kind % 9) + 1 : -1);

export const kindOf = (id: number): number => (id < 136 ? Math.floor(id / 4) : FLOWER_START + (id - 136));

/** 生成 144 张实例 id（未洗牌） */
export function buildWall(): number[] {
  const wall: number[] = new Array(WALL_SIZE);
  for (let i = 0; i < WALL_SIZE; i++) wall[i] = i;
  return wall;
}

/** 确定性随机数（mulberry32），测试与 AI 模拟依赖固定种子可复现 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗牌，返回新数组 */
export function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

export const KIND_NAMES: string[] = [
  '一万', '二万', '三万', '四万', '五万', '六万', '七万', '八万', '九万',
  '一条', '二条', '三条', '四条', '五条', '六条', '七条', '八条', '九条',
  '一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒',
  '东', '南', '西', '北', '中', '发', '白',
  '春', '夏', '秋', '冬', '梅', '兰', '竹', '菊',
];

export const kindName = (kind: number): string => KIND_NAMES[kind] ?? `?${kind}`;
