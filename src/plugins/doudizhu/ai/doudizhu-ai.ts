/**
 * 斗地主AI
 * 支持三种难度：easy（随机）/ medium（牌型优先）/ hard（记牌+牌力评估+配合）
 */

import {
  type Card,
  type CardCombo,
  type DoudizhuState,
  type DoudizhuPlayer,
  type Suit,
  type Rank,
} from '../doudizhu.types';
import { RANK_VALUE, sortCards, sortCardsDesc } from '../doudizhu.engine';
import { DoudizhuEngine } from '../doudizhu.engine';

/** 难度等级 */
export type Difficulty = 'easy' | 'medium' | 'hard';

// ==================== 工具函数 ====================

/** 按牌值统计数量 */
function countByValue(cards: Card[]): Map<number, number> {
  const count = new Map<number, number>();
  for (const card of cards) {
    count.set(card.value, (count.get(card.value) || 0) + 1);
  }
  return count;
}

/** 将牌转换为引擎可用的Card对象 */
function normalizeCard(card: Partial<Card> & { suit: Suit; rank: Rank }): Card {
  return {
    suit: card.suit,
    rank: card.rank,
    value: card.value ?? RANK_VALUE[card.rank],
  };
}

/** 从状态中获取AI玩家对象 */
function getAIPlayer(state: DoudizhuState, aiPlayerId?: string): DoudizhuPlayer | undefined {
  if (aiPlayerId) {
    return state.players.find((p) => p.playerId === aiPlayerId);
  }
  // 默认返回当前轮到操作的玩家
  return state.players.find((p) => p.playerId === state.currentPlayerId);
}

/** 判断是否为地主 */
function isLandlord(state: DoudizhuState, playerId: string): boolean {
  return state.landlordId === playerId;
}

/** 获取队友ID */
function getTeammateId(state: DoudizhuState, playerId: string): string | null {
  const player = state.players.find((p) => p.playerId === playerId);
  if (!player) return null;

  if (player.isLandlord) return null; // 地主没有队友

  // 找另一个农民
  const teammate = state.players.find((p) => !p.isLandlord && p.playerId !== playerId);
  return teammate?.playerId ?? null;
}

/** 获取已出牌记录（从状态中推断） */
function getPlayedCards(state: DoudizhuState, aiPlayerId: string): Card[] {
  // 通过已出牌的组合历史推断（简化版）
  // 实际项目中应该有更完整的出牌记录
  const played: Card[] = [];

  // 从最后出的牌中收集
  if (state.lastPlayedCombo && state.lastPlayedCombo.cards.length > 0) {
    played.push(...state.lastPlayedCombo.cards);
  }

  return played;
}

// ==================== AI主类 ====================

export class DoudizhuAI {
  private difficulty: Difficulty;
  private memory: Map<string, Card[]> = new Map(); // 记牌器：playerId -> 已出牌
  private engine: DoudizhuEngine | null = null;

  constructor(difficulty: Difficulty = 'medium') {
    this.difficulty = difficulty;
  }

  /** 设置引擎引用（用于hard模式的复杂分析） */
  setEngine(engine: DoudizhuEngine): void {
    this.engine = engine;
  }

  // ==================== 叫分决策 ====================

  /**
   * 叫分决策
   * @param state 当前游戏状态
   * @returns 1/2/3分 或 null（不叫）
   */
  getBid(state: DoudizhuState, aiPlayerId?: string): number | null {
    const player = getAIPlayer(state, aiPlayerId);
    if (!player) return null;

    const hand = sortCards(player.hand);
    const strength = this.evaluateHandStrength(hand);

    switch (this.difficulty) {
      case 'easy':
        return this.getBidEasy(strength);
      case 'medium':
        return this.getBidMedium(strength, hand);
      case 'hard':
        return this.getBidHard(strength, hand, state);
    }
  }

  /** Easy难度叫分：随机叫分 */
  private getBidEasy(strength: number): number | null {
    const rand = Math.random();
    if (strength > 70 && rand > 0.2) return 3;
    if (strength > 50 && rand > 0.4) return 2;
    if (strength > 30 && rand > 0.5) return 1;
    return null;
  }

  /** Medium难度叫分：基于牌力评估 */
  private getBidMedium(strength: number, hand: Card[]): number | null {
    // 有大王/炸弹加分
    const hasBigJoker = hand.some((c) => c.rank === 'big_joker');
    const bombCount = this.countBombs(hand);

    let adjustedStrength = strength;
    if (hasBigJoker) adjustedStrength += 10;
    adjustedStrength += bombCount * 8;

    if (adjustedStrength >= 75) return 3;
    if (adjustedStrength >= 55) return 2;
    if (adjustedStrength >= 35) return 1;
    return null;
  }

