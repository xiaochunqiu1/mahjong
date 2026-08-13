/**
 * 开麦麻将 - 纯规则引擎（回合级状态机）。
 *
 * 已钉死的设计决策（改动需过评审）：
 *  D1 翻金移出牌墙：被翻的金牌作为指示物不可被摸到（也不进入任何手牌），
 *     同种其余 3 张仍在局中，同样为金。
 *  D2 响应采用「收集-裁决」模型：出牌后所有有资格者提交响应（超时=过），
 *     按 胡 > 杠/碰 > 吃、同档按距出牌者最近者裁决；一炮只最近者胡。
 *  D3 单游/双游玩家不能响应他人出牌（含点炮胡），只能自摸——文档只对单游
 *     写了「自摸胡」，且游金番型与自摸结构绑定，避免 +3/+9 计分歧义。
 *  D4 任何人进入双游后，全场响应关闭（只能自摸）。
 *  D5 杠补/补花一律从牌墙尾部取；摸牌从头部取；取牌前墙长 <= 16 即流局。
 *  D6 金牌打出不能被任何响应（含胡）。
 */
import {
  buildWall, shuffle, mulberry32, kindOf, isFlower, isSuit, rankOf,
  FLOWER_START, kindName,
} from './tiles.js';
import { canWinConcealed, findDanyouDiscards, countKinds } from './win.js';
import type {
  GameState, GameAction, PlayerState, Meld, Phase, RoundResult, RuleConfig, WinType,
} from './types.js';

const SCORE_TABLE: Record<WinType, { winner: number; each: number }> = {
  ron: { winner: 3, each: 0 }, // 点炮：仅点炮者 -3
  zimo: { winner: 6, each: -2 },
  danyou: { winner: 9, each: -3 },
  shuangyou: { winner: 18, each: -6 },
  sanyou: { winner: 27, each: -9 },
};

export const handKinds = (p: PlayerState): number[] => p.hand.map(kindOf);
export const setsNeededFor = (p: PlayerState): number => 5 - p.melds.length;

// ---------------------------------------------------------------- 开局

/** 创建一局：发牌 → 补起手花（从尾补）→ 翻金。dealer 17 张，其余 16 张。 */
export function createRound(seed: number, dealer: number, config: RuleConfig): GameState {
  const rand = mulberry32(seed);
  const wall = shuffle(buildWall(), rand);
  const players = [0, 1, 2, 3].map((seat) => ({
    seat, hand: [] as number[], flowers: [] as number[], melds: [] as Meld[],
    discards: [] as number[], youjin: 0 as const,
  })) as GameState['players'];

  // 发牌：每人 16 张，庄家再补 1 张（等价于庄家先摸）
  for (let n = 0; n < 16; n++) {
    for (let s = 0; s < 4; s++) players[s]!.hand.push(wall.shift()!);
  }
  players[dealer]!.hand.push(wall.shift()!);

  const state: GameState = {
    wall, goldKind: -1, goldIndicator: -1, players, dealer, current: dealer,
    phase: { t: 'awaitDiscard' }, responses: [], eligible: [],
    shuangyouSeat: -1, config, log: [],
  };

  // 补起手花：从庄家开始轮流，摸到花亮出并从牌尾补，直到无花
  for (let s = 0; s < 4; s++) {
    const seat = (dealer + s) % 4;
    replaceFlowers(state, players[seat]!);
  }

  // 翻金：从摸牌端翻第一张非花牌，移出牌墙作指示物（D1：不可被摸到；
  // 同种其余 3 张仍在局中，同样为金）
  const flipIdx = state.wall.findIndex((id) => !isFlower(kindOf(id)));
  if (flipIdx < 0) throw new Error('牌墙无非花牌可翻金');
  const flip = state.wall.splice(flipIdx, 1)[0]!;
  state.goldIndicator = flip;
  state.goldKind = kindOf(flip);
  state.log.push(`开金:${kindName(state.goldKind)}`);
  return state;
}

/** 将手牌中的花牌全部亮出并从牌尾补牌（开局用；补进的花继续补） */
function replaceFlowers(state: GameState, p: PlayerState): void {
  let i = 0;
  while (i < p.hand.length) {
    const k = kindOf(p.hand[i]!);
    if (isFlower(k)) {
      p.hand.splice(i, 1);
      p.flowers.push(k);
      state.log.push(`补花:seat${p.seat}:${kindName(k)}`);
      p.hand.push(state.wall.pop()!); // 补牌追加在末尾，扫描到时会再检查
    } else {
      i++;
    }
  }
}

