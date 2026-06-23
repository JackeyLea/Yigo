/**
 * 类型定义测试
 */

import {
  Suit, Rank, Card, PokerPhase, PlayerAction,
  PokerPlayer, SidePot, PokerState, PokerAction,
  ShowdownResult, HandRankingType, HandRanking,
  RANK_VALUES, HAND_RANKING_VALUES, AIDifficulty,
  PokerPluginConfig, DEFAULT_POKER_CONFIG,
} from '../poker.types';

describe('Poker Types', () => {
  describe('RANK_VALUES', () => {
    it('should have correct rank values', () => {
      expect(RANK_VALUES['2']).toBe(2);
      expect(RANK_VALUES['10']).toBe(10);
      expect(RANK_VALUES['J']).toBe(11);
      expect(RANK_VALUES['Q']).toBe(12);
      expect(RANK_VALUES['K']).toBe(13);
      expect(RANK_VALUES['A']).toBe(14);
    });

    it('should be ordered correctly', () => {
      const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
      for (let i = 1; i < ranks.length; i++) {
        expect(RANK_VALUES[ranks[i]]).toBe(RANK_VALUES[ranks[i - 1]] + 1);
      }
    });
  });

  describe('HAND_RANKING_VALUES', () => {
    it('should have correct ranking order', () => {
      expect(HAND_RANKING_VALUES['royal_flush']).toBe(10);
      expect(HAND_RANKING_VALUES['straight_flush']).toBe(9);
      expect(HAND_RANKING_VALUES['four_of_a_kind']).toBe(8);
      expect(HAND_RANKING_VALUES['full_house']).toBe(7);
      expect(HAND_RANKING_VALUES['flush']).toBe(6);
      expect(HAND_RANKING_VALUES['straight']).toBe(5);
      expect(HAND_RANKING_VALUES['three_of_a_kind']).toBe(4);
      expect(HAND_RANKING_VALUES['two_pair']).toBe(3);
      expect(HAND_RANKING_VALUES['one_pair']).toBe(2);
      expect(HAND_RANKING_VALUES['high_card']).toBe(1);
    });

    it('should be in descending order', () => {
      const types: HandRankingType[] = [
        'royal_flush', 'straight_flush', 'four_of_a_kind', 'full_house',
        'flush', 'straight', 'three_of_a_kind', 'two_pair', 'one_pair', 'high_card',
      ];
      for (let i = 1; i < types.length; i++) {
        expect(HAND_RANKING_VALUES[types[i - 1]]).toBeGreaterThan(HAND_RANKING_VALUES[types[i]]);
      }
    });
  });

  describe('DEFAULT_POKER_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_POKER_CONFIG.smallBlind).toBe(10);
      expect(DEFAULT_POKER_CONFIG.bigBlind).toBe(20);
      expect(DEFAULT_POKER_CONFIG.maxPlayers).toBe(9);
      expect(DEFAULT_POKER_CONFIG.minPlayers).toBe(2);
      expect(DEFAULT_POKER_CONFIG.buyInMin).toBe(500);
      expect(DEFAULT_POKER_CONFIG.buyInMax).toBe(10000);
      expect(DEFAULT_POKER_CONFIG.turnTimeoutMs).toBe(30000);
      expect(DEFAULT_POKER_CONFIG.enableAI).toBe(true);
      expect(DEFAULT_POKER_CONFIG.aiDifficulty).toBe('medium');
    });
  });

  describe('Type compatibility', () => {
    it('should create a valid Card', () => {
      const card: Card = { suit: 'hearts', rank: 'A' };
      expect(card.suit).toBe('hearts');
      expect(card.rank).toBe('A');
    });

    it('should create a valid PokerPlayer', () => {
      const player: PokerPlayer = {
        playerId: 'p1',
        seatIndex: 0,
        holeCards: [{ suit: 'spades', rank: 'A' }, { suit: 'hearts', rank: 'K' }],
        chips: 1000,
        currentBet: 0,
        totalBet: 0,
        isActive: true,
        isAllIn: false,
        isDealer: true,
        isSmallBlind: false,
        isBigBlind: false,
      };
      expect(player.playerId).toBe('p1');
      expect(player.holeCards).toHaveLength(2);
    });

    it('should create a valid PokerState', () => {
      const state: PokerState = {
        phase: 'waiting',
        players: [],
        communityCards: [],
        pot: 0,
        sidePots: [],
        currentBet: 0,
        minRaise: 0,
        dealerIndex: 0,
        currentPlayerIndex: 0,
        activePlayerCount: 0,
        deck: [],
        actionHistory: [],
        gameOver: false,
      };
      expect(state.phase).toBe('waiting');
    });

    it('should create a valid HandRanking', () => {
      const ranking: HandRanking = {
        type: 'royal_flush',
        rank: 10,
        kickers: [14],
      };
      expect(ranking.type).toBe('royal_flush');
      expect(ranking.rank).toBe(10);
    });
  });
});