  /** Hard难度叫分：精细评估 */
  private getBidHard(strength: number, hand: Card[], state: DoudizhuState): number | null {
    const hasBigJoker = hand.some((c) => c.rank === 'big_joker');
    const hasSmallJoker = hand.some((c) => c.rank === 'small_joker');
    const bombCount = this.countBombs(hand);
    const hasRocket = hasBigJoker && hasSmallJoker;

    let score = strength;

    // 王牌加分
    if (hasRocket) score += 20;
    else if (hasBigJoker) score += 12;
    else if (hasSmallJoker) score += 8;

    // 炸弹加分
    score += bombCount * 10;

    // 2的数量加分
    const count2 = hand.filter((c) => c.rank === '2').length;
    score += count2 * 5;

    // A和K加分
    const countAK = hand.filter((c) => c.rank === 'A' || c.rank === 'K').length;
    score += countAK * 2;

    // 顺子多加分
    const straightCount = this.countStraights(hand);
    score += straightCount * 3;

    if (score >= 80) return 3;
    if (score >= 60) return 2;
    if (score >= 40) return 1;
    return null;
  }

  // ==================== 出牌决策 ====================

  /**
   * 出牌决策
   * @param state 当前游戏状态
   * @param aiPlayerId AI玩家ID（可选，默认当前玩家）
   * @returns 要打出的牌数组，null表示Pass
   */
  getPlay(state: DoudizhuState, aiPlayerId?: string): Card[] | null {
    const player = getAIPlayer(state, aiPlayerId);
    if (!player) return null;

    const hand = sortCards(player.hand);
    const playerId = player.playerId;

    // 创建临时引擎用于获取合法出牌
    const legalPlays = this.getLegalPlaysFromState(state, playerId, hand);

    if (legalPlays.length === 0) return null;

    switch (this.difficulty) {
      case 'easy':
        return this.getPlayEasy(legalPlays, hand);
      case 'medium':
        return this.getPlayMedium(legalPlays, hand, state, playerId);
      case 'hard':
        return this.getPlayHard(legalPlays, hand, state, playerId);
    }
  }

  /** 获取合法出牌 */
  private getLegalPlaysFromState(
    state: DoudizhuState,
    playerId: string,
    hand: Card[],
  ): CardCombo[] {
    // 使用引擎获取合法出牌
    const tempEngine = new DoudizhuEngine(state.players.map((p) => p.playerId));
    // 复制状态到临时引擎
    const allCombos = tempEngine['getAllCombos'](hand);

    // 如果没有上一个出牌，或者自己是上一个出牌的，可以自由出
    if (!state.lastPlayedCombo || state.lastPlayedBy === playerId) {
      return allCombos.filter((c) => c.type !== 'pass');
    }

    // 需要能打过上一个
    return allCombos.filter(
      (combo) => combo.type !== 'pass' && tempEngine.canBeat(state.lastPlayedCombo!, combo),
    );
  }

  /** Easy难度出牌：随机选择合法出牌 */
  private getPlayEasy(legalPlays: CardCombo[], _hand: Card[]): Card[] {
    // 过滤掉过于强力的牌型（保留炸弹和火箭）
    const normalPlays = legalPlays.filter(
      (c) => c.type !== 'rocket' || Math.random() > 0.7,
    );

    const choices = normalPlays.length > 0 ? normalPlays : legalPlays;
    const idx = Math.floor(Math.random() * choices.length);
    return [...choices[idx].cards];
  }

