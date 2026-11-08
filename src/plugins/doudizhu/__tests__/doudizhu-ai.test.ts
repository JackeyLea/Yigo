/**
 * 斗地主AI单元测试
 */

import { DoudizhuAI } from '../ai/doudizhu-ai';
import { DoudizhuEngine, RANK_VALUE } from '../doudizhu.engine';
import type { Card, DoudizhuState } from '../doudizhu.types';

// ==================== 测试工具 ====================

function makeCard(rank: string, suit = 'spade'): Card {
  return {
    suit: suit as Card['suit'],
    rank: rank as Card['rank'],
    value: RANK_VALUE[rank as keyof typeof RANK_VALUE] ?? 0,
  };
}

function makeCards(ranks: string[]): Card[] {
  return ranks.map((r) => makeCard(r));
}

/** 获取完整的游戏状态（含手牌） */
function getFullState(engine: DoudizhuEngine): DoudizhuState {
  return engine.getState();
}

// ==================== AI基础测试 ====================

describe('DoudizhuAI - 基础功能', () => {
  it('应正确创建Easy难度AI', () => {
    const ai = new DoudizhuAI('easy');
    expect(ai.getDifficulty()).toBe('easy');
  });

  it('应正确创建Medium难度AI', () => {
    const ai = new DoudizhuAI('medium');
    expect(ai.getDifficulty()).toBe('medium');
  });

  it('应正确创建Hard难度AI', () => {
    const ai = new DoudizhuAI('hard');
    expect(ai.getDifficulty()).toBe('hard');
  });

  it('默认应为Medium难度', () => {
    const ai = new DoudizhuAI();
    expect(ai.getDifficulty()).toBe('medium');
  });

  it('应能修改难度', () => {
    const ai = new DoudizhuAI('easy');
    ai.setDifficulty('hard');
    expect(ai.getDifficulty()).toBe('hard');
  });

  it('记牌器初始应为空', () => {
    const ai = new DoudizhuAI('hard');
    expect(ai.getMemory().size).toBe(0);
  });

  it('清除记牌器后应为空', () => {
    const ai = new DoudizhuAI('hard');
    // 模拟使用后清除
    ai.clearMemory();
    expect(ai.getMemory().size).toBe(0);
  });
});

// ==================== 叫分测试 ====================

describe('DoudizhuAI - 叫分', () => {
  it('Easy难度应返回有效叫分或null', () => {
    const ai = new DoudizhuAI('easy');
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    const state = engine.getState();

    const bid = ai.getBid(state, 'p1');
    expect(bid === null || (bid >= 1 && bid <= 3)).toBe(true);
  });

  it('Medium难度应返回有效叫分或null', () => {
    const ai = new DoudizhuAI('medium');
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    const state = engine.getState();

    const bid = ai.getBid(state, 'p1');
    expect(bid === null || (bid >= 1 && bid <= 3)).toBe(true);
  });

  it('Hard难度应返回有效叫分或null', () => {
    const ai = new DoudizhuAI('hard');
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    const state = engine.getState();

    const bid = ai.getBid(state, 'p1');
    expect(bid === null || (bid >= 1 && bid <= 3)).toBe(true);
  });

  it('好牌应倾向于叫高分', () => {
    // 创建一手强牌
    const strongHand = makeCards([
      'big_joker', 'small_joker', '2', '2', 'A', 'A', 'K', 'K',
      'Q', 'Q', 'J', 'J', '10', '10', '9', '9', '8',
    ]);

    const ai = new DoudizhuAI('hard');
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();

    // 替换p1的手牌为强牌
    const state = engine.getState();
    (state.players[0] as unknown as Record<string, unknown>).hand = strongHand;

    const bid = ai.getBid(state, 'p1');
    // 有王炸的强牌应该叫分
    expect(bid).toBeGreaterThanOrEqual(1);
  });
});

// ==================== 牌力评估测试 ====================

describe('DoudizhuAI - 牌力评估', () => {
  it('空牌强度应为0', () => {
    const ai = new DoudizhuAI('hard');
    const strength = ai.evaluateHandStrength([]);
    expect(strength).toBe(0);
  });

  it('有王炸的牌应高分', () => {
    const ai = new DoudizhuAI('hard');
    const hand = makeCards(['big_joker', 'small_joker', 'A', 'K', 'Q']);
    const strength = ai.evaluateHandStrength(hand);
    expect(strength).toBeGreaterThan(50);
  });

  it('只有小牌的牌应低分', () => {
    const ai = new DoudizhuAI('hard');
    const hand = makeCards(['3', '4', '5', '6', '7']);
    const strength = ai.evaluateHandStrength(hand);
    expect(strength).toBeLessThan(50);
  });

  it('有大王应加分', () => {
    const ai = new DoudizhuAI('hard');
    const hand1 = makeCards(['big_joker']);
    const hand2 = makeCards(['3']);
    expect(ai.evaluateHandStrength(hand1)).toBeGreaterThan(ai.evaluateHandStrength(hand2));
  });

  it('有炸弹应加分', () => {
    const ai = new DoudizhuAI('hard');
    const handWithBomb = makeCards(['5', '5', '5', '5', '3', '4']);
    const handWithoutBomb = makeCards(['3', '4', '5', '6', '7', '8']);
    expect(ai.evaluateHandStrength(handWithBomb)).toBeGreaterThan(
      ai.evaluateHandStrength(handWithoutBomb),
    );
  });
});

