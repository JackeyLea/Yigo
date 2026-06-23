/**
 * 麻将插件 - 类型定义
 * Mahjong Plugin - Type Definitions
 */

/** 花色：万/筒/条/字 */
export type Suit = 'wan' | 'tong' | 'tiao' | 'zi';

/** 字牌牌面：东南西北中发白 */
export type ZiRank = 'dong' | 'nan' | 'xi' | 'bei' | 'zhong' | 'fa' | 'bai';

/** 牌面：1-9 或字牌 */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | ZiRank;

/** 宝牌类型 */
export type DoraType = 'normal' | 'hidden' | 'ura';

/** 一张麻将牌 */
export interface Tile {
  suit: Suit;
  rank: number | string;
  uniqueId: string; // 全局唯一ID（如"wan5_0"表示第一张5万）
}

/** 副露类型 */
export type MeldType = 'chow' | 'pong' | 'kong' | 'concealed_kong' | 'added_kong';

/** 副露（鸣牌） */
export interface Meld {
  type: MeldType;
  tiles: Tile[];
  fromPlayer: number; // 来自哪个玩家（-1=自己）
}

/** 游戏阶段 */
export type GamePhase = 'deal' | 'draw' | 'discard' | 'respond' | 'win' | 'exhaust' | 'ended';

/** 响应类型 */
export type ResponseType = 'chow' | 'pong' | 'kong' | 'ron' | 'pass';

/** 和牌结果 */
export interface MahjongWinResult {
  playerId: string;
  hand: string[];    // 胡牌牌型列表
  fan: number;       // 番数
  fu: number;        // 符数
  score: number;     // 得分
  isDealer: boolean;
  isTsumo: boolean;  // 自摸/荣胡
  yaku: string[];    // 役种列表
}

/** 麻将玩家 */
export interface MahjongPlayer {
  playerId: string;
  seatIndex: number;
  hand: Tile[];        // 手牌
  melds: Meld[];       // 副露
  discardPile: Tile[]; // 弃牌
  isRiichi: boolean;
  isTenpai: boolean;   // 是否听牌
  isFuriten: boolean;  // 是否振听
  score: number;       // 点数
  isDealer: boolean;
  isAI: boolean;
}

/** 麻将游戏状态 */
export interface MahjongState {
  phase: GamePhase;
  players: MahjongPlayer[];
  wall: Tile[];              // 牌山
  deadWall: Tile[];          // 王牌（岭上牌+宝牌指示）
  doraIndicator: Tile[];     // 宝牌指示牌
  doraTiles: Tile[];         // 宝牌
  discardPiles: Tile[][];    // 各玩家弃牌（4列）
  currentPlayerIndex: number;
  currentTile: Tile | null;   // 当前摸的牌
  lastDiscard: Tile | null;  // 最后打的牌
  lastDiscardPlayer: number;
  roundWind: number;         // 场风（0=东,1=南,2=西,3=北）
  honba: number;             // 本场数
  riichiSticks: number;      // 立直棒数
  gameOver: boolean;
  winners: MahjongWinResult[];
}

/** 麻将引擎配置 */
export interface MahjongEngineConfig {
  tileSetSize: 136 | 144;    // 136张（无花牌）或 144张（有花牌）
  enableDora: boolean;       // 是否启用宝牌
  enableRiichi: boolean;     // 是否启用立直
  initialScore: number;      // 初始点数
  enableKuitan: boolean;     // 是否启用食断（副露后断幺九可役）
}

/** 默认引擎配置 */
export const DEFAULT_ENGINE_CONFIG: MahjongEngineConfig = {
  tileSetSize: 136,
  enableDora: true,
  enableRiichi: true,
  initialScore: 25000,
  enableKuitan: true,
};

/** AI 难度 */
export type AIDifficulty = 'easy' | 'medium' | 'hard';

/** 麻将游戏设置 */
export interface MahjongSettings {
  playerCount: number;       // 玩家数（通常为4）
  aiDifficulty: AIDifficulty;
  engineConfig: MahjongEngineConfig;
  timeLimit: number;         // 每步时间限制（秒）
  enableHints: boolean;      // 是否启用提示
}

/** 默认游戏设置 */
export const DEFAULT_SETTINGS: MahjongSettings = {
  playerCount: 4,
  aiDifficulty: 'medium',
  engineConfig: DEFAULT_ENGINE_CONFIG,
  timeLimit: 30,
  enableHints: true,
};

/** 向听数计算结果 */
export interface ShantenResult {
  shanten: number;           // 向听数（-1=已和牌，0=听牌）
  waits: Tile[];             // 待牌
  efficiency: number;        // 有效牌枚数
}

/** 役种定义 */
export interface Yaku {
  name: string;
  nameJp: string;
  fan: number;               // 番数
  isYakuman: boolean;        // 是否为役满
  condition: (hand: Tile[], winTile: Tile, context: YakuContext) => boolean;
}

/** 役种判定上下文 */
export interface YakuContext {
  isTsumo: boolean;
  isDealer: boolean;
  isRiichi: boolean;
  roundWind: number;
  seatWind: number;
  doraTiles: Tile[];
  melds: Meld[];
  isFuriten: boolean;
}

