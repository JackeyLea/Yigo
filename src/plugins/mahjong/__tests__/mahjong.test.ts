/**
 * 麻将插件 - 单元测试
 * Mahjong Plugin - Unit Tests
 */

import {
  Tile, Suit, TileUtils,
  MahjongPlayer, MahjongState,
  ResponseType,
} from '../mahjong.types';
import { MahjongEngine } from '../mahjong.engine';
import { HandEvaluator } from '../mahjong.hand-evaluator';
import { MahjongAI } from '../ai/mahjong-ai';
import { MahjongPlugin } from '../mahjong.plugin';

// ==================== 工具函数 ====================

/** 创建一张牌 */
function makeTile(suit: Suit, rank: number | string, copy: number = 0): Tile {
  return {
    suit,
    rank,
    uniqueId: `${suit}${rank}_${copy}`,
  };
}

/** 创建多张相同的牌 */
function makeTiles(suit: Suit, rank: number | string, count: number): Tile[] {
  return Array.from({ length: count }, (_, i) => makeTile(suit, rank, i));
}

// ==================== TileUtils 测试 ====================

describe('TileUtils', () => {
  it('should create standard deck of 136 tiles', () => {
    const deck = TileUtils.createStandardDeck();
    expect(deck.length).toBe(136);
  });

  it('should correctly compare tiles', () => {
    const t1 = makeTile('wan', 5);
    const t2 = makeTile('wan', 5);
    const t3 = makeTile('tong', 5);

    expect(TileUtils.equals(t1, t2)).toBe(true);
    expect(TileUtils.equals(t1, t3)).toBe(false);
  });

  it('should identify honor tiles', () => {
    expect(TileUtils.isHonor(makeTile('zi', 'zhong'))).toBe(true);
    expect(TileUtils.isHonor(makeTile('wan', 5))).toBe(false);
  });

  it('should identify wind tiles', () => {
    expect(TileUtils.isWind(makeTile('zi', 'dong'))).toBe(true);
    expect(TileUtils.isWind(makeTile('zi', 'zhong'))).toBe(false);
  });

  it('should identify dragon tiles', () => {
    expect(TileUtils.isDragon(makeTile('zi', 'zhong'))).toBe(true);
    expect(TileUtils.isDragon(makeTile('zi', 'dong'))).toBe(false);
  });

  it('should identify terminal or honor tiles', () => {
    expect(TileUtils.isTerminalOrHonor(makeTile('wan', 1))).toBe(true);
    expect(TileUtils.isTerminalOrHonor(makeTile('wan', 9))).toBe(true);
    expect(TileUtils.isTerminalOrHonor(makeTile('zi', 'zhong'))).toBe(true);
    expect(TileUtils.isTerminalOrHonor(makeTile('wan', 5))).toBe(false);
  });

  it('should sort hand correctly', () => {
    const hand = [
      makeTile('tiao', 3),
      makeTile('wan', 1),
      makeTile('zi', 'bai'),
      makeTile('wan', 5),
      makeTile('tong', 9),
    ];
    const sorted = TileUtils.sortHand(hand);
    expect(sorted[0].suit).toBe('wan');
    expect(sorted[1].suit).toBe('wan');
    expect(sorted[2].suit).toBe('tong');
    expect(sorted[3].suit).toBe('tiao');
    expect(sorted[4].suit).toBe('zi');
  });
});

// ==================== HandEvaluator 测试 ====================

