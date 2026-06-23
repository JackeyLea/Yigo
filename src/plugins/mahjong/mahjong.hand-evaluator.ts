/**
 * 麻将插件 - 胡牌判定器
 * Mahjong Plugin - Hand Evaluator
 *
 * 实现核心胡牌判定逻辑，包括：
 * - 平胡（四面子+一对将）
 * - 七对子
 * - 国士无双（十三幺）
 * - 全不靠/十三不靠
 * - 清一色
 * - 番数/符数计算
 * - 役种判定
 */

import { Tile, Suit, Meld, ZiRank, YakuContext } from './mahjong.types';
import { TileUtils } from './mahjong.types';

/** 手牌分解中的面子/雀头 */
interface Group {
  type: 'pair' | 'triplet' | 'sequence';
  tiles: Tile[];
}

/** 胡牌判定结果 */
export interface WinEvaluation {
  handTypes: string[];  // 役种列表
  fan: number;          // 总番数
  fu: number;           // 总符数
  isYakuman: boolean;   // 是否为役满
  groups: Group[];      // 手牌分解
}

/** 标准役种名称 */
export const YAKU_NAMES = {
  // 1番
  RIICHI: 'riichi',
  IPPATSU: 'ippatsu',
  FULLY_OUTSIDE_HAND: 'chanta',
  PURE_DOUBLE_SEQUENCE: 'iipeikou',
  ALL_SIMPLES: 'tanyao',
  DORA: 'dora',
  RED_FIVE: 'aka_dora',
  PREVAILING_WIND: 'bakaze',
  SEAT_WIND: 'jikaze',
  WHITE_DRAGON: 'haku',
  GREEN_DRAGON: 'hatsu',
  RED_DRAGON: 'chun',
  AFTER_A_KAN: 'rinshan',
  UNDER_THE_RIVER: 'haitei',
  UNDER_THE_SEA: 'houtei',
  DOUBLE_RIICHI: 'daburu_riichi',

  // 2番
  SEVEN_PAIRS: 'chiitoitsu',
  ALL_TRIPLET_HAND: 'toitoi',
  THREE_KANS: 'sankantsu',
  THREE_CONCEALED_TRIPLETS: 'sanankou',
  THREE_COLOR_TRIPLETS: 'sanshoku_douko',
  THREE_COLOR_SEQUENCES: 'sanshoku',
  PURE_STRAIGHT: 'ikkitsuukan',
  MIXED_OUTSIDE_HAND: 'honchantai',
  ALL_TERM_AND_HONOR: 'honroutou',
  HALF_FLUSH: 'honitsu',

  // 3番
  TWICE_PURE_DOUBLE_SEQUENCE: 'ryanpeikou',
  FULL_FLUSH: 'chinitsu',

  // 6番
  HANEMAN_BASE: 'haneman',

  // 役满
  THIRTEEN_ORPHANS: 'kokushi',
  FOUR_CONCEALED_TRIPLETS: 'suuankou',
  BIG_THREE_DRAGONS: 'daisangen',
  LITTLE_FOUR_WINDS: 'shousuushii',
  BIG_FOUR_WINDS: 'daisuushii',
  ALL_HONORS: 'tsuuiisou',
  ALL_GREEN: 'ryuuiisou',
  NINE_GATES: 'chuurenpoutou',
  FOUR_KANS: 'suukantsu',
  NINE_TERMINAL_INITIAL_DRAW: 'kyuushu_kyuuhai',
};

export class HandEvaluator {

  // ==================== 核心胡牌判定 ====================

  /**
   * 检查手牌是否可以胡牌
   * 支持标准平胡、七对子、国士无双
   */
  static canWin(hand: Tile[], winTile?: Tile): boolean {
    const fullHand = winTile ? [...hand, winTile] : [...hand];
    if (fullHand.length !== 14 && fullHand.length !== 2) return false;

    // 国士无双
    if (this.isThirteenOrphans(fullHand)) return true;

    // 七对子
    if (this.isSevenPairs(fullHand)) return true;

    // 标准平胡（四面子+一对将）
    return this.canFormStandardHand(fullHand);
  }

