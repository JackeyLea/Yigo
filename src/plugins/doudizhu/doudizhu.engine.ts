/**
 * 斗地主游戏引擎
 * 负责游戏状态管理、牌型识别、出牌验证、胜负判定
 */

import {
  type Card,
  type CardCombo,
  type DoudizhuPlayer,
  type DoudizhuState,
  type BidRecord,
  type WinnerSide,
  type Suit,
  type Rank,
  type GamePhase,
} from './doudizhu.types';

// ==================== 常量定义 ====================

/** 牌面值映射（用于排序和比较） */
export const RANK_VALUE: Record<Rank, number> = {
  '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15,
  'small_joker': 16, 'big_joker': 17,
};

/** 标准牌组数量 */
const TOTAL_CARDS = 54;
const HAND_SIZE = 17;
const BOTTOM_CARDS = 3;

// ==================== 工具函数 ====================

/** 创建一副完整的扑克牌 */
function createDeck(): Card[] {
  const deck: Card[] = [];
  const suits: Suit[] = ['spade', 'heart', 'club', 'diamond'];
  const ranks: Rank[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank, value: RANK_VALUE[rank] });
    }
  }

  // 添加大小王
  deck.push({ suit: 'joker', rank: 'small_joker', value: RANK_VALUE['small_joker'] });
  deck.push({ suit: 'joker', rank: 'big_joker', value: RANK_VALUE['big_joker'] });

  return deck;
}

/** 按牌面值排序（升序） */
export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.value - b.value);
}

/** 按牌面值排序（降序） */
export function sortCardsDesc(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => b.value - a.value);
}

/** 获取牌组的主值（用于比较同类牌型） */
function getMainValue(combo: CardCombo): number {
  switch (combo.type) {
    case 'single':
      return combo.cards[0].value;
    case 'pair':
      return combo.cards[0].value;
    case 'triple':
      return combo.cards[0].value;
    case 'triple_with_single':
      return findTripleValue(combo.cards);
    case 'triple_with_pair':
      return findTripleValue(combo.cards);
    case 'straight':
      return combo.cards[combo.cards.length - 1].value; // 最大牌
    case 'straight_pairs':
      return combo.cards[1].value; // 第一对的大牌
    case 'airplane':
      return getAirplaneMainValue(combo.cards);
    case 'bomb':
      return combo.cards[0].value;
    case 'rocket':
      return RANK_VALUE['big_joker'];
    default:
      return 0;
  }
}

/** 从混合牌中找到三张的值 */
function findTripleValue(cards: Card[]): number {
  const valueCount = countByValue(cards);
  for (const [value, count] of valueCount.entries()) {
    if (count === 3) return value;
  }
  return 0;
}

/** 获取飞机的主值 */
function getAirplaneMainValue(cards: Card[]): number {
  const valueCount = countByValue(cards);
  const tripleValues: number[] = [];
  for (const [value, count] of valueCount.entries()) {
    if (count >= 3) tripleValues.push(value);
  }
  tripleValues.sort((a, b) => a - b);
  // 返回飞机中最大的三连值
  return tripleValues.length > 0 ? tripleValues[tripleValues.length - 1] : 0;
}

/** 按牌值统计数量 */
function countByValue(cards: Card[]): Map<number, number> {
  const count = new Map<number, number>();
  for (const card of cards) {
    count.set(card.value, (count.get(card.value) || 0) + 1);
  }
  return count;
}

/** 按数量分组（几张相同的） */
function groupByCount(cards: Card[]): Map<number, number[]> {
  const valueCount = countByValue(cards);
  const countGroups = new Map<number, number[]>();
  for (const [value, cnt] of valueCount) {
    if (!countGroups.has(cnt)) countGroups.set(cnt, []);
    countGroups.get(cnt)!.push(value);
  }
  // 每组内排序
  for (const [, values] of countGroups) {
    values.sort((a, b) => a - b);
  }
  return countGroups;
}

/** 检查是否是连续序列 */
function isConsecutive(values: number[], minLen: number, maxGap = 1): boolean {
  if (values.length < minLen) return false;
  const sorted = [...values].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] !== maxGap) return false;
  }
  // 2和王不能参与顺子
  return sorted[sorted.length - 1] < RANK_VALUE['2'];
}