  /** Medium难度出牌：牌型优先 + 大牌优先 */
  private getPlayMedium(
    legalPlays: CardCombo[],
    hand: Card[],
    state: DoudizhuState,
    playerId: string,
  ): Card[] {
    const isLandlordPlayer = isLandlord(state, playerId);

    // 1. 如果只剩很少牌，优先出完
    if (hand.length <= 2) {
      const finishingPlay = legalPlays.find((c) => c.cards.length === hand.length);
      if (finishingPlay) return [...finishingPlay.cards];
    }

    // 2. 排序优先级
    let scored = legalPlays.map((combo) => ({
      combo,
      score: this.scoreComboMedium(combo, hand, isLandlordPlayer),
    }));

    // 3. 农民配合逻辑
    if (!isLandlordPlayer && state.lastPlayedBy) {
      const lastPlayerIsLandlord = isLandlord(state, state.lastPlayedBy);
      const teammateId = getTeammateId(state, playerId);
      const teammate = state.players.find((p) => p.playerId === teammateId);

      if (!lastPlayerIsLandlord && state.lastPlayedBy !== playerId) {
        // 队友出的牌，尽量不接（除非队友牌很少）
        if (teammate && teammate.cardCount > 3) {
          // 降低接队友牌的优先级
          scored = scored.map((s) => ({
            ...s,
            score: s.score - 30,
          }));
        }
      }

      if (lastPlayerIsLandlord) {
        // 地主出牌，农民应该尽量接
        scored = scored.map((s) => ({
          ...s,
          score: s.score + 10,
        }));
      }
    }

    scored.sort((a, b) => b.score - a.score);

    // 4. 如果有明显优势组合优先出
    const best = scored[0];
    return [...best.combo.cards];
  }

  /** Hard难度出牌：记牌 + 牌力评估 + 最优配合 */
  private getPlayHard(
    legalPlays: CardCombo[],
    hand: Card[],
    state: DoudizhuState,
    playerId: string,
  ): Card[] {
    const isLandlordPlayer = isLandlord(state, playerId);
    const handStrength = this.evaluateHandStrength(hand);

    // 1. 判断主攻/助攻角色
    const isAttacker = this.isAttacker(state, playerId, handStrength);

    // 2. 更新记牌器
    this.updateMemory(state);

    // 3. 剩余牌分析
    const remainingAnalysis = this.analyzeRemainingCards(state, playerId);

    // 4. 对每个合法出牌进行评分
    let scored = legalPlays.map((combo) => ({
      combo,
      score: this.scoreComboHard(
        combo,
        hand,
        state,
        playerId,
        isLandlordPlayer,
        isAttacker,
        remainingAnalysis,
      ),
    }));

    // 5. 农民配合
    if (!isLandlordPlayer) {
      const teammateId = getTeammateId(state, playerId);
      const teammate = state.players.find((p) => p.playerId === teammateId);
      const lastPlayerIsLandlord = state.lastPlayedBy
        ? isLandlord(state, state.lastPlayedBy)
        : false;

      if (teammate && teammate.cardCount <= 3 && state.lastPlayedBy !== playerId) {
        // 队友快赢了，优先 Pass 让队友出
        if (!lastPlayerIsLandlord) {
          const passOption = legalPlays.find((c) => c.type === 'pass');
          if (passOption) return [];
        }
      }

      // 地主牌很少时，优先用大牌压制
      const landlord = state.players.find((p) => p.isLandlord);
      if (landlord && landlord.cardCount <= 3 && lastPlayerIsLandlord) {
        scored = scored.map((s) => ({
          ...s,
          score: s.combo.cards.some((c) => c.value >= RANK_VALUE['A']) ? s.score + 15 : s.score,
        }));
      }
    }

    // 6. 优先选择能一次出完的方案
    const finishingPlay = legalPlays.find((c) => c.cards.length === hand.length);
    if (finishingPlay) return [...finishingPlay.cards];

    scored.sort((a, b) => b.score - a.score);
    return [...scored[0].combo.cards];
  }

  // ==================== 牌力评估 ====================

  /**
   * 评估手牌强度（0-100分）
   */
  evaluateHandStrength(hand: Card[]): number {
    let score = 30; // 基础分

    const valueCount = countByValue(hand);

    // 王牌
    const hasBigJoker = hand.some((c) => c.rank === 'big_joker');
    const hasSmallJoker = hand.some((c) => c.rank === 'small_joker');
    if (hasBigJoker && hasSmallJoker) score += 20;
    else if (hasBigJoker) score += 12;
    else if (hasSmallJoker) score += 8;

    // 2的数量
    const count2 = valueCount.get(RANK_VALUE['2']) ?? 0;
    score += count2 * 6;

    // A和K
    const countA = valueCount.get(RANK_VALUE['A']) ?? 0;
    const countK = valueCount.get(RANK_VALUE['K']) ?? 0;
    score += (countA + countK) * 3;

    // 炸弹
    const bombs = this.countBombs(hand);
    score += bombs * 10;

    // 顺子潜力（减少单张加分）
    const singleCount = hand.length - this.countCardsInCombos(hand);
    score -= singleCount * 2;

    // 牌型整齐度加分
    const tripleCount = Array.from(valueCount.values()).filter((c) => c >= 3).length;
    const pairCount = Array.from(valueCount.values()).filter((c) => c >= 2).length;
    score += tripleCount * 3 + pairCount;

    return Math.min(100, Math.max(0, score));
  }