/** 牌组工具函数 */
export const TileUtils = {
  /** 比较两张牌是否相同（忽略 uniqueId） */
  equals(a: Tile, b: Tile): boolean {
    return a.suit === b.suit && a.rank === b.rank;
  },

  /** 获取牌的字面表示 */
  toString(tile: Tile): string {
    const suitMap: Record<Suit, string> = {
      wan: '万',
      tong: '筒',
      tiao: '条',
      zi: '',
    };
    const ziMap: Record<string, string> = {
      dong: '东',
      nan: '南',
      xi: '西',
      bei: '北',
      zhong: '中',
      fa: '发',
      bai: '白',
    };
    if (tile.suit === 'zi') {
      return ziMap[String(tile.rank)] + suitMap[tile.suit];
    }
    return tile.rank + suitMap[tile.suit];
  },

  /** 是否为字牌 */
  isHonor(tile: Tile): boolean {
    return tile.suit === 'zi';
  },

  /** 是否为风牌 */
  isWind(tile: Tile): boolean {
    return tile.suit === 'zi' && ['dong', 'nan', 'xi', 'bei'].includes(String(tile.rank));
  },

  /** 是否为三元牌 */
  isDragon(tile: Tile): boolean {
    return tile.suit === 'zi' && ['zhong', 'fa', 'bai'].includes(String(tile.rank));
  },

  /** 是否为幺九牌（1、9、字牌） */
  isTerminalOrHonor(tile: Tile): boolean {
    if (tile.suit === 'zi') return true;
    const r = typeof tile.rank === 'number' ? tile.rank : parseInt(tile.rank);
    return r === 1 || r === 9;
  },

  /** 是否为中张牌（2-8） */
  isSimple(tile: Tile): boolean {
    if (tile.suit === 'zi') return false;
    const r = typeof tile.rank === 'number' ? tile.rank : parseInt(tile.rank);
    return r >= 2 && r <= 8;
  },

  /** 复制一张牌（生成新 uniqueId） */
  clone(tile: Tile, newId?: string): Tile {
    return {
      suit: tile.suit,
      rank: tile.rank,
      uniqueId: newId || tile.uniqueId,
    };
  },

  /** 创建一副136张的标准牌组 */
  createStandardDeck(): Tile[] {
    const tiles: Tile[] = [];
    const suits: Suit[] = ['wan', 'tong', 'tiao'];
    const ziRanks: ZiRank[] = ['dong', 'nan', 'xi', 'bei', 'zhong', 'fa', 'bai'];

    // 数牌（万、筒、条）：各1-9，每种4张
    for (const suit of suits) {
      for (let rank = 1; rank <= 9; rank++) {
        for (let copy = 0; copy < 4; copy++) {
          tiles.push({
            suit,
            rank,
            uniqueId: `${suit}${rank}_${copy}`,
          });
        }
      }
    }

    // 字牌（东南西北中发白）：每种4张
    for (const rank of ziRanks) {
      for (let copy = 0; copy < 4; copy++) {
        tiles.push({
          suit: 'zi',
          rank,
          uniqueId: `zi${rank}_${copy}`,
        });
      }
    }

    return tiles;
  },

  /** 获取下一张牌（用于宝牌计算） */
  getNextTile(tile: Tile): Tile | null {
    if (tile.suit === 'zi') {
      const ziRanks: ZiRank[] = ['dong', 'nan', 'xi', 'bei', 'zhong', 'fa', 'bai'];
      const idx = ziRanks.indexOf(tile.rank as ZiRank);
      if (idx >= 0 && idx < ziRanks.length - 1) {
        return {
          suit: 'zi',
          rank: ziRanks[idx + 1],
          uniqueId: `next_${tile.uniqueId}`,
        };
      }
      // 循环：北风->东风，白板->红中
      return {
        suit: 'zi',
        rank: ziRanks[0],
        uniqueId: `next_${tile.uniqueId}`,
      };
    }
    const r = typeof tile.rank === 'number' ? tile.rank : parseInt(tile.rank);
    if (r >= 1 && r < 9) {
      return {
        suit: tile.suit,
        rank: r + 1,
        uniqueId: `next_${tile.uniqueId}`,
      };
    }
    return null;
  },

  /** 排序手牌 */
  sortHand(hand: Tile[]): Tile[] {
    const suitOrder: Record<Suit, number> = { wan: 0, tong: 1, tiao: 2, zi: 3 };
    const ziOrder: Record<string, number> = {
      dong: 0, nan: 1, xi: 2, bei: 3, zhong: 4, fa: 5, bai: 6,
    };

    return [...hand].sort((a, b) => {
      const suitDiff = suitOrder[a.suit] - suitOrder[b.suit];
      if (suitDiff !== 0) return suitDiff;

      if (a.suit === 'zi' && b.suit === 'zi') {
        return ziOrder[String(a.rank)] - ziOrder[String(b.rank)];
      }

      const aRank = typeof a.rank === 'number' ? a.rank : parseInt(a.rank);
      const bRank = typeof b.rank === 'number' ? b.rank : parseInt(b.rank);
      return aRank - bRank;
    });
  },
};
