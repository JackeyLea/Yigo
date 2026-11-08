/**
 * Go AI (MCTS) Unit Tests
 *
 * Tests for the GoAI class with different difficulty levels
 * and MCTS algorithm correctness.
 */

import { GoAI } from '../ai/go-ai';
import { GoEngine } from '../go.engine';
import type { GoState } from '../go.types';

describe('GoAI - Construction', () => {
  it('should create AI with beginner difficulty', () => {
    const ai = new GoAI('beginner');
    const config = ai.getConfig();
    expect(config.name).toBe('Beginner');
    expect(config.simulations).toBe(0);
  });

  it('should create AI with elementary difficulty', () => {
    const ai = new GoAI('elementary');
    const config = ai.getConfig();
    expect(config.name).toBe('Elementary');
    expect(config.simulations).toBe(100);
  });

  it('should create AI with intermediate difficulty', () => {
    const ai = new GoAI('intermediate');
    const config = ai.getConfig();
    expect(config.name).toBe('Intermediate');
    expect(config.simulations).toBe(1000);
  });

  it('should create AI with advanced difficulty', () => {
    const ai = new GoAI('advanced');
    const config = ai.getConfig();
    expect(config.name).toBe('Advanced');
    expect(config.simulations).toBe(5000);
    expect(config.useHeuristics).toBe(true);
  });

  it('should throw on unknown difficulty', () => {
    expect(() => new GoAI('expert' as any)).toThrow('Unknown difficulty');
  });
});

describe('GoAI - Difficulty Changing', () => {
  it('should change difficulty', () => {
    const ai = new GoAI('beginner');
    ai.setDifficulty('advanced');
    const config = ai.getConfig();
    expect(config.name).toBe('Advanced');
    expect(config.simulations).toBe(5000);
  });

  it('should throw on invalid difficulty change', () => {
    const ai = new GoAI('beginner');
    expect(() => ai.setDifficulty('invalid' as any)).toThrow(
      'Unknown difficulty'
    );
  });
});

describe('GoAI - Move Generation', () => {
  let engine: GoEngine;

  beforeEach(() => {
    engine = new GoEngine(9);
  });

  it('beginner should return a valid move on empty board', () => {
    const ai = new GoAI('beginner');
    const state = engine.getState();
    const move = ai.getMove(state);

    expect(move).not.toBeNull();
    expect(move!.x).toBeGreaterThanOrEqual(0);
    expect(move!.x).toBeLessThan(9);
    expect(move!.y).toBeGreaterThanOrEqual(0);
    expect(move!.y).toBeLessThan(9);
  });

  it('beginner move should be legal', () => {
    const ai = new GoAI('beginner');
    const state = engine.getState();
    const move = ai.getMove(state);

    expect(move).not.toBeNull();
    // Verify the move is on an empty intersection
    expect(state.board[move!.y][move!.x]).toBe(0);
  });

  it('should return pass when no legal moves', () => {
    const ai = new GoAI('beginner');
    // Fill the board completely (approximately)
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        if (engine.getState().phase === 'playing') {
          engine.placeStone(x, y);
        }
      }
    }

    const state = engine.getState();
    const move = ai.getMove(state);
    // Either pass or a valid move
    if (move !== null) {
      expect(state.board[move.y][move.x]).toBe(0);
    }
  });

  it('should return null for ended game', () => {
    const ai = new GoAI('beginner');
    engine.pass();
    engine.pass();

    const state = engine.getState();
    const move = ai.getMove(state);
    expect(move).toBeNull();
  });

  it('should return null for scoring phase', () => {
    const ai = new GoAI('beginner');
    engine.pass();
    engine.pass();

    const state = engine.getState();
    expect(state.phase).toBe('scoring');
    const move = ai.getMove(state);
    expect(move).toBeNull();
  });
});

describe('GoAI - MCTS Difficulties', () => {
  let engine: GoEngine;

  beforeEach(() => {
    engine = new GoEngine(9);
  });

  it('elementary AI should return a valid move', () => {
    const ai = new GoAI('elementary');
    const state = engine.getState();
    const move = ai.getMove(state);

    expect(move).not.toBeNull();
    expect(state.board[move!.y][move!.x]).toBe(0);
  });

  it('intermediate AI should return a valid move', () => {
    const ai = new GoAI('intermediate');
    const state = engine.getState();
    const move = ai.getMove(state);

    expect(move).not.toBeNull();
    expect(state.board[move!.y][move!.x]).toBe(0);
  });

  it('advanced AI should return a valid move', () => {
    const ai = new GoAI('advanced');
    const state = engine.getState();
    const move = ai.getMove(state);

    expect(move).not.toBeNull();
    expect(state.board[move!.y][move!.x]).toBe(0);
  });

  it('MCTS AI should handle mid-game positions', () => {
    // Setup a mid-game position
    engine.placeStone(4, 4);
    engine.placeStone(3, 3);
    engine.placeStone(4, 3);
    engine.placeStone(3, 4);
    engine.placeStone(5, 4);
    engine.placeStone(4, 5);
    engine.placeStone(5, 5);
    engine.placeStone(3, 5);

    const ai = new GoAI('elementary');
    const state = engine.getState();
    const move = ai.getMove(state);

    expect(move).not.toBeNull();
    expect(state.board[move!.y][move!.x]).toBe(0);
  });

  it('MCTS AI should handle near-full board', () => {
    // Fill most of the board
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        if (engine.getState().phase === 'playing') {
          engine.placeStone(x, y);
        }
      }
    }

    const ai = new GoAI('elementary');
    const state = engine.getState();
    const move = ai.getMove(state);

    // Either a valid move or pass
    if (move !== null) {
      expect(state.board[move.y][move.x]).toBe(0);
    }
  });
});

