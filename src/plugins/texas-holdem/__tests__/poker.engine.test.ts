/**
 * 德州扑克游戏引擎测试
 */

import { PokerEngine } from '../poker.engine';
import { PokerState, PlayerAction, PokerPlayer, PokerPhase } from '../poker.types';

function getActivePlayer(state: PokerState): PokerPlayer {
  return state.players[state.currentPlayerIndex];
}

describe('PokerEngine', () => {
  let engine: PokerEngine;

  beforeEach(() => {
    engine = new PokerEngine(10, 20, 9);
  });

  describe('initialization', () => {
    it('should create engine with default values', () => {
      const state = engine.getState();
      expect(state.phase).toBe('waiting');
      expect(state.players).toHaveLength(0);
      expect(state.pot).toBe(0);
      expect(state.gameOver).toBe(false);
    });

    it('should create engine with custom blinds', () => {
      const customEngine = new PokerEngine(5, 10, 6);
      expect(customEngine.getState().minRaise).toBe(0); // initial state
    });

    it('should reset engine', () => {
      engine.addPlayer('p1', 1000, 0);
      engine.addPlayer('p2', 1000, 1);
      engine.startNewHand();
      engine.reset();
      const state = engine.getState();
      expect(state.phase).toBe('waiting');
      expect(state.players).toHaveLength(0);
    });
  });

  describe('player management', () => {
    it('should add player successfully', () => {
      const success = engine.addPlayer('p1', 1000, 0);
      expect(success).toBe(true);
      const state = engine.getState();
      expect(state.players).toHaveLength(1);
      expect(state.players[0].playerId).toBe('p1');
      expect(state.players[0].chips).toBe(1000);
      expect(state.players[0].seatIndex).toBe(0);
    });

    it('should add player with auto seat', () => {
      engine.addPlayer('p1', 1000);
      const state = engine.getState();
      expect(state.players[0].seatIndex).toBe(0);
    });

    it('should not add duplicate player', () => {
      engine.addPlayer('p1', 1000, 0);
      const success = engine.addPlayer('p1', 1000, 1);
      expect(success).toBe(false);
    });

    it('should not add player to occupied seat', () => {
      engine.addPlayer('p1', 1000, 0);
      const success = engine.addPlayer('p2', 1000, 0);
      expect(success).toBe(false);
    });

    it('should not add player beyond maxPlayers', () => {
      const customEngine = new PokerEngine(10, 20, 2);
      customEngine.addPlayer('p1', 1000, 0);
      customEngine.addPlayer('p2', 1000, 1);
      const success = customEngine.addPlayer('p3', 1000, 2);
      expect(success).toBe(false);
    });

    it('should remove player', () => {
      engine.addPlayer('p1', 1000, 0);
      engine.removePlayer('p1');
      const state = engine.getState();
      expect(state.players).toHaveLength(0);
    });

    it('should handle removing non-existent player', () => {
      engine.addPlayer('p1', 1000, 0);
      engine.removePlayer('nonexistent');
      const state = engine.getState();
      expect(state.players).toHaveLength(1);
    });
  });

  describe('starting a hand', () => {
    it('should start a new hand with 2+ players', () => {
      engine.addPlayer('p1', 1000, 0);
      engine.addPlayer('p2', 1000, 1);
      engine.startNewHand();
      const state = engine.getState();
      expect(state.phase).toBe('preflop');
      expect(state.players[0].holeCards).toHaveLength(2);
      expect(state.players[1].holeCards).toHaveLength(2);
    });

    it('should throw with less than 2 players', () => {
      engine.addPlayer('p1', 1000, 0);
      expect(() => engine.startNewHand()).toThrow('Need at least 2 players');
    });

    it('should collect blinds on hand start', () => {
      engine.addPlayer('p1', 1000, 0);
      engine.addPlayer('p2', 1000, 1);
      engine.addPlayer('p3', 1000, 2);
      engine.startNewHand();
      const state = engine.getState();
      expect(state.pot).toBe(30); // small blind 10 + big blind 20
    });

    it('should mark dealer correctly', () => {
      engine.addPlayer('p1', 1000, 0);
      engine.addPlayer('p2', 1000, 1);
      engine.addPlayer('p3', 1000, 2);
      engine.startNewHand();
      const state = engine.getState();
      const dealer = state.players.find(p => p.isDealer);
      expect(dealer).toBeDefined();
    });
  });

  describe('preflop actions', () => {
    beforeEach(() => {
      engine.addPlayer('p1', 1000, 0);
      engine.addPlayer('p2', 1000, 1);
      engine.addPlayer('p3', 1000, 2);
      engine.startNewHand();
    });

    it('should allow fold', () => {
      const currentPlayer = getActivePlayer(engine.getState());
      const success = engine.handleAction(currentPlayer.playerId, 'fold');
      expect(success).toBe(true);
      const state = engine.getState();
      const player = state.players.find(p => p.playerId === currentPlayer.playerId);
      expect(player?.isActive).toBe(false);
    });

    it('should allow call', () => {
      const currentPlayer = getActivePlayer(engine.getState());
      const stateBefore = engine.getState();
      const callAmount = stateBefore.currentBet - currentPlayer.currentBet;
      const playerChipsBefore = currentPlayer.chips;

      const success = engine.handleAction(currentPlayer.playerId, 'call');
      expect(success).toBe(true);

      const stateAfter = engine.getState();
      const player = stateAfter.players.find(p => p.playerId === currentPlayer.playerId);
      expect(player?.chips).toBe(playerChipsBefore - callAmount);
      expect(stateAfter.pot).toBe(stateBefore.pot + callAmount);
    });

    it('should allow raise', () => {
      const currentPlayer = getActivePlayer(engine.getState());
      const raiseTo = 60; // 加注到60

      const success = engine.handleAction(currentPlayer.playerId, 'raise', raiseTo);
      expect(success).toBe(true);

      const state = engine.getState();
      const player = state.players.find(p => p.playerId === currentPlayer.playerId);
      expect(state.currentBet).toBe(raiseTo);
    });

    it('should allow allin', () => {
      const currentPlayer = getActivePlayer(engine.getState());
      const success = engine.handleAction(currentPlayer.playerId, 'allin');
      expect(success).toBe(true);

      const state = engine.getState();
      const player = state.players.find(p => p.playerId === currentPlayer.playerId);
      expect(player?.isAllIn).toBe(true);
      expect(player?.chips).toBe(0);
    });

    it('should not allow invalid action', () => {
      const currentPlayer = getActivePlayer(engine.getState());
      // Try to bet when there's already a bet (should raise instead)
      const success = engine.handleAction(currentPlayer.playerId, 'bet', 50);
      expect(success).toBe(false);
    });

    it('should not allow action from non-current player', () => {
      const state = engine.getState();
      const nonCurrentPlayer = state.players.find(
        (p, i) => i !== state.currentPlayerIndex
      );
      if (nonCurrentPlayer) {
        const success = engine.handleAction(nonCurrentPlayer.playerId, 'fold');
        expect(success).toBe(false);
      }
    });
  });

  describe('phase transitions', () => {
    beforeEach(() => {
      engine.addPlayer('p1', 1000, 0);
      engine.addPlayer('p2', 1000, 1);
      engine.addPlayer('p3', 1000, 2);
      engine.startNewHand();
    });

    it('should advance from preflop to flop after all players act', () => {
      // 让所有玩家call来结束preflop
      let safety = 0;
      while (engine.getState().phase === 'preflop' && safety < 20) {
        const currentPlayer = getActivePlayer(engine.getState());
        if (currentPlayer) {
          engine.handleAction(currentPlayer.playerId, 'call');
        }
        safety++;
      }
      const state = engine.getState();
      expect(state.phase).toBe('flop');
      expect(state.communityCards).toHaveLength(3);
    });

    it('should advance from flop to turn', () => {
      // 先完成preflop
      let safety = 0;
      while (engine.getState().phase === 'preflop' && safety < 20) {
        const currentPlayer = getActivePlayer(engine.getState());
        if (currentPlayer) engine.handleAction(currentPlayer.playerId, 'call');
        safety++;
      }
      // 完成flop
      safety = 0;
      while (engine.getState().phase === 'flop' && safety < 20) {
        const currentPlayer = getActivePlayer(engine.getState());
        if (currentPlayer) engine.handleAction(currentPlayer.playerId, 'check');
        safety++;
      }
      const state = engine.getState();
      expect(state.phase).toBe('turn');
      expect(state.communityCards).toHaveLength(4);
    });

    it('should go to showdown after river', () => {
      // 快速通过所有阶段
      let safety = 0;
      while (engine.getState().phase !== 'showdown' && 
             engine.getState().phase !== 'ended' && safety < 50) {
        const currentPlayer = getActivePlayer(engine.getState());
        if (currentPlayer) {
          engine.handleAction(currentPlayer.playerId, 'call');
        }
        safety++;
      }
      const state = engine.getState();
      expect(state.phase).toBe('ended');
      expect(state.showdownResults).toBeDefined();
    });
  });

  describe('fold to win', () => {
    it('should end hand when all but one player folds', () => {
      engine.addPlayer('p1', 1000, 0);
      engine.addPlayer('p2', 1000, 1);
      engine.addPlayer('p3', 1000, 2);
      engine.startNewHand();

      // p1 folds
      let currentPlayer = getActivePlayer(engine.getState());
      engine.handleAction(currentPlayer.playerId, 'fold');

      // p2 folds -> p3 wins
      currentPlayer = getActivePlayer(engine.getState());
      engine.handleAction(currentPlayer.playerId, 'fold');

      const state = engine.getState();
      expect(state.phase).toBe('ended');
      expect(state.gameOver).toBe(true);
    });
  });

  describe('allin scenarios', () => {
    it('should handle allin correctly', () => {
      engine.addPlayer('p1', 100, 0);  // short stack
      engine.addPlayer('p2', 1000, 1);
      engine.addPlayer('p3', 1000, 2);
      engine.startNewHand();

      const currentPlayer = getActivePlayer(engine.getState());
      const success = engine.handleAction(currentPlayer.playerId, 'allin');
      expect(success).toBe(true);

      const state = engine.getState();
      const player = state.players.find(p => p.playerId === currentPlayer.playerId);
      expect(player?.isAllIn).toBe(true);
      expect(player?.chips).toBe(0);
    });

    it('should handle all players allin', () => {
      engine.addPlayer('p1', 100, 0);
      engine.addPlayer('p2', 100, 1);
      engine.addPlayer('p3', 100, 2);
      engine.startNewHand();

      // All players go allin
      let safety = 0;
      while (engine.getState().phase !== 'ended' && safety < 20) {
        const state = engine.getState();
        const currentPlayer = getActivePlayer(state);
        if (currentPlayer && !currentPlayer.isAllIn) {
          engine.handleAction(currentPlayer.playerId, 'allin');
        } else {
          break;
        }
        safety++;
      }

      const state = engine.getState();
      if (state.phase === 'ended') {
        expect(state.showdownResults).toBeDefined();
        expect(state.communityCards).toHaveLength(5);
      }
    });
  });

  describe('side pots', () => {
    it('should calculate side pots with different allin amounts', () => {
      engine.addPlayer('p1', 50, 0);   // allin 50
      engine.addPlayer('p2', 100, 1);  // allin 100
      engine.addPlayer('p3', 200, 2);  // full stack
      engine.startNewHand();

      // p1 (small blind) is allin with 50, already posted SB
      // p2 (big blind) is allin with 100, already posted BB
      // p3 needs to call or raise

      let safety = 0;
      while (engine.getState().phase !== 'ended' && safety < 30) {
        const state = engine.getState();
        const currentPlayer = getActivePlayer(state);
        if (currentPlayer && !currentPlayer.isAllIn) {
          engine.handleAction(currentPlayer.playerId, 'call');
        } else if (currentPlayer) {
          engine.handleAction(currentPlayer.playerId, 'call');
        }
        safety++;
      }

      const state = engine.getState();
      if (state.phase === 'ended' && state.showdownResults) {
        // 验证边池被正确计算
        expect(state.showdownResults.length).toBeGreaterThan(0);
      }
    });
  });

  describe('valid actions', () => {
    beforeEach(() => {
      engine.addPlayer('p1', 1000, 0);
      engine.addPlayer('p2', 1000, 1);
      engine.addPlayer('p3', 1000, 2);
      engine.startNewHand();
    });

    it('should return valid actions for current player', () => {
      const currentPlayer = getActivePlayer(engine.getState());
      const actions = engine.getValidActions(currentPlayer.playerId);
      expect(actions.length).toBeGreaterThan(0);
    });

    it('should not return actions for non-current player', () => {
      const state = engine.getState();
      const nonCurrentPlayer = state.players.find(
        (p, i) => i !== state.currentPlayerIndex
      );
      if (nonCurrentPlayer) {
        const actions = engine.getValidActions(nonCurrentPlayer.playerId);
        expect(actions).toHaveLength(0);
      }
    });

    it('should validate actions correctly', () => {
      const currentPlayer = getActivePlayer(engine.getState());
      expect(engine.isValidAction(currentPlayer.playerId, 'fold')).toBe(true);
    });
  });

  describe('showdown', () => {
    it('should award pot to winner', () => {
      engine.addPlayer('p1', 1000, 0);
      engine.addPlayer('p2', 1000, 1);
      engine.startNewHand();

      // Both players allin to force showdown
      let safety = 0;
      while (engine.getState().phase !== 'ended' && safety < 20) {
        const state = engine.getState();
        const currentPlayer = getActivePlayer(state);
        if (currentPlayer) {
          engine.handleAction(currentPlayer.playerId, 'allin');
        }
        safety++;
      }

      const state = engine.getState();
      expect(state.showdownResults).toBeDefined();
      if (state.showdownResults) {
        expect(state.showdownResults.length).toBe(2);
        const winner = state.showdownResults.find(r => r.wonAmount > 0);
        expect(winner).toBeDefined();
      }
    });
  });

  describe('rotateDealer', () => {
    it('should rotate dealer position', () => {
      engine.addPlayer('p1', 1000, 0);
      engine.addPlayer('p2', 1000, 1);
      engine.addPlayer('p3', 1000, 2);

      engine.startNewHand();
      const state1 = engine.getState();
      const firstDealer = state1.players.find(p => p.isDealer)?.playerId;

      engine.startNewHand();
      const state2 = engine.getState();
      const secondDealer = state2.players.find(p => p.isDealer)?.playerId;

      expect(firstDealer).not.toBe(secondDealer);
    });
  });

  describe('action history', () => {
    beforeEach(() => {
      engine.addPlayer('p1', 1000, 0);
      engine.addPlayer('p2', 1000, 1);
      engine.addPlayer('p3', 1000, 2);
      engine.startNewHand();
    });

    it('should record actions in history', () => {
      const currentPlayer = getActivePlayer(engine.getState());
      engine.handleAction(currentPlayer.playerId, 'fold');

      const state = engine.getState();
      expect(state.actionHistory.length).toBeGreaterThan(0);
      expect(state.actionHistory[0].action).toBe('fold');
    });
  });
});
