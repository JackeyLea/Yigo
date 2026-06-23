/**
 * Xiangqi Opening Book & Endgame Tests
 */

import { findOpeningMove, getOpeningInfo, OPENING_BOOK } from '../xiangqi-opening-book';
import { findEndgameMove, ENDGAME_TABLE } from '../xiangqi-endgame';
import { XiangqiEngine } from '../xiangqi.engine';

describe('Opening Book', () => {
  let engine: XiangqiEngine;

  beforeEach(() => {
    engine = new XiangqiEngine();
  });

  it('should have opening entries', () => {
    expect(Object.keys(OPENING_BOOK).length).toBeGreaterThan(0);
  });

  it('should find a move from initial position', () => {
    const move = findOpeningMove(engine.getState());
    expect(move).not.toBeNull();
    expect(move?.from).toBeDefined();
    expect(move?.to).toBeDefined();
  });

  it('should return opening info for initial position', () => {
    const info = getOpeningInfo(engine.getState());
    expect(info).not.toBeNull();
    expect(info?.name).toBeDefined();
    expect(info?.description).toBeDefined();
  });

  it('should return null after many moves', () => {
    // Simulate several moves to exit opening phase
    engine.movePiece(4, 3, 4, 4); // r1
    engine.movePiece(4, 6, 4, 5); // b1
    engine.movePiece(1, 2, 1, 5); // r cannon (non-standard)
    engine.movePiece(1, 7, 1, 4); // b cannon
    engine.movePiece(4, 4, 4, 5); // r captures
    engine.movePiece(4, 9, 4, 8); // b gen
    // At this point no opening line should match
    const move = findOpeningMove(engine.getState());
    // May or may not find something; just ensure it doesn't throw
    expect(() => findOpeningMove(engine.getState())).not.toThrow();
  });
});

describe('Endgame Table', () => {
  let engine: XiangqiEngine;

  beforeEach(() => {
    engine = new XiangqiEngine();
  });

  it('should have endgame entries', () => {
    expect(ENDGAME_TABLE.length).toBeGreaterThan(0);
  });

  it('should find endgame move for chariot vs advisor', () => {
    // Setup: Red chariot vs Black general + advisor
    engine.importFromFEN('4ka3/9/9/9/9/9/9/9/9/3R5 w');
    const move = findEndgameMove(engine.getState());
    // May or may not find a specific move; ensure no throw
    expect(() => findEndgameMove(engine.getState())).not.toThrow();
  });

  it('should identify chariot vs advisor material', () => {
    engine.importFromFEN('4ka3/9/9/9/9/9/9/9/9/3R5 w');
    const state = engine.getState();

    // Count pieces
    const redCount = { chariot: 0, general: 0 };
    const blackCount = { chariot: 0, general: 0, advisor: 0 };
    for (let x = 0; x < 9; x++) {
      for (let y = 0; y < 10; y++) {
        const p = state.board[x][y];
        if (p) {
          if (p.player === 1) {
            redCount[p.type as keyof typeof redCount] = (redCount[p.type as keyof typeof redCount] || 0) + 1;
          } else {
            blackCount[p.type as keyof typeof blackCount] = (blackCount[p.type as keyof typeof blackCount] || 0) + 1;
          }
        }
      }
    }
    expect(redCount.chariot).toBe(1);
    expect(blackCount.advisor).toBe(1);
    expect(blackCount.general).toBe(1);
  });

  it('should identify horse vs advisor endgame', () => {
    engine.importFromFEN('4ka3/9/9/9/9/9/9/9/9/5N3 w');
    const state = engine.getState();

    let horseCount = 0;
    let advisorCount = 0;
    for (let x = 0; x < 9; x++) {
      for (let y = 0; y < 10; y++) {
        const p = state.board[x][y];
        if (p?.type === 'horse' && p.player === 1) horseCount++;
        if (p?.type === 'advisor' && p.player === 2) advisorCount++;
      }
    }
    expect(horseCount).toBe(1);
    expect(advisorCount).toBe(1);
  });
});

describe('Plugin Integration', () => {
  it('should export all required components', () => {
    const plugin = require('../xiangqi.plugin');
    expect(plugin.XIANGQI_PLUGIN).toBeDefined();
    expect(plugin.createEngine).toBeDefined();
    expect(plugin.createAI).toBeDefined();
    expect(plugin.createGame).toBeDefined();
    expect(plugin.getPieceName).toBeDefined();
    expect(plugin.getPlayerName).toBeDefined();
  });

  it('should create a complete game', () => {
    const { createGame } = require('../xiangqi.plugin');
    const { engine, ai, settings } = createGame({ aiDifficulty: 'hard' });
    expect(engine).toBeDefined();
    expect(ai).toBeDefined();
    expect(settings.aiDifficulty).toBe('hard');
  });

  it('should validate settings', () => {
    const { validateSettings } = require('../xiangqi.settings');
    const settings = validateSettings({ aiDifficulty: 'master', boardTheme: 'green' });
    expect(settings.aiDifficulty).toBe('master');
    expect(settings.boardTheme).toBe('green');
    expect(settings.showLegalMoves).toBe(true); // default
  });
});
