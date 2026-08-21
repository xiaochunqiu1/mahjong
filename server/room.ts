/**
 * 好友房核心逻辑（服务端权威）。
 * 可被 CloudBase 云函数（数据库存储）与本地 mock server（内存存储）复用。
 *
 * 规则约定（与 docs/rules.md 一致）：
 * - 房间码 4 位数字
 * - 1-4 真人 + 电脑补齐；陪打电脑永不胡牌（只作规则约束，不上视觉）
 * - 服务端持有完整 GameState，客户端只能拿到自己的手牌视图（PlayerView 裁剪）
 * - 每个玩家有 token，所有请求校验 token 归属
 * - 轮询同步：客户端 1s 拉一次 poll，比对 version 判断是否变化
 */

import {
  createMatch, advanceMatch, applyAction, legalActions, createRound,
  type GameAction, type GameState, type MatchState, type PlayerState,
} from '../src/engine/index.js';
import { aiDecide } from '../src/game/ai.js';

export const BOT_AI_LEVEL = 0.35; // 陪打电脑水平：明显弱于真人（不胡牌、少碰杠）
export const BOT_GREED = 0.05;
export const BOT_STEP_MS = 2200; // 陪打电脑动作节流：与单机 aiDelayMs 一致，保证三家电脑节奏均匀、不秒响应（真人动作也计时，见 submitAction）
export const RESPONSE_MS = 8_000; // 响应窗口（与单机 controller 对齐）
export const TURN_MS = 30_000;    // 主回合（出牌/摸牌）

export interface SeatPlayer {
  seat: number;
  name: string;
  token: string;
  online: boolean;
  ready: boolean;
  isBot: boolean;
}

export type RoomPhase = 'lobby' | 'playing' | 'over';

export interface RoomState {
  id: string;                 // 4 位数字房间码
  createdAt: number;
  phase: RoomPhase;
  rounds: number; // 局数上限(9999=不限)
  players: (SeatPlayer | null)[]; // 固定 4 座
  hostToken: string;
  version: number;            // 状态版本号（客户端比对）
  lastEvent: string;          // 最近事件文案（toast）
  // 对局部分
  match: MatchState | null;
  state: GameState | null;    // 当前局引擎状态（服务端权威）
  roundNo: number;            // 1-based
  botTickAt: number;          // 上次 bot 行动时间戳
  turnStartedAt: number;      // 当前 phase 开始时间戳（用于客户端倒计时）
  waitingNext: boolean;       // 本局结束等待所有在场真人点"下一局"（避免自动开新局吞掉结算页）
  nextReady: number[];        // 已同意"下一局"的真人座位（全员同意才开新局；退出者自动不计）
  trusted: boolean[];         // 真人托管标记：超时自动托管 → 之后轮到由 AI 代打；真人可点"取消托管"
}

export interface RoomStorage {
  load(id: string): Promise<RoomState | null>;
  save(room: RoomState): Promise<void>;
}

/** 可序列化视图：客户端只看到自己手牌 + 公开信息 */
export interface RoomView {
  roomId: string;
  roomPhase: RoomPhase;      // lobby / playing / over
  version: number;
  lastEvent: string;
  rounds: number;
  roundNo: number;
  dealer: number;
  scores: [number, number, number, number];
  players: {
    seat: number; name: string; online: boolean; ready: boolean; isBot: boolean;
  }[];
  seat: number;                 // 请求者座位（-1 = 未入座）
  // 对局视图（phase=playing 时才有）
  goldKind: number;
  wallCount: number;
  self: { hand: number[]; flowers: number[]; melds: { type: string; kind: number; tiles: number[]; fromSeat?: number }[]; discards: number[]; youjin: 0 | 1 | 2 } | null;
  others: {
    seat: number; handCount: number; flowers: number[]; melds: { type: string; kind: number; tiles: number[]; fromSeat?: number }[]; discards: number[]; youjin: 0 | 1 | 2;
  }[];
  phase: { t: string; discard?: number; from?: number } | null;   // 对局阶段 + 响应阶段出牌 kind / 出牌人座位
  current: number;
  waitingNext: boolean;         // 本局已结算，等待所有在场真人点"下一局"
  nextReady: number[];         // 已同意"下一局"的真人座位
  trusted: boolean[];          // 托管中的座位（AI 代打）
  lastDiscardSeat: number | null;  // 最近出牌人的座位（客户端高亮牌河最后一张；不依赖名字解析）
  botSeatLast: number;              // 上次响应的 bot 座位（响应窗口公平轮转，避免固定 seat 顺序造成某家永远优先）
  yourTurn: boolean;
  canRespond: boolean;          // 响应窗口内本人是否可响应（胡/碰/杠/吃/过）
  legal: GameAction[] | null;   // 仅轮到请求者或可响应时返回合法动作
  deadline: number | null;      // 当前 phase 截止时间戳（客户端罗盘倒计时）
  overResult: {
    winner: number; winType: string; liuju: boolean; delta: [number, number, number, number];
  } | null;
}