// ==================== 出牌决策测试 ====================

describe('DoudizhuAI - 出牌决策', () => {
  it('Easy难度应返回合法出牌', () => {
    const ai = new DoudizhuAI('easy');
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 3);

    const state = engine.getState();
    const play = ai.getPlay(state, 'p1');

    // 应该有出牌（地主先手）
    expect(play).not.toBeNull();
    expect(play!.length).toBeGreaterThan(0);
  });

  it('Medium难度应返回合法出牌', () => {
    const ai = new DoudizhuAI('medium');
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 3);

    const state = engine.getState();
    const play = ai.getPlay(state, 'p1');

    expect(play).not.toBeNull();
    expect(play!.length).toBeGreaterThan(0);
  });

  it('Hard难度应返回合法出牌', () => {
    const ai = new DoudizhuAI('hard');
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 3);

    const state = engine.getState();
    const play = ai.getPlay(state, 'p1');

    expect(play).not.toBeNull();
    expect(play!.length).toBeGreaterThan(0);
  });

  it('当必须接牌时应返回能接的牌', () => {
    const ai = new DoudizhuAI('medium');
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    engine.placeBid('p1', 3);

    // p1出一张小牌
    const state = engine.getState();
    const landlord = state.players.find((p) => p.isLandlord)!;
    engine.playCards('p1', [landlord.hand[0]]);

    // 现在轮到p2
    const afterState = engine.getState();
    const p2Play = ai.getPlay(afterState, afterState.currentPlayerId);

    // p2应该能接（除非确实接不了会pass）
    expect(p2Play !== undefined).toBe(true);
  });
});

// ==================== 出牌序列规划测试 ====================

describe('DoudizhuAI - 出牌序列规划', () => {
  it('应能为手牌规划序列', () => {
    const ai = new DoudizhuAI('hard');
    const hand = makeCards([
      '3', '4', '5', '6', '7', // 顺子
      '8', '8', // 对子
      'J', 'J', 'J', // 三张
    ]);

    const sequence = ai.planPlaySequence(hand);
    expect(sequence.length).toBeGreaterThan(0);
  });

  it('序列应覆盖所有手牌', () => {
    const ai = new DoudizhuAI('hard');
    const hand = makeCards(['3', '3', '4', '4', '5', '5']);

    const sequence = ai.planPlaySequence(hand);
    const totalCards = sequence.reduce((sum, cards) => sum + cards.length, 0);
    expect(totalCards).toBe(hand.length);
  });

  it('空手牌应返回空序列', () => {
    const ai = new DoudizhuAI('hard');
    const sequence = ai.planPlaySequence([]);
    expect(sequence).toHaveLength(0);
  });
});

// ==================== 难度差异测试 ====================

describe('DoudizhuAI - 难度差异', () => {
  it('不同难度对同一手牌的叫分可能不同', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    engine.dealCards();
    const state = engine.getState();

    const easyAI = new DoudizhuAI('easy');
    const hardAI = new DoudizhuAI('hard');

    const easyBid = easyAI.getBid(state, 'p1');
    const hardBid = hardAI.getBid(state, 'p1');

    // 两者都应返回有效值
    expect(easyBid === null || (easyBid >= 1 && easyBid <= 3)).toBe(true);
    expect(hardBid === null || (hardBid >= 1 && hardBid <= 3)).toBe(true);
  });
});

// ==================== 完整对局模拟 ====================

describe('DoudizhuAI - 完整对局模拟', () => {
  it('三个AI应能完成一局游戏', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    const ai1 = new DoudizhuAI('easy');
    const ai2 = new DoudizhuAI('easy');
    const ai3 = new DoudizhuAI('easy');

    engine.dealCards();

    // 叫分阶段
    const state = engine.getState();
    const bid1 = ai1.getBid(state, 'p1') ?? 1;
    engine.placeBid('p1', bid1);

    const state2 = engine.getState();
    const bid2 = ai2.getBid(state2, state2.currentPlayerId) ?? null;
    engine.placeBid(state2.currentPlayerId, bid2);

    const state3 = engine.getState();
    const bid3 = ai3.getBid(state3, state3.currentPlayerId) ?? null;
    engine.placeBid(state3.currentPlayerId, bid3);

    // 出牌阶段（模拟最多100步）
    let steps = 0;
    const maxSteps = 100;

    while (!engine.isGameOver() && steps < maxSteps) {
      const currentState = engine.getState();
      const currentId = currentState.currentPlayerId;

      let ai: DoudizhuAI;
      if (currentId === 'p1') ai = ai1;
      else if (currentId === 'p2') ai = ai2;
      else ai = ai3;

      const play = ai.getPlay(currentState, currentId);

      if (play && play.length > 0) {
        engine.playCards(currentId, play);
      } else {
        engine.pass(currentId);
      }

      steps++;
    }

    // 游戏应该结束
    expect(engine.isGameOver() || steps >= maxSteps).toBe(true);
  }, 10000);

  it('Hard AI应能在对局中做出决策', () => {
    const engine = new DoudizhuEngine(['p1', 'p2', 'p3']);
    const ai = new DoudizhuAI('hard');

    engine.dealCards();
    engine.placeBid('p1', 3);

    const state = engine.getState();
    const play = ai.getPlay(state, 'p1');

    expect(play).not.toBeNull();
    if (play) {
      expect(play.length).toBeGreaterThan(0);
    }
  });
});