/** 计算牌型大小等级（用于比较不同类型） */
function getComboTier(combo: CardCombo): number {
  switch (combo.type) {
    case 'pass': return 0;
    case 'single': return 1;
    case 'pair': return 2;
    case 'triple': return 3;
    case 'triple_with_single': return 4;
    case 'triple_with_pair': return 5;
    case 'straight': return 6;
    case 'straight_pairs': return 7;
    case 'airplane': return 8;
    case 'bomb': return 10;
    case 'rocket': return 20;
  }
}

// ==================== 引擎类 ====================

export class DoudizhuEngine {
  private state: DoudizhuState;
  private bottomCards: Card[] = []; // 底牌
  private eventListeners: Array<(event: unknown) => void> = [];

  constructor(playerIds: string[]) {
    if (playerIds.length !== 3) {
      throw new Error('斗地主需要恰好3名玩家');
    }

    const players: DoudizhuPlayer[] = playerIds.map((id, index) => ({
      playerId: id,
      seatIndex: index,
      hand: [],
      cardCount: 0,
      isLandlord: false,
      isReady: true,
      bidScore: null,
    }));

    this.state = {
      phase: 'deal',
      players,
      landlordId: null,
      currentPlayerId: playerIds[0],
      lastPlayedCombo: null,
      lastPlayedBy: null,
      consecutivePasses: 0,
      deck: createDeck(),
      bidHistory: [],
      multiplier: 1,
      isSpring: false,
      round: 1,
      gameOver: false,
      winner: null,
    };
  }

  // ==================== 状态访问 ====================

  getState(): DoudizhuState {
    return JSON.parse(JSON.stringify(this.state)) as DoudizhuState;
  }

  getBottomCards(): Card[] {
    return [...this.bottomCards];
  }

  // ==================== 事件系统 ====================

  addEventListener(listener: (event: unknown) => void): void {
    this.eventListeners.push(listener);
  }

  removeEventListener(listener: (event: unknown) => void): void {
    this.eventListeners = this.eventListeners.filter((l) => l !== listener);
  }