// ---------------------------------------------------------------- 合法动作

export function legalActions(state: GameState, seat: number): GameAction[] {
  const p = state.players[seat]!;
  const ph = state.phase;

  if (ph.t === 'awaitDraw') {
    return seat === state.current ? [{ type: 'draw' }] : [];
  }

  if (ph.t === 'awaitDiscard') {
    if (seat !== state.current) return [];
    const acts: GameAction[] = p.hand.map((tile) => ({ type: 'discard', tile }));
    const kinds = handKinds(p);
    const sets = setsNeededFor(p);
    // 自摸胡（游金状态由摸牌时自动结算，不走这里）
    if (p.youjin === 0 && canWinConcealed(kinds, state.goldKind, sets)) acts.push({ type: 'hu' });
    if (p.youjin === 1) acts.push({ type: 'hu' }); // 单游状态任意牌可胡（含摸到金放弃双游直接胡）
    // 暗杠 / 加杠（金不能杠；游金状态手牌结构已锁定，不允许杠）
    if (p.youjin === 0) {
      const cnt = countKinds(kinds);
      for (let k = 0; k < 34; k++) {
        if (k === state.goldKind) continue;
        if (cnt[k] === 4) acts.push({ type: 'anGang', kind: k });
        if (cnt[k]! >= 1 && p.melds.some((m) => m.type === 'peng' && m.kind === k)) {
          acts.push({ type: 'jiaGang', kind: k });
        }
      }
    }
    // 单游宣告：打出 X 后暗手为 (5-副露组数) 组面子 + 1 金（泉州规则副露后仍可游金）
    if (p.youjin === 0) {
      for (const x of findDanyouDiscards(kinds, state.goldKind, p.melds.length)) {
        const tile = p.hand.find((t) => kindOf(t) === x)!;
        acts.push({ type: 'discard', tile, declare: 'danyou' });
      }
    }
    // 双游宣告：单游者摸到金，打出该金
    if (p.youjin === 1) {
      const gold = p.hand.find((t) => kindOf(t) === state.goldKind);
      if (gold !== undefined) acts.push({ type: 'discard', tile: gold, declare: 'shuangyou' });
    }
    return acts;
  }

  if (ph.t === 'awaitResponse') {
    if (!state.eligible[seat] || state.responses[seat]) return [];
    return responseOptions(state, seat);
  }
  return [];
}

/** 某座位对当前待响应出牌的全部可选响应 */
export function responseOptions(state: GameState, seat: number): GameAction[] {
  const ph = state.phase;
  if (ph.t !== 'awaitResponse') return [];
  const from = ph.from;
  const kind = ph.discard;
  if (seat === from || state.shuangyouSeat >= 0) return [{ type: 'pass' }];
  const p = state.players[seat]!;
  const opts: GameAction[] = [{ type: 'pass' }];
  if (p.youjin > 0) return opts; // D3：游金玩家不能响应

  const cnt = countKinds(handKinds(p));
  // 胡
  if (canWinConcealed([...handKinds(p), kind], state.goldKind, setsNeededFor(p))) {
    opts.push({ type: 'hu' });
  }
  // 明杠 / 碰（金不能参与）
  if (kind !== state.goldKind) {
    if (cnt[kind]! >= 3) opts.push({ type: 'gang' });
    if (cnt[kind]! >= 2) opts.push({ type: 'peng' });
  }
  // 吃：仅下家，仅序数牌，只能用自然牌（金牌不参与吃）
  if (seat === (from + 1) % 4 && isSuit(kind)) {
    for (const pair of chiPairs(p, kind)) {
      if (pair.includes(state.goldKind)) continue; // 金牌不能当某张牌去吃
      opts.push({ type: 'chi', useKinds: pair });
    }
  }
  return opts;
}

