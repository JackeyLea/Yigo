/**
 * 斗地主游戏类型定义
 * 遵循需求文档第10章规范
 */

// ==================== 基础类型 ====================

/** 扑克牌花色（包含大小王） */
export type Suit = 'spade' | 'heart' | 'club' | 'diamond' | 'joker';

/** 扑克牌点数 */
export type Rank =
  | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2'
  | 'small_joker' | 'big_joker';

/** 单张扑克牌 */
export interface Card {
  suit: Suit;
  rank: Rank;
  value: number; // 用于排序和比较
}

// ==================== 牌型定义 ====================

/** 单张 */
export interface SingleCombo {
  type: 'single';
  cards: [Card];
}

/** 对子 */
export interface PairCombo {
  type: 'pair';
  cards: [Card, Card];
}

/** 三张 */
export interface TripleCombo {
  type: 'triple';
  cards: [Card, Card, Card];
}

/** 三带一 */
export interface TripleWithSingleCombo {
  type: 'triple_with_single';
  cards: Card[];
}

/** 三带二 */
export interface TripleWithPairCombo {
  type: 'triple_with_pair';
  cards: Card[];
}

/** 顺子（5张及以上连续单张） */
export interface StraightCombo {
  type: 'straight';
  cards: Card[];
}

/** 连对（3对及以上连续对子） */
export interface StraightPairsCombo {
  type: 'straight_pairs';
  cards: Card[];
}

/** 飞机（两组及以上连续三张） */
export interface AirplaneCombo {
  type: 'airplane';
  cards: Card[];
}

/** 炸弹（四张相同点数） */
export interface BombCombo {
  type: 'bomb';
  cards: [Card, Card, Card, Card];
}

/** 火箭（王炸：大小王） */
export interface RocketCombo {
  type: 'rocket';
  cards: Card[];
}

/** 不出（Pass） */
export interface PassCombo {
  type: 'pass';
  cards: [];
}

/** 牌型联合体 */
export type CardCombo =
  | SingleCombo
  | PairCombo
  | TripleCombo
  | TripleWithSingleCombo
  | TripleWithPairCombo
  | StraightCombo
  | StraightPairsCombo
  | AirplaneCombo
  | BombCombo
  | RocketCombo
  | PassCombo;

/** 牌型类型（不含 pass） */
export type CardComboType = Exclude<CardCombo['type'], 'pass'>;

// ==================== 游戏状态 ====================

/** 游戏阶段 */
export type GamePhase = 'deal' | 'bid' | 'play' | 'settle';

/** 斗地主玩家 */
export interface DoudizhuPlayer {
  playerId: string;
  seatIndex: number;
  hand: Card[];
  cardCount: number;
  isLandlord: boolean;
  isReady: boolean;
  bidScore: number | null; // 叫分
}

/** 叫分记录 */
export interface BidRecord {
  playerId: string;
  bid: number | null;
}

/** 游戏结果 */
export type WinnerSide = 'landlord' | 'peasant' | null;

/** 斗地主完整游戏状态 */
export interface DoudizhuState {
  phase: GamePhase;
  players: DoudizhuPlayer[];
  landlordId: string | null;
  currentPlayerId: string;
  lastPlayedCombo: CardCombo | null;
  lastPlayedBy: string | null;
  consecutivePasses: number;
  deck: Card[];
  bidHistory: BidRecord[];
  multiplier: number; // 倍数
  isSpring: boolean; // 是否春天
  round: number;
  gameOver: boolean;
  winner: WinnerSide;
}

// ==================== 游戏事件 ====================

/** 出牌事件 */
export interface PlayEvent {
  type: 'play';
  playerId: string;
  combo: CardCombo;
  remainingCards: number;
}

/** Pass事件 */
export interface PassEvent {
  type: 'pass';
  playerId: string;
}

/** 叫分事件 */
export interface BidEvent {
  type: 'bid';
  playerId: string;
  bid: number | null;
}

/** 确定地主事件 */
export interface LandlordConfirmEvent {
  type: 'landlord_confirm';
  landlordId: string;
  bottomCards: Card[];
}

/** 游戏结束事件 */
export interface GameOverEvent {
  type: 'game_over';
  winner: WinnerSide;
  multiplier: number;
  isSpring: boolean;
  scores: Record<string, number>;
}

/** 游戏事件联合体 */
export type DoudizhuEvent =
  | PlayEvent
  | PassEvent
  | BidEvent
  | LandlordConfirmEvent
  | GameOverEvent;

// ==================== 配置与设置 ====================

/** 游戏难度 */
export type Difficulty = 'easy' | 'medium' | 'hard';

/** AI类型 */
export type AIType = 'rule_based' | 'mcts';

/** 斗地主游戏配置 */
export interface DoudizhuConfig {
  /** 游戏局数限制（0为无限） */
  maxRounds: number;
  /** 初始底分 */
  baseScore: number;
  /** AI难度 */
  aiDifficulty: Difficulty;
  /** AI类型 */
  aiType: AIType;
  /** 是否允许抢地主 */
  enableGrab: boolean;
  /** 是否允许明牌 */
  enableShowCards: boolean;
  /** 出牌超时时间（秒，0为不限制） */
  playTimeout: number;
  /** 叫分超时时间（秒，0为不限制） */
  bidTimeout: number;
}

/** 默认配置 */
export const DEFAULT_DOUDIZHU_CONFIG: DoudizhuConfig = {
  maxRounds: 0,
  baseScore: 1,
  aiDifficulty: 'medium',
  aiType: 'rule_based',
  enableGrab: false,
  enableShowCards: false,
  playTimeout: 30,
  bidTimeout: 15,
};

// ==================== 工具类型 ====================

/** 玩家操作结果 */
export interface ActionResult {
  success: boolean;
  message?: string;
  events?: DoudizhuEvent[];
}

/** 牌型统计（用于AI分析） */
export interface HandAnalysis {
  singles: Card[][];
  pairs: Card[][];
  triples: Card[][];
  bombs: Card[][];
  straights: Card[][];
  straightPairs: Card[][];
  airplanes: Card[][];
  hasRocket: boolean;
  handStrength: number;
}

/** 排行榜条目 */
export interface LeaderboardEntry {
  playerId: string;
  playerName: string;
  gamesPlayed: number;
  gamesWon: number;
  totalScore: number;
  winRate: number;
  lastPlayedAt: string;
}