  // ==================== 出牌序列规划 ====================

  /**
   * 规划最优出牌序列
   * @returns 出牌序列的数组
   */
  planPlaySequence(hand: Card[]): Card[][] {
    const sequences: Card[][] = [];
    const sorted = sortCards(hand);
    const valueCount = countByValue(sorted);

    // 1. 先出顺子（尽量减少单张）
    const straight = this.findLongestStraight(sorted);
    if (straight.length >= 5) {
      sequences.push(straight);
      const remaining = this.removeCards(sorted, straight);
      const subSequence = this.planPlaySequence(remaining);
      sequences.push(...subSequence);
      return sequences;
    }

    // 2. 出连对
    const straightPairs = this.findLongestStraightPairs(sorted);
    if (straightPairs.length >= 6) {
      sequences.push(straightPairs);
      const remaining = this.removeCards(sorted, straightPairs);
      const subSequence = this.planPlaySequence(remaining);
      sequences.push(...subSequence);
      return sequences;
    }

    // 3. 出飞机
    const airplane = this.findAirplane(sorted);
    if (airplane.length >= 6) {
      sequences.push(airplane);
      const remaining = this.removeCards(sorted, airplane);
      const subSequence = this.planPlaySequence(remaining);
      sequences.push(...subSequence);
      return sequences;
    }

    // 4. 出三带
    for (const [value, count] of valueCount) {
      if (count === 3) {
        const triple = sorted.filter((c) => c.value === value).slice(0, 3);
        sequences.push(triple);
        const remaining = this.removeCards(sorted, triple);
        const subSequence = this.planPlaySequence(remaining);
        sequences.push(...subSequence);
        return sequences;
      }
    }

    // 5. 出对子
    for (const [value, count] of valueCount) {
      if (count === 2 && value < RANK_VALUE['2']) {
        const pair = sorted.filter((c) => c.value === value).slice(0, 2);
        sequences.push(pair);
        const remaining = this.removeCards(sorted, pair);
        const subSequence = this.planPlaySequence(remaining);
        sequences.push(...subSequence);
        return sequences;
      }
    }

    // 6. 出单张（从小到大）
    if (sorted.length > 0) {
      const single = [sorted[0]];
      sequences.push(single);
      const remaining = this.removeCards(sorted, single);
      if (remaining.length > 0) {
        const subSequence = this.planPlaySequence(remaining);
        sequences.push(...subSequence);
      }
    }

    return sequences;
  }

  // ==================== 私有工具方法 ====================

  /** 评分组合（Medium难度） */
  private scoreComboMedium(combo: CardCombo, hand: Card[], isLandlord: boolean): number {
    let score = 0;
    const len = combo.cards.length;

    // 出牌数量多的优先（尽快出完）
    score += len * 3;

    switch (combo.type) {
      case 'single':
        // 单张出小的
        score += 20 - combo.cards[0].value;
        break;
      case 'pair':
        score += 15 - combo.cards[0].value * 0.5;
        break;
      case 'triple':
        score += 25 - combo.cards[0].value * 0.3;
        break;
      case 'triple_with_single':
      case 'triple_with_pair':
        score += 28;
        break;
      case 'straight':
        score += 30 + len;
        break;
      case 'straight_pairs':
        score += 35 + len;
        break;
      case 'airplane':
        score += 40 + len;
        break;
      case 'bomb':
        // 炸弹谨慎使用
        score = isLandlord ? 10 : 5;
        break;
      case 'rocket':
        // 火箭最后出
        score = -50;
        break;
    }

    // 如果出牌后能大幅减少手牌，加分
    const remainingCount = hand.length - len;
    if (remainingCount <= 2) score += 20;
    if (remainingCount === 0) score += 100;

    return score;
  }