/** 枚举能吃 kind 的两张自然牌组合（按 kind 去重） */
export function chiPairs(p: PlayerState, kind: number): [number, number][] {
  if (!isSuit(kind)) return [];
  const have = new Set(handKinds(p));
  const out: [number, number][] = [];
  const r = rankOf(kind);
  const inSuit = (k: number) => isSuit(k) && Math.floor(k / 9) === Math.floor(kind / 9);
  const tryAdd = (a: number, b: number) => {
    if (inSuit(a) && inSuit(b) && have.has(a) && have.has(b)) out.push([a, b]);
  };
  if (r >= 3) tryAdd(kind - 2, kind - 1);
  if (r >= 2 && r <= 8) tryAdd(kind - 1, kind + 1);
  if (r <= 7) tryAdd(kind + 1, kind + 2);
  return out;
}

// ---------------------------------------------------------------- 动作应用

export function applyAction(state: GameState, seat: number, action: GameAction): GameState {
  const legal = legalActions(state, seat);
  if (!isLegal(action, legal)) {
    throw new Error(`非法动作 seat${seat}: ${JSON.stringify(action)} (phase=${state.phase.t})`);
  }
  switch (action.type) {
    case 'draw': return doDraw(state, seat);
    case 'discard': return doDiscard(state, seat, action);
    case 'hu': return doHu(state, seat);
    case 'anGang': return doAnGang(state, seat, action.kind);
    case 'jiaGang': return doJiaGang(state, seat, action.kind);
    case 'peng': case 'gang': case 'chi': case 'pass':
      return submitResponse(state, seat, action);
  }
}

function isLegal(a: GameAction, legal: GameAction[]): boolean {
  return legal.some((l) => JSON.stringify(l) === JSON.stringify(a));
}

// ---- 摸牌（含补花、游金自动结算、流局）

function doDraw(state: GameState, seat: number): GameState {
  const p = state.players[seat]!;
  const tile = takeNonFlower(state, p, true);
  if (state.phase.t === 'over') return state; // 流局
  const k = kindOf(tile);
  state.log.push(`摸牌:seat${seat}:${kindName(k)}`);

  // 双游者再摸金 → 三游，立即胡
  if (p.youjin === 2 && k === state.goldKind) {
    p.hand.push(tile);
    return settle(state, seat, 'sanyou');
  }
  // 单游/双游者摸任意非金牌 → 游金胡
  if (p.youjin >= 1 && k !== state.goldKind) {
    p.hand.push(tile);
    return settle(state, seat, p.youjin === 1 ? 'danyou' : 'shuangyou');
  }
  p.hand.push(tile);
  state.phase = { t: 'awaitDiscard' };
  return state;
}

/**
 * 取一张非花牌。首次从头部（摸牌）或尾部（杠补）取；
 * 一旦取出花牌，亮出后固定从尾部继续补，直到非花。
 * 取牌前墙长 <= 流局底线即置流局并返回 -1（调用方先查 phase）。
 */
function takeNonFlower(state: GameState, p: PlayerState, fromHead: boolean): number {
  let head = fromHead;
  for (;;) {
    if (state.wall.length <= state.config.liujuFloor) {
      state.phase = { t: 'over', result: liujuResult(state) };
      state.log.push('流局');
      return -1;
    }
    const tile = head ? state.wall.shift()! : state.wall.pop()!;
    const k = kindOf(tile);
    if (!isFlower(k)) return tile;
    p.flowers.push(k);
    state.log.push(`补花:seat${p.seat}:${kindName(k)}`);
    head = false; // 补花一律走牌尾
  }
}

// ---- 出牌（含单游/双游宣告）

function doDiscard(state: GameState, seat: number, action: { tile: number; declare?: 'danyou' | 'shuangyou' }): GameState {
  const p = state.players[seat]!;
  const idx = p.hand.indexOf(action.tile);
  const k = kindOf(action.tile);
  p.hand.splice(idx, 1);
  p.discards.push(k); // discards 存 kind（UI TileFace 用 kind 渲染牌面）

  if (action.declare === 'danyou') {
    p.youjin = 1;
    state.log.push(`单游宣告:seat${seat}:打${kindName(k)}`);
  } else if (action.declare === 'shuangyou') {
    p.youjin = 2;
    state.shuangyouSeat = seat;
    state.log.push(`双游宣告:seat${seat}:打金${kindName(k)}`);
    // 金牌无响应，直接下家摸
    state.current = (seat + 1) % 4;
    state.phase = { t: 'awaitDraw' };
    return state;
  } else {
    state.log.push(`出牌:seat${seat}:${kindName(k)}`);
  }

  // 金牌或双游进行中：无响应（D4/D6）
  if (k === state.goldKind || state.shuangyouSeat >= 0) {
    state.current = (seat + 1) % 4;
    state.phase = { t: 'awaitDraw' };
    return state;
  }

  // 计算响应资格
  const eligible = [false, false, false, false];
  let any = false;
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    const opts = responseOptionsForDiscard(state, s, seat, k);
    if (opts.length > 0) { eligible[s] = true; any = true; }
  }
  if (!any) {
    state.current = (seat + 1) % 4;
    state.phase = { t: 'awaitDraw' };
    return state;
  }
  state.phase = { t: 'awaitResponse', discard: k, from: seat };
  state.eligible = eligible;
  state.responses = [null, null, null, null];
  for (let s = 0; s < 4; s++) if (!eligible[s]) state.responses[s] = { type: 'pass' };
  return state;
}