  private emit(event: unknown): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // 忽略监听器错误
      }
    }
  }

  // ==================== 游戏流程 ====================

  /** 重置游戏 */
  reset(): void {
    const playerIds = this.state.players.map((p) => p.playerId);
    this.bottomCards = [];

    this.state = {
      phase: 'deal',
      players: playerIds.map((id, index) => ({
        playerId: id,
        seatIndex: index,
        hand: [],
        cardCount: 0,
        isLandlord: false,
        isReady: true,
        bidScore: null,
      })),
      landlordId: null,
      currentPlayerId: playerIds[0],
      lastPlayedCombo: null,
      lastPlayedBy: null,
      consecutivePasses: 0,
      deck: createDeck(),
      bidHistory: [],
      multiplier: 1,
      isSpring: false,
      round: this.state.round + 1,
      gameOver: false,
      winner: null,
    };
  }

  /** 洗牌（Fisher-Yates算法） */
  private shuffleDeck(): void {
    const deck = this.state.deck;
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }

  /** 发牌：每人17张 + 3张底牌 */
  dealCards(): void {
    if (this.state.phase !== 'deal') {
      throw new Error(`当前阶段为 ${this.state.phase}，无法发牌`);
    }

    this.shuffleDeck();

    const deck = this.state.deck;
    // 发17张给每个玩家
    for (let i = 0; i < 3; i++) {
      const hand = deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE);
      this.state.players[i].hand = sortCards(hand);
      this.state.players[i].cardCount = hand.length;
    }

    // 剩余3张为底牌
    this.bottomCards = deck.slice(3 * HAND_SIZE, 3 * HAND_SIZE + BOTTOM_CARDS);

    this.state.phase = 'bid';
    this.state.currentPlayerId = this.state.players[0].playerId;
  }

  /** 叫分（1/2/3分或不叫null） */
  placeBid(playerId: string, bid: number | null): boolean {
    if (this.state.phase !== 'bid') {
      return false;
    }

    const player = this.state.players.find((p) => p.playerId === playerId);
    if (!player) return false;
    if (player.playerId !== this.state.currentPlayerId) return false;

    // 验证叫分有效性
    if (bid !== null && (bid < 1 || bid > 3 || !Number.isInteger(bid))) {
      return false;
    }

    // 记录叫分
    player.bidScore = bid;
    this.state.bidHistory.push({ playerId, bid });

    this.emit({ type: 'bid', playerId, bid });

    // 如果叫了3分，直接成为地主
    if (bid === 3) {
      this.setLandlord(playerId);
      return true;
    }

    // 检查是否所有人都叫过了
    if (this.state.bidHistory.length >= 3) {
      this.confirmLandlord();
      return true;
    }

    // 轮到下一个玩家
    this.advancePlayer();
    return true;
  }

  /** 确定地主（最高叫分者） */
  confirmLandlord(): void {
    const validBids = this.state.bidHistory.filter((b) => b.bid !== null);

    if (validBids.length === 0) {
      // 没人叫分，重新发牌
      this.reset();
      this.dealCards();
      return;
    }

    // 找出最高叫分
    let maxBid = -1;
    let landlordId = '';
    for (const bid of validBids) {
      if ((bid.bid ?? -1) > maxBid) {
        maxBid = bid.bid ?? -1;
        landlordId = bid.playerId;
      }
    }

    this.setLandlord(landlordId);
  }

  /** 设置地主 */
  private setLandlord(landlordId: string): void {
    this.state.landlordId = landlordId;

    for (const player of this.state.players) {
      if (player.playerId === landlordId) {
        player.isLandlord = true;
        // 地主获得底牌
        player.hand = sortCards([...player.hand, ...this.bottomCards]);
        player.cardCount = player.hand.length;
      }
    }

    this.state.multiplier = this.getBidMultiplier();
    this.state.phase = 'play';
    this.state.currentPlayerId = landlordId; // 地主先出牌
    this.state.consecutivePasses = 0;

    this.emit({
      type: 'landlord_confirm',
      landlordId,
      bottomCards: [...this.bottomCards],
    });
  }

  /** 获取叫分倍数 */
  private getBidMultiplier(): number {
    const validBids = this.state.bidHistory
      .filter((b) => b.bid !== null)
      .map((b) => b.bid ?? 0);
    return validBids.length > 0 ? Math.max(...validBids) : 1;
  }

  /** 出牌 */
  playCards(playerId: string, cards: Card[]): boolean {
    if (this.state.phase !== 'play') return false;
    if (this.state.currentPlayerId !== playerId) return false;
    if (this.state.gameOver) return false;

    const player = this.state.players.find((p) => p.playerId === playerId);
    if (!player) return false;

    // 识别牌型
    const combo = this.identifyCombo(cards);
    if (!combo) return false;

    // 验证玩家手中有这些牌
    if (!this.hasCards(playerId, cards)) return false;

    // 验证是否能打过上一手
    if (this.state.lastPlayedCombo && this.state.lastPlayedBy !== playerId) {
      if (!this.canBeat(this.state.lastPlayedCombo, combo)) return false;
    }

    // 移除打出的牌
    this.removeCardsFromHand(playerId, cards);

    // 更新状态
    this.state.lastPlayedCombo = combo;
    this.state.lastPlayedBy = playerId;
    this.state.consecutivePasses = 0;

    // 炸弹和火箭加倍
    if (combo.type === 'bomb' || combo.type === 'rocket') {
      this.state.multiplier *= 2;
    }

    this.emit({
      type: 'play',
      playerId,
      combo,
      remainingCards: player.cardCount,
    });

    // 检查游戏结束
    this.checkGameOver();

    if (!this.state.gameOver) {
      this.advancePlayer();
    }

    return true;
  }

  /** 不出（Pass） */
  pass(playerId: string): boolean {
    if (this.state.phase !== 'play') return false;
    if (this.state.currentPlayerId !== playerId) return false;
    if (this.state.gameOver) return false;

    // 如果自己是最后一个出牌的，不能pass
    if (this.state.lastPlayedBy === playerId) return false;

    this.state.consecutivePasses += 1;

    this.emit({ type: 'pass', playerId });

    // 连续两个pass，新一轮开始（由下一个玩家自由出牌）
    if (this.state.consecutivePasses >= 2) {
      this.state.lastPlayedCombo = null;
      this.state.lastPlayedBy = null;
      this.state.consecutivePasses = 0;
    }

    this.advancePlayer();
    return true;
  }

  // ==================== 牌型识别 ====================

  /** 从牌组中识别牌型 */
  identifyCombo(cards: Card[]): CardCombo | null {
    if (cards.length === 0) return { type: 'pass', cards: [] };

    const sorted = sortCards(cards);
    const n = sorted.length;

    // 火箭（大小王）
    if (n === 2) {
      const values = sorted.map((c) => c.value).sort((a, b) => a - b);
      if (values[0] === RANK_VALUE['small_joker'] && values[1] === RANK_VALUE['big_joker']) {
        return { type: 'rocket', cards: sorted };
      }
    }

    const valueCount = countByValue(sorted);
    const counts = Array.from(valueCount.values());

    // 单张
    if (n === 1) {
      return { type: 'single', cards: [sorted[0]] };
    }

    // 对子
    if (n === 2 && counts[0] === 2) {
      return { type: 'pair', cards: [sorted[0], sorted[1]] };
    }

    // 三张
    if (n === 3 && counts[0] === 3) {
      return { type: 'triple', cards: [sorted[0], sorted[1], sorted[2]] };
    }

    // 炸弹（四张）
    if (n === 4 && counts[0] === 4) {
      return { type: 'bomb', cards: [sorted[0], sorted[1], sorted[2], sorted[3]] };
    }

    // 三带一
    if (n === 4 && counts.includes(3) && counts.includes(1)) {
      return { type: 'triple_with_single', cards: sorted };
    }

    // 三带二
    if (n === 5 && counts.includes(3) && counts.includes(2)) {
      return { type: 'triple_with_pair', cards: sorted };
    }

    // 顺子（5张及以上连续单张）
    if (n >= 5 && counts.every((c) => c === 1)) {
      const values = sorted.map((c) => c.value);
      if (isConsecutive(values, 5)) {
        return { type: 'straight', cards: sorted };
      }
    }

    // 连对（3对及以上连续对子）
    if (n >= 6 && n % 2 === 0 && counts.every((c) => c === 2)) {
      const pairValues = Array.from(valueCount.keys()).sort((a, b) => a - b);
      if (isConsecutive(pairValues, 3)) {
        return { type: 'straight_pairs', cards: sorted };
      }
    }

    // 飞机（两组及以上连续三张）
    if (n >= 6) {
      const airplaneCombo = this.identifyAirplane(sorted, valueCount, counts);
      if (airplaneCombo) return airplaneCombo;
    }

    // 四带二
    if (n === 6 && counts.includes(4)) {
      // 简化为炸弹处理，或作为特殊牌型
      // 这里不单独识别四带二，作为非法牌型
    }

    return null;
  }

  /** 识别飞机牌型 */
  private identifyAirplane(
    sorted: Card[],
    valueCount: Map<number, number>,
    counts: number[],
  ): CardCombo | null {
    // 找出所有三连
    const tripleValues: number[] = [];
    for (const [value, count] of valueCount) {
      if (count === 3) tripleValues.push(value);
    }
    tripleValues.sort((a, b) => a - b);

    if (tripleValues.length < 2) return null;

    // 寻找最长连续的三连序列
    let bestStart = -1;
    let bestLen = 0;
    let currentStart = 0;
    let currentLen = 1;

    for (let i = 1; i < tripleValues.length; i++) {
      if (tripleValues[i] === tripleValues[i - 1] + 1 && tripleValues[i] < RANK_VALUE['2']) {
        currentLen++;
      } else {
        if (currentLen > bestLen) {
          bestLen = currentLen;
          bestStart = currentStart;
        }
        currentStart = i;
        currentLen = 1;
      }
    }
    if (currentLen > bestLen) {
      bestLen = currentLen;
      bestStart = currentStart;
    }

    if (bestLen < 2) return null;

    const consecutiveTriples = tripleValues.slice(bestStart, bestStart + bestLen);
    const requiredCards = bestLen * 3;
    const extraCards = sorted.length - requiredCards;

    // 纯飞机（不带翅膀）：只有连续的三张
    if (extraCards === 0) {
      // 验证所有牌正好是这些三连
      const tripleCards = sorted.filter((c) => consecutiveTriples.includes(c.value));
      if (tripleCards.length === requiredCards) {
        return { type: 'airplane', cards: sorted };
      }
    }

    // 飞机带单张：每个三连带一张单牌
    if (extraCards === bestLen) {
      const tripleCards = sorted.filter((c) => consecutiveTriples.includes(c.value));
      if (tripleCards.length === requiredCards) {
        return { type: 'airplane', cards: sorted };
      }
    }

    // 飞机带对子：每个三连带一对
    if (extraCards === bestLen * 2) {
      // 检查额外部分是否都是对子
      const nonTripleCards = sorted.filter((c) => !consecutiveTriples.includes(c.value));
      const nonTripleCount = countByValue(nonTripleCards);
      const allPairs = Array.from(nonTripleCount.values()).every((c) => c === 2);
      if (allPairs && nonTripleCards.length === bestLen * 2) {
        return { type: 'airplane', cards: sorted };
      }
    }

    return null;
  }

  // ==================== 牌型比较 ====================

  /**
   * 比较两个牌型：comboB 是否能打过 comboA
   * @param comboA 先出的牌
   * @param comboB 后出的牌
   */
  canBeat(comboA: CardCombo, comboB: CardCombo): boolean {
    // pass 不能打过任何牌
    if (comboB.type === 'pass') return false;

    // 火箭最大
    if (comboB.type === 'rocket') return true;
    if (comboA.type === 'rocket') return false;

    // 炸弹可以打任何非炸弹
    if (comboB.type === 'bomb' && comboA.type !== 'bomb') return true;

    // 炸弹之间比较
    if (comboB.type === 'bomb' && comboA.type === 'bomb') {
      return getMainValue(comboB) > getMainValue(comboA);
    }

    // A是炸弹，B不是，则B不能打
    if (comboA.type === 'bomb') return false;

    // 不同类型不能比较
    if (comboA.type !== comboB.type) return false;

    // 同类型比较主值
    if (comboA.cards.length !== comboB.cards.length) return false;

    return getMainValue(comboB) > getMainValue(comboA);
  }

  // ==================== 合法出牌 ====================

  /** 获取某玩家所有合法出牌组合 */
  getLegalPlays(playerId: string): CardCombo[] {
    const player = this.state.players.find((p) => p.playerId === playerId);
    if (!player) return [];

    const allCombos = this.getAllCombos(player.hand);

    // 如果自己是最后一个出牌的，或者还没有出牌记录，可以自由出
    if (!this.state.lastPlayedCombo || this.state.lastPlayedBy === playerId) {
      return allCombos.filter((c) => c.type !== 'pass');
    }

    // 否则必须能打过上一个牌型
    return allCombos.filter(
      (combo) => combo.type !== 'pass' && this.canBeat(this.state.lastPlayedCombo!, combo),
    );
  }

  /** 获取手牌中所有可能的牌型组合 */
  private getAllCombos(hand: Card[]): CardCombo[] {
    const combos: CardCombo[] = [];
    const n = hand.length;
    if (n === 0) return combos;

    const sorted = sortCards(hand);
    const valueCount = countByValue(sorted);
    const values = Array.from(valueCount.keys()).sort((a, b) => a - b);

    // 单张
    for (const card of sorted) {
      combos.push({ type: 'single', cards: [card] });
    }

    // 对子
    for (const [value, count] of valueCount) {
      if (count >= 2) {
        const cards = sorted.filter((c) => c.value === value).slice(0, 2);
        combos.push({ type: 'pair', cards: [cards[0], cards[1]] });
      }
    }

    // 三张
    for (const [value, count] of valueCount) {
      if (count >= 3) {
        const cards = sorted.filter((c) => c.value === value).slice(0, 3);
        combos.push({ type: 'triple', cards: [cards[0], cards[1], cards[2]] });
      }
    }

    // 三带一
    for (const [tValue, tCount] of valueCount) {
      if (tCount >= 3) {
        const triple = sorted.filter((c) => c.value === tValue).slice(0, 3);
        for (const [sValue, sCount] of valueCount) {
          if (sValue !== tValue && sCount >= 1) {
            const single = sorted.filter((c) => c.value === sValue)[0];
            combos.push({ type: 'triple_with_single', cards: [...triple, single] });
            break; // 每种三张只带一种单张即可（优化）
          }
        }
      }
    }

    // 三带二
    for (const [tValue, tCount] of valueCount) {
      if (tCount >= 3) {
        const triple = sorted.filter((c) => c.value === tValue).slice(0, 3);
        for (const [pValue, pCount] of valueCount) {
          if (pValue !== tValue && pCount >= 2) {
            const pair = sorted.filter((c) => c.value === pValue).slice(0, 2);
            combos.push({ type: 'triple_with_pair', cards: [...triple, ...pair] });
            break;
          }
        }
      }
    }

    // 顺子（5张及以上）
    for (let len = 5; len <= Math.min(n, 12); len++) {
      for (let start = 0; start <= values.length - len; start++) {
        const seq = values.slice(start, start + len);
        if (isConsecutive(seq, len)) {
          const cards: Card[] = [];
          for (const v of seq) {
            cards.push(sorted.find((c) => c.value === v)!);
          }
          combos.push({ type: 'straight', cards });
        }
      }
    }

    // 连对（3对及以上）
    const pairValues = values.filter((v) => (valueCount.get(v) ?? 0) >= 2);
    for (let len = 3; len <= Math.min(pairValues.length, 10); len++) {
      for (let start = 0; start <= pairValues.length - len; start++) {
        const seq = pairValues.slice(start, start + len);
        if (isConsecutive(seq, len)) {
          const cards: Card[] = [];
          for (const v of seq) {
            cards.push(...sorted.filter((c) => c.value === v).slice(0, 2));
          }
          combos.push({ type: 'straight_pairs', cards });
        }
      }
    }

    // 飞机
    const tripleValues = values.filter((v) => (valueCount.get(v) ?? 0) >= 3);
    for (let len = 2; len <= Math.min(tripleValues.length, 6); len++) {
      for (let start = 0; start <= tripleValues.length - len; start++) {
        const seq = tripleValues.slice(start, start + len);
        if (isConsecutive(seq, len)) {
          // 纯飞机
          const cards: Card[] = [];
          for (const v of seq) {
            cards.push(...sorted.filter((c) => c.value === v).slice(0, 3));
          }
          combos.push({ type: 'airplane', cards: [...cards] });

          // 飞机带单张
          // 简化：只生成一种带法
          if (n - cards.length >= len) {
            const remaining = sorted.filter((c) => !seq.includes(c.value));
            const wings = remaining.slice(0, len);
            combos.push({ type: 'airplane', cards: [...cards, ...wings] });
          }
        }
      }
    }

    // 炸弹
    for (const [value, count] of valueCount) {
      if (count === 4) {
        const cards = sorted.filter((c) => c.value === value);
        combos.push({ type: 'bomb', cards: [cards[0], cards[1], cards[2], cards[3]] });
      }
    }

    // 火箭
    const hasSmallJoker = sorted.some((c) => c.rank === 'small_joker');
    const hasBigJoker = sorted.some((c) => c.rank === 'big_joker');
    if (hasSmallJoker && hasBigJoker) {
      combos.push({
        type: 'rocket',
        cards: [
          sorted.find((c) => c.rank === 'small_joker')!,
          sorted.find((c) => c.rank === 'big_joker')!,
        ],
      });
    }

    return combos;
  }

  // ==================== 私有工具方法 ====================

  /** 验证玩家是否有指定的牌 */
  private hasCards(playerId: string, cards: Card[]): boolean {
    const player = this.state.players.find((p) => p.playerId === playerId);
    if (!player) return false;

    const handCopy = [...player.hand];
    for (const card of cards) {
      const idx = handCopy.findIndex(
        (c) => c.suit === card.suit && c.rank === card.rank && c.value === card.value,
      );
      if (idx === -1) return false;
      handCopy.splice(idx, 1);
    }
    return true;
  }

  /** 从玩家手牌中移除指定的牌 */
  private removeCardsFromHand(playerId: string, cards: Card[]): void {
    const player = this.state.players.find((p) => p.playerId === playerId);
    if (!player) return;

    for (const card of cards) {
      const idx = player.hand.findIndex(
        (c) => c.suit === card.suit && c.rank === card.rank && c.value === card.value,
      );
      if (idx !== -1) {
        player.hand.splice(idx, 1);
      }
    }
    player.cardCount = player.hand.length;
  }

  /** 切换到下一个玩家 */
  private advancePlayer(): void {
    const currentIdx = this.state.players.findIndex(
      (p) => p.playerId === this.state.currentPlayerId,
    );
    const nextIdx = (currentIdx + 1) % 3;
    this.state.currentPlayerId = this.state.players[nextIdx].playerId;
  }

  /** 检查游戏是否结束 */
  private checkGameOver(): void {
    for (const player of this.state.players) {
      if (player.hand.length === 0) {
        this.state.gameOver = true;
        this.state.phase = 'settle';

        // 判断获胜方
        if (player.isLandlord) {
          this.state.winner = 'landlord';
          this.checkSpring();
        } else {
          this.state.winner = 'peasant';
          this.checkAntiSpring(player.playerId);
        }

        this.emit({
          type: 'game_over',
          winner: this.state.winner,
          multiplier: this.state.multiplier,
          isSpring: this.state.isSpring,
          scores: this.calculateScores(),
        });

        return;
      }
    }
  }

  /** 检查春天（地主出完牌，农民一张未出） */
  private checkSpring(): void {
    const peasants = this.state.players.filter((p) => !p.isLandlord);
    const allPeasantsNoPlay = peasants.every((p) => p.cardCount === HAND_SIZE);
    if (allPeasantsNoPlay) {
      this.state.isSpring = true;
      this.state.multiplier *= 2;
    }
  }

  /** 检查反春天（一个农民出完牌，地主一张未出） */
  private checkAntiSpring(winnerId: string): void {
    const landlord = this.state.players.find((p) => p.isLandlord);
    if (landlord && landlord.cardCount === 20) {
      // 地主一张没出（17+3底牌）
      this.state.isSpring = true;
      this.state.multiplier *= 2;
    }
  }

  /** 计算得分 */
  private calculateScores(): Record<string, number> {
    const scores: Record<string, number> = {};
    const baseScore = this.state.multiplier;

    if (this.state.winner === 'landlord') {
      // 地主赢，农民各输 baseScore
      for (const player of this.state.players) {
        scores[player.playerId] = player.isLandlord ? baseScore * 2 : -baseScore;
      }
    } else {
      // 农民赢，地主输 baseScore * 2
      for (const player of this.state.players) {
        scores[player.playerId] = player.isLandlord ? -baseScore * 2 : baseScore;
      }
    }

    return scores;
  }

  // ==================== 调试工具 ====================

  /** 打印当前游戏状态（调试用） */
  debugPrint(): string {
    const s = this.state;
    let output = `=== 斗地主游戏状态 ===\n`;
    output += `阶段: ${s.phase} | 回合: ${s.round} | 倍数: ${s.multiplier}x\n`;
    output += `地主: ${s.landlordId ?? '未定'} | 当前玩家: ${s.currentPlayerId}\n`;
    output += `最后出牌: ${s.lastPlayedCombo?.type ?? '无'} | 连续Pass: ${s.consecutivePasses}\n`;
    output += `--- 玩家手牌 ---\n`;
    for (const p of s.players) {
      const handStr = sortCards(p.hand)
        .map((c) => c.rank)
        .join(' ');
      output += `${p.playerId}${p.isLandlord ? '[地主]' : ''}: [${p.cardCount}张] ${handStr}\n`;
    }
    output += `底牌: ${this.bottomCards.map((c) => c.rank).join(' ')}\n`;
    return output;
  }

  /** 获取玩家手牌（调试用） */
  getPlayerHand(playerId: string): Card[] {
    const player = this.state.players.find((p) => p.playerId === playerId);
    return player ? [...player.hand] : [];
  }

  /** 获取指定玩家的所有信息 */
  getPlayer(playerId: string): DoudizhuPlayer | undefined {
    return this.state.players.find((p) => p.playerId === playerId);
  }

  /** 获取当前游戏阶段 */
  getPhase(): GamePhase {
    return this.state.phase;
  }

  /** 获取当前应该操作的玩家ID */
  getCurrentPlayerId(): string {
    return this.state.currentPlayerId;
  }

  /** 检查游戏是否已结束 */
  isGameOver(): boolean {
    return this.state.gameOver;
  }

  /** 获取获胜方 */
  getWinner(): WinnerSide {
    return this.state.winner;
  }
}

export default DoudizhuEngine;