  /**
   * 标准手牌判定：4面子 + 1雀头
   */
  static canFormStandardHand(hand: Tile[]): boolean {
    if (hand.length !== 14) return false;

    // 构建计数映射
    const counts = this.buildCountMap(hand);

    // 尝试每种牌作为雀头
    for (const [key, count] of counts.entries()) {
      if (count >= 2) {
        // 尝试作为雀头
        const remaining = new Map(counts);
        remaining.set(key, count - 2);
        if (remaining.get(key) === 0) remaining.delete(key);

        if (this.canForm4Groups(remaining)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 判断剩余牌能否形成4个面子
   */
  private static canForm4Groups(counts: Map<string, number>): boolean {
    if (counts.size === 0) return true;

    // 找到数量最多的牌类型
    const entries = Array.from(counts.entries());

    // 尝试刻子
    for (const [key, count] of entries) {
      if (count >= 3) {
        const next = new Map(counts);
        next.set(key, count - 3);
        if (next.get(key) === 0) next.delete(key);
        if (this.canForm4Groups(next)) return true;
        break; // 每种牌只试一次
      }
    }

    // 尝试顺子（只对数牌）
    for (const [key, count] of entries) {
      const tile = this.keyToTile(key);
      if (tile.suit !== 'zi' && count > 0) {
        const rank = typeof tile.rank === 'number' ? tile.rank : parseInt(tile.rank);
        if (rank <= 7) {
          const key1 = this.tileToKey({ suit: tile.suit, rank: rank + 1, uniqueId: '' });
          const key2 = this.tileToKey({ suit: tile.suit, rank: rank + 2, uniqueId: '' });
          if ((counts.get(key1) || 0) > 0 && (counts.get(key2) || 0) > 0) {
            const next = new Map(counts);
            next.set(key, count - 1);
            next.set(key1, (next.get(key1) || 0) - 1);
            next.set(key2, (next.get(key2) || 0) - 1);
            for (const k of [key, key1, key2]) {
              if (next.get(k) === 0) next.delete(k);
            }
            if (this.canForm4Groups(next)) return true;
          }
        }
      }
      break; // 只处理排序后第一个
    }

    return false;
  }

  // ==================== 特殊牌型判定 ====================

  /**
   * 检查七对子
   * 条件：7个不同的对子
   */
  static isSevenPairs(hand: Tile[]): boolean {
    if (hand.length !== 14) return false;

    const counts = this.buildCountMap(hand);
    let pairCount = 0;

    for (const count of counts.values()) {
      if (count !== 2 && count !== 0) return false;
      if (count === 2) pairCount++;
    }

    return pairCount === 7;
  }

  /**
   * 检查国士无双（十三幺）
   * 条件：13种幺九牌各1张 + 任意1种幺九牌再1张
   */
  static isThirteenOrphans(hand: Tile[]): boolean {
    if (hand.length !== 14) return false;

    const required: string[] = [
      'wan1', 'wan9',
      'tong1', 'tong9',
      'tiao1', 'tiao9',
      'zidong', 'zinan', 'zixi', 'zibei',
      'zizhong', 'zifa', 'zibai',
    ];

    const counts = this.buildCountMap(hand);
    let hasDouble = false;

    for (const key of required) {
      const count = counts.get(key) || 0;
      if (count === 0) return false;
      if (count === 2) {
        if (hasDouble) return false;
        hasDouble = true;
      }
      if (count > 2) return false;
    }

    // 确保没有其他牌
    for (const [key] of counts) {
      if (!required.includes(key)) return false;
    }

    return hasDouble;
  }

  /**
   * 检查全不靠 / 十三不靠
   * 每门牌的数字相差至少3，且字牌不重复
   */
  static isAllHonorsAndKnitted(hand: Tile[]): boolean {
    if (hand.length !== 14) return false;

    const suits: Record<Suit, number[]> = { wan: [], tong: [], tiao: [], zi: [] };

    for (const tile of hand) {
      if (tile.suit === 'zi') {
        suits.zi.push(this.getZiIndex(tile.rank as ZiRank));
      } else {
        const r = typeof tile.rank === 'number' ? tile.rank : parseInt(tile.rank);
        suits[tile.suit].push(r);
      }
    }

    // 字牌不能重复
    const ziSet = new Set(suits.zi);
    if (ziSet.size !== suits.zi.length) return false;

    // 每种数牌的数字间隔 >= 3
    for (const suit of ['wan', 'tong', 'tiao'] as Suit[]) {
      const arr = suits[suit].sort((a, b) => a - b);
      for (let i = 1; i < arr.length; i++) {
        if (arr[i] - arr[i - 1] < 3) return false;
      }
    }

    // 需要有7张字牌 + 7张数牌（各门至少1张）
    return suits.zi.length === 7 &&
           suits.wan.length + suits.tong.length + suits.tiao.length === 7;
  }

  /**
   * 检查平胡（无番胡）
   * 四顺子 + 无役牌雀头 + 两面/两面待
   */
  static isPinfu(hand: Tile[], winTile: Tile): boolean {
    const fullHand = [...hand, winTile];
    if (fullHand.length !== 14) return false;

    // 平胡必须是标准型，不是七对/国士
    if (this.isSevenPairs(fullHand) || this.isThirteenOrphans(fullHand)) return false;

    // 分解手牌，检查是否全部为顺子
    const decomposition = this.decomposeHand(fullHand);
    if (!decomposition) return false;

    // 检查所有面子都是顺子
    const melds = decomposition.filter(g => g.type !== 'pair');
    if (melds.some(g => g.type === 'triplet')) return false;

    // 雀头不能是役牌
    const pair = decomposition.find(g => g.type === 'pair');
    if (!pair) return false;
    if (this.isYakuPair(pair.tiles[0])) return false;

    return true;
  }

  /**
   * 检查清一色
   * 所有牌（包括副露）为同一花色
   */
  static isFullFlush(hand: Tile[], melds: Meld[] = []): boolean {
    let suit: Suit | null = null;

    for (const tile of hand) {
      if (tile.suit === 'zi') return false;
      if (!suit) suit = tile.suit;
      if (tile.suit !== suit) return false;
    }

    for (const meld of melds) {
      for (const tile of meld.tiles) {
        if (tile.suit === 'zi') return false;
        if (tile.suit !== suit) return false;
      }
    }

    return suit !== null;
  }

  /**
   * 检查混一色
   * 只有一种数牌 + 字牌
   */
  static isHalfFlush(hand: Tile[], melds: Meld[] = []): boolean {
    let suit: Suit | null = null;
    let hasZi = false;

    for (const tile of hand) {
      if (tile.suit === 'zi') {
        hasZi = true;
      } else {
        if (!suit) suit = tile.suit;
        if (tile.suit !== suit) return false;
      }
    }

    for (const meld of melds) {
      for (const tile of meld.tiles) {
        if (tile.suit === 'zi') {
          hasZi = true;
        } else {
          if (!suit) suit = tile.suit;
          if (tile.suit !== suit) return false;
        }
      }
    }

    return suit !== null && hasZi;
  }

  /**
   * 检查断幺九（手牌全为中张牌，无幺九字牌）
   */
  static isAllSimples(hand: Tile[], melds: Meld[] = []): boolean {
    for (const tile of hand) {
      if (TileUtils.isTerminalOrHonor(tile)) return false;
    }
    for (const meld of melds) {
      for (const tile of meld.tiles) {
        if (TileUtils.isTerminalOrHonor(tile)) return false;
      }
    }
    return true;
  }

  /**
   * 检查混全带幺九
   */
  static isMixedOutsideHand(hand: Tile[], winTile: Tile, melds: Meld[] = []): boolean {
    const fullHand = [...hand, winTile];
    if (this.isSevenPairs(fullHand) || this.isThirteenOrphans(fullHand)) return false;

    const decomp = this.decomposeHand(fullHand);
    if (!decomp) return false;

    for (const group of decomp) {
      const hasTerminal = group.tiles.some(t => TileUtils.isTerminalOrHonor(t));
      if (!hasTerminal) return false;
    }

    for (const meld of melds) {
      const hasTerminal = meld.tiles.some(t => TileUtils.isTerminalOrHonor(t));
      if (!hasTerminal) return false;
    }

    return true;
  }

  /**
   * 检查纯全带幺九
   */
  static isFullyOutsideHand(hand: Tile[], winTile: Tile, melds: Meld[] = []): boolean {
    if (!this.isMixedOutsideHand(hand, winTile, melds)) return false;
    // 不能有字牌
    for (const tile of hand) {
      if (tile.suit === 'zi') return false;
    }
    for (const meld of melds) {
      for (const tile of meld.tiles) {
        if (tile.suit === 'zi') return false;
      }
    }
    return true;
  }

  /**
   * 检查对对和
   */
  static isAllTriplets(hand: Tile[], winTile: Tile, melds: Meld[] = []): boolean {
    const fullHand = [...hand, winTile];
    if (fullHand.length !== 14) return false;

    if (this.isSevenPairs(fullHand) || this.isThirteenOrphans(fullHand)) return false;

    const decomp = this.decomposeHand(fullHand);
    if (!decomp) return false;

    const concealedMelds = decomp.filter(g => g.type !== 'pair');
    const allTriplet = concealedMelds.every(g => g.type === 'triplet');

    // 副露也必须是刻子
    const allMeldTriplets = melds.every(m => m.type === 'pong' || m.type === 'kong');

    return allTriplet && allMeldTriplets;
  }

  /**
   * 检查三色同顺
   */
  static isThreeColorSequences(hand: Tile[], winTile: Tile): boolean {
    const fullHand = [...hand, winTile];
    const decomp = this.decomposeHand(fullHand);
    if (!decomp) return false;

    const sequences = decomp.filter(g => g.type === 'sequence');
    if (sequences.length < 3) return false;

    // 检查是否有三个花色相同数字的顺子
    const seqRanks: Record<string, { suit: Suit; startRank: number }[]> = {};
    for (const seq of sequences) {
      const ranks = seq.tiles.map(t => typeof t.rank === 'number' ? t.rank : parseInt(t.rank)).sort((a, b) => a - b);
      if (ranks[1] === ranks[0] + 1 && ranks[2] === ranks[0] + 2) {
        const key = `${ranks[0]}`;
        if (!seqRanks[key]) seqRanks[key] = [];
        seqRanks[key].push({ suit: seq.tiles[0].suit, startRank: ranks[0] });
      }
    }

    for (const entries of Object.values(seqRanks)) {
      const suits = new Set(entries.map(e => e.suit));
      if (suits.size >= 3) return true;
    }

    return false;
  }

  /**
   * 检查一气通贯
   */
  static isPureStraight(hand: Tile[], winTile: Tile): boolean {
    const fullHand = [...hand, winTile];
    const decomp = this.decomposeHand(fullHand);
    if (!decomp) return false;

    const sequences = decomp.filter(g => g.type === 'sequence');
    if (sequences.length < 3) return false;

    for (const suit of ['wan', 'tong', 'tiao'] as Suit[]) {
      const suitSeqs = sequences.filter(s => s.tiles[0].suit === suit);
      const starts = suitSeqs.map(s => {
        const ranks = s.tiles.map(t => typeof t.rank === 'number' ? t.rank : parseInt(t.rank));
        return Math.min(...ranks);
      }).sort((a, b) => a - b);

      // 检查是否有1-3, 4-6, 7-9的顺子
      if (starts.includes(1) && starts.includes(4) && starts.includes(7)) return true;
    }

    return false;
  }

  /**
   * 检查一杯口 / 两杯口
   */
  static countPureDoubleSequences(hand: Tile[], winTile: Tile): number {
    const fullHand = [...hand, winTile];
    const decomp = this.decomposeHand(fullHand);
    if (!decomp) return 0;

    const sequences = decomp.filter(g => g.type === 'sequence');
    const seqSignatures: string[] = [];

    for (const seq of sequences) {
      const suit = seq.tiles[0].suit;
      const ranks = seq.tiles.map(t => typeof t.rank === 'number' ? t.rank : parseInt(t.rank)).sort((a, b) => a - b);
      seqSignatures.push(`${suit}:${ranks[0]}`);
    }

    const signatureCounts: Record<string, number> = {};
    for (const sig of seqSignatures) {
      signatureCounts[sig] = (signatureCounts[sig] || 0) + 1;
    }

    let pairs = 0;
    for (const count of Object.values(signatureCounts)) {
      pairs += Math.floor(count / 2);
    }

    return pairs;
  }

  /**
   * 检查岭上开花（杠后摸牌和牌）
   */
  static isAfterAKan(context: YakuContext): boolean {
    return context.melds.some(m => m.type === 'kong' || m.type === 'concealed_kong' || m.type === 'added_kong');
  }

  // ==================== 役种判定 ====================

  /**
   * 评估和牌的所有役种
   */
  static evaluateYaku(hand: Tile[], winTile: Tile, context: YakuContext): string[] {
    const yaku: string[] = [];
    const fullHand = [...hand, winTile];

    // 役满判定
    if (this.isThirteenOrphans(fullHand)) {
      yaku.push(YAKU_NAMES.THIRTEEN_ORPHANS);
      return yaku; // 役满直接返回
    }

    if (this.isAllHonors(fullHand, context)) {
      yaku.push(YAKU_NAMES.ALL_HONORS);
      return yaku;
    }

    // 七对子
    if (this.isSevenPairs(fullHand)) {
      yaku.push(YAKU_NAMES.SEVEN_PAIRS);
    }

    // 立直 / 双立直
    if (context.isRiichi) {
      yaku.push(YAKU_NAMES.RIICHI);
    }

    // 断幺九
    if (this.isAllSimples(fullHand, context.melds)) {
      yaku.push(YAKU_NAMES.ALL_SIMPLES);
    }

    // 场风 / 自风
    const roundWindTile = this.windNumberToTile(context.roundWind);
    const seatWindTile = this.windNumberToTile(context.seatWind);

    // 白/发/中
    // 这些通过dora等其他方式计算

    // 清一色
    if (this.isFullFlush(fullHand, context.melds)) {
      yaku.push(YAKU_NAMES.FULL_FLUSH);
    } else if (this.isHalfFlush(fullHand, context.melds)) {
      yaku.push(YAKU_NAMES.HALF_FLUSH);
    }

    // 对对和
    if (this.isAllTriplets(fullHand, winTile, context.melds)) {
      yaku.push(YAKU_NAMES.ALL_TRIPLET_HAND);
    }

    // 三色同顺
    if (!this.isSevenPairs(fullHand) && this.isThreeColorSequences(hand, winTile)) {
      yaku.push(YAKU_NAMES.THREE_COLOR_SEQUENCES);
    }

    // 一气通贯
    if (!this.isSevenPairs(fullHand) && this.isPureStraight(hand, winTile)) {
      yaku.push(YAKU_NAMES.PURE_STRAIGHT);
    }

    // 一杯口 / 两杯口
    const doubleSeqCount = this.countPureDoubleSequences(hand, winTile);
    if (doubleSeqCount >= 2 && !this.isSevenPairs(fullHand)) {
      yaku.push(YAKU_NAMES.TWICE_PURE_DOUBLE_SEQUENCE);
    } else if (doubleSeqCount >= 1 && !this.isSevenPairs(fullHand)) {
      yaku.push(YAKU_NAMES.PURE_DOUBLE_SEQUENCE);
    }

    // 纯全带幺九
    if (!this.isSevenPairs(fullHand) && this.isFullyOutsideHand(hand, winTile, context.melds)) {
      yaku.push(YAKU_NAMES.FULLY_OUTSIDE_HAND);
    } else if (!this.isSevenPairs(fullHand) && this.isMixedOutsideHand(hand, winTile, context.melds)) {
      yaku.push(YAKU_NAMES.MIXED_OUTSIDE_HAND);
    }

    // 岭上开花
    if (context.isTsumo && this.isAfterAKan(context)) {
      yaku.push(YAKU_NAMES.AFTER_A_KAN);
    }

    // 海底摸月 / 河底捞鱼
    if (context.isTsumo) {
      yaku.push(YAKU_NAMES.UNDER_THE_RIVER);
    } else {
      yaku.push(YAKU_NAMES.UNDER_THE_SEA);
    }

    return yaku;
  }

  /**
   * 综合评估和牌
   */
  static evaluateWinningHand(hand: Tile[], winTile: Tile, context: YakuContext): WinEvaluation {
    const yaku = this.evaluateYaku(hand, winTile, context);
    const fan = this.calculateFan(yaku, context);
    const fu = this.calculateFu(yaku, context);
    const groups = this.decomposeHand([...hand, winTile]) || [];

    const isYakuman = yaku.some(y =>
      [YAKU_NAMES.THIRTEEN_ORPHANS, YAKU_NAMES.ALL_HONORS, YAKU_NAMES.FOUR_CONCEALED_TRIPLETS,
       YAKU_NAMES.BIG_THREE_DRAGONS, YAKU_NAMES.BIG_FOUR_WINDS, YAKU_NAMES.FOUR_KANS,
       YAKU_NAMES.NINE_GATES, YAKU_NAMES.ALL_GREEN].includes(y)
    );

    return {
      handTypes: yaku,
      fan,
      fu,
      isYakuman,
      groups,
    };
  }

  // ==================== 番数/符数计算 ====================

  /**
   * 计算番数
   */
  static calculateFan(yakuNames: string[], context?: YakuContext): number {
    const yakuFanMap: Record<string, number> = {
      [YAKU_NAMES.RIICHI]: 1,
      [YAKU_NAMES.IPPATSU]: 1,
      [YAKU_NAMES.FULLY_OUTSIDE_HAND]: 2,
      [YAKU_NAMES.PURE_DOUBLE_SEQUENCE]: 1,
      [YAKU_NAMES.ALL_SIMPLES]: 1,
      [YAKU_NAMES.DORA]: 1,
      [YAKU_NAMES.RED_FIVE]: 1,
      [YAKU_NAMES.PREVAILING_WIND]: 1,
      [YAKU_NAMES.SEAT_WIND]: 1,
      [YAKU_NAMES.WHITE_DRAGON]: 1,
      [YAKU_NAMES.GREEN_DRAGON]: 1,
      [YAKU_NAMES.RED_DRAGON]: 1,
      [YAKU_NAMES.AFTER_A_KAN]: 1,
      [YAKU_NAMES.UNDER_THE_RIVER]: 1,
      [YAKU_NAMES.UNDER_THE_SEA]: 1,
      [YAKU_NAMES.DOUBLE_RIICHI]: 2,
      [YAKU_NAMES.SEVEN_PAIRS]: 2,
      [YAKU_NAMES.ALL_TRIPLET_HAND]: 2,
      [YAKU_NAMES.THREE_KANS]: 2,
      [YAKU_NAMES.THREE_CONCEALED_TRIPLETS]: 2,
      [YAKU_NAMES.THREE_COLOR_TRIPLETS]: 2,
      [YAKU_NAMES.THREE_COLOR_SEQUENCES]: 2,
      [YAKU_NAMES.PURE_STRAIGHT]: 2,
      [YAKU_NAMES.MIXED_OUTSIDE_HAND]: 2,
      [YAKU_NAMES.ALL_TERM_AND_HONOR]: 2,
      [YAKU_NAMES.HALF_FLUSH]: 3,
      [YAKU_NAMES.TWICE_PURE_DOUBLE_SEQUENCE]: 3,
      [YAKU_NAMES.FULL_FLUSH]: 6,
    };

    let total = 0;
    for (const yaku of yakuNames) {
      total += yakuFanMap[yaku] || 0;
    }

    // 加宝牌
    if (context) {
      total += this.countDora([...context.melds.flatMap(m => m.tiles)], context.doraTiles);
    }

    return total;
  }

  /**
   * 计算符数
   */
  static calculateFu(yakuNames: string[], context: YakuContext): number {
    // 七对子固定25符
    if (yakuNames.includes(YAKU_NAMES.SEVEN_PAIRS)) {
      return 25;
    }

    // 基本符数
    let fu = 20;

    // 自摸加2符（非平胡）
    if (context.isTsumo) {
      fu += 2;
    }

    // 门前清荣胡加10符
    if (!context.isTsumo && context.melds.length === 0) {
      fu += 10;
    }

    // 雀头符（役牌雀头）
    // 根据实际雀头计算

    // 面子符（刻子/明刻/暗刻/杠）
    for (const meld of context.melds) {
      if (meld.type === 'pong') {
        const isTerminal = meld.tiles.some(t => TileUtils.isTerminalOrHonor(t));
        fu += isTerminal ? 4 : 2;
      } else if (meld.type === 'kong') {
        const isTerminal = meld.tiles.some(t => TileUtils.isTerminalOrHonor(t));
        fu += isTerminal ? 16 : 8;
      } else if (meld.type === 'concealed_kong') {
        const isTerminal = meld.tiles.some(t => TileUtils.isTerminalOrHonor(t));
        fu += isTerminal ? 32 : 16;
      }
    }

    // 符数向上取整到10
    fu = Math.ceil(fu / 10) * 10;

    return Math.max(fu, 20);
  }

  /**
   * 计算宝牌数量
   */
  static countDora(hand: Tile[], doraTiles: Tile[]): number {
    let count = 0;
    for (const tile of hand) {
      for (const dora of doraTiles) {
        if (TileUtils.equals(tile, dora)) count++;
      }
    }
    return count;
  }

  // ==================== 手牌分解 ====================

  /**
   * 分解手牌为面子+雀头
   * 返回一种有效的分解方式
   */
  static decomposeHand(hand: Tile[]): Group[] | null {
    if (hand.length !== 14) return null;

    const counts = this.buildCountMap(hand);

    for (const [key, count] of counts.entries()) {
      if (count >= 2) {
        const pairTile = this.keyToTile(key);
        const remaining = new Map(counts);
        remaining.set(key, count - 2);
        if (remaining.get(key) === 0) remaining.delete(key);

        const groups = this.findGroups(remaining);
        if (groups.length === 4) {
          return [{ type: 'pair', tiles: [pairTile, pairTile] }, ...groups];
        }
      }
    }

    return null;
  }

  /**
   * 从计数映射中找到4个面子
   */
  private static findGroups(counts: Map<string, number>): Group[] {
    if (counts.size === 0) return [];

    const entries = Array.from(counts.entries());
    const [firstKey, firstCount] = entries[0];

    // 尝试刻子
    if (firstCount >= 3) {
      const next = new Map(counts);
      next.set(firstKey, firstCount - 3);
      if (next.get(firstKey) === 0) next.delete(firstKey);
      const groups = this.findGroups(next);
      if (groups.length >= 0) {
        const tile = this.keyToTile(firstKey);
        return [{ type: 'triplet', tiles: [tile, tile, tile] }, ...groups];
      }
    }

    // 尝试顺子
    const tile = this.keyToTile(firstKey);
    if (tile.suit !== 'zi') {
      const rank = typeof tile.rank === 'number' ? tile.rank : parseInt(tile.rank);
      if (rank <= 7) {
        const key1 = this.tileToKey({ suit: tile.suit, rank: rank + 1, uniqueId: '' });
        const key2 = this.tileToKey({ suit: tile.suit, rank: rank + 2, uniqueId: '' });
        if ((counts.get(key1) || 0) > 0 && (counts.get(key2) || 0) > 0) {
          const next = new Map(counts);
          next.set(firstKey, firstCount - 1);
          next.set(key1, (next.get(key1) || 0) - 1);
          next.set(key2, (next.get(key2) || 0) - 1);
          for (const k of [firstKey, key1, key2]) {
            if (next.get(k) === 0) next.delete(k);
          }
          const groups = this.findGroups(next);
          if (groups.length >= 0) {
            const t1 = { suit: tile.suit, rank: rank + 1, uniqueId: '' };
            const t2 = { suit: tile.suit, rank: rank + 2, uniqueId: '' };
            return [{ type: 'sequence', tiles: [tile, t1, t2] }, ...groups];
          }
        }
      }
    }

    return [];
  }

  // ==================== 辅助方法 ====================

  /** 检查全带幺 */
  static isAllTerminalsAndHonors(hand: Tile[], winTile: Tile): boolean {
    const fullHand = [...hand, winTile];
    return fullHand.every(t => TileUtils.isTerminalOrHonor(t));
  }

  /** 检查全为字牌 */
  static isAllHonors(hand: Tile[], context: YakuContext): boolean {
    for (const tile of hand) {
      if (tile.suit !== 'zi') return false;
    }
    for (const meld of context.melds) {
      for (const tile of meld.tiles) {
        if (tile.suit !== 'zi') return false;
      }
    }
    return true;
  }

  /** 检查是否为役牌雀头 */
  private static isYakuPair(tile: Tile): boolean {
    if (tile.suit !== 'zi') return false;
    return true; // 所有字牌作为雀头都有符
  }

  /** 风位数字转Tile */
  private static windNumberToTile(wind: number): Tile {
    const winds: ZiRank[] = ['dong', 'nan', 'xi', 'bei'];
    return { suit: 'zi', rank: winds[wind % 4], uniqueId: '' };
  }

  /** 获取字牌索引 */
  private static getZiIndex(rank: ZiRank): number {
    const order: ZiRank[] = ['dong', 'nan', 'xi', 'bei', 'zhong', 'fa', 'bai'];
    return order.indexOf(rank);
  }

  /** Tile 转 key 字符串 */
  private static tileToKey(tile: Tile): string {
    return `${tile.suit}${tile.rank}`;
  }

  /** key 字符串转 Tile */
  private static keyToTile(key: string): Tile {
    const match = key.match(/^([a-z]+)(.+)$/);
    if (!match) return { suit: 'zi', rank: key, uniqueId: '' };

    const suit = match[1] as Suit;
    const rankStr = match[2];

    if (suit === 'zi') {
      return { suit, rank: rankStr, uniqueId: '' };
    }

    const rank = parseInt(rankStr);
    return { suit, rank, uniqueId: '' };
  }

  /** 构建牌的计数映射 */
  private static buildCountMap(hand: Tile[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const tile of hand) {
      const key = this.tileToKey(tile);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  // ==================== 符数转点数 ====================

  /**
   * 根据番数和符数计算点数
   */
  static calculateScore(fan: number, fu: number, isDealer: boolean, isTsumo: boolean): number {
    if (fan >= 13) return isDealer ? 48000 : 32000; // 两倍役满
    if (fan >= 11) return isDealer ? 36000 : 24000; // 三倍役满
    if (fan >= 8) return isDealer ? 24000 : 16000;  // 累计役满
    if (fan === 6 || fan === 7) return isDealer ? 18000 : 12000; // 跳满
    if (fan === 5 || (fan === 4 && fu >= 40) || (fan === 3 && fu >= 70)) return isDealer ? 12000 : 8000; // 满贯

    const base = fu * Math.pow(2, fan + 2);

    if (isTsumo) {
      return isDealer ? base * 3 : base * 2 + base;
    }

    return isDealer ? base * 6 : base * 4;
  }
}
