/**
 * 单机 AI：只使用公开信息 + 自身手牌，不读牌墙、不操纵发牌。
 *
 * 决策核心：含金向听数评估。金为百搭，评估时把每张金当作"可补任意牌"，
 * 用回溯求「最大面子数 S + 将是否完整 P」，eval = 2*(5-S) + (1-P)，越小越接近胡。
 *
 * 校准：aiLevel ∈ [0,1] 为内部难度旋钮（0=乱打，1=最优），默认 0.9。
 * 真人长期胜率 50% 目标：先以 4 AI 自对弈验证对称性（各约 25%），
 * 再按真人试玩反馈微调 aiLevel（见 tests/ai-sim.test.ts 与 docs/rules.md §9）。
 */
import {
  kindOf, isSuit, countKinds, legalActions, findDanyouDiscards,
  type GameAction, type GameState,
} from '../engine/index.js';

export const DEFAULT_AI_LEVEL = 0.9;
/** 进取度：AI 放弃点炮胡、改等自摸的概率（模拟真人"稳健但有追求"） */
export const DEFAULT_AI_GREED = 0.15;

/** 含金评估：返回 { S: 完整面子数, P: 将是否完整 }，未用的金计入牌型帮助 */
export function evaluateHand(kinds: number[], goldKind: number): { S: number; P: boolean } {
  const counts = countKinds(kinds);
  const jokers = goldKind >= 0 ? counts[goldKind]! : 0;
  if (goldKind >= 0) counts[goldKind] = 0;

  let bestS = -1;
  let hasPair = false;

  // 枚举将：普通牌对 / 金补对 / 双金对
  for (let p = 0; p < 34; p++) {
    if (p === goldKind) {
      if (jokers >= 2) {
        const c = counts.slice();
        const S = maxSets(c, jokers - 2);
        if (S > bestS || (S === bestS && !hasPair)) { bestS = S; hasPair = true; }
      }
      continue;
    }
    const take = Math.min(2, counts[p]!);
    const need = 2 - take;
    if (need > jokers) continue;
    const c = counts.slice();
    c[p]! -= take;
    const S = maxSets(c, jokers - need);
    if (S > bestS || (S === bestS && !hasPair)) { bestS = S; hasPair = true; }
  }
  // 无将方案（将未完成）
  if (bestS === -1) bestS = maxSets(counts, jokers);

  return { S: Math.max(bestS, 0), P: hasPair };
}

export function evalScore(kinds: number[], goldKind: number): number {
  const { S, P } = evaluateHand(kinds, goldKind);
  return 2 * (5 - S) + (P ? 0 : 1);
}

/** 最大面子数回溯（刻/顺，jokers 补位） */
function maxSets(c: number[], j: number): number {
  // 找最小有余牌的 kind
  let k = -1;
  for (let i = 0; i < 34; i++) {
    if (c[i]! > 0) { k = i; break; }
  }
  if (k === -1) return 0;
  let best = 0;
  // 刻子
  if (c[k]! + j >= 3) {
    const take = Math.min(3, c[k]!);
    const cc = c.slice();
    cc[k]! -= take;
    best = Math.max(best, 1 + maxSets(cc, j - (3 - take)));
  }
  // 顺子
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
        best = Math.max(best, 1 + maxSets(cc, jj));
      }
    }
  }
  return best;
}

/** 弃牌评分：该牌被弃后手牌向听（越小越好）；NaN = 弃金（极差，几乎不选） */
function discardScore(state: GameState, seat: number, tile: number): number {
  const p = state.players[seat]!;
  if (kindOf(tile) === state.goldKind) return NaN;
  const kinds = p.hand.filter((t) => t !== tile).map(kindOf);
  return evalScore(kinds, state.goldKind);
}

/** 孤张度：出现 1 次且无邻张的牌优先弃（定序用） */
function isolationScore(kinds: number[], tileKind: number): number {
  const c = countKinds(kinds);
  let n = 0;
  if (c[tileKind]! > 1) n += 4;
  if (isSuit(tileKind)) {
    const r = (tileKind % 9) + 1;
    if (r > 1 && c[tileKind - 1]! > 0) n += 2;
    if (r < 9 && c[tileKind + 1]! > 0) n += 2;
    if (r > 2 && c[tileKind - 2]! > 0) n += 1;
    if (r < 8 && c[tileKind + 2]! > 0) n += 1;
  }
  return n;
}

function pickRandom<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

