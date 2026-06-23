/**
 * 德州扑克类型定义
 * Texas Hold'em Poker Type Definitions
 */

// 花色: 红心、方块、梅花、黑桃
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

// 牌面: 2-A
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

// 扑克牌
export interface Card {
  suit: Suit;
  rank: Rank;
}

// 游戏阶段
export type PokerPhase =
  | 'waiting'     // 等待玩家
  | 'preflop'     // 翻牌前（已发底牌）
  | 'flop'        // 翻牌（3张公共牌）
  | 'turn'        // 转牌（第4张公共牌）
  | 'river'       // 河牌（第5张公共牌）
  | 'showdown'    // 摊牌比牌
  | 'ended';      // 本局结束

// 玩家动作
export type PlayerAction = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

// 玩家信息
export interface PokerPlayer {
  playerId: string;       // 玩家ID
  seatIndex: number;      // 座位号 0-8
  holeCards: Card[];      // 底牌（仅自己可见）
  chips: number;          // 剩余筹码
  currentBet: number;     // 本轮已下注
  totalBet: number;       // 本局总下注
  isActive: boolean;      // 是否仍在局中（未fold）
  isAllIn: boolean;       // 是否已allin
  isDealer: boolean;      // 是否为庄家
  isSmallBlind: boolean;  // 是否小盲
  isBigBlind: boolean;    // 是否大盲
  handRanking?: HandRanking; // 手牌排名（摊牌时计算）
}

// 边池
export interface SidePot {
  amount: number;                    // 边池金额
  eligiblePlayers: string[];         // 有资格争夺此边池的玩家ID
}

// 牌型大小类型（从大到小）
export type HandRankingType =
  | 'royal_flush'      // 皇家同花顺
  | 'straight_flush'   // 同花顺
  | 'four_of_a_kind'   // 四条
  | 'full_house'       // 葫芦
  | 'flush'            // 同花
  | 'straight'         // 顺子
  | 'three_of_a_kind'  // 三条
  | 'two_pair'         // 两对
  | 'one_pair'         // 一对
  | 'high_card';       // 高牌

// 手牌排名
export interface HandRanking {
  type: HandRankingType;
  rank: number;        // 数值越大越好（用于快速比较）
  kickers: number[];   // 踢脚牌值（用于同牌型比较）
}

// 扑克动作记录
export interface PokerAction {
  playerId: string;
  action: PlayerAction;
  amount?: number;
  timestamp: number;
}

// 摊牌结果
export interface ShowdownResult {
  playerId: string;
  holeCards: Card[];
  bestHand: Card[];        // 5张最佳牌
  handRank: HandRanking;
  wonAmount: number;
}

// 游戏状态
export interface PokerState {
  phase: PokerPhase;
  players: PokerPlayer[];
  communityCards: Card[];      // 公共牌
  pot: number;                 // 主池
  sidePots: SidePot[];         // 边池
  currentBet: number;          // 当前轮最高注额
  minRaise: number;            // 最小加注额
  dealerIndex: number;         // 庄家位置
  currentPlayerIndex: number;  // 当前行动玩家
  activePlayerCount: number;   // 活跃玩家数
  deck: Card[];                // 剩余牌堆
  actionHistory: PokerAction[];
  showdownResults?: ShowdownResult[];
  gameOver: boolean;
}

// AI难度
export type AIDifficulty = 'easy' | 'medium' | 'hard';

// AI决策结果
export interface AIDecision {
  action: PlayerAction;
  amount?: number;
}

// 对手风格（用于AI对手建模）
export type OpponentStyle =
  | 'tight-aggressive'
  | 'loose-aggressive'
  | 'tight-passive'
  | 'loose-passive';

// 插件配置
export interface PokerPluginConfig {
  smallBlind: number;
  bigBlind: number;
  maxPlayers: number;
  minPlayers: number;
  buyInMin: number;
  buyInMax: number;
  turnTimeoutMs: number;      // 每轮超时时间
  enableAI: boolean;
  aiDifficulty: AIDifficulty;
}

// 默认配置
export const DEFAULT_POKER_CONFIG: PokerPluginConfig = {
  smallBlind: 10,
  bigBlind: 20,
  maxPlayers: 9,
  minPlayers: 2,
  buyInMin: 500,
  buyInMax: 10000,
  turnTimeoutMs: 30000,
  enableAI: true,
  aiDifficulty: 'medium',
};

// 牌面值到数值的映射（用于比较）
export const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

// 手牌排名数值（越大越好）
export const HAND_RANKING_VALUES: Record<HandRankingType, number> = {
  'royal_flush': 10,
  'straight_flush': 9,
  'four_of_a_kind': 8,
  'full_house': 7,
  'flush': 6,
  'straight': 5,
  'three_of_a_kind': 4,
  'two_pair': 3,
  'one_pair': 2,
  'high_card': 1,
};
