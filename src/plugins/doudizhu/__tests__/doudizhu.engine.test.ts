/**
 * 斗地主游戏引擎单元测试
 */

import { DoudizhuEngine, RANK_VALUE, sortCards, sortCardsDesc } from '../doudizhu.engine';
import type { Card, CardCombo } from '../doudizhu.types';

// ==================== 测试工具 ====================

/** 快速创建卡牌 */
function makeCard(rank: string, suit = 'spade', value?: number): Card {
  const v = value ?? RANK_VALUE[rank as keyof typeof RANK_VALUE] ?? 0;
  return { suit: suit as Card['suit'], rank: rank as Card['rank'], value: v };
}

/** 创建多张卡牌 */
function makeCards(ranks: string[]): Card[] {
  return ranks.map((r) => makeCard(r));
}

// ==================== 引擎基础测试 ====================

describe('DoudizhuEngine - 基础功能', () => {
  it('应该正确创建引擎', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    expect(engine).toBeDefined();
    expect(engine.getPhase()).toBe('deal');
  });

  it('创建引擎时少于3人应该抛出错误', () => {
    expect(() => new DoudizhuEngine(['p1', 'p2'])).toThrow('斗地主需要恰好3名玩家');
  });

  it('创建引擎时多于3人应该抛出错误', () => {
    expect(() => new DoudizhuEngine(['p1', 'p2', 'p3', 'p4'])).toThrow('斗地主需要恰好3名玩家');
  });

  it('应该正确获取初始状态', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    const state = engine.getState();
    expect(state.phase).toBe('deal');
    expect(state.players).toHaveLength(3);
    expect(state.players[0].playerId).toBe('p1');
    expect(state.players[1].playerId).toBe('p2');
    expect(state.players[2].playerId).toBe('p3');
    expect(state.landlordId).toBeNull();
    expect(state.gameOver).toBe(false);
    expect(state.deck).toHaveLength(54);
  });

  it('reset应该重置游戏状态', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.reset();
    expect(engine.getPhase()).toBe('deal');
    expect(engine.getState().landlordId).toBeNull();
  });
});

// ==================== 发牌测试 ====================

describe('DoudizhuEngine - 发牌', () => {
  it('发牌后每人应有17张牌', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    const state = engine.getState();

    expect(state.players[0].hand).toHaveLength(17);
    expect(state.players[1].hand).toHaveLength(17);
    expect(state.players[2].hand).toHaveLength(17);
  });

  it('发牌后阶段应为bid', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    expect(engine.getPhase()).toBe('bid');
  });

  it('发牌后底牌应有3张', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    expect(engine.getBottomCards()).toHaveLength(3);
  });

  it('发牌后所有手牌加底牌应为54张', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    const state = engine.getState();

    const totalCards =
      state.players[0].hand.length +
      state.players[1].hand.length +
      state.players[2].hand.length +
      engine.getBottomCards().length;

    expect(totalCards).toBe(54);
  });

  it('发牌后手牌应已排序', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    const state = engine.getState();

    for (const player of state.players) {
      for (let i = 1; i < player.hand.length; i++) {
        expect(player.hand[i].value).toBeGreaterThanOrEqual(player.hand[i - 1].value);
      }
    }
  });

  it('在非deal阶段发牌应抛出错误', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    expect(() => engine.dealCards()).toThrow();
  });
});

// ==================== 叫分测试 ====================

