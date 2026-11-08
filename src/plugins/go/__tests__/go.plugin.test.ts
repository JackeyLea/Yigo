/**
 * Go Plugin Unit Tests
 *
 * Tests for the GoPlugin main class including event system,
 * game management, and AI integration.
 */

import { GoPlugin } from '../go.plugin';
import type { GoSettings, GoGameOptions } from '../go.types';

describe('GoPlugin - Construction', () => {
  it('should create plugin with default settings', () => {
    const plugin = new GoPlugin();
    expect(plugin.name).toBe('go');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.gameType).toBe('go');
  });

  it('should accept custom settings', () => {
    const plugin = new GoPlugin({ defaultBoardSize: 9, defaultKomi: 6.5 });
    const settings = plugin.getSettings();
    expect(settings.defaultBoardSize).toBe(9);
    expect(settings.defaultKomi).toBe(6.5);
  });
});

describe('GoPlugin - Lifecycle', () => {
  it('should initialize', () => {
    const plugin = new GoPlugin();
    const listener = jest.fn();
    plugin.on('plugin:initialized', listener);
    plugin.init();
    expect(listener).toHaveBeenCalled();
  });

  it('should initialize with settings', () => {
    const plugin = new GoPlugin();
    plugin.init({ defaultBoardSize: 13, theme: 'dark' });
    expect(plugin.getSettings().defaultBoardSize).toBe(13);
    expect(plugin.getSettings().theme).toBe('dark');
  });

  it('should start a game', () => {
    const plugin = new GoPlugin();
    const listener = jest.fn();
    plugin.on('game:started', listener);
    plugin.startGame();
    expect(listener).toHaveBeenCalled();
    expect(plugin.isActive()).toBe(true);
  });

  it('should start game with options', () => {
    const plugin = new GoPlugin();
    plugin.startGame({ boardSize: 9, komi: 6.5, handicap: 2 });
    expect(plugin.getBoardSize()).toBe(9);
    expect(plugin.getKomi()).toBe(6.5);
    expect(plugin.getHandicap()).toBe(2);
  });

  it('should end a game', () => {
    const plugin = new GoPlugin();
    plugin.startGame();
    const listener = jest.fn();
    plugin.on('game:ended', listener);
    plugin.endGame();
    expect(plugin.isActive()).toBe(false);
  });

  it('should reset game', () => {
    const plugin = new GoPlugin();
    plugin.startGame();
    plugin.placeStone(4, 4);
    plugin.resetGame();
    const state = plugin.getState();
    expect(state).not.toBeNull();
    expect(state!.board[4][4]).toBe(0);
  });

  it('should throw on invalid board size', () => {
    const plugin = new GoPlugin();
    expect(() => plugin.startGame({ boardSize: 15 as any })).toThrow(
      'Invalid board size'
    );
  });
});

describe('GoPlugin - Player Actions', () => {
  let plugin: GoPlugin;

  beforeEach(() => {
    plugin = new GoPlugin();
    plugin.startGame({ boardSize: 9 });
  });

  it('should place a stone', () => {
    const result = plugin.placeStone(4, 4);
    expect(result).toBe(true);
    expect(plugin.getState()!.board[4][4]).toBe(1);
  });

  it('should not place on occupied position', () => {
    plugin.placeStone(4, 4);
    const result = plugin.placeStone(4, 4);
    expect(result).toBe(false);
  });

  it('should not place when game not active', () => {
    plugin.endGame();
    const result = plugin.placeStone(4, 4);
    expect(result).toBe(false);
  });

  it('should pass', () => {
    plugin.pass();
    expect(plugin.getState()!.consecutivePasses).toBe(1);
  });

  it('should emit move event', () => {
    const listener = jest.fn();
    plugin.on('game:move', listener);
    plugin.placeStone(4, 4);
    expect(listener).toHaveBeenCalled();
  });

  it('should emit pass event', () => {
    const listener = jest.fn();
    plugin.on('game:pass', listener);
    plugin.pass();
    expect(listener).toHaveBeenCalled();
  });
});

