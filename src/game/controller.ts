/**
 * 单机会话控制器：驱动引擎 + AI + 真人，管理 4/8 局整场与本地战绩。
 * 事件模型：UI 订阅 onChange，动作通过 humanAct / aiAct 进入。
 */
import {
  createMatch, advanceMatch, createRound, applyAction, legalActions,
  mulberry32,
  type GameState, type GameAction, type RoundResult, type MatchLike,
} from '../engine/index.js';
import { aiDecide, DEFAULT_AI_LEVEL, DEFAULT_AI_GREED } from './ai.js';
import { playForEvent, setSoundEnabled } from './sound.js';

export const HUMAN_SEAT = 0; // 真人固定坐 0（下家方向按逆时针）
export const TURN_MS = 30_000; // 主回合
export const RESPONSE_MS = 8_000; // 响应窗口

export interface RecordEntry {
  date: string;
  rounds: number;
  score: number;
  winCount: number;
  rank: number;
  durationSec: number;
}

export interface SoloSession {
  match: MatchLike & { config: { rounds: number; liujuFloor: number } };
  state: GameState | null;
  seed: number;
  humanSeat: number;
  aiLevel: number;
  greed: number;
  /** 当前回合的真人可选动作（用于渲染按钮） */
  humanActions: GameAction[];
  phaseDeadline: number; // 时间戳
  logs: string[];
  lastDrawn: number | null; // 刚摸的牌（超时自动打出）
  /** 最近一次出牌的 tile instance id（用于牌河金边跟随） */
  lastDisc: number | null;
  roundResult: RoundResult | null;
  matchOver: boolean;
  finishedAt: number | null;
  /** AI 出牌/吃碰等"有信息量"动作的最小间隔（摸牌不限速，让玩家看得清牌局节奏） */
  aiDelayMs: number;
  lastAIMoveAt: number;
}

export function createSession(seed: number, rounds: number, aiLevel = DEFAULT_AI_LEVEL): SoloSession {
  const match = createMatch(seed, rounds);
  return {
    match,
    state: null,
    seed,
    humanSeat: HUMAN_SEAT,
    aiLevel,
    greed: DEFAULT_AI_GREED,
    humanActions: [],
    phaseDeadline: 0,
    logs: [],
    lastDrawn: null,
    lastDisc: null,
    roundResult: null,
    matchOver: false,
    finishedAt: null,
    aiDelayMs: 2200,
    lastAIMoveAt: 0,
  };
}

export function startRound(s: SoloSession): void {
  const state = createRound(s.seed + s.match.roundNo * 100003, s.match.dealer, {
    rounds: s.match.config.rounds,
    liujuFloor: 16,
  });
  s.state = state;
  s.logs = [];
  s.lastDrawn = null;
  s.lastDisc = null;
  s.roundResult = null;
  sync(s);
}

function sync(s: SoloSession): void {
  const state = s.state;
  if (!state) { s.humanActions = []; return; }
  s.humanActions = legalActionsForHuman(s);
  s.phaseDeadline = Date.now() + (state.phase.t === 'awaitResponse' ? RESPONSE_MS : TURN_MS);
}

function legalActionsForHuman(s: SoloSession): GameAction[] {
  const state = s.state!;
  const ph = state.phase;
  if (ph.t === 'over') return [];
  if (ph.t === 'awaitDraw' || ph.t === 'awaitDiscard') {
    return state.current === s.humanSeat ? legalActionsRaw(state, s.humanSeat) : [];
  }
  if (ph.t === 'awaitResponse') {
    return state.eligible[s.humanSeat] && !state.responses[s.humanSeat]
      ? legalActionsRaw(state, s.humanSeat)
      : [];
  }
  return [];
}

function legalActionsRaw(state: GameState, seat: number): GameAction[] {
  return legalActions(state, seat);
}

/** 真人动作入口 */
export function humanAct(s: SoloSession, action: GameAction): void {
  if (s.state?.phase.t === 'over') return;
  apply(s, s.humanSeat, action);
}

/** 推进一帧：真人自动摸牌 + 真人超时处理 + AI 自动行动（供 UI 定时器调用） */
export function tick(s: SoloSession): void {
  const state = s.state;
  if (!state || state.phase.t === 'over') return;

  const ph = state.phase;
  // 轮到真人且可摸牌 → 默认自动摸（无需按钮）
  if (ph.t === 'awaitDraw' && state.current === s.humanSeat) {
    apply(s, s.humanSeat, { type: 'draw' });
    return;
  }

  // 真人回合超时：自动动作
  if (Date.now() >= s.phaseDeadline) {
    if (ph.t === 'awaitDiscard' && state.current === s.humanSeat) {
      // 超时打出刚摸的牌；没有则打第一张
      const acts = legalActions(s.state!, s.humanSeat);
      const tile = s.lastDrawn ?? null;
      const act = tile !== null
        ? acts.find((a) => a.type === 'discard' && a.tile === tile)
        : acts.find((a) => a.type === 'discard' && !a.declare);
      if (act) { apply(s, s.humanSeat, act); return; }
      // 安全网：超时 1 秒后仍未找到合法动作，强制用 AI 替真人决策
      if (Date.now() - s.phaseDeadline > 1000) {
        const sstate = s.state!;
        const safe = aiDecide(sstate, s.humanSeat, mulberry32(s.seed + sstate.log.length + 17), s.aiLevel);
        if (safe) { apply(s, s.humanSeat, safe); return; }
      }
    }
    if (ph.t === 'awaitResponse' && !state.responses[s.humanSeat]) {
      apply(s, s.humanSeat, { type: 'pass' });
      return;
    }
  }

  // AI 行动
  driveAI(s);
}