describe('DoudizhuEngine - 叫分', () => {
  it('叫分应成功', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    const result = engine.placeBid('p1', 2);
    expect(result).toBe(true);
  });

  it('叫3分应直接成为地主', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 3);
    const state = engine.getState();
    expect(state.landlordId).toBe('p1');
    expect(state.phase).toBe('play');
  });

  it('非当前玩家叫分应失败', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    const result = engine.placeBid('p2', 2);
    expect(result).toBe(false);
  });

  it('无效叫分应失败', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    expect(engine.placeBid('p1', 0)).toBe(false);
    expect(engine.placeBid('p1', 4)).toBe(false);
  });

  it('三人都叫分后应确定地主', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 1);
    engine.placeBid('p2', 2);
    engine.placeBid('p3', 1);

    const state = engine.getState();
    expect(state.phase).toBe('play');
    expect(state.landlordId).toBe('p2'); // 最高分2分
  });

  it('地主应获得底牌共20张', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 3);

    const landlord = engine.getState().players.find((p) => p.playerId === 'p1');
    expect(landlord?.hand.length).toBe(20);
    expect(landlord?.isLandlord).toBe(true);
  });

  it('不叫(null)应被记录', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', null);
    const state = engine.getState();
    expect(state.bidHistory).toHaveLength(1);
    expect(state.bidHistory[0].bid).toBeNull();
  });

  it('三人都pass应重新发牌', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', null);
    engine.placeBid('p2', null);
    engine.placeBid('p3', null);

    const state = engine.getState();
    // 应该重新开始
    expect(state.phase).toBe('bid');
  });
});

// ==================== 牌型识别测试 ====================

describe('DoudizhuEngine - 牌型识别', () => {
  let engine: DoudizhuEngine;

  beforeEach(() => {
    engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 3); // 快速进入出牌阶段
  });

  it('应正确识别单张', () => {
    const combo = engine.identifyCombo([makeCard('5')]);
    expect(combo?.type).toBe('single');
  });

  it('应正确识别对子', () => {
    const cards = [makeCard('7', 'spade'), makeCard('7', 'heart')];
    const combo = engine.identifyCombo(cards);
    expect(combo?.type).toBe('pair');
  });

  it('应正确识别三张', () => {
    const cards = [
      makeCard('9', 'spade'),
      makeCard('9', 'heart'),
      makeCard('9', 'club'),
    ];
    const combo = engine.identifyCombo(cards);
    expect(combo?.type).toBe('triple');
  });

  it('应正确识别炸弹', () => {
    const cards = [
      makeCard('K', 'spade'),
      makeCard('K', 'heart'),
      makeCard('K', 'club'),
      makeCard('K', 'diamond'),
    ];
    const combo = engine.identifyCombo(cards);
    expect(combo?.type).toBe('bomb');
  });

  it('应正确识别火箭', () => {
    const cards = [makeCard('small_joker', 'joker'), makeCard('big_joker', 'joker')];
    const combo = engine.identifyCombo(cards);
    expect(combo?.type).toBe('rocket');
  });

  it('应正确识别三带一', () => {
    const cards = [
      makeCard('5', 'spade'),
      makeCard('5', 'heart'),
      makeCard('5', 'club'),
      makeCard('3', 'spade'),
    ];
    const combo = engine.identifyCombo(cards);
    expect(combo?.type).toBe('triple_with_single');
  });

  it('应正确识别三带二', () => {
    const cards = [
      makeCard('A', 'spade'),
      makeCard('A', 'heart'),
      makeCard('A', 'club'),
      makeCard('4', 'spade'),
      makeCard('4', 'heart'),
    ];
    const combo = engine.identifyCombo(cards);
    expect(combo?.type).toBe('triple_with_pair');
  });

  it('应正确识别顺子（5张）', () => {
    const cards = makeCards(['3', '4', '5', '6', '7']);
    const combo = engine.identifyCombo(cards);
    expect(combo?.type).toBe('straight');
    expect(combo?.cards.length).toBe(5);
  });

  it('应正确识别顺子（10张）', () => {
    const cards = makeCards(['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q']);
    const combo = engine.identifyCombo(cards);
    expect(combo?.type).toBe('straight');
    expect(combo?.cards.length).toBe(10);
  });

  it('应正确识别连对', () => {
    const cards = [
      makeCard('3', 'spade'),
      makeCard('3', 'heart'),
      makeCard('4', 'spade'),
      makeCard('4', 'heart'),
      makeCard('5', 'spade'),
      makeCard('5', 'heart'),
    ];
    const combo = engine.identifyCombo(cards);
    expect(combo?.type).toBe('straight_pairs');
  });

  it('应正确识别飞机', () => {
    const cards = [
      makeCard('3', 'spade'),
      makeCard('3', 'heart'),
      makeCard('3', 'club'),
      makeCard('4', 'spade'),
      makeCard('4', 'heart'),
      makeCard('4', 'club'),
    ];
    const combo = engine.identifyCombo(cards);
    expect(combo?.type).toBe('airplane');
  });

  it('应正确识别飞机带翅膀', () => {
    const cards = [
      makeCard('3', 'spade'),
      makeCard('3', 'heart'),
      makeCard('3', 'club'),
      makeCard('4', 'spade'),
      makeCard('4', 'heart'),
      makeCard('4', 'club'),
      makeCard('6', 'spade'),
      makeCard('7', 'heart'),
    ];
    const combo = engine.identifyCombo(cards);
    expect(combo?.type).toBe('airplane');
  });

  it('应识别空牌为pass', () => {
    const combo = engine.identifyCombo([]);
    expect(combo?.type).toBe('pass');
  });

  it('非法牌型应返回null', () => {
    const cards = [makeCard('3'), makeCard('5')]; // 不连续的两张单牌
    const combo = engine.identifyCombo(cards);
    expect(combo).toBeNull();
  });

  it('2和王不能参与顺子', () => {
    const cards = makeCards(['J', 'Q', 'K', 'A', '2']);
    const combo = engine.identifyCombo(cards);
    expect(combo).toBeNull();
  });
});