describe('GoPlugin - Queries', () => {
  let plugin: GoPlugin;

  beforeEach(() => {
    plugin = new GoPlugin();
    plugin.startGame({ boardSize: 9 });
  });

  it('should get state', () => {
    const state = plugin.getState();
    expect(state).not.toBeNull();
    expect(state!.boardSize).toBe(9);
  });

  it('should check valid move', () => {
    expect(plugin.isValidMove(4, 4)).toBe(true);
    plugin.placeStone(4, 4);
    expect(plugin.isValidMove(4, 4)).toBe(false);
  });

  it('should get legal moves', () => {
    const moves = plugin.getLegalMoves();
    expect(moves.length).toBe(81); // Empty 9x9 board
  });

  it('should get liberties', () => {
    plugin.placeStone(4, 4);
    const liberties = plugin.getLiberties(4, 4);
    expect(liberties.length).toBe(4);
  });

  it('should get group', () => {
    plugin.placeStone(4, 4);
    const group = plugin.getGroup(4, 4);
    expect(group.length).toBe(1);
  });

  it('should get move history', () => {
    plugin.placeStone(4, 4);
    plugin.placeStone(3, 3);
    const history = plugin.getMoveHistory();
    expect(history.length).toBe(2);
  });

  it('should get last move', () => {
    plugin.placeStone(4, 4);
    const lastMove = plugin.getLastMove();
    expect(lastMove).not.toBeNull();
    expect(lastMove!.x).toBe(4);
    expect(lastMove!.y).toBe(4);
  });

  it('should get captures', () => {
    const captures = plugin.getCaptures();
    expect(captures).toEqual({ black: 0, white: 0 });
  });

  it('should get phase', () => {
    expect(plugin.getPhase()).toBe('playing');
  });

  it('should get current player', () => {
    expect(plugin.getCurrentPlayer()).toBe(1);
    plugin.placeStone(4, 4);
    expect(plugin.getCurrentPlayer()).toBe(2);
  });

  it('should get board size', () => {
    expect(plugin.getBoardSize()).toBe(9);
  });

  it('should get komi', () => {
    expect(plugin.getKomi()).toBe(7.5);
  });

  it('should get handicap', () => {
    expect(plugin.getHandicap()).toBe(0);
  });

  it('should get consecutive passes', () => {
    expect(plugin.getConsecutivePasses()).toBe(0);
    plugin.pass();
    expect(plugin.getConsecutivePasses()).toBe(1);
  });

  it('should get ko position', () => {
    expect(plugin.getKoPosition()).toBeNull();
  });
});

describe('GoPlugin - Game End', () => {
  let plugin: GoPlugin;

  beforeEach(() => {
    plugin = new GoPlugin();
    plugin.startGame({ boardSize: 9 });
  });

  it('should end after two passes', () => {
    plugin.pass();
    plugin.pass();
    expect(plugin.getPhase()).toBe('scoring');
  });

  it('should get winner after scoring', () => {
    plugin.pass();
    plugin.pass();
    expect(plugin.getWinner()).not.toBeUndefined();
  });

  it('should check for draw', () => {
    plugin.pass();
    plugin.pass();
    expect(plugin.isDraw()).toBe(false); // With komi, unlikely draw
  });

  it('should emit phase change event', () => {
    const listener = jest.fn();
    plugin.on('game:phaseChange', listener);
    plugin.pass();
    plugin.pass();
    expect(listener).toHaveBeenCalled();
  });

  it('should emit end event', () => {
    const listener = jest.fn();
    plugin.on('game:ended', listener);
    plugin.pass();
    plugin.pass();
    expect(listener).toHaveBeenCalled();
  });
});

describe('GoPlugin - Scoring', () => {
  let plugin: GoPlugin;

  beforeEach(() => {
    plugin = new GoPlugin();
    plugin.startGame({ boardSize: 9 });
  });

  it('should get territory analysis', () => {
    const analysis = plugin.getTerritoryAnalysis();
    expect(analysis).not.toBeNull();
  });

  it('should get score detail', () => {
    const detail = plugin.getScoreDetail();
    expect(detail).not.toBeNull();
  });

  it('should confirm score', () => {
    plugin.pass();
    plugin.pass();
    plugin.confirmScore();
    expect(plugin.getPhase()).toBe('ended');
  });

  it('should mark dead stones', () => {
    plugin.placeStone(4, 4);
    plugin.placeStone(0, 0);
    plugin.pass();
    plugin.pass();
    plugin.markDeadStone(4, 4);
    const state = plugin.getState();
    expect(state!.deadStones.length).toBeGreaterThan(0);
  });

  it('should mark alive stones', () => {
    plugin.placeStone(4, 4);
    plugin.placeStone(0, 0);
    plugin.pass();
    plugin.pass();
    plugin.markDeadStone(4, 4);
    plugin.markAliveStone(4, 4);
    const state = plugin.getState();
    expect(state!.deadStones.length).toBe(0);
  });
});

