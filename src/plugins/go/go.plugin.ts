/**
 * Go (围棋) Plugin - Main Plugin Class
 *
 * Integrates the Go game engine and AI into the chess platform.
 * Provides a unified interface for game management, AI opponents,
 * and event handling.
 *
 * Architecture:
 * - GoEngine:  Core game logic (board, rules, scoring)
 * - GoAI:      AI opponent using MCTS
 * - GoPlugin:  Integration layer with event system
 */

import { GoEngine } from './go.engine';
import { GoAI } from './ai/go-ai';
import type {
  BoardSize,
  Cell,
  Board,
  Player,
  GoState,
  GoMove,
  Position,
  GoGameOptions,
  GoGameEvents,
  GoSettings,
  GamePhase,
  ScoreDetail,
  TerritoryResult,
  SGFNode,
  AIDifficultyConfig,
} from './go.types';

// ---------------------------------------------------------------------------
// Plugin Event Types
// ---------------------------------------------------------------------------

/** Plugin event payload base */
interface PluginEvent<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
}

/** Plugin event listener */
type EventListener<T = unknown> = (event: PluginEvent<T>) => void;

// ---------------------------------------------------------------------------
// Game Plugin Interface
// ---------------------------------------------------------------------------

export interface IGamePlugin {
  readonly name: string;
  readonly version: string;
  readonly gameType: string;

  init(settings?: Record<string, unknown>): void;
  startGame(options?: GoGameOptions): void;
  endGame(): void;

  on<T = unknown>(event: string, listener: EventListener<T>): void;
  off<T = unknown>(event: string, listener: EventListener<T>): void;
  emit<T = unknown>(event: string, payload: T): void;
}

// ---------------------------------------------------------------------------
// GoPlugin Implementation
// ---------------------------------------------------------------------------

export class GoPlugin implements IGamePlugin {
  public readonly name = 'go';
  public readonly version = '1.0.0';
  public readonly gameType = 'go';

  private engine: GoEngine | null = null;
  private ai: GoAI | null = null;
  private settings: GoSettings;
  private events: Map<string, Set<EventListener>> = new Map();
  private gameEvents: GoGameEvents = {};
  private isGameActive = false;
  private playerSides: { human: Player; ai: Player | null } = {
    human: 1,
    ai: null,
  };
  private thinking = false;