// ==================== 牌型比较测试 ====================

describe('DoudizhuEngine - 牌型比较', () => {
  let engine: DoudizhuEngine;

  beforeEach(() => {
    engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 3);
  });

  it('同点数单张不能打', () => {
    const single5a: CardCombo = { type: 'single', cards: [makeCard('5')] };
    const single5b: CardCombo = { type: 'single', cards: [makeCard('5', 'heart')] };
    expect(engine.canBeat(single5a, single5b)).toBe(false);
  });

  it('大牌单张可以打小牌单张', () => {
    const small: CardCombo = { type: 'single', cards: [makeCard('5')] };
    const big: CardCombo = { type: 'single', cards: [makeCard('K')] };
    expect(engine.canBeat(small, big)).toBe(true);
  });

  it('小牌单张不能打大牌单张', () => {
    const big: CardCombo = { type: 'single', cards: [makeCard('K')] };
    const small: CardCombo = { type: 'single', cards: [makeCard('5')] };
    expect(engine.canBeat(big, small)).toBe(false);
  });

  it('炸弹可以打任何普通牌型', () => {
    const straight: CardCombo = {
      type: 'straight',
      cards: makeCards(['3', '4', '5', '6', '7']),
    };
    const bomb: CardCombo = {
      type: 'bomb',
      cards: [makeCard('5'), makeCard('5', 'heart'), makeCard('5', 'club'), makeCard('5', 'diamond')],
    };
    expect(engine.canBeat(straight, bomb)).toBe(true);
  });

  it('火箭可以打任何牌', () => {
    const bomb: CardCombo = {
      type: 'bomb',
      cards: [makeCard('A'), makeCard('A', 'heart'), makeCard('A', 'club'), makeCard('A', 'diamond')],
    };
    const rocket: CardCombo = {
      type: 'rocket',
      cards: [makeCard('small_joker', 'joker'), makeCard('big_joker', 'joker')],
    };
    expect(engine.canBeat(bomb, rocket)).toBe(true);
  });

  it('普通牌型不能打炸弹', () => {
    const single: CardCombo = { type: 'single', cards: [makeCard('2')] };
    const bomb: CardCombo = {
      type: 'bomb',
      cards: [makeCard('5'), makeCard('5', 'heart'), makeCard('5', 'club'), makeCard('5', 'diamond')],
    };
    expect(engine.canBeat(bomb, single)).toBe(false);
  });

  it('大炸弹可以打小炸弹', () => {
    const smallBomb: CardCombo = {
      type: 'bomb',
      cards: [makeCard('5'), makeCard('5', 'heart'), makeCard('5', 'club'), makeCard('5', 'diamond')],
    };
    const bigBomb: CardCombo = {
      type: 'bomb',
      cards: [makeCard('K'), makeCard('K', 'heart'), makeCard('K', 'club'), makeCard('K', 'diamond')],
    };
    expect(engine.canBeat(smallBomb, bigBomb)).toBe(true);
  });

  it('pass不能打任何牌', () => {
    const single: CardCombo = { type: 'single', cards: [makeCard('3')] };
    const pass: CardCombo = { type: 'pass', cards: [] };
    expect(engine.canBeat(single, pass)).toBe(false);
  });

  it('不同类型不能比较', () => {
    const single: CardCombo = { type: 'single', cards: [makeCard('2')] };
    const pair: CardCombo = {
      type: 'pair',
      cards: [makeCard('3'), makeCard('3', 'heart')],
    };
    expect(engine.canBeat(single, pair)).toBe(false);
  });
});