/** AI 驱动：轮到 AI 或响应窗口内 AI 未提交时决策；摸牌不限速，其余动作受 aiDelayMs 节流 */
function driveAI(s: SoloSession): void {
  const state = s.state;
  if (!state || state.phase.t === 'over') return;
  const ph = state.phase;
  const throttleOk = Date.now() - s.lastAIMoveAt >= s.aiDelayMs;

  if (ph.t === 'awaitDraw' || ph.t === 'awaitDiscard') {
    if (state.current !== s.humanSeat) {
      // 摸牌是无声动作，立即执行；出牌/宣告/杠等限速
      if (ph.t === 'awaitDraw' || throttleOk) {
        const act = aiDecide(state, state.current, mulberry32(s.seed + state.log.length), s.aiLevel);
        apply(s, state.current, act);
      }
    }
    return;
  }
  if (ph.t === 'awaitResponse') {
    if (!throttleOk) return;
    for (let seat = 0; seat < 4; seat++) {
      if (seat === s.humanSeat) continue;
      if (state.eligible[seat] && !state.responses[seat]) {
        // 单机版电脑 = 正常 AI：会胡、会宣告游金（真人长期胜率靠 aiLevel/greed 校准到 50%）
        const act = aiDecide(state, seat, mulberry32(s.seed + seat * 31 + state.log.length), s.aiLevel);
        apply(s, seat, act);
        return; // 每帧最多驱动一个 AI，等下次 tick
      }
    }
  }
}

function apply(s: SoloSession, seat: number, action: GameAction): void {
  const state = s.state;
  if (!state) return;
  try {
    applyAction(state, seat, action);
  } catch (e) {
    // 非法动作（含并发竞态）直接忽略，UI 以最新视图为准
    console.warn('[solo] illegal action', seat, action, e);
    return;
  }
  if (action.type !== 'draw') s.lastAIMoveAt = Date.now(); // 有信息量的动作计时
  if (action.type === 'draw' && state.phase.t === 'awaitDiscard' && state.current === seat) {
    const p = state.players[seat]!;
    s.lastDrawn = p.hand[p.hand.length - 1] ?? null;
  } else if (action.type === 'discard') {
    s.lastDisc = action.tile;
    s.lastDrawn = null; // 刚摸的牌已打出，金边高亮取消
  }
  if (state.log.length > s.logs.length) {
    const newOnes = state.log.slice(s.logs.length);
    s.logs = state.log.slice();
    for (const l of newOnes) playForEvent(l);
  }
  if (state.phase.t === 'over') {
    finishRound(s);
    return;
  }
  sync(s);
}

function finishRound(s: SoloSession): void {
  const state = s.state!;
  const result = state.phase.t === 'over'
    ? (state.phase as { t: 'over'; result: RoundResult }).result
    : null;
  if (result) {
    s.roundResult = result;
    advanceMatch(s.match, result);
  }
  if (s.match.over) {
    s.matchOver = true;
    s.finishedAt = Date.now();
    saveRecord(s);
  }
}

function saveRecord(s: SoloSession): void {
  const scores = s.match.scores;
  const human = scores[s.humanSeat] ?? 0;
  const sorted = [...scores].sort((a, b) => b - a);
  const rank = sorted.indexOf(human) + 1;
  const winCount = s.match.history.filter((r) => r.winner === s.humanSeat).length;
  const entry: RecordEntry = {
    date: new Date().toLocaleString('zh-CN'),
    rounds: s.match.config.rounds,
    score: human,
    winCount,
    rank,
    durationSec: 0,
  };
  try {
    const list = loadRecords();
    list.unshift(entry);
    localStorage.setItem('qz-mj-history', JSON.stringify(list.slice(0, 20)));
  } catch { /* localStorage 不可用时静默 */ }
}

export function loadRecords(): RecordEntry[] {
  try {
    const raw = localStorage.getItem('qz-mj-history');
    return raw ? (JSON.parse(raw) as RecordEntry[]) : [];
  } catch {
    return [];
  }
}

/** 下一局（整场未完时） */
export function nextRound(s: SoloSession): void {
  if (s.match.over) return;
  startRound(s);
}