describe('HandEvaluator', () => {
  describe('canWin', () => {
    it('should detect standard winning hand (4 groups + 1 pair)', () => {
      // 一个标准平胡手牌：
      // 111万 + 222筒 + 333条 + 456万 + 55条
      const hand = [
        ...makeTiles('wan', 1, 3),
        ...makeTiles('tong', 2, 3),
        ...makeTiles('tiao', 3, 3),
        makeTile('wan', 4), makeTile('wan', 5), makeTile('wan', 6),
        ...makeTiles('tiao', 5, 2),
      ];
      expect(HandEvaluator.canWin(hand)).toBe(true);
    });

    it('should detect seven pairs', () => {
      const hand = [
        ...makeTiles('wan', 1, 2),
        ...makeTiles('wan', 3, 2),
        ...makeTiles('tong', 2, 2),
        ...makeTiles('tong', 5, 2),
        ...makeTiles('tiao', 7, 2),
        ...makeTiles('zi', 'dong', 2),
        ...makeTiles('zi', 'fa', 2),
      ];
      expect(HandEvaluator.canWin(hand)).toBe(true);
      expect(HandEvaluator.isSevenPairs(hand)).toBe(true);
    });

    it('should detect thirteen orphans', () => {
      const hand = [
        makeTile('wan', 1), makeTile('wan', 9),
        makeTile('tong', 1), makeTile('tong', 9),
        makeTile('tiao', 1), makeTile('tiao', 9),
        makeTile('zi', 'dong'), makeTile('zi', 'nan'),
        makeTile('zi', 'xi'), makeTile('zi', 'bei'),
        makeTile('zi', 'zhong'), makeTile('zi', 'fa'),
        makeTile('zi', 'bai'), makeTile('wan', 1), // 重复1万做雀头
      ];
      expect(HandEvaluator.canWin(hand)).toBe(true);
      expect(HandEvaluator.isThirteenOrphans(hand)).toBe(true);
    });

    it('should reject non-winning hand', () => {
      const hand = [
        makeTile('wan', 1), makeTile('wan', 2), makeTile('wan', 3),
        makeTile('wan', 4), makeTile('wan', 5), makeTile('wan', 6),
        makeTile('wan', 7), makeTile('wan', 8), makeTile('wan', 9),
        makeTile('tong', 1), makeTile('tong', 2), makeTile('tong', 3),
        makeTile('tong', 4),
      ];
      expect(HandEvaluator.canWin(hand)).toBe(false);
    });

    it('should detect win with specific tile', () => {
      const hand = [
        ...makeTiles('wan', 1, 3),
        ...makeTiles('tong', 2, 3),
        ...makeTiles('tiao', 3, 3),
        makeTile('wan', 4), makeTile('wan', 5),
        ...makeTiles('tiao', 5, 2),
      ];
      const winTile = makeTile('wan', 6);
      expect(HandEvaluator.canWin(hand, winTile)).toBe(true);
    });
  });

  describe('isPinfu', () => {
    it('should detect pinfu hand', () => {
      const hand = [
        makeTile('wan', 1), makeTile('wan', 2), makeTile('wan', 3),
        makeTile('wan', 4), makeTile('wan', 5), makeTile('wan', 6),
        makeTile('tong', 2), makeTile('tong', 3), makeTile('tong', 4),
        makeTile('tiao', 3), makeTile('tiao', 4), makeTile('tiao', 5),
      ];
      const winTile = makeTile('tiao', 5);
      const fullHand = [...hand, winTile];
      expect(HandEvaluator.isPinfu(hand, winTile)).toBe(true);
    });
  });

  describe('isFullFlush', () => {
    it('should detect full flush', () => {
      const hand = [
        ...makeTiles('wan', 1, 3),
        ...makeTiles('wan', 4, 3),
        ...makeTiles('wan', 7, 3),
        ...makeTiles('wan', 9, 2),
        makeTile('wan', 2),
      ];
      expect(HandEvaluator.isFullFlush(hand)).toBe(true);
    });

    it('should reject mixed suit hand', () => {
      const hand = [
        ...makeTiles('wan', 1, 3),
        ...makeTiles('tong', 2, 3),
      ];
      expect(HandEvaluator.isFullFlush(hand)).toBe(false);
    });
  });

  describe('isAllSimples', () => {
    it('should detect all simples (tanyao)', () => {
      const hand = [
        makeTile('wan', 2), makeTile('wan', 3), makeTile('wan', 4),
        makeTile('tong', 3), makeTile('tong', 4), makeTile('tong', 5),
        makeTile('tiao', 5), makeTile('tiao', 6), makeTile('tiao', 7),
        makeTile('wan', 6), makeTile('wan', 7), makeTile('wan', 8),
        ...makeTiles('tong', 6, 2),
      ];
      expect(HandEvaluator.isAllSimples(hand)).toBe(true);
    });

    it('should reject hand with terminals', () => {
      const hand = [
        makeTile('wan', 1),
        ...Array(13).fill(makeTile('wan', 2)),
      ];
      expect(HandEvaluator.isAllSimples(hand)).toBe(false);
    });
  });

  describe('calculateFan', () => {
    it('should calculate fan correctly', () => {
      const yaku = ['riichi', 'tanyao'];
      const fan = HandEvaluator.calculateFan(yaku);
      expect(fan).toBe(2); // 1 + 1
    });

    it('should calculate fan for seven pairs', () => {
      const yaku = ['chiitoitsu'];
      const fan = HandEvaluator.calculateFan(yaku);
      expect(fan).toBe(2);
    });

    it('should calculate fan for full flush', () => {
      const yaku = ['chinitsu'];
      const fan = HandEvaluator.calculateFan(yaku);
      expect(fan).toBe(6);
    });
  });

  describe('calculateFu', () => {
    it('should calculate fu for tsumo', () => {
      const context = {
        isTsumo: true,
        isDealer: false,
        isRiichi: false,
        roundWind: 0,
        seatWind: 0,
        doraTiles: [],
        melds: [],
        isFuriten: false,
      };
      const fu = HandEvaluator.calculateFu([], context);
      expect(fu).toBeGreaterThanOrEqual(20);
    });
  });

  describe('score calculation', () => {
    it('should calculate mangan correctly', () => {
      const score = HandEvaluator.calculateScore(5, 30, false, false);
      expect(score).toBe(8000);
    });

    it('should calculate haneman correctly', () => {
      const score = HandEvaluator.calculateScore(6, 30, false, false);
      expect(score).toBe(12000);
    });

    it('should calculate dealer score with multiplier', () => {
      const score = HandEvaluator.calculateScore(3, 40, true, false);
      expect(score).toBeGreaterThan(0);
    });
  });
});