  /** 评分组合（Hard难度） */
  private scoreComboHard(
    combo: CardCombo,
    hand: Card[],
    state: DoudizhuState,
    playerId: string,
    isLandlord: boolean,
    isAttacker: boolean,
    remainingAnalysis: { opponentsHaveHigh: boolean; opponentsHaveBombs: boolean },
  ): number {
    let score = this.scoreComboMedium(combo, hand, isLandlord);

    // Hard模式额外策略

    // 1. 根据角色调整
    if (isAttacker) {
      // 主攻：优先快速出完
      score += combo.cards.length * 2;
    } else {
      // 助攻：保留大牌，出小牌
      if (combo.cards[0].value > RANK_VALUE['A']) {
        score -= 10;
      }
    }

    // 2. 对手有炸弹时，避免出容易被拦截的牌型
    if (remainingAnalysis.opponentsHaveBombs && combo.type !== 'bomb' && combo.type !== 'rocket') {
      if (combo.cards[0].value > RANK_VALUE['K']) {
        score -= 5; // 大牌可能被炸弹拦截
      }
    }

    // 3. 对手有大牌时，保留自己的大牌
    if (remainingAnalysis.opponentsHaveHigh) {
      const maxCard = Math.max(...combo.cards.map((c) => c.value));
      if (maxCard >= RANK_VALUE['2']) {
        score -= 8;
      }
    }

    // 4. 炸弹使用策略
    if (combo.type === 'bomb') {
      // 只在关键时刻使用炸弹
      if (state.lastPlayedCombo?.type === 'bomb') {
        score += 50; // 对方出了炸弹，需要压制
      }
      const opponent = state.players.find(
        (p) => p.playerId !== playerId && p.cardCount <= 2,
      );
      if (opponent) {
        score += 30; // 对手快出完了
      }
    }

    // 5. 春天/反春天判断
    if (isLandlord && state.players.every((p) => !p.isLandlord && p.cardCount === 17)) {
      // 可能春天：尽量出完
      score += combo.cards.length * 3;
    }

    return score;
  }

  /** 判断是否为主攻角色 */
  private isAttacker(state: DoudizhuState, playerId: string, handStrength: number): boolean {
    if (isLandlord(state, playerId)) {
      // 地主总是主攻
      return true;
    }

    // 农民：牌力强的主攻
    const teammateId = getTeammateId(state, playerId);
    if (!teammateId) return true;

    const teammate = state.players.find((p) => p.playerId === teammateId);
    if (!teammate) return true;

    const teammateStrength = this.evaluateHandStrength(teammate.hand);

    // 牌力明显高于队友，承担主攻
    return handStrength > teammateStrength + 15;
  }

  /** 更新记牌器 */
  private updateMemory(state: DoudizhuState): void {
    if (this.difficulty !== 'hard') return;

    // 记录最后出的牌
    if (state.lastPlayedCombo && state.lastPlayedBy) {
      const existing = this.memory.get(state.lastPlayedBy) ?? [];
      this.memory.set(state.lastPlayedBy, [...existing, ...state.lastPlayedCombo.cards]);
    }
  }

  /** 分析剩余牌（基于记牌器） */
  private analyzeRemainingCards(
    state: DoudizhuState,
    playerId: string,
  ): { opponentsHaveHigh: boolean; opponentsHaveBombs: boolean } {
    if (this.difficulty !== 'hard') {
      return { opponentsHaveHigh: true, opponentsHaveBombs: true };
    }

    // 统计已出的大牌和炸弹
    let bigCardsPlayed = 0;
    let bombsPlayed = 0;

    for (const [pid, cards] of this.memory) {
      if (pid === playerId) continue;
      for (const card of cards) {
        if (card.value >= RANK_VALUE['A']) bigCardsPlayed++;
      }
      // 简化炸弹检测
      const valueCount = countByValue(cards);
      for (const count of valueCount.values()) {
        if (count === 4) bombsPlayed++;
      }
    }

    return {
      opponentsHaveHigh: bigCardsPlayed < 12, // 还有大牌在外
      opponentsHaveBombs: bombsPlayed < 3, // 可能还有炸弹
    };
  }

  /** 计算炸弹数量 */
  private countBombs(hand: Card[]): number {
    const valueCount = countByValue(hand);
    return Array.from(valueCount.values()).filter((c) => c === 4).length;
  }

  /** 计算顺子数量 */
  private countStraights(hand: Card[]): number {
    let count = 0;
    const values = [...new Set(hand.map((c) => c.value))].sort((a, b) => a - b);
    for (let i = 0; i <= values.length - 5; i++) {
      let len = 1;
      for (let j = i + 1; j < values.length && values[j] - values[j - 1] === 1; j++) {
        len++;
      }
      if (len >= 5) count++;
    }
    return count;
  }