// ==================== 出牌测试 ====================

describe('DoudizhuEngine - 出牌', () => {
  let engine: DoudizhuEngine;

  beforeEach(() => {
    engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 3); // p1是地主
  });

  it('地主应能出牌', () => {
    const state = engine.getState();
    const landlord = state.players.find((p) => p.isLandlord)!;
    const card = landlord.hand[0];

    const result = engine.playCards('p1', [card]);
    expect(result).toBe(true);
  });

  it('非当前玩家不能出牌', () => {
    const state = engine.getState();
    const peasant = state.players.find((p) => !p.isLandlord)!;

    const result = engine.playCards(peasant.playerId, [peasant.hand[0]]);
    expect(result).toBe(false);
  });

  it('不能出手中没有的牌', () => {
    const fakeCard: Card = { suit: 'spade', rank: '2', value: 15 };
    const result = engine.playCards('p1', [fakeCard]);
    expect(result).toBe(false);
  });

  it('出牌后手牌应减少', () => {
    const state = engine.getState();
    const landlord = state.players.find((p) => p.isLandlord)!;
    const beforeCount = landlord.hand.length;

    engine.playCards('p1', [landlord.hand[0]]);

    const afterState = engine.getState();
    const afterCount = afterState.players.find((p) => p.isLandlord)!.hand.length;

    expect(afterCount).toBe(beforeCount - 1);
  });

  it('Pass应成功', () => {
    // p1出牌
    const state = engine.getState();
    const landlord = state.players.find((p) => p.isLandlord)!;
    engine.playCards('p1', [landlord.hand[0]]);

    // 轮到p2，p2 pass
    const p2State = engine.getState();
    const result = engine.pass(p2State.currentPlayerId);
    expect(result).toBe(true);
  });

  it('最后一个出牌的不能pass', () => {
    const state = engine.getState();
    const landlord = state.players.find((p) => p.isLandlord)!;
    engine.playCards('p1', [landlord.hand[0]]);

    // p2 pass
    let s = engine.getState();
    engine.pass(s.currentPlayerId);

    // p3 pass
    s = engine.getState();
    engine.pass(s.currentPlayerId);

    // 现在轮到p1，p1是最后一个出牌的，不能pass
    s = engine.getState();
    expect(s.currentPlayerId).toBe('p1');
    const result = engine.pass('p1');
    expect(result).toBe(false);
  });

  it('两个pass后应清空出牌记录', () => {
    const state = engine.getState();
    const landlord = state.players.find((p) => p.isLandlord)!;
    engine.playCards('p1', [landlord.hand[0]]);

    // p2 pass
    let s = engine.getState();
    engine.pass(s.currentPlayerId);

    // p3 pass
    s = engine.getState();
    engine.pass(s.currentPlayerId);

    // 现在p1可以自由出
    s = engine.getState();
    expect(s.lastPlayedCombo).toBeNull();
    expect(s.consecutivePasses).toBe(0);
  });

  it('炸弹应使倍数翻倍', () => {
    // 给p1四个5
    const state = engine.getState();
    const landlord = state.players.find((p) => p.isLandlord)!;
    const beforeMultiplier = state.multiplier;

    // 找到四个相同点数的牌
    const valueCount = new Map<number, Card[]>();
    for (const card of landlord.hand) {
      if (!valueCount.has(card.value)) valueCount.set(card.value, []);
      valueCount.get(card.value)!.push(card);
    }

    const bombEntry = Array.from(valueCount.entries()).find(([, cards]) => cards.length === 4);
    if (bombEntry) {
      engine.playCards('p1', bombEntry[1]);
      const afterState = engine.getState();
      expect(afterState.multiplier).toBe(beforeMultiplier * 2);
    }
  });
});