describe('GoPlugin - SGF', () => {
  let plugin: GoPlugin;

  beforeEach(() => {
    plugin = new GoPlugin();
    plugin.startGame({ boardSize: 9 });
  });

  it('should export to SGF', () => {
    plugin.placeStone(4, 4);
    plugin.placeStone(3, 3);
    const sgf = plugin.exportToSGF();
    expect(sgf).toContain('GM[1]');
    expect(sgf).toContain('SZ[9]');
  });

  it('should import from SGF', () => {
    const sgf = '(;GM[1]FF[4]SZ[9]KM[7.5];B[ee];W[dd])';
    const listener = jest.fn();
    plugin.on('game:sgfImported', listener);
    plugin.importFromSGF(sgf);
    expect(listener).toHaveBeenCalled();
    expect(plugin.getBoardSize()).toBe(9);
  });

  it('should throw when SGF disabled', () => {
    plugin.updateSettings({ enableSGF: false });
    expect(() => plugin.exportToSGF()).toThrow('SGF support is disabled');
  });
});

describe('GoPlugin - Settings', () => {
  let plugin: GoPlugin;

  beforeEach(() => {
    plugin = new GoPlugin();
  });

  it('should get settings', () => {
    const settings = plugin.getSettings();
    expect(settings.defaultBoardSize).toBe(19);
  });

  it('should update settings', () => {
    plugin.updateSettings({ defaultBoardSize: 9, theme: 'dark' });
    const settings = plugin.getSettings();
    expect(settings.defaultBoardSize).toBe(9);
    expect(settings.theme).toBe('dark');
  });

  it('should emit settings updated event', () => {
    const listener = jest.fn();
    plugin.on('settings:updated', listener);
    plugin.updateSettings({ theme: 'dark' });
    expect(listener).toHaveBeenCalled();
  });
});

describe('GoPlugin - Event System', () => {
  let plugin: GoPlugin;

  beforeEach(() => {
    plugin = new GoPlugin();
    plugin.startGame({ boardSize: 9 });
  });

  it('should support event subscription', () => {
    const listener = jest.fn();
    plugin.on('game:move', listener);
    plugin.placeStone(4, 4);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should support event unsubscription', () => {
    const listener = jest.fn();
    plugin.on('game:move', listener);
    plugin.off('game:move', listener);
    plugin.placeStone(4, 4);
    expect(listener).not.toHaveBeenCalled();
  });

  it('should emit events with correct structure', () => {
    const listener = jest.fn();
    plugin.on('game:move', listener);
    plugin.placeStone(4, 4);
    const call = listener.mock.calls[0][0];
    expect(call).toHaveProperty('type', 'game:move');
    expect(call).toHaveProperty('payload');
    expect(call).toHaveProperty('timestamp');
  });

  it('should handle multiple listeners', () => {
    const listener1 = jest.fn();
    const listener2 = jest.fn();
    plugin.on('game:move', listener1);
    plugin.on('game:move', listener2);
    plugin.placeStone(4, 4);
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('should handle listener errors gracefully', () => {
    const errorListener = jest.fn(() => {
      throw new Error('Listener error');
    });
    const goodListener = jest.fn();
    plugin.on('game:move', errorListener);
    plugin.on('game:move', goodListener);
    // Should not throw
    expect(() => plugin.placeStone(4, 4)).not.toThrow();
    expect(goodListener).toHaveBeenCalled();
  });

  it('should support custom events', () => {
    const listener = jest.fn();
    plugin.on('custom:event', listener);
    plugin.emit('custom:event', { data: 'test' });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'custom:event',
        payload: { data: 'test' },
      })
    );
  });
});