  /** 计算已组成牌型的牌数 */
  private countCardsInCombos(hand: Card[]): number {
    const valueCount = countByValue(hand);
    let count = 0;

    // 对子、三张、炸弹中的牌
    for (const cnt of valueCount.values()) {
      if (cnt >= 2) count += cnt;
    }

    // 顺子中的牌（简化计算）
    const straight = this.findLongestStraight(hand);
    count += straight.length;

    return Math.min(count, hand.length);
  }

  /** 找最长顺子 */
  private findLongestStraight(hand: Card[]): Card[] {
    const values = [...new Set(hand.map((c) => c.value))].sort((a, b) => a - b);
    let bestStart = 0;
    let bestLen = 0;
    let curStart = 0;
    let curLen = 1;

    for (let i = 1; i < values.length; i++) {
      if (values[i] - values[i - 1] === 1 && values[i] < RANK_VALUE['2']) {
        curLen++;
      } else {
        if (curLen > bestLen) {
          bestLen = curLen;
          bestStart = curStart;
        }
        curStart = i;
        curLen = 1;
      }
    }
    if (curLen > bestLen) {
      bestLen = curLen;
      bestStart = curStart;
    }

    if (bestLen < 5) return [];

    const straightValues = values.slice(bestStart, bestStart + bestLen);
    const result: Card[] = [];
    for (const v of straightValues) {
      const card = hand.find((c) => c.value === v);
      if (card) result.push(card);
    }
    return result;
  }

  /** 找最长连对 */
  private findLongestStraightPairs(hand: Card[]): Card[] {
    const valueCount = countByValue(hand);
    const pairValues: number[] = [];
    for (const [value, count] of valueCount) {
      if (count >= 2 && value < RANK_VALUE['2']) pairValues.push(value);
    }
    pairValues.sort((a, b) => a - b);

    let bestStart = 0;
    let bestLen = 0;
    let curStart = 0;
    let curLen = 1;

    for (let i = 1; i < pairValues.length; i++) {
      if (pairValues[i] - pairValues[i - 1] === 1) {
        curLen++;
      } else {
        if (curLen > bestLen) {
          bestLen = curLen;
          bestStart = curStart;
        }
        curStart = i;
        curLen = 1;
      }
    }
    if (curLen > bestLen) {
      bestLen = curLen;
      bestStart = curStart;
    }

    if (bestLen < 3) return [];

    const result: Card[] = [];
    const selectedValues = pairValues.slice(bestStart, bestStart + bestLen);
    for (const v of selectedValues) {
      const cards = hand.filter((c) => c.value === v).slice(0, 2);
      result.push(...cards);
    }
    return result;
  }

  /** 找飞机 */
  private findAirplane(hand: Card[]): Card[] {
    const valueCount = countByValue(hand);
    const tripleValues: number[] = [];
    for (const [value, count] of valueCount) {
      if (count >= 3 && value < RANK_VALUE['2']) tripleValues.push(value);
    }
    tripleValues.sort((a, b) => a - b);

    if (tripleValues.length < 2) return [];

    let bestStart = 0;
    let bestLen = 0;
    let curStart = 0;
    let curLen = 1;

    for (let i = 1; i < tripleValues.length; i++) {
      if (tripleValues[i] - tripleValues[i - 1] === 1) {
        curLen++;
      } else {
        if (curLen > bestLen) {
          bestLen = curLen;
          bestStart = curStart;
        }
        curStart = i;
        curLen = 1;
      }
    }
    if (curLen > bestLen) {
      bestLen = curLen;
      bestStart = curStart;
    }

    if (bestLen < 2) return [];

    const result: Card[] = [];
    const selectedValues = tripleValues.slice(bestStart, bestStart + bestLen);
    for (const v of selectedValues) {
      const cards = hand.filter((c) => c.value === v).slice(0, 3);
      result.push(...cards);
    }
    return result;
  }

  /** 从手牌中移除指定牌 */
  private removeCards(hand: Card[], toRemove: Card[]): Card[] {
    const result = [...hand];
    for (const card of toRemove) {
      const idx = result.findIndex(
        (c) => c.suit === card.suit && c.rank === card.rank && c.value === card.value,
      );
      if (idx !== -1) result.splice(idx, 1);
    }
    return result;
  }

  /** 获取记牌器信息 */
  getMemory(): Map<string, Card[]> {
    return new Map(this.memory);
  }

  /** 清除记牌器 */
  clearMemory(): void {
    this.memory.clear();
  }

  /** 获取难度 */
  getDifficulty(): Difficulty {
    return this.difficulty;
  }

  /** 设置难度 */
  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
  }
}

export default DoudizhuAI;