// ==================== MahjongEngine 测试 ====================

describe('MahjongEngine', () => {
  let engine: MahjongEngine;

  beforeEach(() => {
    engine = new MahjongEngine();
  });

  it('should initialize with correct default state', () => {
    const state = engine.getState();
    expect(state.players.length).toBe(4);
    expect(state.wall.length).toBe(0);
    expect(state.phase).toBe('deal');
    expect(state.gameOver).toBe(false);
  });

  it('should deal tiles correctly', () => {
    engine.dealTiles();
    const state = engine.getState();

    // 庄家14张，闲家13张
    expect(state.players[0].hand.length).toBe(14);
    for (let i = 1; i < 4; i++) {
      expect(state.players[i].hand.length).toBe(13);
    }

    // 王牌区14张
    expect(state.deadWall.length + state.doraIndicator.length).toBeGreaterThan(0);
  });

  it('should allow player to discard tile', () => {
    engine.dealTiles();
    const state = engine.getState();
    const player = state.players[0];
    const tileToDiscard = player.hand[0];

    const result = engine.discardTile(player.playerId, tileToDiscard.uniqueId);
    expect(result).toBe(true);

    const newState = engine.getState();
    expect(newState.lastDiscard).not.toBeNull();
    expect(newState.phase).toBe('respond');
  });

  it('should reject discard from non-current player', () => {
    engine.dealTiles();
    const state = engine.getState();
    const nonCurrentPlayer = state.players[1];
    const tile = nonCurrentPlayer.hand[0];

    const result = engine.discardTile(nonCurrentPlayer.playerId, tile.uniqueId);
    expect(result).toBe(false);
  });

  it('should check canPong correctly', () => {
    const hand = [
      makeTile('wan', 5),
      makeTile('wan', 5),
      makeTile('tong', 3),
    ];
    const target = makeTile('wan', 5);
    expect(engine.canPong(hand, target)).toBe(true);

    const target2 = makeTile('wan', 3);
    expect(engine.canPong(hand, target2)).toBe(false);
  });

  it('should check canKong correctly', () => {
    const hand = [
      makeTile('wan', 5),
      makeTile('wan', 5),
      makeTile('wan', 5),
    ];
    const target = makeTile('wan', 5);
    expect(engine.canKong(hand, target)).toBe(true);

    const target2 = makeTile('wan', 3);
    expect(engine.canKong(hand, target2)).toBe(false);
  });

  it('should check canWin correctly', () => {
    const hand = [
      ...makeTiles('wan', 1, 3),
      ...makeTiles('wan', 4, 3),
      ...makeTiles('wan', 7, 3),
      makeTile('tong', 2), makeTile('tong', 3), makeTile('tong', 4),
      ...makeTiles('tiao', 5, 2),
    ];
    expect(engine.canWin(hand)).toBe(true);
  });

  it('should calculate shanten', () => {
    const hand = [
      makeTile('wan', 1), makeTile('wan', 2), makeTile('wan', 3),
      makeTile('wan', 4), makeTile('wan', 5), makeTile('wan', 6),
      makeTile('tong', 2), makeTile('tong', 3), makeTile('tong', 4),
      makeTile('tiao', 3), makeTile('tiao', 4),
      makeTile('zi', 'dong'), makeTile('zi', 'dong'),
    ];
    const shanten = engine.calculateShanten(hand);
    expect(shanten).toBeGreaterThanOrEqual(0);
    expect(shanten).toBeLessThan(8);
  });

  it('should check tenpai status', () => {
    // 听牌手牌（等3万或6万）
    const hand = [
      makeTile('wan', 1), makeTile('wan', 2),
      makeTile('wan', 4), makeTile('wan', 5),
      makeTile('wan', 7), makeTile('wan', 8),
      makeTile('tong', 2), makeTile('tong', 3), makeTile('tong', 4),
      makeTile('tiao', 5), makeTile('tiao', 6), makeTile('tiao', 7),
      ...makeTiles('zi', 'zhong', 2),
    ];
    expect(engine.isTenpai(hand)).toBe(true);
  });

  it('should get waits for tenpai hand', () => {
    const hand = [
      makeTile('wan', 1), makeTile('wan', 2),
      makeTile('wan', 4), makeTile('wan', 5),
      makeTile('wan', 7), makeTile('wan', 8),
      makeTile('tong', 2), makeTile('tong', 3), makeTile('tong', 4),
      makeTile('tiao', 5), makeTile('tiao', 6), makeTile('tiao', 7),
      ...makeTiles('zi', 'zhong', 2),
    ];
    const waits = engine.getWaits(hand);
    expect(waits.length).toBeGreaterThan(0);
  });

  it('should return correct response priority', () => {
    expect(engine.getResponsePriority('ron')).toBe(100);
    expect(engine.getResponsePriority('kong')).toBe(50);
    expect(engine.getResponsePriority('pong')).toBe(30);
    expect(engine.getResponsePriority('chow')).toBe(10);
    expect(engine.getResponsePriority('pass')).toBe(0);
  });

  it('should detect concealed kong possibility', () => {
    const hand = [
      ...makeTiles('wan', 5, 4),
      ...Array(9).fill(makeTile('tong', 1)),
    ];
    expect(engine.canConcealedKong(hand)).toBe(true);
  });
});

