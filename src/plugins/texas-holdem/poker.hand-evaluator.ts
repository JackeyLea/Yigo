/**
 * 德州扑克牌型评估器
 * Poker Hand Evaluator - 7-card evaluation for Texas Hold'em
 *
 * 从7张牌（2张底牌 + 5张公共牌）中找出最佳的5张牌组合
 */

import { Card, Rank, Suit, HandRanking, HandRankingType, RANK_VALUES } from './poker.types';

export class HandEvaluator {
  /**
   * 评估7张牌中的最佳5张牌
   * Evaluate the best 5-card hand from 7 cards
   */
  static evaluateBestHand(holeCards: Card[], communityCards: Card[]): HandRanking {
    const allCards = [...holeCards, ...communityCards];
    if (allCards.length < 5) {
      throw new Error(`Need at least 5 cards to evaluate, got ${allCards.length}`);
    }

    // 从大到小依次检查各种牌型
    const checks: ((cards: Card[]) => HandRanking | null)[] = [
      this.checkRoyalFlush,
      this.checkStraightFlush,
      this.checkFourOfAKind,
      this.checkFullHouse,
      this.checkFlush,
      this.checkStraight,
      this.checkThreeOfAKind,
      this.checkTwoPair,
      this.checkOnePair,
      this.checkHighCard,
    ];

    for (const check of checks) {
      const result = check(allCards);
      if (result) return result;
    }

    // 保底：高牌（理论上不会走到这里）
    return this.checkHighCard(allCards)!;
  }

  /**
   * 比较两手牌
   * Compare two hand rankings
   * @returns -1 if handA < handB, 0 if equal, 1 if handA > handB
   */
  static compareHands(handA: HandRanking, handB: HandRanking): number {
    // 先比较rank
    if (handA.rank !== handB.rank) {
      return handA.rank > handB.rank ? 1 : -1;
    }
    // rank相同，比较kickers
    const maxLen = Math.max(handA.kickers.length, handB.kickers.length);
    for (let i = 0; i < maxLen; i++) {
      const a = handA.kickers[i] ?? 0;
      const b = handB.kickers[i] ?? 0;
      if (a !== b) {
        return a > b ? 1 : -1;
      }
    }
    return 0;
  }

  // ==================== 私有方法：牌型检查 ====================

  /**
   * 皇家同花顺：A-K-Q-J-10 同花色
   */
  private static checkRoyalFlush(cards: Card[]): HandRanking | null {
    const sf = this.checkStraightFlush(cards);
    if (sf && sf.kickers[0] === 14) {
      return {
        type: 'royal_flush' as HandRankingType,
        rank: 10,
        kickers: [14],
      };
    }
    return null;
  }

  /**
   * 同花顺：5张连续同花色
   */
  private static checkStraightFlush(cards: Card[]): HandRanking | null {
    // 按花色分组
    const bySuit: Record<string, Card[]> = {};
    for (const card of cards) {
      if (!bySuit[card.suit]) bySuit[card.suit] = [];
      bySuit[card.suit].push(card);
    }

    for (const suitCards of Object.values(bySuit)) {
      if (suitCards.length >= 5) {
        const straight = this.findStraight(suitCards);
        if (straight) {
          const highCard = RANK_VALUES[straight[0].rank];
          return {
            type: 'straight_flush' as HandRankingType,
            rank: 9,
            kickers: [highCard],
          };
        }
      }
    }
    return null;
  }