export class RoomError extends Error {
  constructor(msg: string) { super(msg); }
}

function genRoomId(storage: RoomStorage, tries = 0): string {
  const id = String(Math.floor(1000 + Math.random() * 9000)); // 1000-9999
  return id; // 冲突由 createRoom 的 storage 层处理（云函数用 doc().create 唯一性）
}

const rand = () => Math.random();

/** 生成 4 位数字房间码（不查重，碰撞时 createRoom 由存储层兜底重试） */
export function newRoomId(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export class RoomManager {
  private botStepMs: number;
  constructor(private storage: RoomStorage, opts?: { botStepMs?: number }) {
    this.botStepMs = opts?.botStepMs ?? BOT_STEP_MS;
  }

  // ---------------- 建房 / 加入 ----------------

  async createRoom(name: string, rounds: number): Promise<{ roomId: string; token: string; view: RoomView }> {
    let roomId = newRoomId();
    let room: RoomState | null = null;
    for (let i = 0; i < 20; i++) {
      roomId = newRoomId();
      const existing = await this.storage.load(roomId);
      if (existing) continue; // 撞码重试
      room = {
        id: roomId,
        createdAt: Date.now(),
        phase: 'lobby',
        rounds,
        players: [null, null, null, null],
        hostToken: '',
        version: 1,
        lastEvent: '',
        match: null,
        state: null,
        roundNo: 0,
        botTickAt: 0,
        turnStartedAt: 0,
        waitingNext: false,
        nextReady: [],
        trusted: [false, false, false, false],
        lastDiscardSeat: null,
        botSeatLast: 3,
      };
      break;
    }
    if (!room) throw new RoomError('房间创建失败，请重试');
    const token = this.newToken(roomId, 0);
    room.hostToken = token;
    room.players[0] = { seat: 0, name: name || '房主', token, online: true, ready: false, isBot: false };
    // 其余三座默认 bot 待机
    for (let s = 1; s < 4; s++) room.players[s] = this.botSeat(s);
    room.lastEvent = `${room.players[0]!.name} 创建了房间 ${roomId}`;
    await this.storage.save(room);
    return { roomId, token, view: this.buildView(room, token) };
  }

  async joinRoom(roomId: string, name: string): Promise<{ token: string; view: RoomView }> {
    const room = await this.mustLoad(roomId);
    if (room.phase !== 'lobby') throw new RoomError('对局已开始，无法加入');
    // 找空真人座（优先替换 bot 座）
    let seat = room.players.findIndex((p) => p === null || p.isBot);
    if (seat < 0) throw new RoomError('房间已满');
    // 重名处理
    const base = name || '牌友';
    let finalName = base;
    let n = 2;
    while (room.players.some((p) => p && !p.isBot && p.name === finalName)) {
      finalName = `${base}${n++}`;
    }
    const token = this.newToken(roomId, seat);
    room.players[seat] = { seat, name: finalName, token, online: true, ready: false, isBot: false };
    room.version++;
    room.lastEvent = `${finalName} 加入房间（${seat + 1} 号位）`;
    await this.storage.save(room);
    return { token, view: this.buildView(room, token) };
  }

  async setReady(roomId: string, token: string, ready: boolean): Promise<RoomView> {
    const room = await this.mustLoad(roomId);
    const p = this.playerByToken(room, token);
    p.ready = ready;
    room.version++;
    if (ready) room.lastEvent = `${p.name} 准备`;
    await this.storage.save(room);
    return this.buildView(room, token);
  }

  async startMatch(roomId: string, token: string): Promise<RoomView> {
    const room = await this.mustLoad(roomId);
    if (room.phase !== 'lobby') throw new RoomError('对局已开始');
    if (room.hostToken !== token) throw new RoomError('只有房主可以开始');
    // 房主点"开始游戏"即视为自动准备（不需要单独点准备）
    const host = room.players.find((p) => p && p.token === token);
    if (host) host.ready = true;
    const humans = room.players.filter((p) => p && !p.isBot);
    if (humans.length < 1) throw new RoomError('需要至少 1 名玩家');
    // 除房主外的真人必须都已准备（房主已在上面自动准备）
    const others = humans.filter((p) => p!.seat !== 0);
    if (others.some((p) => !p!.ready)) throw new RoomError('还有玩家未准备');
    room.phase = 'playing';
    room.roundNo = 1;
    room.match = createMatch(Math.floor(Math.random() * 1e9), room.rounds);
    room.state = this.newRoundState(room);
    room.version++;
    room.lastEvent = '对局开始！';
    room.botTickAt = Date.now();
    room.turnStartedAt = Date.now();
    await this.storage.save(room);
    // 开局后驱动 bot（若庄家是 bot）
    await this.tickBots(room);
    return this.buildView(room, token);
  }

  /** 重新开局（上一局结束后调用 advanceMatch 并开新局） */
  private newRoundState(room: RoomState): GameState {
    // createMatch 生成 MatchState；开局牌用 createRound
    // 复用 controller 的思路：基于 match 开新局
    const seed = Math.floor(Math.random() * 1e9);
    return createRoundState(room.match!, seed, room.match!.dealer);
  }

  // ---------------- 对局动作 ----------------

  async submitAction(roomId: string, token: string, action: GameAction): Promise<RoomView> {
    const room = await this.mustLoad(roomId);
    if (room.phase !== 'playing' || !room.state) throw new RoomError('对局未开始');
    const p = this.playerByToken(room, token);
    const seat = p.seat;
    // 服务端权威校验
    const legal = legalActions(room.state, seat);
    const match = legal.some((l) => JSON.stringify(l) === JSON.stringify(action));
    if (!match) throw new RoomError('动作不合法');
    const beforePhase = room.state.phase.t;
    const prevLogLen = room.state.log.length;
    applyAction(room.state, seat, action);
    // 真人动作也计时（与单机 controller 一致：有信息量的动作重置 AI 节流）——
    // 否则真人出牌后 botTickAt 早已过期，响应窗口第一家 bot 会零延迟"秒响应"
    if (action.type !== 'draw') room.botTickAt = Date.now();
    // 只在阶段切换时重设倒计时（响应阶段每人提交不重置，否则 8s 窗口被不断后移）
    if (room.state.phase.t !== beforePhase) room.turnStartedAt = Date.now();
    // 只广播**公共动作**（出牌/碰/吃/杠/胡/宣告）——摸牌/杠补是各玩家私有手牌，不能广播
    if (action.type !== 'draw') {
      const newLog = room.state.log.slice(prevLogLen);
      const publicLog = newLog.find((l) => /^(出牌|碰|吃|明杠|暗杠|加杠|补花|单游宣告|双游宣告|胡牌|流局|无人响应):/.test(l));
      if (publicLog) {
        room.lastEvent = this.prettyLog(publicLog, room.players);
        room.lastDiscardSeat = this.parseDiscardSeat(publicLog);
      }
    }
    room.version++;
    await this.storage.save(room);
    // 驱动 bot（含响应窗口内未提交的 bot）
    await this.tickBots(room);
    return this.buildView(room, token);
  }

  async resumeSeat(roomId: string, token: string): Promise<RoomView> {
    const room = await this.mustLoad(roomId);
    const p = this.playerByToken(room, token);
    p.online = true;
    p.isBot = false; // 真人回来，夺回控制权
    room.version++;
    await this.storage.save(room);
    return this.buildView(room, token);
  }

  async leaveRoom(roomId: string, token: string): Promise<{ ok: true }> {
    const room = await this.mustLoad(roomId);
    const p = this.playerByToken(room, token);
    if (room.phase === 'lobby') {
      room.players[p.seat] = this.botSeat(p.seat);
      room.version++;
      room.lastEvent = `${p.name} 离开了房间`;
    } else {
      // 对局中离开：座位交给 bot 托管（下一局投票自动不计）
      room.players[p.seat] = { ...this.botSeat(p.seat), online: false };
      room.nextReady = room.nextReady.filter((s) => s !== p.seat);
      room.version++;
      room.lastEvent = `${p.name} 托管离开`;
    }
    await this.storage.save(room);
    return { ok: true };
  }

  /** 轮询：返回视图（客户端比对 version 判断是否有更新） */
  async poll(roomId: string, token?: string): Promise<RoomView> {
    const room = await this.mustLoad(roomId);
    // 每次 poll 都驱动 bot（陪打电脑持续行动）
    if (room.phase === 'playing') await this.tickBots(room);
    return this.buildView(room, token ?? '');
  }

  // ---------------- bot 陪打 ----------------

  private async tickBots(room: RoomState): Promise<void> {
    if (!room.state || room.phase !== 'playing') return;
    while (true) {
      const s = room.state;
      if (s.phase.t === 'over') {
        // 本局结束 → 结算。若已等待房主点"下一局"则不再自动开新局
        if (!room.waitingNext) {
          this.settleRound(room);
          await this.storage.save(room);
        }
        return;
      }
      let didAction = false;
      // 响应窗口：从 botSeatLast 开始找第一个未提交的 bot；行动后 botSeatLast 移到其下一位（round-robin）
      // 公平性：固定从 seat0 开始会让 seat1(右家)永远优先；轮转起点使每轮窗口的"先手"在三家间轮流
      if (s.phase.t === 'awaitResponse') {
        for (let i = 0; i < 4; i++) {
          const seat = (room.botSeatLast + i) % 4;
          if (s.responses[seat] !== null) continue; // 已提交
          const seatP = room.players[seat];
          const isHuman = seatP && !seatP.isBot;
          // 真人：已托管 → AI 代打(同 bot 逻辑,节流)；未托管超时(8s) → 自动托管 + 过
          if (isHuman) {
            if (room.trusted[seat]) {
              if (Date.now() - room.botTickAt < this.botStepMs) break;
              let act: GameAction;
              try { act = this.botDecide(s, seat); } catch { continue; }
              const prevLen2 = s.log.length;
              const beforePhase = s.phase.t;
              applyAction(s, seat, act);
              if (s.phase.t !== beforePhase) room.turnStartedAt = Date.now();
              const newLog2 = s.log.slice(prevLen2);
              const publicLog2 = newLog2.find((l) => /^(出牌|碰|吃|明杠|暗杠|加杠|补花|单游宣告|双游宣告|胡牌|流局|无人响应):/.test(l));
              if (publicLog2) {
                room.lastEvent = this.prettyLog(publicLog2, room.players);
                room.lastDiscardSeat = this.parseDiscardSeat(publicLog2);
              }
              room.botTickAt = Date.now();
              room.botSeatLast = (seat + 1) % 4;
              room.version++;
              didAction = true;
              break;
            }
            if (Date.now() - room.turnStartedAt < RESPONSE_MS) continue;
            room.trusted[seat] = true;
            room.lastEvent = `${seatP!.name} 超时托管`;
            const prevLen = s.log.length;
            applyAction(s, seat, { type: 'pass' });
            room.version++;
            didAction = true;
            room.botTickAt = Date.now();
            break;
          }
          if (Date.now() - room.botTickAt < this.botStepMs) break; // 节流
          let act: GameAction;
          try { act = this.botDecide(s, seat); } catch { continue; }
          const prevLen = s.log.length;
          const beforePhase = s.phase.t;
          applyAction(s, seat, act);
          if (s.phase.t !== beforePhase) room.turnStartedAt = Date.now();
          const newLog = s.log.slice(prevLen);
          const publicLog = newLog.find((l) => /^(出牌|碰|吃|明杠|暗杠|加杠|补花|单游宣告|双游宣告|胡牌|流局|无人响应):/.test(l));
          if (publicLog) {
            room.lastEvent = this.prettyLog(publicLog, room.players);
            room.lastDiscardSeat = this.parseDiscardSeat(publicLog);
          }
          room.botTickAt = Date.now();
          room.botSeatLast = (seat + 1) % 4; // 下一轮从下一位开始，先手轮流
          room.version++;
          didAction = true;
          break; // 每 tick 只动一个 bot（配合节流）
        }
      } else {
        const cur = s.current;
        const seatP = room.players[cur];
        const isBot = !seatP || seatP.isBot;
        if (!isBot) {
          // 真人：已托管 → AI 代打(摸牌立即,出牌节流)；未托管超时(30s) → 自动托管 + 代打一次
          if (room.trusted[cur]) {
            if (s.phase.t === 'awaitDiscard' && Date.now() - room.botTickAt < this.botStepMs) break;
            let act: GameAction;
            try { act = this.botDecide(s, cur); } catch { break; }
            const prevLen = s.log.length;
            const beforePhase = s.phase.t;
            applyAction(s, cur, act);
            if (s.phase.t !== beforePhase) room.turnStartedAt = Date.now();
            const newLog = s.log.slice(prevLen);
            const publicLog = newLog.find((l) => /^(出牌|碰|吃|明杠|暗杠|加杠|补花|单游宣告|双游宣告|胡牌|流局|无人响应):/.test(l));
            if (publicLog) {
              room.lastEvent = this.prettyLog(publicLog, room.players);
              room.lastDiscardSeat = this.parseDiscardSeat(publicLog);
            }
            room.botTickAt = Date.now();
            room.version++;
            didAction = true;
          } else {
            if (Date.now() - room.turnStartedAt < TURN_MS) break;
            room.trusted[cur] = true;
            room.lastEvent = `${seatP!.name} 超时托管`;
            let act: GameAction;
            try { act = this.humanTimeoutAct(s, cur); } catch { break; }
            const prevLen = s.log.length;
            const beforePhase = s.phase.t;
            applyAction(s, cur, act);
            if (s.phase.t !== beforePhase) room.turnStartedAt = Date.now();
            const newLog = s.log.slice(prevLen);
            const publicLog = newLog.find((l) => /^(出牌|碰|吃|明杠|暗杠|加杠|补花|单游宣告|双游宣告|胡牌|流局|无人响应):/.test(l));
            if (publicLog) {
              room.lastEvent = this.prettyLog(publicLog, room.players);
              room.lastDiscardSeat = this.parseDiscardSeat(publicLog);
            }
            room.botTickAt = Date.now();
            room.version++;
            didAction = true;
          }
        } else {
          // 摸牌（awaitDraw）立即执行（与单机 controller 一致：draw 不节流）；出牌/宣告等其余动作节流 botStepMs
          // 之前摸牌也节流 → 好友房每个 bot 回合 2 个节流（用户观察到"31-30-31-30"两个倒计时），比单机慢一倍
          if (s.phase.t === 'awaitDiscard' && Date.now() - room.botTickAt < this.botStepMs) break;
          let act: GameAction;
          try {
            act = this.botDecide(s, cur);
          } catch {
            break; // 无合法动作，等下一步
          }
          const prevLen = s.log.length;
          const beforePhase = s.phase.t;
          applyAction(s, cur, act);
          if (s.phase.t !== beforePhase) room.turnStartedAt = Date.now();
          const newLog = s.log.slice(prevLen);
          const publicLog = newLog.find((l) => /^(出牌|碰|吃|明杠|暗杠|加杠|补花|单游宣告|双游宣告|胡牌|流局|无人响应):/.test(l));
          if (publicLog) {
            room.lastEvent = this.prettyLog(publicLog, room.players);
            room.lastDiscardSeat = this.parseDiscardSeat(publicLog);
          }
          // 与单机 controller 一致：摸牌(draw)不计时，只有出牌/宣告等有信息量动作才计时 → 每回合恰好 1 个节流
          if (act.type !== 'draw') room.botTickAt = Date.now();
          room.version++;
          didAction = true;
        }
      }
      if (!didAction) break; // 没动（真人等待 / 节流 / 无动作）→ 等下次 poll 触发
      // 每次 bot 动作后立刻 save（否则下次 poll 拿到旧 state，bot 重复出同一张牌）
      await this.storage.save(room);
      // 响应窗口且还有 bot 可响应 → 继续（直到响应结束或转真人）
      if (s.phase.t === 'awaitResponse') continue;
      break; // 出牌阶段每次只动一次
    }
  }

  /** 真人主回合超时兜底：优先打出刚摸的牌，否则打第一张可出的牌 */
  private humanTimeoutAct(state: GameState, seat: number): GameAction {
    const acts = legalActions(state, seat);
    const plain = acts.find((a) => a.type === 'discard' && !a.declare);
    if (plain) return plain;
    return acts[0]!;
  }

  /** 陪打 bot 决策：可碰/吃/杠/出牌，永不胡（"陪打电脑永不胡牌"用户红线） */
  private botDecide(state: GameState, seat: number): GameAction {
    const acts = legalActions(state, seat);
    if (acts.length === 0) throw new Error('no legal');
    const ph = state.phase;
    if (ph.t === 'awaitDraw') return { type: 'draw' };
    // 响应窗口：用 AI 评估碰/吃/杠（向听放宽 +2），但永不胡
    if (ph.t === 'awaitResponse') {
      const nonHu = acts.filter((a) => a.type !== 'hu');
      if (nonHu.length === 0) return { type: 'pass' };
      let act: GameAction;
      try {
        act = aiDecide(state, seat, rand, BOT_AI_LEVEL, BOT_GREED);
      } catch {
        // AI 抛错则退化为第一个非胡动作（通常 pass）
        act = nonHu[0]!;
      }
      // 强制不胡、不宣告游金
      if (act.type === 'hu') act = { type: 'pass' };
      if (act.type === 'discard' && act.declare) {
        const plain = nonHu.find((a) => a.type === 'discard' && !a.declare);
        act = plain ?? { type: 'pass' };
      }
      return act;
    }
    // 出牌阶段：直接 AI 决策，但过滤胡 / 宣告
    let act: GameAction;
    try {
      act = aiDecide(state, seat, rand, BOT_AI_LEVEL, BOT_GREED);
    } catch {
      const discards = acts.filter((a) => a.type === 'discard' && !a.declare);
      act = discards[0] ?? acts[0]!;
    }
    if (act.type === 'hu' || (act.type === 'discard' && act.declare)) {
      const plain = acts.find((a) => a.type === 'discard' && !a.declare);
      return plain ?? { type: 'pass' };
    }
    return act;
  }

  /** 结算本局：推进整场积分；不自动开新局（等房主点"下一局"），保证客户端能看到结算页 */
  private settleRound(room: RoomState): void {
    if (!room.state || !room.match) return;
    const res = (room.state.phase as { t: 'over'; result: import('../src/engine/index.js').RoundResult }).result;
    advanceMatch(room.match, res);
    room.waitingNext = true;
    if (room.match.over) {
      room.phase = 'over';
      room.lastEvent = '整场结束';
    }
  }

  /** 真人点"下一局"（全员同意才开新局；退出者自动不计——2026-08-21 用户要求） */
  async nextRound(roomId: string, token: string): Promise<RoomView> {
    const room = await this.mustLoad(roomId);
    if (room.phase !== 'playing' || !room.waitingNext) throw new RoomError('当前不在等待下一局的状态');
    const p = this.playerByToken(room, token);
    if (p.isBot) throw new RoomError('电脑不用点下一局');
    if (!room.nextReady.includes(p.seat)) room.nextReady.push(p.seat);
    // 所有【在场真人】（未退出的真人玩家）都已同意 → 开新局
    const humans = room.players.filter((x) => x && !x.isBot).map((x) => x.seat);
    if (humans.length > 0 && humans.every((s) => room.nextReady.includes(s))) {
      room.roundNo++;
      room.state = createRoundState(room.match!, Math.floor(Math.random() * 1e9), room.match!.dealer);
      room.botTickAt = Date.now();
      room.turnStartedAt = Date.now();
      room.waitingNext = false;
      room.nextReady = [];
      room.version++;
      room.lastEvent = `第 ${room.roundNo} 局开始`;
      await this.storage.save(room);
      await this.tickBots(room);
      return this.buildView(room, token);
    }
    room.version++;
    room.lastEvent = `${p.name} 已同意开始下一局`;
    await this.storage.save(room);
    return this.buildView(room, token);
  }

  /** 真人取消托管：恢复自己操作（托管后轮到由 AI 代打） */
  async untrust(roomId: string, token: string): Promise<RoomView> {
    const room = await this.mustLoad(roomId);
    const p = this.playerByToken(room, token);
    if (p.isBot) throw new RoomError('电脑无需取消托管');
    if (room.trusted[p.seat]) {
      room.trusted[p.seat] = false;
      room.version++;
      room.lastEvent = `${p.name} 取消托管`;
      await this.storage.save(room);
    }
    return this.buildView(room, token);
  }

  // ---------------- 视图构建 ----------------

  buildView(room: RoomState, token: string): RoomView {
    const p = room.players.find((pp) => pp && pp.token === token) ?? null;
    const seat = p?.seat ?? -1;
    const s = room.state;
    const view: RoomView = {
      roomId: room.id,
      roomPhase: room.phase,
      version: room.version,
      lastEvent: room.lastEvent,
      rounds: room.rounds,
      roundNo: room.roundNo,
      dealer: room.match?.dealer ?? 0,
      scores: room.match?.scores ?? [0, 0, 0, 0],
      players: room.players.map((pp) => ({
        seat: pp!.seat, name: pp!.name, online: pp!.online, ready: pp!.ready, isBot: pp!.isBot,
      })),
      seat,
      goldKind: 0,
      wallCount: 0,
      self: null,
      others: [],
      phase: null,
      current: 0,
      waitingNext: false,
      nextReady: room.nextReady ?? [],
      trusted: room.trusted ?? [false, false, false, false],
      yourTurn: false,
      canRespond: false,
      legal: null,
      deadline: null,
      overResult: null,
    };
    if (!s || !room.match) return view;
    const goldKind = s.goldKind;
    view.goldKind = goldKind;
    view.wallCount = s.wall.length;
    view.phase = { t: s.phase.t, discard: (s.phase as any).discard, from: (s.phase as any).from };
    view.current = s.current;
    view.waitingNext = room.waitingNext;
    view.lastDiscardSeat = room.lastDiscardSeat;
    view.yourTurn = seat >= 0 && s.current === seat;
    view.canRespond = seat >= 0 && s.phase.t === 'awaitResponse'
      && !!s.eligible[seat] && s.responses[seat] === null;
    // lastEvent 严格只用最近一次公共动作——重算整个 log 找最近的公共事件，不依赖 room.lastEvent（避免摸牌泄漏）
    {
      const publicRe = /^(出牌|碰|吃|明杠|暗杠|加杠|补花|单游宣告|双游宣告|胡牌|流局|无人响应):/;
      let lastPublic = '';
      const logs = s.log;
      for (let i = logs.length - 1; i >= 0; i--) {
        const l = logs[i]!;
        if (publicRe.test(l)) { lastPublic = l; break; }
      }
      view.lastEvent = lastPublic ? this.prettyLog(lastPublic, room.players) : '';
    }
    // 倒计时：awaitResponse 8s，出牌/摸牌 30s（与单机 TURN_MS/RESPONSE_MS 对齐）
    if (s.phase.t === 'awaitResponse') view.deadline = room.turnStartedAt + 8_000;
    else if (s.phase.t === 'awaitDiscard' || s.phase.t === 'awaitDraw') view.deadline = room.turnStartedAt + 30_000;
    const stripMeld = (m: { type: string; kind: number; tiles: number[]; fromSeat?: number }) => ({ type: m.type, kind: m.kind, tiles: m.tiles, fromSeat: m.fromSeat });
    // 名字/isBot 从座位玩家(room.players)取——引擎 PlayerState 无 name 字段(修复联机玩家名显示"家")
    view.others = s.players.map((opp: PlayerState, i: number) => ({
      seat: i,
      name: room.players[i]?.name ?? '',
      isBot: room.players[i]?.isBot ?? true,
      handCount: i === seat ? 0 : opp.hand.length,
      flowers: opp.flowers,
      melds: opp.melds.map(stripMeld),
      discards: opp.discards,
      youjin: opp.youjin,
    })).filter((o) => o.seat !== seat);
    if (seat >= 0) {
      const me = s.players[seat]!;
      view.self = { hand: me.hand, flowers: me.flowers, melds: me.melds.map(stripMeld), discards: me.discards, youjin: me.youjin };
      if (view.yourTurn || view.canRespond) view.legal = legalActions(s, seat);
    }
    if (s.phase.t === 'over') {
      view.overResult = {
        winner: s.phase.result.winner,
        winType: s.phase.result.score.winType,
        liuju: s.phase.result.liuju,
        delta: s.phase.result.score.delta,
      };
    }
    return view;
  }

  // ---------------- 工具 ----------------

  /** TRTC 语音：校验 token 合法性，返回该玩家的座位与房间号（开麦签名用，纯新增不影响对局逻辑） */
  async resolveVoice(roomId: string, token: string): Promise<{ seat: number; roomId: string }> {
    const room = await this.mustLoad(roomId);
    const p = this.playerByToken(room, token);
    return { seat: p.seat, roomId: room.id };
  }


  private newToken(roomId: string, seat: number): string {
    return `${roomId}-${seat}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private botSeat(seat: number): SeatPlayer {
    return {
      seat,
      name: ['小美', '阿强', '阿珍'][seat - 1] ?? `电脑${seat + 1}`,
      token: `bot-${seat}`,
      online: true,
      ready: true, // bot 总是已准备
      isBot: true,
    };
  }

  private playerByToken(room: RoomState, token: string): SeatPlayer {
    const p = room.players.find((pp) => pp && pp.token === token);
    if (!p) throw new RoomError('身份校验失败');
    return p;
  }

  private async mustLoad(roomId: string): Promise<RoomState> {
    const room = await this.storage.load(roomId);
    if (!room) throw new RoomError('房间不存在');
    return room;
  }

  /** 解析"出牌:seatN:kind" → N（其他动作返回 null）—— 客户端牌河高亮用 */
  private parseDiscardSeat(l: string): number | null {
    const m = l.match(/^出牌:seat([0-3]):/);
    return m ? Number(m[1]) : null;
  }

  /** 引擎日志 → 可读文案（复用 controller 的 prettyLog 思路） */
  private prettyLog(l: string, players: (SeatPlayer | null)[]): string {
    const names = players.map((p) => (p ? p.name : '?'));
    let s = l.replace(/seat([0-3])/g, (_, n: string) => names[Number(n)] ?? '家');
    s = s
      .replace(/^开金:/, '开金：')
      .replace(/^补花:([^:]+):/, '补花：$1 ')
      .replace(/^摸牌:([^:]+):/, '$1 摸 ')
      .replace(/^出牌:([^:]+):/, '$1 打出 ')
      .replace(/^暗杠:([^:]+):/, '$1 暗杠 ')
      .replace(/^加杠:([^:]+):/, '$1 加杠 ')
      .replace(/^明杠:([^:]+):/, '$1 杠 ')
      .replace(/^碰:([^:]+):/, '$1 碰 ')
      .replace(/^吃:([^:]+):/, '$1 吃 ')
      .replace(/^杠补:([^:]+):/, '$1 补牌 ')
      .replace(/^单游宣告:([^:]+):/, '$1 单游！打 ')
      .replace(/^双游宣告:([^:]+):/, '$1 双游！打 ')
      .replace(/^胡牌:([^:]+):([^:]+):/, (_, n: string, wt: string) => `${n} ${WIN_TYPE_CN[wt] ?? wt} `)
      .replace(/^流局$/, '流局')
      .replace(/^无人响应:/, '无人响应 ');
    return s;
  }
}

const WIN_TYPE_CN: Record<string, string> = {
  ron: '点炮胡', zimo: '自摸', danyou: '单游自摸', shuangyou: '双游自摸', sanyou: '三游自摸',
};

/** 基于 match 开局（对齐 controller.createSession 逻辑） */
export function createRoundState(match: MatchState, seed: number, dealer: number): GameState {
  return createRound(seed, dealer, { rounds: match.config.rounds, liujuFloor: 16 });
}

export { createRound };