// ==================== MahjongAI 测试 ====================

describe('MahjongAI', () => {
  let engine: MahjongEngine;

  beforeEach(() => {
    engine = new MahjongEngine();
  });

  it('easy AI should return a valid tile to discard', () => {
    engine.dealTiles();
    const ai = new MahjongAI('easy');
    const state = engine.getState();

    const discard = ai.getDiscard(state);
    expect(discard).toBeDefined();
    expect(discard.uniqueId).toBeDefined();
  });

  it('medium AI should return a valid tile to discard', () => {
    engine.dealTiles();
    const ai = new MahjongAI('medium');
    const state = engine.getState();

    const discard = ai.getDiscard(state);
    expect(discard).toBeDefined();
    expect(discard.uniqueId).toBeDefined();
  });

  it('hard AI should return a valid tile to discard', () => {
    engine.dealTiles();
    const ai = new MahjongAI('hard');
    const state = engine.getState();

    const discard = ai.getDiscard(state);
    expect(discard).toBeDefined();
    expect(discard.uniqueId).toBeDefined();
  });

  it('AI should respond to available actions', () => {
    engine.dealTiles();
    const ai = new MahjongAI('medium');
    const state = engine.getState();

    const responses: ResponseType[] = ['chow', 'pong', 'pass'];
    const response = ai.getResponse(state, responses);
    expect(responses).toContain(response);
  });

  it('AI should always choose ron if available', () => {
    engine.dealTiles();
    const ai = new MahjongAI('hard');
    const state = engine.getState();

    const responses: ResponseType[] = ['ron', 'pong', 'pass'];
    const response = ai.getResponse(state, responses);
    expect(response).toBe('ron');
  });

  it('AI should make riichi decision', () => {
    engine.dealTiles();
    const ai = new MahjongAI('medium');
    const state = engine.getState();

    const shouldRiichi = ai.shouldRiichi(state);
    expect(typeof shouldRiichi).toBe('boolean');
  });
});

// ==================== MahjongPlugin 集成测试 ====================