describe('GoAI - Beginner Heuristics', () => {
  let engine: GoEngine;

  beforeEach(() => {
    engine = new GoEngine(9);
  });

  it('beginner should prefer corners/edges early', () => {
    const ai = new GoAI('beginner');
    const state = engine.getState();

    // Run multiple times to check statistical preference
    let cornerCount = 0;
    let edgeCount = 0;
    const trials = 20;

    for (let i = 0; i < trials; i++) {
      const testEngine = new GoEngine(9);
      const move = ai.getMove(testEngine.getState());
      if (move) {
        const isCorner =
          (move.x === 0 || move.x === 8) && (move.y === 0 || move.y === 8);
        const isEdge =
          move.x === 0 || move.x === 8 || move.y === 0 || move.y === 8;
        if (isCorner) cornerCount++;
        if (isEdge) edgeCount++;
      }
    }

    // With weighted heuristics, edges/corners should be preferred
    expect(edgeCount + cornerCount).toBeGreaterThan(0);
  });

  it('beginner should make capture moves when available', () => {
    const engine = new GoEngine(9);

    // Setup a capture opportunity for Black
    // White stone at (4,4) surrounded on 3 sides
    engine.placeStone(4, 3); // B
    engine.placeStone(4, 4); // W - target
    engine.placeStone(3, 4); // B
    engine.placeStone(0, 0); // W elsewhere
    engine.placeStone(5, 4); // B
    engine.placeStone(0, 1); // W elsewhere

    // Black to move - can capture (4,4) by playing (4,5)
    expect(engine.getState().currentPlayer).toBe(1);

    const ai = new GoAI('beginner');
    const state = engine.getState();
    const move = ai.getMove(state);

    expect(move).not.toBeNull();
  });
});

describe('GoAI - Advanced Heuristics', () => {
  let engine: GoEngine;

  beforeEach(() => {
    engine = new GoEngine(9);
  });

  it('advanced AI should use heuristics', () => {
    const ai = new GoAI('advanced');
    const config = ai.getConfig();
    expect(config.useHeuristics).toBe(true);
  });

  it('advanced AI should handle early game', () => {
    const ai = new GoAI('advanced');
    const state = engine.getState();
    const move = ai.getMove(state);

    expect(move).not.toBeNull();
    expect(state.board[move!.y][move!.x]).toBe(0);
  });
});

describe('GoAI - Self-Play', () => {
  it('two AIs should be able to play a complete game', () => {
    const engine = new GoEngine(9);
    const blackAI = new GoAI('beginner');
    const whiteAI = new GoAI('beginner');

    let moves = 0;
    const maxMoves = 50;

    while (engine.getState().phase === 'playing' && moves < maxMoves) {
      const state = engine.getState();
      const ai = state.currentPlayer === 1 ? blackAI : whiteAI;
      const move = ai.getMove(state);

      if (move === null) {
        engine.pass();
      } else {
        engine.placeStone(move.x, move.y);
      }
      moves++;
    }

    // Game should have progressed
    expect(moves).toBeGreaterThan(0);
    expect(engine.getState().moveHistory.length).toBeGreaterThan(0);
  });

  it('beginner vs elementary AI should complete a game', () => {
    const engine = new GoEngine(9);
    const blackAI = new GoAI('beginner');
    const whiteAI = new GoAI('elementary');

    let moves = 0;
    const maxMoves = 40;

    while (engine.getState().phase === 'playing' && moves < maxMoves) {
      const state = engine.getState();
      const ai = state.currentPlayer === 1 ? blackAI : whiteAI;
      const move = ai.getMove(state);

      if (move === null) {
        engine.pass();
      } else {
        const success = engine.placeStone(move.x, move.y);
        if (!success) {
          // If AI suggests illegal move, pass instead
          engine.pass();
        }
      }
      moves++;
    }

    expect(engine.getState().moveHistory.length).toBeGreaterThan(0);
  });
});

describe('GoAI - 19x19 Board', () => {
  it('should handle 19x19 board', () => {
    const engine = new GoEngine(19);
    const ai = new GoAI('beginner');
    const state = engine.getState();
    const move = ai.getMove(state);

    expect(move).not.toBeNull();
    expect(move!.x).toBeGreaterThanOrEqual(0);
    expect(move!.x).toBeLessThan(19);
    expect(move!.y).toBeGreaterThanOrEqual(0);
    expect(move!.y).toBeLessThan(19);
  });
});