describe('GoPlugin - Game Events Callback', () => {
  let plugin: GoPlugin;

  beforeEach(() => {
    plugin = new GoPlugin();
    plugin.startGame({ boardSize: 9 });
  });

  it('should set game event callbacks', () => {
    const onMove = jest.fn();
    plugin.setGameEvents({ onMove });
    plugin.placeStone(4, 4);
    expect(onMove).toHaveBeenCalled();
  });

  it('should call onPass callback', () => {
    const onPass = jest.fn();
    plugin.setGameEvents({ onPass });
    plugin.pass();
    expect(onPass).toHaveBeenCalled();
  });

  it('should call onPhaseChange callback', () => {
    const onPhaseChange = jest.fn();
    plugin.setGameEvents({ onPhaseChange });
    plugin.pass();
    plugin.pass();
    expect(onPhaseChange).toHaveBeenCalled();
  });

  it('should call onGameEnd callback', () => {
    const onGameEnd = jest.fn();
    plugin.setGameEvents({ onGameEnd });
    plugin.pass();
    plugin.pass();
    expect(onGameEnd).toHaveBeenCalled();
  });
});

describe('GoPlugin - AI', () => {
  let plugin: GoPlugin;

  beforeEach(() => {
    plugin = new GoPlugin({ enableAI: true, defaultAIDifficulty: 'beginner' });
  });

  it('should set AI difficulty', () => {
    plugin.startGame({ boardSize: 9 });
    plugin.setAIDifficulty('advanced');
    const config = plugin.getAIDifficulty();
    expect(config).not.toBeNull();
    expect(config!.name).toBe('Advanced');
  });

  it('should emit difficulty change event', () => {
    plugin.startGame({ boardSize: 9 });
    const listener = jest.fn();
    plugin.on('ai:difficultyChanged', listener);
    plugin.setAIDifficulty('advanced');
    expect(listener).toHaveBeenCalled();
  });

  it('should not be AI thinking initially', () => {
    plugin.startGame({ boardSize: 9 });
    expect(plugin.isAIThinking()).toBe(false);
  });
});

describe('GoPlugin - Factory', () => {
  it('should create with static factory', () => {
    const plugin = GoPlugin.create({ defaultBoardSize: 9 });
    expect(plugin).toBeInstanceOf(GoPlugin);
    expect(plugin.getSettings().defaultBoardSize).toBe(9);
  });
});

describe('GoPlugin - Complex Scenarios', () => {
  it('should handle a short complete game', () => {
    const plugin = new GoPlugin();
    plugin.startGame({ boardSize: 9 });

    // Play a few moves
    plugin.placeStone(4, 4);
    plugin.placeStone(3, 3);
    plugin.placeStone(4, 3);
    plugin.placeStone(3, 4);
    plugin.placeStone(5, 4);

    // Pass to end
    plugin.pass();
    plugin.pass();

    expect(plugin.getPhase()).toBe('scoring');
    expect(plugin.getState()!.moveHistory.length).toBe(7); // 5 moves + 2 passes
  });

  it('should handle game with captures', () => {
    const plugin = new GoPlugin();
    plugin.startGame({ boardSize: 9 });

    // Setup capture
    plugin.placeStone(4, 3); // B
    plugin.placeStone(0, 0); // W
    plugin.placeStone(3, 4); // B
    plugin.placeStone(4, 4); // W - stone to capture
    plugin.placeStone(5, 4); // B
    plugin.placeStone(0, 1); // W
    plugin.placeStone(4, 5); // B captures (4,4)

    const captures = plugin.getCaptures();
    expect(captures.black).toBeGreaterThan(0);
  });

  it('should handle no-AI game', () => {
    const plugin = new GoPlugin({ enableAI: false });
    plugin.startGame({ boardSize: 9 });

    // Both players human - alternate moves
    plugin.placeStone(4, 4); // Black
    plugin.placeStone(3, 3); // White
    plugin.placeStone(4, 3); // Black

    expect(plugin.getState()!.board[4][4]).toBe(1);
    expect(plugin.getState()!.board[3][3]).toBe(2);
  });
});