describe('MahjongPlugin', () => {
  it('should create plugin with default settings', () => {
    const plugin = new MahjongPlugin();
    const state = plugin.getState();

    expect(state.players.length).toBe(4);
    expect(state.gameOver).toBe(false);
  });

  it('should start a game', () => {
    const plugin = new MahjongPlugin();
    plugin.startGame();

    const state = plugin.getState();
    expect(state.players[0].hand.length).toBeGreaterThan(0);
  });

  it('should emit events during gameplay', () => {
    const plugin = new MahjongPlugin();
    const events: string[] = [];

    plugin.onEvent((event) => {
      events.push(event.type);
    });

    plugin.startGame();

    expect(events).toContain('game_started');
    expect(events).toContain('tiles_dealt');
  });

  it('should track game stats', () => {
    const plugin = new MahjongPlugin();
    plugin.startGame();

    const stats = plugin.getStats('player_0');
    expect(stats).toBeDefined();
  });

  it('should update settings', () => {
    const plugin = new MahjongPlugin();
    plugin.setAIDifficulty('hard');

    const settings = plugin.getSettings();
    expect(settings.aiDifficulty).toBe('hard');
  });

  it('should load presets', () => {
    const plugin = new MahjongPlugin();
    plugin.loadPreset('quick');

    const settings = plugin.getSettings();
    expect(settings.engineConfig.enableDora).toBe(false);
    expect(settings.engineConfig.enableRiichi).toBe(false);
  });
});

// ==================== 边界条件测试 ====================

describe('Edge Cases', () => {
  it('should handle empty hand', () => {
    const hand: Tile[] = [];
    expect(HandEvaluator.canWin(hand)).toBe(false);
    expect(HandEvaluator.isSevenPairs(hand)).toBe(false);
  });

  it('should handle hand with one tile', () => {
    const hand = [makeTile('wan', 1)];
    expect(HandEvaluator.canWin(hand)).toBe(false);
  });

  it('should handle thirteen orphans with wrong composition', () => {
    const hand = [
      makeTile('wan', 1), makeTile('wan', 9),
      makeTile('tong', 1), makeTile('tong', 9),
      makeTile('tiao', 1), makeTile('tiao', 9),
      makeTile('zi', 'dong'), makeTile('zi', 'nan'),
      makeTile('zi', 'xi'), makeTile('zi', 'bei'),
      makeTile('zi', 'zhong'), makeTile('zi', 'fa'),
      makeTile('zi', 'bai'), makeTile('wan', 5), // 不是幺九牌
    ];
    expect(HandEvaluator.isThirteenOrphans(hand)).toBe(false);
  });

  it('should handle seven pairs with only 6 pairs', () => {
    const hand = [
      ...makeTiles('wan', 1, 2),
      ...makeTiles('wan', 3, 2),
      ...makeTiles('tong', 2, 2),
      ...makeTiles('tong', 5, 2),
      ...makeTiles('tiao', 7, 2),
      ...makeTiles('zi', 'dong', 2),
      makeTile('zi', 'fa'), // 单张
      makeTile('zi', 'bai'), // 单张
    ];
    expect(HandEvaluator.isSevenPairs(hand)).toBe(false);
  });

  it('should not allow chow of honor tiles', () => {
    const engine = new MahjongEngine();
    const hand = [
      makeTile('zi', 'dong'),
      makeTile('zi', 'nan'),
    ];
    const target = makeTile('zi', 'xi');
    expect(engine.canChow('player_0', target)).toBe(false);
  });

  it('should handle wall exhaustion gracefully', () => {
    const engine = new MahjongEngine();
    engine.dealTiles();
    const state = engine.getState();

    // 模拟牌山即将耗尽
    expect(typeof engine.checkExhaustiveDraw).toBe('function');
  });
});

// ==================== 性能测试 ====================

describe('Performance', () => {
  it('should evaluate hand quickly', () => {
    const hand = [
      ...makeTiles('wan', 1, 3),
      ...makeTiles('wan', 4, 3),
      ...makeTiles('wan', 7, 3),
      makeTile('tong', 2), makeTile('tong', 3), makeTile('tong', 4),
      ...makeTiles('tiao', 5, 2),
    ];

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      HandEvaluator.canWin(hand);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000); // 100次调用应小于1秒
  });

  it('should calculate shanten quickly', () => {
    const engine = new MahjongEngine();
    engine.dealTiles();
    const state = engine.getState();
    const hand = state.players[0].hand;

    const start = performance.now();
    const shanten = engine.calculateShanten(hand);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500); // 单次计算应小于500ms
    expect(typeof shanten).toBe('number');
  });
});