/** AI 决策：给定状态与座位，返回一个合法动作 */
export function aiDecide(
  state: GameState, seat: number, rand: () => number,
  level = DEFAULT_AI_LEVEL, greed = DEFAULT_AI_GREED,
): GameAction {
  const acts = legalActions(state, seat);
  if (acts.length === 0) throw new Error(`AI seat${seat} 无合法动作`);
  const ph = state.phase;

  if (ph.t === 'awaitDraw') return { type: 'draw' };

  if (ph.t === 'awaitDiscard') {
    // 游金宣告优先于直接胡：单游 +9 / 双游 +18 期望高于自摸 +6（单游后摸任意牌必胡，风险仅在点炮）
    const danyou = acts.find((a) => a.type === 'discard' && a.declare === 'danyou');
    if (danyou && rand() < level) return danyou;
    const shuangyou = acts.find((a) => a.type === 'discard' && a.declare === 'shuangyou');
    if (shuangyou && rand() < level) return shuangyou;
    // 胡
    const hu = acts.find((a) => a.type === 'hu');
    if (hu) return hu;

    const p = state.players[seat]!;
    const kinds = p.hand.map(kindOf);
    const cur = evalScore(kinds, state.goldKind);

    // 杠：非听牌状态且不破坏牌型时杠（听牌边缘不冒险）
    for (const a of acts) {
      if (a.type === 'anGang' || a.type === 'jiaGang') {
        if (cur > 1 || level >= 1) {
          if (rand() < level) return a;
        }
      }
    }

    // 弃牌：向听最优，平手按孤张度
    const discards = acts.filter((a): a is { type: 'discard'; tile: number } =>
      a.type === 'discard' && !a.declare);
    if (discards.length > 0) {
      let best: { act: { type: 'discard'; tile: number }; score: number; iso: number } | null = null;
      const kindCount = countKinds(kinds);
      for (const a of discards) {
        const score = discardScore(state, seat, a.tile);
        if (Number.isNaN(score)) continue;
        const iso = isolationScore(kinds, kindOf(a.tile));
        if (!best || score < best.score || (score === best.score && iso < best.iso)) {
          best = { act: a, score, iso };
        }
      }
      if (best) {
        if (rand() < level) return best.act;
        return pickRandom(discards, rand);
      }
      // 全是金（几乎不可能）：随机
      return pickRandom(discards, rand);
    }
    return pickRandom(acts, rand);
  }

  if (ph.t === 'awaitResponse') {
    const p = state.players[seat]!;
    const kinds = p.hand.map(kindOf);
    const cur = evalScore(kinds, state.goldKind);
    const hu = acts.find((a) => a.type === 'hu');
    // 拒胡救援：吃进这张牌恰好构成单游牌型（5 组面子 + 金 + X）时，
    // 拒绝点炮胡（+3），等自摸宣告单游（+9）——EV 更高，也提升游金可见性
    if (hu) {
      const after = [...kinds, ph.discard];
      if (findDanyouDiscards(after, state.goldKind, p.melds.length).length > 0) {
        if (rand() < level) return { type: 'pass' };
        return hu;
      }
      // 一般拒胡：低概率进取（等自摸 +6 优于点炮 +3，但可能被抢胡）
      if (rand() < greed) return { type: 'pass' };
      return hu;
    }
    const melds = acts.filter((a) => a.type === 'peng' || a.type === 'gang');
    const chis = acts.filter((a) => a.type === 'chi');
    // 碰/杠：动作后手牌 + 弃一张的最优向听 <= 当前 +1 才做
    let bestMeld: GameAction | null = null;
    let bestScore = Infinity;
    for (const a of melds) {
      const after = kinds.slice();
      const k = ph.discard;
      if (a.type === 'peng') {
        for (let n = 0; n < 2; n++) after.splice(after.indexOf(k), 1);
      } else {
        for (let n = 0; n < 3; n++) after.splice(after.indexOf(k), 1);
      }
      // 模拟最佳弃牌
      const s = minDiscardEval(after, state.goldKind);
      if (s < bestScore) { bestScore = s; bestMeld = a; }
    }
    // 陪打电脑放宽吃碰杠：向听不超过当前 +2 即做，概率用 level（不再除 2）——让其他三家更活跃陪玩
    if (bestMeld && bestScore <= cur + 2 && rand() < level) return bestMeld;
    // 吃：同上（chi 带 useKinds）
    let bestChi: GameAction | null = null;
    let bestChiScore = Infinity;
    for (const a of chis) {
      if (a.type !== 'chi') continue;
      const after = kinds.slice();
      for (const uk of a.useKinds) after.splice(after.indexOf(uk), 1);
      const s = minDiscardEval(after, state.goldKind);
      if (s < bestChiScore) { bestChiScore = s; bestChi = a; }
    }
    if (bestChi && bestChiScore <= cur + 2 && rand() < level) return bestChi;
    return { type: 'pass' };
  }
  return pickRandom(acts, rand);
}

/** 摸/吃碰后，模拟弃一张的最优向听 */
function minDiscardEval(kindsAfter: number[], goldKind: number): number {
  if (kindsAfter.length <= 14) return evalScore(kindsAfter, goldKind); // 吃碰后直接出牌（不含刚摸）
  let best = Infinity;
  const seen = new Set<number>();
  for (let i = 0; i < kindsAfter.length; i++) {
    const k = kindsAfter[i]!;
    if (seen.has(k)) continue;
    seen.add(k);
    const rest = kindsAfter.slice(0, i).concat(kindsAfter.slice(i + 1));
    const s = evalScore(rest, goldKind);
    if (s < best) best = s;
  }
  return best;
}