/**
 * 胡牌判定：16 张玩法（5 组面子 + 1 对将 = 17 张），金为百搭。
 *
 * 规则要点（与设计文档对齐）：
 *  - 金在暗手中可代替任意非花牌；
 *  - 金不能用于吃 / 碰 / 杠（响应面），本模块只处理暗手胡牌与单游判定；
 *  - 手牌必须被「恰好用完」：胡牌时 17 张全部进入面子/将，不允许剩余游离金。
 */
import { isSuit } from './tiles.js';

/** 统计暗手各 kind 数量，返回长度 34 的计数数组（花牌不应出现在暗手） */
export function countKinds(handKinds: number[]): number[] {
  const c = new Array<number>(34).fill(0);
  for (const k of handKinds) c[k]!++;
  return c;
}

/**
 * 递归判定：c（不含金）+ j 个百搭金，能否恰好组成 n 组面子。
 * 每次取最小有余牌的 kind，分支出刻子或顺子。
 */
function canFormSets(c: number[], j: number, n: number): boolean {
  if (n === 0) {
    let rest = j;
    for (let k = 0; k < 34; k++) rest += c[k]!;
    return rest === 0;
  }
  let k = -1;
  for (let i = 0; i < 34; i++) {
    if (c[i]! > 0) { k = i; break; }
  }
  if (k === -1) {
    // 只剩百搭金：每 3 张成一组，必须恰好
    return j === 3 * n;
  }

  // 分支一：刻子（自然牌优先用满，剩余由金补）
  if (c[k]! + j >= 3) {
    const take = Math.min(3, c[k]!);
    const cc = c.slice();
    cc[k]! -= take;
    if (canFormSets(cc, j - (3 - take), n - 1)) return true;
  }

  // 分支二：顺子（仅序数牌，且不跨花色；k+1/k+2 位置允许用金，分支枚举）
  if (isSuit(k) && k % 9 <= 6) {
    const nat1 = c[k + 1]! > 0;
    const nat2 = c[k + 2]! > 0;
    const opt1 = nat1 ? [true, false] : [false];
    const opt2 = nat2 ? [true, false] : [false];
    for (const u1 of opt1) {
      for (const u2 of opt2) {
        const need = (u1 ? 0 : 1) + (u2 ? 0 : 1);
        if (need > j) continue;
        const cc = c.slice();
        let jj = j;
        cc[k]! -= 1;
        if (u1) cc[k + 1]! -= 1; else jj -= 1;
        if (u2) cc[k + 2]! -= 1; else jj -= 1;
        if (canFormSets(cc, jj, n - 1)) return true;
      }
    }
  }
  return false;
}

/**
 * 判定一组暗手牌（kind 数组）是否满足 setsNeeded 组面子 + 1 对将。
 * goldKind 为金的 kind（-1 表示无金）。
 */
export function canWinConcealed(handKinds: number[], goldKind: number, setsNeeded: number): boolean {
  if (handKinds.length !== setsNeeded * 3 + 2) return false;
  const c0 = countKinds(handKinds);
  const j0 = goldKind >= 0 ? c0[goldKind]! : 0;
  if (goldKind >= 0) c0[goldKind] = 0;

  for (let p = 0; p < 34; p++) {
    const c = c0.slice();
    let j = j0;
    if (p === goldKind) {
      if (j < 2) continue; // 金作将只能从金池出
      j -= 2;
    } else {
      const take = Math.min(2, c[p]!);
      const need = 2 - take;
      if (need > j) continue;
      c[p]! -= take;
      j -= need;
    }
    if (canFormSets(c, j, setsNeeded)) return true;
  }
  return false;
}

/**
 * 单游判定：暗手 = (5 - meldCount) 组面子 +（1 金 + 1 普通牌 X）。
 * 返回所有可宣告单游时打出的普通牌 X（kind 去重）。
 * 判定方式：枚举金 g 与普通牌 X，剩余 15 张（允许其余金作百搭）恰好成 (5 - meldCount) 组面子。
 * meldCount：已副露的面子组数（吃/碰/明杠/暗杠/加杠各计 1 组）——泉州规则副露后仍可游金。
 */
export function findDanyouDiscards(handKinds: number[], goldKind: number, meldCount = 0): number[] {
  const needSets = 5 - meldCount;
  if (handKinds.length !== needSets * 3 + 2 || goldKind < 0) return [];
  const goldCount = handKinds.filter((k) => k === goldKind).length;
  if (goldCount === 0) return [];
  const result = new Set<number>();
  const candidates = [...new Set(handKinds.filter((k) => k !== goldKind))];
  for (const x of candidates) {
    // 移除一张金与一张 X
    const rest = handKinds.slice();
    rest.splice(rest.indexOf(goldKind), 1);
    rest.splice(rest.indexOf(x), 1);
    const c = countKinds(rest);
    const j = c[goldKind]!;
    c[goldKind] = 0;
    if (canFormSets(c, j, needSets)) result.add(x);
  }
  return [...result];
}

/** 仅供测试/工具使用：判断 15 张暗手是否恰好成 5 组面子（含金百搭） */
export function canFormFiveSets(handKinds: number[], goldKind: number): boolean {
  if (handKinds.length !== 15) return false;
  const c = countKinds(handKinds);
  const j = goldKind >= 0 ? c[goldKind]! : 0;
  if (goldKind >= 0) c[goldKind] = 0;
  return canFormSets(c, j, 5);
}