/** 与 responseOptions 同逻辑，但用于资格判定（不含 pass） */
function responseOptionsForDiscard(state: GameState, seat: number, from: number, kind: number): GameAction[] {
  const p = state.players[seat]!;
  if (p.youjin > 0) return [];
  const opts: GameAction[] = [];
  const cnt = countKinds(handKinds(p));
  if (canWinConcealed([...handKinds(p), kind], state.goldKind, setsNeededFor(p))) opts.push({ type: 'hu' });
  if (kind !== state.goldKind) {
    if (cnt[kind]! >= 3) opts.push({ type: 'gang' });
    if (cnt[kind]! >= 2) opts.push({ type: 'peng' });
  }
  if (seat === (from + 1) % 4 && isSuit(kind)) {
    for (const pair of chiPairs(p, kind)) {
      if (pair.includes(state.goldKind)) continue;
      opts.push({ type: 'chi', useKinds: pair });
    }
  }
  return opts;
}

// ---- 自摸胡（awaitDiscard 时的 hu）

function doHu(state: GameState, seat: number): GameState {
  const p = state.players[seat]!;
  if (state.phase.t === 'awaitDiscard') {
    return settle(state, seat, p.youjin === 1 ? 'danyou' : 'zimo');
  }
  // 响应阶段的 hu：在 submitResponse 处理
  return submitResponse(state, seat, { type: 'hu' });
}

// ---- 杠

function doAnGang(state: GameState, seat: number, kind: number): GameState {
  const p = state.players[seat]!;
  for (let n = 0; n < 4; n++) {
    const i = p.hand.findIndex((t) => kindOf(t) === kind);
    p.hand.splice(i, 1);
  }
  p.melds.push({ type: 'anGang', kind, tiles: [kind, kind, kind, kind] });
  state.log.push(`暗杠:seat${seat}:${kindName(kind)}`);
  return gangSupplement(state, p);
}

function doJiaGang(state: GameState, seat: number, kind: number): GameState {
  const p = state.players[seat]!;
  const i = p.hand.findIndex((t) => kindOf(t) === kind);
  p.hand.splice(i, 1);
  const meld = p.melds.find((m) => m.type === 'peng' && m.kind === kind)!;
  meld.type = 'jiaGang';
  meld.tiles.push(kind);
  state.log.push(`加杠:seat${seat}:${kindName(kind)}`);
  return gangSupplement(state, p);
}

/** 杠后从牌尾补一张（花则继续补），再回到 awaitDiscard */
function gangSupplement(state: GameState, p: PlayerState): GameState {
  const tile = takeNonFlower(state, p, false);
  if (state.phase.t === 'over') return state; // 流局
  p.hand.push(tile);
  state.log.push(`杠补:seat${p.seat}:${kindName(kindOf(tile))}`);
  state.phase = { t: 'awaitDiscard' };
  return state;
}

// ---- 响应收集与裁决（D2）

function submitResponse(state: GameState, seat: number, action: GameAction): GameState {
  state.responses[seat] = action;
  if (state.responses.some((r) => r === null)) return state; // 未收齐
  return resolveResponses(state);
}