// ==================== 游戏结束测试 ====================

describe('DoudizhuEngine - 游戏结束', () => {
  it('玩家手牌出完应结束游戏', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 3);

    // 模拟出完所有牌（通过直接操作内部状态）
    const state = engine.getState();
    const landlord = state.players.find((p) => p.isLandlord)!;

    // 清空地主手牌触发结束
    (engine as unknown as Record<string, unknown>)['state'] = {
      ...state,
      players: state.players.map((p) =>
        p.playerId === 'p1' ? { ...p, hand: [], cardCount: 0 } : p,
      ),
    };

    // 手动触发检查
    (engine as unknown as { checkGameOver: () => void }).checkGameOver();

    expect(engine.isGameOver()).toBe(true);
    expect(engine.getWinner()).toBe('landlord');
  });
});

// ==================== 工具函数测试 ====================

describe('DoudizhuEngine - 工具函数', () => {
  it('sortCards应按升序排序', () => {
    const cards = [makeCard('A'), makeCard('3'), makeCard('K'), makeCard('5')];
    const sorted = sortCards(cards);
    expect(sorted[0].rank).toBe('3');
    expect(sorted[1].rank).toBe('5');
    expect(sorted[2].rank).toBe('K');
    expect(sorted[3].rank).toBe('A');
  });

  it('sortCardsDesc应按降序排序', () => {
    const cards = [makeCard('3'), makeCard('A'), makeCard('5'), makeCard('K')];
    const sorted = sortCardsDesc(cards);
    expect(sorted[0].rank).toBe('A');
    expect(sorted[1].rank).toBe('K');
    expect(sorted[2].rank).toBe('5');
    expect(sorted[3].rank).toBe('3');
  });

  it('RANK_VALUE应正确映射', () => {
    expect(RANK_VALUE['3']).toBe(3);
    expect(RANK_VALUE['10']).toBe(10);
    expect(RANK_VALUE['A']).toBe(14);
    expect(RANK_VALUE['2']).toBe(15);
    expect(RANK_VALUE['small_joker']).toBe(16);
    expect(RANK_VALUE['big_joker']).toBe(17);
  });
});

// ==================== 合法出牌测试 ====================

describe('DoudizhuEngine - 合法出牌', () => {
  it('应返回合法出牌列表', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 3);

    const plays = engine.getLegalPlays('p1');
    expect(plays.length).toBeGreaterThan(0);
  });

  it('没有上一轮时应返回所有牌型', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 3);

    const plays = engine.getLegalPlays('p1');
    // 应包含多种牌型
    const hasSingle = plays.some((p) => p.type === 'single');
    expect(hasSingle).toBe(true);
  });
});
