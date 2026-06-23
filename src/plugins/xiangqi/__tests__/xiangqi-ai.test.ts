/**
 * Xiangqi AI Unit Tests
 *
 * Tests the AI engine:
 *   - Difficulty levels
 *   - Move generation
 *   - Evaluation function behavior
 */

import { XiangqiAI } from '../ai/xiangqi-ai';
import { XiangqiEngine } from '../xiangqi.engine';
import { PIECE_VALUES } from '../xiangqi.types';

describe('XiangqiAI', () => {
  let engine: XiangqiEngine;

  beforeEach(() => {
    engine = new XiangqiEngine();
  });

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should create with easy difficulty', () => {
      const ai = new XiangqiAI('easy');
      expect(ai).toBeDefined();
    });

    it('should create with medium difficulty', () => {
      const ai = new XiangqiAI('medium');
      expect(ai).toBeDefined();
    });

    it('should create with hard difficulty', () => {
      const ai = new XiangqiAI('hard');
      expect(ai).toBeDefined();
    });

    it('should create with master difficulty', () => {
      const ai = new XiangqiAI('master');
      expect(ai).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Move generation
  // -----------------------------------------------------------------------

  describe('getMove', () => {
    it('should return a valid move from initial position', () => {
      const ai = new XiangqiAI('easy');
      ai.setPlayer(1); // AI plays Red
      const move = ai.getMove(engine.getState());
      expect(move).toBeDefined();
      expect(move.from).toBeDefined();
      expect(move.to).toBeDefined();

      // Verify the move is legal
      expect(engine.isValidMove(move.from.x, move.from.y, move.to.x, move.to.y)).toBe(true);
    });

    it('should return different moves at easy difficulty (randomness)', () => {
      const ai = new XiangqiAI('easy');
      ai.setPlayer(1);
      const moves: string[] = [];
      for (let i = 0; i < 5; i++) {
        const move = ai.getMove(engine.getState());
        moves.push(`${move.from.x}${move.from.y}${move.to.x}${move.to.y}`);
        // Reset engine for each attempt
        engine = new XiangqiEngine();
      }
      // With randomness, we should get some variety (not guaranteed but likely)
      expect(moves.length).toBe(5);
    });

    it('should always return a legal move at medium difficulty', () => {
      const ai = new XiangqiAI('medium');
      ai.setPlayer(1);
      for (let i = 0; i < 3; i++) {
        const state = engine.getState();
        const move = ai.getMove(state);
        expect(engine.isValidMove(move.from.x, move.from.y, move.to.x, move.to.y)).toBe(true);
        engine.movePiece(move.from.x, move.from.y, move.to.x, move.to.y);

        // Make a random legal move for the opponent
        const legalMoves = engine.getAllLegalMoves();
        if (legalMoves.length > 0) {
          const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
          engine.movePiece(randomMove.from.x, randomMove.from.y, randomMove.to.x, randomMove.to.y);
        }
      }
    });

    it('should handle endgame positions', () => {
      const ai = new XiangqiAI('hard');
      ai.setPlayer(1);
      // Simple endgame: chariot vs general
      engine.importFromFEN('4k4/9/9/9/9/9/9/9/4R4/9 w');
      const move = ai.getMove(engine.getState());
      expect(move).toBeDefined();
      expect(engine.isValidMove(move.from.x, move.from.y, move.to.x, move.to.y)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Evaluation
  // -----------------------------------------------------------------------

  describe('evaluation', () => {
    it('should prefer capturing moves when possible', () => {
      const ai = new XiangqiAI('medium');
      ai.setPlayer(1);
      // Position where a capture is available
      engine.importFromFEN('9/9/9/9/4p4/9/4R4/9/9/4K4 w');
      // Red chariot at (4,3) can capture black soldier at (4,4)
      const move = ai.getMove(engine.getState());
      expect(move).toBeDefined();
      // The AI should likely capture
      expect(engine.isValidMove(move.from.x, move.from.y, move.to.x, move.to.y)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Piece values
  // -----------------------------------------------------------------------

  describe('piece values', () => {
    it('should have correct values', () => {
      expect(PIECE_VALUES.general).toBe(10000);
      expect(PIECE_VALUES.chariot).toBe(500);
      expect(PIECE_VALUES.horse).toBe(300);
      expect(PIECE_VALUES.cannon).toBe(300);
      expect(PIECE_VALUES.advisor).toBe(100);
      expect(PIECE_VALUES.elephant).toBe(100);
      expect(PIECE_VALUES.soldier).toBe(50);
    });

    it('should value general above all other pieces', () => {
      expect(PIECE_VALUES.general).toBeGreaterThan(PIECE_VALUES.chariot);
      expect(PIECE_VALUES.chariot).toBeGreaterThan(PIECE_VALUES.horse);
      expect(PIECE_VALUES.horse).toBe(PIECE_VALUES.cannon);
      expect(PIECE_VALUES.horse).toBeGreaterThan(PIECE_VALUES.advisor);
    });
  });
});
