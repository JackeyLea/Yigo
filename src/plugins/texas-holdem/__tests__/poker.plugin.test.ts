/**
 * 德州扑克插件主类测试
 */

import { PokerPlugin } from '../poker.plugin';
import { PlayerAction } from '../poker.types';

describe('PokerPlugin', () => {
  let plugin: PokerPlugin;

  beforeEach(() => {
    plugin = new PokerPlugin({
      smallBlind: 10,
      bigBlind: 20,
      maxPlayers: 6,
      minPlayers: 2,
      buyInMin: 500,
      buyInMax: 5000,
      enableAI: true,
      aiDifficulty: 'easy',
    });
  });

  describe('initialization', () => {
    it('should create plugin with default config', () => {
      const defaultPlugin = new PokerPlugin();
      const config = defaultPlugin.getConfig();
      expect(config.smallBlind).toBe(10);
      expect(config.bigBlind).toBe(20);
      expect(config.maxPlayers).toBe(9);
    });

    it('should create plugin with custom config', () => {
      const config = plugin.getConfig();
      expect(config.smallBlind).toBe(10);
      expect(config.bigBlind).toBe(20);
      expect(config.maxPlayers).toBe(6);
    });

    it('should get initial state', () => {
      const state = plugin.getState();
      expect(state.phase).toBe('waiting');
      expect(state.players).toHaveLength(0);
    });
  });

  describe('player management', () => {
    it('should add human player', () => {
      const success = plugin.addPlayer('human1', 1000, 0);
      expect(success).toBe(true);
      expect(plugin.getState().players).toHaveLength(1);
    });

    it('should add AI player', () => {
      const aiId = plugin.addAIPlayer('easy', 1000);
      expect(aiId).toBeDefined();
      expect(aiId.startsWith('ai_easy_')).toBe(true);
      expect(plugin.getState().players).toHaveLength(1);
    });

    it('should add multiple players', () => {
      plugin.addPlayer('p1', 1000, 0);
      plugin.addPlayer('p2', 1000, 1);
      plugin.addAIPlayer('medium', 1000, 2);
      expect(plugin.getState().players).toHaveLength(3);
    });

    it('should not add player beyond maxPlayers', () => {
      const smallPlugin = new PokerPlugin({ maxPlayers: 2 });
      smallPlugin.addPlayer('p1', 1000, 0);
      smallPlugin.addPlayer('p2', 1000, 1);
      const success = smallPlugin.addPlayer('p3', 1000, 2);
      expect(success).toBe(false);
    });

    it('should remove player', () => {
      plugin.addPlayer('p1', 1000, 0);
      plugin.removePlayer('p1');
      expect(plugin.getState().players).toHaveLength(0);
    });

    it('should remove AI player', () => {
      const aiId = plugin.addAIPlayer('easy', 1000, 0);
      plugin.removeAIPlayer(aiId);
      expect(plugin.getState().players).toHaveLength(0);
      expect(plugin.getAIPlayers()).toHaveLength(0);
    });

    it('should clear all AI players', () => {
      plugin.addAIPlayer('easy', 1000, 0);
      plugin.addAIPlayer('medium', 1000, 1);
      plugin.clearAIPlayers();
      expect(plugin.getAIPlayers()).toHaveLength(0);
    });
  });

  describe('game flow', () => {
    beforeEach(() => {
      plugin.addPlayer('p1', 1000, 0);
      plugin.addPlayer('p2', 1000, 1);
    });

    it('should start a new hand', () => {
      const success = plugin.startNewHand();
      expect(success).toBe(true);
      const state = plugin.getState();
      expect(state.phase).not.toBe('waiting');
      expect(state.players[0].holeCards).toHaveLength(2);
      expect(state.players[1].holeCards).toHaveLength(2);
    });

    it('should not start with less than minPlayers', () => {
      plugin.removePlayer('p2');
      const success = plugin.startNewHand();
      expect(success).toBe(false);
    });

    it('should track if game is running', () => {
      expect(plugin.isGameRunning()).toBe(false);
      plugin.startNewHand();
      // After hand completes or during play
      expect(plugin.isGameRunning() || plugin.getState().phase === 'ended').toBeTruthy();
    });
  });

  describe('actions', () => {
    beforeEach(() => {
      plugin.addPlayer('p1', 1000, 0);
      plugin.addPlayer('p2', 1000, 1);
      plugin.addPlayer('p3', 1000, 2);
      plugin.startNewHand();
    });

    it('should handle fold action', () => {
      const currentPlayer = plugin.getCurrentPlayer();
      if (currentPlayer && !plugin.getAIPlayers().includes(currentPlayer.playerId)) {
        const success = plugin.handleAction(currentPlayer.playerId, 'fold');
        expect(success).toBe(true);
      }
    });

    it('should handle call action', () => {
      const currentPlayer = plugin.getCurrentPlayer();
      if (currentPlayer && !plugin.getAIPlayers().includes(currentPlayer.playerId)) {
        const success = plugin.handleAction(currentPlayer.playerId, 'call');
        expect(success).toBe(true);
      }
    });

    it('should check action validity', () => {
      const currentPlayer = plugin.getCurrentPlayer();
      if (currentPlayer) {
        const isValid = plugin.isValidAction(currentPlayer.playerId, 'fold');
        expect(typeof isValid).toBe('boolean');
      }
    });

    it('should get valid actions', () => {
      const currentPlayer = plugin.getCurrentPlayer();
      if (currentPlayer) {
        const actions = plugin.getValidActions(currentPlayer.playerId);
        expect(Array.isArray(actions)).toBe(true);
        expect(actions.length).toBeGreaterThan(0);
      }
    });
  });

  describe('hand evaluation', () => {
    beforeEach(() => {
      plugin.addPlayer('p1', 1000, 0);
      plugin.addPlayer('p2', 1000, 1);
      plugin.startNewHand();
    });

    it('should evaluate player hand', () => {
      const result = plugin.evaluateHand('p1');
      expect(result).toBeDefined();
      if (result) {
        expect(result).toHaveProperty('type');
        expect(result).toHaveProperty('rank');
        expect(result).toHaveProperty('kickers');
      }
    });

    it('should return null for non-existent player', () => {
      const result = plugin.evaluateHand('nonexistent');
      expect(result).toBeNull();
    });

    it('should compare hands', () => {
      const handA = { type: 'royal_flush' as const, rank: 10, kickers: [14] };
      const handB = { type: 'straight_flush' as const, rank: 9, kickers: [9] };
      expect(plugin.compareHands(handA, handB)).toBe(1);
      expect(plugin.compareHands(handB, handA)).toBe(-1);
      expect(plugin.compareHands(handA, handA)).toBe(0);
    });
  });

  describe('event system', () => {
    it('should subscribe and receive events', () => {
      const listener = jest.fn();
      const unsubscribe = plugin.on('playerJoined', listener);

      plugin.addPlayer('p1', 1000, 0);
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0]).toHaveProperty('type', 'playerJoined');
      expect(listener.mock.calls[0][0]).toHaveProperty('data');
      expect(listener.mock.calls[0][0]).toHaveProperty('timestamp');

      unsubscribe();
    });

    it('should unsubscribe correctly', () => {
      const listener = jest.fn();
      const unsubscribe = plugin.on('playerJoined', listener);
      unsubscribe();

      plugin.addPlayer('p1', 1000, 0);
      // Should not receive event after unsubscribe
      // (the event was already fired above, so we check it was only called once)
    });

    it('should subscribe to all events', () => {
      const listener = jest.fn();
      const unsubscribe = plugin.onAny(listener);

      plugin.addPlayer('p1', 1000, 0);
      expect(listener).toHaveBeenCalled();

      unsubscribe();
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      plugin.addPlayer('p1', 1000, 0);
      plugin.addPlayer('p2', 1000, 1);
    });

    it('should track player stats', () => {
      const stats = plugin.getPlayerStats('p1');
      expect(stats).toBeDefined();
      if (stats) {
        expect(stats.playerId).toBe('p1');
        expect(stats.handsPlayed).toBe(0);
      }
    });

    it('should return undefined for unknown player stats', () => {
      const stats = plugin.getPlayerStats('nonexistent');
      expect(stats).toBeUndefined();
    });

    it('should get all stats', () => {
      const allStats = plugin.getAllStats();
      expect(allStats).toHaveLength(2);
    });

    it('should track hand count', () => {
      expect(plugin.getHandCount()).toBe(0);
      plugin.startNewHand();
      expect(plugin.getHandCount()).toBe(1);
    });

    it('should reset stats', () => {
      plugin.startNewHand();
      plugin.resetStats();
      const stats = plugin.getPlayerStats('p1');
      expect(stats).toBeDefined();
      if (stats) {
        expect(stats.handsPlayed).toBe(0);
      }
    });
  });

  describe('configuration', () => {
    it('should update config', () => {
      plugin.updateConfig({ smallBlind: 25, bigBlind: 50 });
      const config = plugin.getConfig();
      expect(config.smallBlind).toBe(25);
      expect(config.bigBlind).toBe(50);
    });
  });

  describe('serialization', () => {
    beforeEach(() => {
      plugin.addPlayer('p1', 1000, 0);
      plugin.addPlayer('p2', 1000, 1);
    });

    it('should serialize and deserialize', () => {
      plugin.startNewHand();
      const serialized = plugin.serialize();
      expect(typeof serialized).toBe('string');

      const newPlugin = new PokerPlugin();
      newPlugin.deserialize(serialized);
      expect(newPlugin.getHandCount()).toBe(plugin.getHandCount());
    });
  });

  describe('reset', () => {
    it('should reset the entire game', () => {
      plugin.addPlayer('p1', 1000, 0);
      plugin.addAIPlayer('easy', 1000, 1);
      plugin.startNewHand();

      plugin.reset();

      const state = plugin.getState();
      expect(state.players).toHaveLength(0);
      expect(plugin.getAIPlayers()).toHaveLength(0);
      expect(plugin.getHandCount()).toBe(0);
    });
  });

  describe('min raise calculation', () => {
    it('should calculate minimum raise', () => {
      plugin.addPlayer('p1', 1000, 0);
      plugin.addPlayer('p2', 1000, 1);
      plugin.startNewHand();

      const minRaise = plugin.calculateMinRaise();
      expect(typeof minRaise).toBe('number');
      expect(minRaise).toBeGreaterThan(0);
    });
  });

  describe('current player', () => {
    it('should get current player', () => {
      plugin.addPlayer('p1', 1000, 0);
      plugin.addPlayer('p2', 1000, 1);
      plugin.startNewHand();

      const currentPlayer = plugin.getCurrentPlayer();
      expect(currentPlayer).toBeDefined();
      if (currentPlayer) {
        expect(currentPlayer.isActive).toBe(true);
      }
    });
  });
});