  /**
   * 四条：4张相同牌面
   */
  private static checkFourOfAKind(cards: Card[]): HandRanking | null {
    const groups = this.groupByRank(cards);
    const quads = groups.filter(g => g.length === 4);
    if (quads.length > 0) {
      // 取最大的四条
      const quadRank = Math.max(...quads.map(g => RANK_VALUES[g[0].rank]));
      // 找最大的踢脚
      const kickers = cards
        .filter(c => RANK_VALUES[c.rank] !== quadRank)
        .sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]);
      const kicker = kickers.length > 0 ? RANK_VALUES[kickers[0].rank] : 0;
      return {
        type: 'four_of_a_kind' as HandRankingType,
        rank: 8,
        kickers: [quadRank, kicker],
      };
    }
    return null;
  }

  /**
   * 葫芦：三条+一对
   */
  private static checkFullHouse(cards: Card[]): HandRanking | null {
    const groups = this.groupByRank(cards);
    const triples = groups.filter(g => g.length >= 3);
    const pairs = groups.filter(g => g.length >= 2);

    if (triples.length >= 1 && (pairs.length >= 2 || triples[0].length >= 3)) {
      // 取最大的三条
      const sortedTriples = triples.sort((a, b) =>
        RANK_VALUES[b[0].rank] - RANK_VALUES[a[0].rank]
      );
      const tripleRank = RANK_VALUES[sortedTriples[0][0].rank];

      // 找最大的一对（不能与三条同rank）
      const pairCandidates = groups.filter(
        g => g.length >= 2 && RANK_VALUES[g[0].rank] !== tripleRank
      );
      if (pairCandidates.length > 0) {
        const pairRank = Math.max(
          ...pairCandidates.map(g => RANK_VALUES[g[0].rank])
        );
        return {
          type: 'full_house' as HandRankingType,
          rank: 7,
          kickers: [tripleRank, pairRank],
        };
      }

      // 如果有两个三条，较小的可以作为对子
      if (sortedTriples.length >= 2) {
        const pairRank = RANK_VALUES[sortedTriples[1][0].rank];
        return {
          type: 'full_house' as HandRankingType,
          rank: 7,
          kickers: [tripleRank, pairRank],
        };
      }
    }
    return null;
  }

  /**
   * 同花：5张同花色（不连续）
   */
  private static checkFlush(cards: Card[]): HandRanking | null {
    const bySuit: Record<string, Card[]> = {};
    for (const card of cards) {
      if (!bySuit[card.suit]) bySuit[card.suit] = [];
      bySuit[card.suit].push(card);
    }

    for (const suitCards of Object.values(bySuit)) {
      if (suitCards.length >= 5) {
        const sorted = suitCards.sort(
          (a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]
        );
        return {
          type: 'flush' as HandRankingType,
          rank: 6,
          kickers: sorted.slice(0, 5).map(c => RANK_VALUES[c.rank]),
        };
      }
    }
    return null;
  }

  /**
   * 顺子：5张连续牌面（不同花色）
   */
  private static checkStraight(cards: Card[]): HandRanking | null {
    const straight = this.findStraight(cards);
    if (straight) {
      return {
        type: 'straight' as HandRankingType,
        rank: 5,
        kickers: [RANK_VALUES[straight[0].rank]],
      };
    }
    return null;
  }

  /**
   * 三条：3张相同牌面
   */
  private static checkThreeOfAKind(cards: Card[]): HandRanking | null {
    const groups = this.groupByRank(cards);
    const triples = groups.filter(g => g.length === 3);
    if (triples.length > 0) {
      const tripleRank = Math.max(
        ...triples.map(g => RANK_VALUES[g[0].rank])
      );
      const kickers = cards
        .filter(c => RANK_VALUES[c.rank] !== tripleRank)
        .sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank])
        .slice(0, 2)
        .map(c => RANK_VALUES[c.rank]);
      return {
        type: 'three_of_a_kind' as HandRankingType,
        rank: 4,
        kickers: [tripleRank, ...kickers],
      };
    }
    return null;
  }

  /**
   * 两对：两个不同的对子
   */
  private static checkTwoPair(cards: Card[]): HandRanking | null {
    const groups = this.groupByRank(cards);
    const pairs = groups.filter(g => g.length === 2);
    if (pairs.length >= 2) {
      const pairRanks = pairs
        .map(g => RANK_VALUES[g[0].rank])
        .sort((a, b) => b - a)
        .slice(0, 2);
      const usedRanks = new Set(pairRanks);
      const kicker = cards
        .filter(c => !usedRanks.has(RANK_VALUES[c.rank]))
        .sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank])[0];
      return {
        type: 'two_pair' as HandRankingType,
        rank: 3,
        kickers: [...pairRanks, kicker ? RANK_VALUES[kicker.rank] : 0],
      };
    }
    return null;
  }

  /**
   * 一对：1个对子
   */
  private static checkOnePair(cards: Card[]): HandRanking | null {
    const groups = this.groupByRank(cards);
    const pairs = groups.filter(g => g.length === 2);
    if (pairs.length === 1) {
      const pairRank = RANK_VALUES[pairs[0][0].rank];
      const kickers = cards
        .filter(c => RANK_VALUES[c.rank] !== pairRank)
        .sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank])
        .slice(0, 3)
        .map(c => RANK_VALUES[c.rank]);
      return {
        type: 'one_pair' as HandRankingType,
        rank: 2,
        kickers: [pairRank, ...kickers],
      };
    }
    return null;
  }

  /**
   * 高牌：没有任何组合
   */
  private static checkHighCard(cards: Card[]): HandRanking | null {
    const sorted = [...cards].sort(
      (a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]
    );
    return {
      type: 'high_card' as HandRankingType,
      rank: 1,
      kickers: sorted.slice(0, 5).map(c => RANK_VALUES[c.rank]),
    };
  }

  // ==================== 私有工具方法 ====================

  /**
   * 按牌面分组
   */
  private static groupByRank(cards: Card[]): Card[][] {
    const map: Record<string, Card[]> = {};
    for (const card of cards) {
      if (!map[card.rank]) map[card.rank] = [];
      map[card.rank].push(card);
    }
    return Object.values(map).filter(g => g.length >= 2);
  }

  /**
   * 查找顺子（5张连续牌面）
   * 返回顺子中的5张牌（从大到小排列）
   */
  private static findStraight(cards: Card[]): Card[] | null {
    // 去重（同rank只取一张）
    const uniqueRanks: Record<number, Card> = {};
    for (const card of cards) {
      const val = RANK_VALUES[card.rank];
      if (!uniqueRanks[val] || RANK_VALUES[card.rank] > RANK_VALUES[uniqueRanks[val].rank]) {
        uniqueRanks[val] = card;
      }
    }

    let uniqueCards = Object.values(uniqueRanks).sort(
      (a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]
    );

    // 特殊情况：A-2-3-4-5 小顺（A作为1）
    const hasAce = uniqueCards.some(c => c.rank === 'A');
    const has2 = uniqueCards.some(c => c.rank === '2');
    const has3 = uniqueCards.some(c => c.rank === '3');
    const has4 = uniqueCards.some(c => c.rank === '4');
    const has5 = uniqueCards.some(c => c.rank === '5');

    // 检查普通顺子
    for (let i = 0; i <= uniqueCards.length - 5; i++) {
      const seq = uniqueCards.slice(i, i + 5);
      const values = seq.map(c => RANK_VALUES[c.rank]);
      if (this.isConsecutive(values)) {
        return seq;
      }
    }

    // 检查A-2-3-4-5小顺
    if (hasAce && has2 && has3 && has4 && has5) {
      const wheelCards = [
        uniqueCards.find(c => c.rank === '5')!,
        uniqueCards.find(c => c.rank === '4')!,
        uniqueCards.find(c => c.rank === '3')!,
        uniqueCards.find(c => c.rank === '2')!,
        uniqueCards.find(c => c.rank === 'A')!,
      ];
      return wheelCards;
    }

    return null;
  }

  /**
   * 检查数值是否连续（递减）
   */
  private static isConsecutive(values: number[]): boolean {
    for (let i = 0; i < values.length - 1; i++) {
      if (values[i] - values[i + 1] !== 1) {
        return false;
      }
    }
    return true;
  }

  /**
   * 获取最佳5张牌的具体牌
   * 用于showdown时展示
   */
  static getBestFiveCards(holeCards: Card[], communityCards: Card[]): Card[] {
    const allCards = [...holeCards, ...communityCards];
    const ranking = this.evaluateBestHand(holeCards, communityCards);

    // 根据牌型返回具体的5张牌
    switch (ranking.type) {
      case 'royal_flush':
      case 'straight_flush':
        return this.getStraightFlushCards(allCards);
      case 'four_of_a_kind':
        return this.getFourOfAKindCards(allCards, ranking);
      case 'full_house':
        return this.getFullHouseCards(allCards, ranking);
      case 'flush':
        return this.getFlushCards(allCards);
      case 'straight':
        return this.getStraightCards(allCards);
      case 'three_of_a_kind':
        return this.getThreeOfAKindCards(allCards, ranking);
      case 'two_pair':
        return this.getTwoPairCards(allCards, ranking);
      case 'one_pair':
        return this.getOnePairCards(allCards, ranking);
      case 'high_card':
      default:
        return this.getHighCardCards(allCards);
    }
  }

  // ==================== 获取具体5张牌的方法 ====================

  private static getStraightFlushCards(cards: Card[]): Card[] {
    const bySuit: Record<string, Card[]> = {};
    for (const card of cards) {
      if (!bySuit[card.suit]) bySuit[card.suit] = [];
      bySuit[card.suit].push(card);
    }
    for (const suitCards of Object.values(bySuit)) {
      if (suitCards.length >= 5) {
        const straight = this.findStraight(suitCards);
        if (straight) return straight;
      }
    }
    return cards.slice(0, 5);
  }

  private static getFourOfAKindCards(cards: Card[], ranking: HandRanking): Card[] {
    const quadRank = ranking.kickers[0];
    const quads = cards.filter(c => RANK_VALUES[c.rank] === quadRank);
    const kicker = cards
      .filter(c => RANK_VALUES[c.rank] !== quadRank)
      .sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank])[0];
    return [...quads.slice(0, 4), kicker];
  }

  private static getFullHouseCards(cards: Card[], ranking: HandRanking): Card[] {
    const tripleRank = ranking.kickers[0];
    const pairRank = ranking.kickers[1];
    const triples = cards.filter(c => RANK_VALUES[c.rank] === tripleRank).slice(0, 3);
    const pairs = cards.filter(c => RANK_VALUES[c.rank] === pairRank).slice(0, 2);
    return [...triples, ...pairs];
  }

  private static getFlushCards(cards: Card[]): Card[] {
    const bySuit: Record<string, Card[]> = {};
    for (const card of cards) {
      if (!bySuit[card.suit]) bySuit[card.suit] = [];
      bySuit[card.suit].push(card);
    }
    for (const suitCards of Object.values(bySuit)) {
      if (suitCards.length >= 5) {
        return suitCards
          .sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank])
          .slice(0, 5);
      }
    }
    return cards.slice(0, 5);
  }

  private static getStraightCards(cards: Card[]): Card[] {
    return this.findStraight(cards) || cards.slice(0, 5);
  }

  private static getThreeOfAKindCards(cards: Card[], ranking: HandRanking): Card[] {
    const tripleRank = ranking.kickers[0];
    const triples = cards.filter(c => RANK_VALUES[c.rank] === tripleRank).slice(0, 3);
    const kickers = cards
      .filter(c => RANK_VALUES[c.rank] !== tripleRank)
      .sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank])
      .slice(0, 2);
    return [...triples, ...kickers];
  }

  private static getTwoPairCards(cards: Card[], ranking: HandRanking): Card[] {
    const pair1Rank = ranking.kickers[0];
    const pair2Rank = ranking.kickers[1];
    const pair1 = cards.filter(c => RANK_VALUES[c.rank] === pair1Rank).slice(0, 2);
    const pair2 = cards.filter(c => RANK_VALUES[c.rank] === pair2Rank).slice(0, 2);
    const used = new Set([pair1Rank, pair2Rank]);
    const kicker = cards
      .filter(c => !used.has(RANK_VALUES[c.rank]))
      .sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank])[0];
    return [...pair1, ...pair2, kicker];
  }

  private static getOnePairCards(cards: Card[], ranking: HandRanking): Card[] {
    const pairRank = ranking.kickers[0];
    const pair = cards.filter(c => RANK_VALUES[c.rank] === pairRank).slice(0, 2);
    const kickers = cards
      .filter(c => RANK_VALUES[c.rank] !== pairRank)
      .sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank])
      .slice(0, 3);
    return [...pair, ...kickers];
  }

  private static getHighCardCards(cards: Card[]): Card[] {
    return cards
      .sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank])
      .slice(0, 5);
  }
}