function resolveResponses(state: GameState): GameState {
  const ph = state.phase as Extract<Phase, { t: 'awaitResponse' }>;
  const kind = ph.discard;
  const from = ph.from;
  const byDistance = [1, 2, 3].map((d) => (from + d) % 4);

  // 胡：最近者
  for (const s of byDistance) {
    if (state.responses[s]?.type === 'hu') {
      return settle(state, s, 'ron', from);
    }
  }
  // 杠 > 碰（同档最近优先；杠先于碰尝试，文档为「杠/碰」同档，这里杠优先是裁决细化）
  for (const s of byDistance) {
    if (state.responses[s]?.type === 'gang') {
      const p = state.players[s]!;
      for (let n = 0; n < 3; n++) {
        const i = p.hand.findIndex((t) => kindOf(t) === kind);
        p.hand.splice(i, 1);
      }
      p.melds.push({ type: 'mingGang', kind, tiles: [kind, kind, kind, kind], fromSeat: from });
      state.log.push(`明杠:seat${s}:${kindName(kind)}`);
      state.current = s;
      return gangSupplement(state, p);
    }
  }
  for (const s of byDistance) {
    if (state.responses[s]?.type === 'peng') {
      const p = state.players[s]!;
      for (let n = 0; n < 2; n++) {
        const i = p.hand.findIndex((t) => kindOf(t) === kind);
        p.hand.splice(i, 1);
      }
      p.melds.push({ type: 'peng', kind, tiles: [kind, kind, kind], fromSeat: from });
      state.log.push(`碰:seat${s}:${kindName(kind)}`);
      state.current = s;
      state.phase = { t: 'awaitDiscard' };
      return state;
    }
  }
  // 吃（仅下家有资格，唯一候选）
  for (const s of byDistance) {
    const r = state.responses[s];
    if (r?.type === 'chi') {
      const p = state.players[s]!;
      for (const uk of r.useKinds) {
        const i = p.hand.findIndex((t) => kindOf(t) === uk);
        p.hand.splice(i, 1);
      }
      const lo = Math.min(kind, r.useKinds[0], r.useKinds[1]);
      p.melds.push({ type: 'chi', kind: lo, tiles: [kind, ...r.useKinds], fromSeat: from });
      state.log.push(`吃:seat${s}:${kindName(kind)}`);
      state.current = s;
      state.phase = { t: 'awaitDiscard' };
      return state;
    }
  }
  // 全部过
  state.log.push(`无人响应:${kindName(kind)}`);
  state.current = (from + 1) % 4;
  state.phase = { t: 'awaitDraw' };
  return state;
}

// ---------------------------------------------------------------- 结算

function settle(state: GameState, winner: number, winType: WinType, loser?: number): GameState {
  const t = SCORE_TABLE[winType];
  const delta: [number, number, number, number] = [0, 0, 0, 0];
  if (winType === 'ron') {
    delta[winner] = t.winner;
    delta[loser!] = -t.winner;
  } else {
    delta[winner] = t.winner;
    for (let s = 0; s < 4; s++) if (s !== winner) delta[s] = t.each;
  }
  const result: RoundResult = {
    score: { winType, winner, loser, delta },
    winner,
    liuju: false,
  };
  state.log.push(`胡牌:seat${winner}:${winType}:${JSON.stringify(delta)}`);
  state.phase = { t: 'over', result };
  return state;
}

function liujuResult(state: GameState): RoundResult {
  return {
    score: { winType: 'liuju', winner: -1, delta: [0, 0, 0, 0] },
    winner: -1,
    liuju: true,
  };
}

// ---------------------------------------------------------------- 整场（4/8 局）

export interface MatchLike {
  roundNo: number;
  dealer: number;
  scores: [number, number, number, number];
  over: boolean;
  history: RoundResult[];
}

export function createMatch(seed: number, rounds: 4 | 8): MatchLike & { config: RuleConfig; seed: number } {
  const rand = mulberry32(seed);
  const dealer = Math.floor(rand() * 4);
  return {
    config: { rounds, liujuFloor: 16 },
    seed,
    roundNo: 1,
    dealer,
    scores: [0, 0, 0, 0],
    over: false,
    history: [],
  };
}

/** 一局结束后推进整场：赢家坐庄；庄家胡或流局则连庄（不追加倍数） */
export function advanceMatch(match: MatchLike & { config: RuleConfig }, result: RoundResult): void {
  match.history.push(result);
  for (let s = 0; s < 4; s++) match.scores[s]! += result.score.delta[s]!;
  const dealerKeep = result.liuju || result.winner === match.dealer;
  if (!dealerKeep) match.dealer = result.winner;
  if (match.roundNo >= match.config.rounds) {
    match.over = true;
  } else {
    match.roundNo += 1;
  }
}