  constructor(settings?: Partial<GoSettings>) {
    this.settings = {
      defaultBoardSize: 19,
      defaultKomi: 7.5,
      defaultHandicap: 0,
      defaultAIDifficulty: 'intermediate',
      enableSuperKo: true,
      enableScoring: true,
      enableAI: true,
      enableSGF: true,
      theme: 'classic',
      showCoordinates: true,
      showLastMove: true,
      showMoveNumber: false,
      soundEnabled: true,
      animationEnabled: true,
      ...settings,
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Initialize the plugin with settings */
  init(settings?: Partial<GoSettings>): void {
    if (settings) {
      this.settings = { ...this.settings, ...settings };
    }
    this.emit('plugin:initialized', { settings: this.settings });
  }

  /** Start a new game */
  startGame(options: GoGameOptions = {}): void {
    const boardSize = (options.boardSize ?? this.settings.defaultBoardSize) as BoardSize;
    const komi = options.komi ?? this.settings.defaultKomi;
    const handicap = options.handicap ?? this.settings.defaultHandicap;
    const aiDifficulty = options.aiDifficulty ?? this.settings.defaultAIDifficulty;

    // Validate board size
    if (![9, 13, 19].includes(boardSize)) {
      throw new Error(`Invalid board size: ${boardSize}. Must be 9, 13, or 19.`);
    }

    // Create engine
    this.engine = new GoEngine(
      boardSize,
      komi,
      handicap,
      this.settings.enableSuperKo
    );

    // Setup AI if enabled
    if (this.settings.enableAI && aiDifficulty) {
      this.ai = new GoAI(aiDifficulty);
      this.playerSides = { human: 1, ai: 2 };
    } else {
      this.ai = null;
      this.playerSides = { human: 1, ai: null };
    }

    this.isGameActive = true;
    this.thinking = false;

    this.emit('game:started', {
      state: this.engine.getState(),
      options: { boardSize, komi, handicap, aiDifficulty },
    });

    // If AI plays black (handicap), make AI move
    if (this.playerSides.ai === 1) {
      this.makeAIMove();
    }
  }

  /** End the current game */
  endGame(): void {
    this.isGameActive = false;
    this.thinking = false;

    const state = this.engine?.getState();
    if (state) {
      this.emit('game:ended', { state });
    }
  }

  /** Reset the current game */
  resetGame(): void {
    if (!this.engine) return;

    this.engine.reset();
    this.thinking = false;

    this.emit('game:reset', { state: this.engine.getState() });

    // If AI plays black, make AI move
    if (this.playerSides.ai === 1) {
      this.makeAIMove();
    }
  }

  // -------------------------------------------------------------------------
  // Player Actions
  // -------------------------------------------------------------------------

  /**
   * Place a stone at the specified position
   * @returns true if move was successful
   */
  placeStone(x: number, y: number): boolean {
    if (!this.isGameActive || !this.engine) return false;
    if (this.thinking) return false;

    const success = this.engine.placeStone(x, y);
    if (success) {
      const state = this.engine.getState();
      this.emit('game:move', { state, move: state.moveHistory[state.moveHistory.length - 1] });

      // Trigger game events
      if (this.gameEvents.onMove) {
        this.gameEvents.onMove(state.moveHistory[state.moveHistory.length - 1], state);
      }

      // Check if game ended
      if (state.phase === 'scoring') {
        this.emit('game:phaseChange', { phase: 'scoring' });
        if (this.gameEvents.onPhaseChange) {
          this.gameEvents.onPhaseChange('scoring');
        }
      } else if (state.phase === 'ended') {
        this.emit('game:ended', { state });
        if (this.gameEvents.onGameEnd) {
          this.gameEvents.onGameEnd(state);
        }
      }

      // Trigger AI move if it's AI's turn
      if (this.isGameActive && state.phase === 'playing' && this.playerSides.ai === state.currentPlayer) {
        this.makeAIMove();
      }
    }

    return success;
  }

  /** Pass the turn */
  pass(): void {
    if (!this.isGameActive || !this.engine) return;
    if (this.thinking) return;

    this.engine.pass();
    const state = this.engine.getState();
    this.emit('game:pass', { state, player: state.currentPlayer === 1 ? 2 : 1 });

    if (this.gameEvents.onPass) {
      this.gameEvents.onPass(state.currentPlayer === 1 ? 2 : 1);
    }

    if (state.phase === 'scoring') {
      this.emit('game:phaseChange', { phase: 'scoring' });
    } else if (state.phase === 'ended') {
      this.emit('game:ended', { state });
    }

    // Trigger AI if it's AI's turn
    if (this.isGameActive && state.phase === 'playing' && this.playerSides.ai === state.currentPlayer) {
      this.makeAIMove();
    }
  }

  /** Mark a stone group as dead (during scoring) */
  markDeadStone(x: number, y: number): void {
    if (!this.engine) return;
    this.engine.markDeadStone(x, y);
    const state = this.engine.getState();
    this.emit('game:scoreUpdate', { state, score: state.score });
  }

  /** Mark a stone group as alive (during scoring) */
  markAliveStone(x: number, y: number): void {
    if (!this.engine) return;
    this.engine.markAliveStone(x, y);
    const state = this.engine.getState();
    this.emit('game:scoreUpdate', { state, score: state.score });
  }

  /** Confirm scoring and end the game */
  confirmScore(): void {
    if (!this.engine) return;
    this.engine.confirmScore();
    const state = this.engine.getState();
    this.emit('game:phaseChange', { phase: 'ended' });
    this.emit('game:ended', { state });
  }

  // -------------------------------------------------------------------------
  // AI
  // -------------------------------------------------------------------------

  /** Check if it's the AI's turn */
  isAITurn(): boolean {
    if (!this.engine || !this.ai) return false;
    return this.playerSides.ai === this.engine.getState().currentPlayer;
  }

  /** Make the AI play a move */
  private async makeAIMove(): Promise<void> {
    if (!this.engine || !this.ai || !this.isGameActive) return;

    this.thinking = true;
    this.emit('ai:thinking', { player: this.playerSides.ai });

    // Small delay to make AI feel more natural
    await new Promise((resolve) => setTimeout(resolve, 300));

    const state = this.engine.getState();
    const move = this.ai.getMove(state);

    this.thinking = false;

    if (move === null) {
      // AI passes
      this.engine.pass();
      this.emit('ai:pass', { state: this.engine.getState() });
    } else {
      this.engine.placeStone(move.x, move.y);
      this.emit('ai:move', {
        state: this.engine.getState(),
        move,
      });
    }

    const newState = this.engine.getState();

    // Check game end conditions
    if (newState.phase === 'scoring') {
      this.emit('game:phaseChange', { phase: 'scoring' });
    } else if (newState.phase === 'ended') {
      this.isGameActive = false;
      this.emit('game:ended', { state: newState });
    }

    this.emit('ai:done', { state: newState });
  }

  /** Change AI difficulty during gameplay */
  setAIDifficulty(difficulty: 'beginner' | 'elementary' | 'intermediate' | 'advanced'): void {
    if (!this.ai) {
      this.ai = new GoAI(difficulty);
    } else {
      this.ai.setDifficulty(difficulty);
    }
    this.settings.defaultAIDifficulty = difficulty;
    this.emit('ai:difficultyChanged', { difficulty });
  }

  /** Get AI difficulty config */
  getAIDifficulty(): AIDifficultyConfig | null {
    return this.ai?.getConfig() ?? null;
  }

  /** Get whether AI is currently thinking */
  isAIThinking(): boolean {
    return this.thinking;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Get current game state */
  getState(): GoState | null {
    return this.engine?.getState() ?? null;
  }

  /** Check if a position is a valid move */
  isValidMove(x: number, y: number): boolean {
    return this.engine?.isValidMove(x, y) ?? false;
  }

  /** Get all legal moves */
  getLegalMoves(): Position[] {
    return this.engine?.getLegalMoves() ?? [];
  }

  /** Get liberties of a group at position */
  getLiberties(x: number, y: number): Position[] {
    return this.engine?.getLiberties(x, y) ?? [];
  }

  /** Get the group (connected stones) at position */
  getGroup(x: number, y: number): Position[] {
    return this.engine?.getGroup(x, y) ?? [];
  }

  /** Get territory analysis */
  getTerritoryAnalysis(): TerritoryResult | null {
    return this.engine?.getTerritoryAnalysis() ?? null;
  }

  /** Get score detail */
  getScoreDetail(): ScoreDetail | null {
    return this.engine?.getScoreDetail() ?? null;
  }

  // -------------------------------------------------------------------------
  // SGF Import/Export
  // -------------------------------------------------------------------------

  /** Export game to SGF format */
  exportToSGF(): string {
    if (!this.engine) throw new Error('No active game');
    if (!this.settings.enableSGF) throw new Error('SGF support is disabled');
    return this.engine.exportToSGF();
  }

  /** Import game from SGF format */
  importFromSGF(sgf: string): void {
    if (!this.settings.enableSGF) throw new Error('SGF support is disabled');

    const boardSize = this.extractBoardSizeFromSGF(sgf) ?? this.settings.defaultBoardSize;
    const komi = this.extractKomiFromSGF(sgf) ?? this.settings.defaultKomi;
    const handicap = this.extractHandicapFromSGF(sgf) ?? 0;

    this.engine = new GoEngine(
      boardSize as BoardSize,
      komi,
      handicap,
      this.settings.enableSuperKo
    );

    this.engine.importFromSGF(sgf);
    this.isGameActive = true;

    this.emit('game:sgfImported', {
      state: this.engine.getState(),
    });
  }

  /** Extract board size from SGF string */
  private extractBoardSizeFromSGF(sgf: string): BoardSize | null {
    const match = sgf.match(/SZ\[(\d+)\]/);
    if (match) {
      const size = parseInt(match[1]);
      if ([9, 13, 19].includes(size)) return size as BoardSize;
    }
    return null;
  }

  /** Extract komi from SGF string */
  private extractKomiFromSGF(sgf: string): number | null {
    const match = sgf.match(/KM\[([\d.]+)\]/);
    return match ? parseFloat(match[1]) : null;
  }

  /** Extract handicap from SGF string */
  private extractHandicapFromSGF(sgf: string): number | null {
    const match = sgf.match(/HA\[(\d+)\]/);
    return match ? parseInt(match[1]) : null;
  }

  // -------------------------------------------------------------------------
  // Event System
  // -------------------------------------------------------------------------

  /** Subscribe to an event */
  on<T = unknown>(event: string, listener: EventListener<T>): void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(listener as EventListener);
  }

  /** Unsubscribe from an event */
  off<T = unknown>(event: string, listener: EventListener<T>): void {
    this.events.get(event)?.delete(listener as EventListener);
  }

  /** Emit an event */
  emit<T = unknown>(event: string, payload: T): void {
    const listeners = this.events.get(event);
    if (listeners) {
      const eventObj: PluginEvent<T> = {
        type: event,
        payload,
        timestamp: Date.now(),
      };
      listeners.forEach((listener) => {
        try {
          listener(eventObj as PluginEvent<unknown>);
        } catch (err) {
          console.error(`Error in event listener for ${event}:`, err);
        }
      });
    }
  }

  /** Set game event callbacks */
  setGameEvents(events: GoGameEvents): void {
    this.gameEvents = { ...events };
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  /** Update plugin settings */
  updateSettings(newSettings: Partial<GoSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.emit('settings:updated', { settings: this.settings });
  }

  /** Get current settings */
  getSettings(): GoSettings {
    return { ...this.settings };
  }

  // -------------------------------------------------------------------------
  // Game Status
  // -------------------------------------------------------------------------

  /** Check if a game is active */
  isActive(): boolean {
    return this.isGameActive;
  }

  /** Get current game phase */
  getPhase(): GamePhase | null {
    return this.engine?.getState().phase ?? null;
  }

  /** Get current player */
  getCurrentPlayer(): Player | null {
    return this.engine?.getState().currentPlayer ?? null;
  }

  /** Get move history */
  getMoveHistory(): GoMove[] {
    return this.engine?.getState().moveHistory ?? [];
  }

  /** Get last move */
  getLastMove(): GoMove | null {
    const history = this.getMoveHistory();
    return history[history.length - 1] ?? null;
  }

  /** Get capture counts */
  getCaptures(): { black: number; white: number } {
    return this.engine?.getState().capturedStones ?? { black: 0, white: 0 };
  }

  /** Get winner */
  getWinner(): Player | null {
    return this.engine?.getState().winner ?? null;
  }

  /** Check if game is a draw */
  isDraw(): boolean {
    return this.engine?.getState().isDraw ?? false;
  }

  /** Get board size */
  getBoardSize(): number {
    return this.engine?.getState().boardSize ?? 0;
  }

  /** Get komi */
  getKomi(): number {
    return this.engine?.getState().komi ?? 0;
  }

  /** Get handicap */
  getHandicap(): number {
    return this.engine?.getState().handicap ?? 0;
  }

  /** Get consecutive pass count */
  getConsecutivePasses(): number {
    return this.engine?.getState().consecutivePasses ?? 0;
  }

  /** Get ko position */
  getKoPosition(): Position | null {
    return this.engine?.getState().koPosition ?? null;
  }

  // -------------------------------------------------------------------------
  // Static Factory
  // -------------------------------------------------------------------------

  /** Create a new GoPlugin instance */
  static create(settings?: Partial<GoSettings>): GoPlugin {
    return new GoPlugin(settings);
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { GoEngine } from './go.engine';
export { GoAI } from './ai/go-ai';
export type {
  BoardSize,
  Cell,
  Board,
  Player,
  GoState,
  GoMove,
  Position,
  GoGameOptions,
  GoGameEvents,
  GoSettings,
  GamePhase,
  ScoreDetail,
  TerritoryResult,
  SGFNode,
  AIDifficultyConfig,
} from './go.types';
