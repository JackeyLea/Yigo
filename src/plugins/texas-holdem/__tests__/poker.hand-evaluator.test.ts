/**
 * 牌型评估器测试
 */

import { HandEvaluator } from '../poker.hand-evaluator';
import { Card, HandRanking, RANK_VALUES } from '../poker.types';

// 辅助函数：快速创建牌
function card(suit: string, rank: string): Card {
  return { suit: suit as any, rank: rank as any };
}

describe('HandEvaluator', () => {
  describe('evaluateBestHand', () => {
    it('should evaluate royal flush correctly', () => {
      const holeCards = [card('hearts', '10'), card('hearts', 'J')];
      const communityCards = [
        card('hearts', 'Q'), card('hearts', 'K'), card('hearts', 'A'),
        card('clubs', '2'), card('diamonds', '3'),
      ];
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('royal_flush');
      expect(result.rank).toBe(10);
    });

    it('should evaluate straight flush correctly', () => {
      const holeCards = [card('spades', '5'), card('spades', '6')];
      const communityCards = [
        card('spades', '7'), card('spades', '8'), card('spades', '9'),
        card('hearts', '2'), card('diamonds', '3'),
      ];
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('straight_flush');
      expect(result.rank).toBe(9);
      expect(result.kickers[0]).toBe(9); // 高牌9
    });

    it('should evaluate four of a kind correctly', () => {
      const holeCards = [card('hearts', 'A'), card('diamonds', 'A')];
      const communityCards = [
        card('clubs', 'A'), card('spades', 'A'), card('hearts', 'K'),
        card('clubs', '2'), card('diamonds', '3'),
      ];
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('four_of_a_kind');
      expect(result.rank).toBe(8);
      expect(result.kickers[0]).toBe(14); // 四条的rank是A
    });

    it('should evaluate full house correctly', () => {
      const holeCards = [card('hearts', 'K'), card('diamonds', 'K')];
      const communityCards = [
        card('clubs', 'K'), card('spades', 'Q'), card('hearts', 'Q'),
        card('clubs', '2'), card('diamonds', '3'),
      ];
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('full_house');
      expect(result.rank).toBe(7);
      expect(result.kickers[0]).toBe(13); // 三条K
      expect(result.kickers[1]).toBe(12); // 对子Q
    });

    it('should evaluate flush correctly', () => {
      const holeCards = [card('hearts', '2'), card('hearts', '5')];
      const communityCards = [
        card('hearts', '7'), card('hearts', '9'), card('hearts', 'K'),
        card('clubs', '3'), card('spades', '4'),
      ];
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('flush');
      expect(result.rank).toBe(6);
    });

    it('should evaluate straight correctly', () => {
      const holeCards = [card('hearts', '5'), card('diamonds', '6')];
      const communityCards = [
        card('clubs', '7'), card('spades', '8'), card('hearts', '9'),
        card('clubs', 'K'), card('diamonds', 'A'),
      ];
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('straight');
      expect(result.rank).toBe(5);
      expect(result.kickers[0]).toBe(9); // 高牌9
    });

    it('should evaluate wheel straight (A-2-3-4-5) correctly', () => {
      const holeCards = [card('hearts', 'A'), card('diamonds', '2')];
      const communityCards = [
        card('clubs', '3'), card('spades', '4'), card('hearts', '5'),
        card('clubs', 'K'), card('diamonds', 'Q'),
      ];
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('straight');
      expect(result.rank).toBe(5);
      expect(result.kickers[0]).toBe(5); // 高牌5
    });

    it('should evaluate three of a kind correctly', () => {
      const holeCards = [card('hearts', 'J'), card('diamonds', 'J')];
      const communityCards = [
        card('clubs', 'J'), card('spades', '8'), card('hearts', '4'),
        card('clubs', '2'), card('diamonds', '3'),
      ];
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('three_of_a_kind');
      expect(result.rank).toBe(4);
      expect(result.kickers[0]).toBe(11); // J
    });

    it('should evaluate two pair correctly', () => {
      const holeCards = [card('hearts', '10'), card('diamonds', '10')];
      const communityCards = [
        card('clubs', '7'), card('spades', '7'), card('hearts', '3'),
        card('clubs', '2'), card('diamonds', 'K'),
      ];
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('two_pair');
      expect(result.rank).toBe(3);
    });

    it('should evaluate one pair correctly', () => {
      const holeCards = [card('hearts', 'A'), card('diamonds', 'K')];
      const communityCards = [
        card('clubs', 'A'), card('spades', '8'), card('hearts', '5'),
        card('clubs', '3'), card('diamonds', '2'),
      ];
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('one_pair');
      expect(result.rank).toBe(2);
      expect(result.kickers[0]).toBe(14); // A
    });

    it('should evaluate high card correctly', () => {
      const holeCards = [card('hearts', 'A'), card('diamonds', 'K')];
      const communityCards = [
        card('clubs', 'Q'), card('spades', '8'), card('hearts', '5'),
        card('clubs', '3'), card('diamonds', '2'),
      ];
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('high_card');
      expect(result.rank).toBe(1);
      expect(result.kickers[0]).toBe(14); // A
    });

    it('should throw error when less than 5 cards', () => {
      const holeCards = [card('hearts', 'A'), card('diamonds', 'K')];
      const communityCards = [card('clubs', 'Q')];
      expect(() => HandEvaluator.evaluateBestHand(holeCards, communityCards)).toThrow();
    });
  });

  describe('compareHands', () => {
    it('should compare different rank hands', () => {
      const royalFlush: HandRanking = { type: 'royal_flush', rank: 10, kickers: [14] };
      const straightFlush: HandRanking = { type: 'straight_flush', rank: 9, kickers: [9] };
      const fourOfAKind: HandRanking = { type: 'four_of_a_kind', rank: 8, kickers: [14, 13] };

      expect(HandEvaluator.compareHands(royalFlush, straightFlush)).toBe(1);
      expect(HandEvaluator.compareHands(straightFlush, royalFlush)).toBe(-1);
      expect(HandEvaluator.compareHands(straightFlush, fourOfAKind)).toBe(1);
    });

    it('should compare same rank with different kickers', () => {
      const pairAces: HandRanking = { type: 'one_pair', rank: 2, kickers: [14, 13, 12, 8] };
      const pairKings: HandRanking = { type: 'one_pair', rank: 2, kickers: [13, 14, 12, 8] };

      expect(HandEvaluator.compareHands(pairAces, pairKings)).toBe(1);
      expect(HandEvaluator.compareHands(pairKings, pairAces)).toBe(-1);
    });

    it('should return 0 for equal hands', () => {
      const hand1: HandRanking = { type: 'flush', rank: 6, kickers: [14, 12, 10, 7, 4] };
      const hand2: HandRanking = { type: 'flush', rank: 6, kickers: [14, 12, 10, 7, 4] };

      expect(HandEvaluator.compareHands(hand1, hand2)).toBe(0);
    });

    it('should handle different kicker lengths', () => {
      const fourOfAKindA: HandRanking = { type: 'four_of_a_kind', rank: 8, kickers: [7, 14] };
      const fourOfAKindB: HandRanking = { type: 'four_of_a_kind', rank: 8, kickers: [7, 13] };

      expect(HandEvaluator.compareHands(fourOfAKindA, fourOfAKindB)).toBe(1);
    });
  });

  describe('getBestFiveCards', () => {
    it('should return 5 cards for royal flush', () => {
      const holeCards = [card('hearts', '10'), card('hearts', 'J')];
      const communityCards = [
        card('hearts', 'Q'), card('hearts', 'K'), card('hearts', 'A'),
        card('clubs', '2'), card('diamonds', '3'),
      ];
      const bestFive = HandEvaluator.getBestFiveCards(holeCards, communityCards);
      expect(bestFive).toHaveLength(5);
    });

    it('should return 5 cards for high card', () => {
      const holeCards = [card('hearts', 'A'), card('diamonds', 'K')];
      const communityCards = [
        card('clubs', 'Q'), card('spades', '8'), card('hearts', '5'),
        card('clubs', '3'), card('diamonds', '2'),
      ];
      const bestFive = HandEvaluator.getBestFiveCards(holeCards, communityCards);
      expect(bestFive).toHaveLength(5);
    });
  });

  describe('edge cases', () => {
    it('should detect flush over straight when flush is higher', () => {
      // 同花和顺子同时存在，但同花更大
      const holeCards = [card('hearts', '2'), card('hearts', '3')];
      const communityCards = [
        card('hearts', '4'), card('hearts', '5'), card('hearts', '6'),
        card('spades', '7'), card('clubs', '8'),
      ];
      // 既是同花(2-3-4-5-6 hearts)也是顺子(2-3-4-5-6)，但顺子同花>普通同花>顺子
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('straight_flush');
    });

    it('should detect higher straight flush over lower one', () => {
      const holeCards = [card('hearts', '6'), card('hearts', '7')];
      const communityCards = [
        card('hearts', '8'), card('hearts', '9'), card('hearts', '10'),
        card('hearts', '2'), card('hearts', '3'),
      ];
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('straight_flush');
      expect(result.kickers[0]).toBe(10); // 6-7-8-9-10，高牌10
    });

    it('should handle 7 cards with multiple possible hands', () => {
      // 有多条、对子等多种组合，应选最大的
      const holeCards = [card('hearts', 'A'), card('diamonds', 'A')];
      const communityCards = [
        card('clubs', 'A'), card('spades', 'K'), card('hearts', 'K'),
        card('diamonds', 'K'), card('clubs', 'Q'),
      ];
      // AA+KKK+AQ = 葫芦A带K（四条A+K踢脚 > 葫芦）
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('four_of_a_kind');
      expect(result.kickers[0]).toBe(14);
    });

    it('should handle two full house options, pick higher one', () => {
      const holeCards = [card('hearts', 'Q'), card('diamonds', 'Q')];
      const communityCards = [
        card('clubs', 'Q'), card('spades', 'J'), card('hearts', 'J'),
        card('diamonds', 'J'), card('clubs', '10'),
      ];
      // QQQ + JJJ = 葫芦Q带J
      const result = HandEvaluator.evaluateBestHand(holeCards, communityCards);
      expect(result.type).toBe('full_house');
      expect(result.kickers[0]).toBe(12); // Q
      expect(result.kickers[1]).toBe(11); // J
    });
  });
});
