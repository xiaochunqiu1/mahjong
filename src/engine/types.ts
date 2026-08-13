/**
 * 核心类型（与设计文档第 4 节对齐）。
 * Tile 用实例 id（0..143）表示，kind 用 tiles.ts 的编码表示。
 */

export type Tile = number; // 实例 id 0..143
export type Flower = number; // 花牌 kind 34..41

export type MeldType = 'chi' | 'peng' | 'mingGang' | 'anGang' | 'jiaGang';

export interface Meld {
  type: MeldType;
  kind: number; // 碰/杠的 kind；吃为顺子最小 kind
  tiles: number[]; // 组成的 kind 列表（含来自牌河的那张）
  fromSeat?: number; // 吃/碰/明杠的来源座位
}

export type YoujinStage = 0 | 1 | 2; // 0 无，1 单游，2 双游（三游为即时胡牌，不是驻留状态）

export interface PlayerState {
  seat: number;
  hand: Tile[]; // 暗手（实例 id）
  flowers: Flower[];
  melds: Meld[];
  discards: number[]; // 牌河（kind）
  youjin: YoujinStage;
}

export interface RuleConfig {
  rounds: 4 | 8;
  liujuFloor: number; // 牌墙剩余此数量时流局，本项目 = 16
}

export interface RoomConfig {
  roomCode: string;
  rounds: 4 | 8;
  hostSeat: number;
}

export type WinType = 'ron' | 'zimo' | 'danyou' | 'shuangyou' | 'sanyou';

export interface ScoreEvent {
  winType: WinType | 'liuju';
  winner: number; // -1 表示流局
  loser?: number; // 点炮者
  delta: [number, number, number, number];
}

export interface RoundResult {
  score: ScoreEvent;
  winner: number;
  liuju: boolean;
}

export type Phase =
  | { t: 'awaitDraw' }
  | { t: 'awaitDiscard' }
  | { t: 'awaitResponse'; discard: number; from: number }
  | { t: 'over'; result: RoundResult };

export type GameAction =
  | { type: 'draw' }
  | { type: 'discard'; tile: Tile; declare?: 'danyou' | 'shuangyou' }
  | { type: 'hu' }
  | { type: 'anGang'; kind: number }
  | { type: 'jiaGang'; kind: number }
  | { type: 'peng' }
  | { type: 'gang' } // 明杠（响应）
  | { type: 'chi'; useKinds: [number, number] } // 指定用哪两张吃（处理多种吃法）
  | { type: 'pass' };

export interface GameState {
  wall: Tile[]; // 头部为摸牌端，尾部为补花/杠补端
  goldKind: number;
  goldIndicator: Tile; // 翻出的金牌：从牌墙移除作指示物，不可被摸到（同种其余 3 张仍在局中为金）
  players: [PlayerState, PlayerState, PlayerState, PlayerState];
  dealer: number;
  current: number; // 当前回合座位（响应阶段为出牌者）
  phase: Phase;
  responses: (GameAction | null)[]; // awaitResponse 时各座位已提交响应（null=未提交）
  eligible: boolean[]; // awaitResponse 时各座位是否有资格响应
  shuangyouSeat: number; // -1 表示无双游
  config: RuleConfig;
  log: string[]; // 事件日志（测试与回放用）
}

export interface MatchState {
  config: RuleConfig;
  roundNo: number; // 1-based，当前局
  dealer: number;
  scores: [number, number, number, number];
  history: RoundResult[];
  over: boolean;
  seed: number;
}

export interface MatchResult {
  scores: [number, number, number, number];
  rounds: RoundResult[];
}

/** 玩家视图：客户端只能看到的服务端裁剪结果（联机阶段使用） */
export interface PlayerView {
  seat: number;
  goldKind: number;
  wallCount: number;
  self: PlayerState;
  others: { seat: number; handCount: number; flowers: Flower[]; melds: Meld[]; discards: number[]; youjin: YoujinStage }[];
  phase: Phase;
  dealer: number;
  current: number;
}
