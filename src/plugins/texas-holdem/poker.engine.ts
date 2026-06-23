/**
 * 德州扑克游戏引擎
 * Texas Hold'em Poker Engine
 *
 * 核心游戏逻辑：发牌、下注管理、阶段推进、边池计算、摊牌比牌
 */

import {
  Card, Suit, Rank, PokerPhase, PlayerAction,
  PokerPlayer, SidePot, PokerState, PokerAction,
  ShowdownResult, HandRanking, RANK_VALUES,
} from './poker.types';
import { HandEvaluator } from './poker.hand-evaluator';

/** 创建一副标准扑克牌（52张） */
function createDeck(): Card[] {
  const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/** 发牌助手：从牌堆顶发指定数量的牌 */
function drawCards(deck: Card[], count: number): Card[] {
  if (deck.length < count) {
    throw new Error(`Not enough cards in deck. Need ${count}, have ${deck.length}`);
  }
  return deck.splice(0, count);
}

export class PokerEngine {
  private state: PokerState;
  private smallBlind: number;
  private bigBlind: number;
  private maxPlayers: number;

  constructor(smallBlind: number = 10, bigBlind: number = 20, maxPlayers: number = 9) {
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.maxPlayers = maxPlayers;

    this.state = this.createInitialState();
  }

  // ==================== 公共方法 ====================

  /** 获取当前游戏状态 */
  getState(): PokerState {
    return { ...this.state, players: this.state.players.map(p => ({ ...p })) };
  }

  /** 重置整个游戏（清除所有玩家和状态） */
  reset(): void {
    this.state = this.createInitialState();
  }

  /** 添加玩家 */
  addPlayer(playerId: string, buyIn: number, seatIndex?: number): boolean {
    // 检查是否已存在
    if (this.state.players.some(p => p.playerId === playerId)) {
      return false;
    }

    // 确定座位
    let seat = seatIndex;
    if (seat === undefined) {
      // 自动分配座位
      const usedSeats = new Set(this.state.players.map(p => p.seatIndex));
      for (let i = 0; i < this.maxPlayers; i++) {
        if (!usedSeats.has(i)) {
          seat = i;
          break;
        }
      }
    }

    if (seat === undefined || seat < 0 || seat >= this.maxPlayers) {
      return false;
    }
    if (this.state.players.some(p => p.seatIndex === seat)) {
      return false;
    }

    const player: PokerPlayer = {
      playerId,
      seatIndex: seat,
      holeCards: [],
      chips: buyIn,
      currentBet: 0,
      totalBet: 0,
      isActive: true,
      isAllIn: false,
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: false,
    };

    this.state.players.push(player);
    this.state.activePlayerCount = this.state.players.filter(p => p.isActive).length;
    return true;
  }

  /** 移除玩家 */
  removePlayer(playerId: string): void {
    const index = this.state.players.findIndex(p => p.playerId === playerId);
    if (index !== -1) {
      // 返还剩余筹码
      this.state.players.splice(index, 1);
      this.state.activePlayerCount = this.state.players.filter(p => p.isActive).length;
    }
  }

  /** 开始新一局 */
  startNewHand(): void {
    if (this.state.players.length < 2) {
      throw new Error('Need at least 2 players to start a hand');
    }

    // 重置状态
    this.state.communityCards = [];
    this.state.pot = 0;
    this.state.sidePots = [];
    this.state.currentBet = 0;
    this.state.minRaise = this.bigBlind;
    this.state.actionHistory = [];
    this.state.showdownResults = undefined;
    this.state.gameOver = false;
    this.state.phase = 'preflop';

    // 旋转庄家
    this.rotateDealer();

    // 重置玩家状态
    for (const player of this.state.players) {
      player.holeCards = [];
      player.currentBet = 0;
      player.totalBet = 0;
      player.isActive = true;
      player.isAllIn = false;
      player.handRanking = undefined;
    }
    this.state.activePlayerCount = this.state.players.length;

    // 创建牌堆并发牌
    this.state.deck = createDeck();
    this.shuffleDeck();
    this.dealHoleCards();

    // 收取盲注
    this.collectBlinds();

    this.state.currentBet = this.bigBlind;
    this.state.minRaise = this.bigBlind;

    // 确定第一个行动的玩家（大盲下家）
    this.state.currentPlayerIndex = this.findNextActivePlayer(
      this.findPlayerIndexBySeat(this.findNextSeat(this.findDealerSeat()))
    );
  }

  /** 处理玩家动作 */
  handleAction(playerId: string, action: PlayerAction, amount?: number): boolean {
    if (!this.isValidAction(playerId, action, amount)) {
      return false;
    }

    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return false;

    const actualAmount = amount ?? 0;

    switch (action) {
      case 'fold':
        player.isActive = false;
        this.state.activePlayerCount--;
        this.recordAction(playerId, 'fold', 0);
        break;

      case 'check':
        this.recordAction(playerId, 'check', 0);
        break;

      case 'call': {
        const callAmount = this.state.currentBet - player.currentBet;
        const actualCall = Math.min(callAmount, player.chips);
        player.chips -= actualCall;
        player.currentBet += actualCall;
        player.totalBet += actualCall;
        this.state.pot += actualCall;
        if (player.chips === 0) {
          player.isAllIn = true;
          this.recordAction(playerId, 'allin', actualCall);
        } else {
          this.recordAction(playerId, 'call', actualCall);
        }
        break;
      }

      case 'bet': {
        const betAmount = actualAmount;
        if (betAmount > player.chips) return false;
        player.chips -= betAmount;
        player.currentBet = betAmount;
        player.totalBet += betAmount;
        this.state.pot += betAmount;
        this.state.currentBet = betAmount;
        this.state.minRaise = betAmount;
        if (player.chips === 0) {
          player.isAllIn = true;
          this.recordAction(playerId, 'allin', betAmount);
        } else {
          this.recordAction(playerId, 'bet', betAmount);
        }
        break;
      }

      case 'raise': {
        const raiseTo = actualAmount; // 加注到的总额
        const addAmount = raiseTo - player.currentBet;
        if (addAmount > player.chips) return false;
        player.chips -= addAmount;
        player.currentBet = raiseTo;
        player.totalBet += addAmount;
        this.state.pot += addAmount;
        const raiseDiff = raiseTo - this.state.currentBet;
        this.state.currentBet = raiseTo;
        // 最小加注额 = 这次加注的差额
        this.state.minRaise = raiseDiff;
        if (player.chips === 0) {
          player.isAllIn = true;
          this.recordAction(playerId, 'allin', raiseTo);
        } else {
          this.recordAction(playerId, 'raise', raiseTo);
        }
        break;
      }

      case 'allin': {
        const allInAmount = player.chips;
        const newTotalBet = player.currentBet + allInAmount;
        player.chips = 0;
        player.currentBet = newTotalBet;
        player.totalBet += allInAmount;
        this.state.pot += allInAmount;
        player.isAllIn = true;

        // 如果allin超过当前注额，更新currentBet和minRaise
        if (newTotalBet > this.state.currentBet) {
          const raiseDiff = newTotalBet - this.state.currentBet;
          this.state.currentBet = newTotalBet;
          if (raiseDiff > this.state.minRaise) {
            this.state.minRaise = raiseDiff;
          }
        }
        this.recordAction(playerId, 'allin', allInAmount);
        break;
      }
    }

    // 检查是否只剩一个活跃玩家
    if (this.isOnlyOneActive()) {
      this.calculateSidePots();
      // 直接发完剩余公共牌
      while (this.state.communityCards.length < 5) {
        const remaining = 5 - this.state.communityCards.length;
        this.dealCommunityCards(Math.min(remaining, 3));
      }
      this.state.phase = 'showdown';
      this.state.showdownResults = this.showdown();
      this.state.gameOver = true;
      this.state.phase = 'ended';
      return true;
    }

    // 检查下注轮是否结束
    if (this.isBettingRoundComplete()) {
      this.calculateSidePots();
      this.advancePhase();
    } else {
      // 移动到下一个活跃玩家
      this.state.currentPlayerIndex = this.findNextActivePlayer(this.state.currentPlayerIndex);
    }

    return true;
  }

  /** 检查动作是否合法 */
  isValidAction(playerId: string, action: PlayerAction, amount?: number): boolean {
    if (this.state.phase === 'waiting' || this.state.phase === 'ended') return false;
    if (this.state.gameOver) return false;

    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return false;
    if (!player.isActive || player.isAllIn) return false;

    // 必须是当前行动玩家
    const currentPlayer = this.state.players[this.state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.playerId !== playerId) return false;

    const callAmount = this.state.currentBet - player.currentBet;

    switch (action) {
      case 'fold':
        return true;

      case 'check':
        // 只能在没有未跟注的注额时check
        return callAmount <= 0;

      case 'call':
        // 有注额需要跟注，且筹码足够（或allin）
        return callAmount > 0 && player.chips > 0;

      case 'bet':
        // 只能在还没有人下注时bet（currentBet为0或只有盲注时等于currentBet）
        // 实际上，preflop时盲注已经下了，所以要特殊处理
        if (this.state.phase === 'preflop') {
          // preflop时盲注已下，如果玩家不是盲注位，currentBet > player.currentBet
          return callAmount > 0 && (amount ?? 0) >= this.state.currentBet && player.chips >= (amount ?? 0);
        }
        return this.state.currentBet === 0 && (amount ?? 0) > 0 && player.chips >= (amount ?? 0);

      case 'raise':
        // 加注额必须 >= currentBet + minRaise
        // 或者allin（筹码不足时的allin视为raise）
        {
          const raiseTo = amount ?? 0;
          const minRaiseTotal = this.state.currentBet + this.state.minRaise;
          if (raiseTo < minRaiseTotal && raiseTo < player.currentBet + player.chips) {
            return false; // 加注额不够且不是allin
          }
          const addAmount = raiseTo - player.currentBet;
          return addAmount > 0 && player.chips >= addAmount;
        }

      case 'allin':
        return player.chips > 0;

      default:
        return false;
    }
  }

  /** 计算最小加注额 */
  calculateMinRaise(): number {
    return this.state.currentBet + this.state.minRaise;
  }

  /** 进入下一阶段 */
  advancePhase(): void {
    // 重置本轮下注
    for (const player of this.state.players) {
      player.currentBet = 0;
    }
    this.state.currentBet = 0;
    this.state.minRaise = this.bigBlind;

    switch (this.state.phase) {
      case 'preflop':
        this.state.phase = 'flop';
        this.dealCommunityCards(3);
        break;
      case 'flop':
        this.state.phase = 'turn';
        this.dealCommunityCards(1);
        break;
      case 'turn':
        this.state.phase = 'river';
        this.dealCommunityCards(1);
        break;
      case 'river':
        this.state.phase = 'showdown';
        this.state.showdownResults = this.showdown();
        this.state.gameOver = true;
        this.state.phase = 'ended';
        return;
    }

    // 设置下一个行动玩家（庄家下家第一个行动）
    this.state.currentPlayerIndex = this.findNextActivePlayer(
      this.findPlayerIndexBySeat(this.findNextSeat(this.findDealerSeat()))
    );

    // 如果所有活跃玩家都allin了，自动发完剩余牌
    if (this.isAllAllIn()) {
      while (this.state.communityCards.length < 5) {
        const remaining = 5 - this.state.communityCards.length;
        this.dealCommunityCards(Math.min(remaining, 3));
      }
      this.state.phase = 'showdown';
      this.state.showdownResults = this.showdown();
      this.state.gameOver = true;
      this.state.phase = 'ended';
    }
  }

  /** 计算边池 */
  calculateSidePots(): SidePot[] {
    const sidePots: SidePot[] = [];
    const allInPlayers = this.state.players
      .filter(p => p.isAllIn && p.totalBet > 0)
      .sort((a, b) => a.totalBet - b.totalBet);

    let processedBet = 0;

    for (const allInPlayer of allInPlayers) {
      const betLevel = allInPlayer.totalBet;
      if (betLevel <= processedBet) continue;

      const contributionPerPlayer = betLevel - processedBet;
      const eligiblePlayers = this.state.players.filter(
        p => p.totalBet >= betLevel
      );
      const potAmount = contributionPerPlayer * eligiblePlayers.length;

      // 加上之前未处理的allin玩家多出的部分
      const alreadyProcessedFromAllIn = allInPlayers
        .filter(p => p.totalBet <= betLevel)
        .length * contributionPerPlayer;

      sidePots.push({
        amount: potAmount,
        eligiblePlayers: eligiblePlayers.map(p => p.playerId),
      });

      processedBet = betLevel;
    }

    // 主池：剩余未分配的
    const totalInSidePots = sidePots.reduce((sum, sp) => sum + sp.amount, 0);
    const mainPotEligible = this.state.players.filter(p => p.isActive || p.totalBet > 0);
    if (totalInSidePots < this.state.pot) {
      sidePots.push({
        amount: this.state.pot - totalInSidePots,
        eligiblePlayers: mainPotEligible.map(p => p.playerId),
      });
    } else if (sidePots.length === 0) {
      // 没有allin，全部为主池
      sidePots.push({
        amount: this.state.pot,
        eligiblePlayers: mainPotEligible.map(p => p.playerId),
      });
    }

    this.state.sidePots = sidePots;
    return sidePots;
  }

  /** 摊牌比牌 */
  showdown(): ShowdownResult[] {
    const activePlayers = this.state.players.filter(p => p.isActive);
    const results: ShowdownResult[] = [];

    // 计算每个活跃玩家的手牌排名
    for (const player of activePlayers) {
      const handRank = HandEvaluator.evaluateBestHand(
        player.holeCards,
        this.state.communityCards
      );
      player.handRanking = handRank;
      const bestHand = HandEvaluator.getBestFiveCards(
        player.holeCards,
        this.state.communityCards
      );
      results.push({
        playerId: player.playerId,
        holeCards: player.holeCards,
        bestHand,
        handRank,
        wonAmount: 0,
      });
    }

    // 按手牌排名排序（从大到小）
    results.sort((a, b) => HandEvaluator.compareHands(b.handRank, a.handRank));

    // 分配奖池
    const sidePots = this.state.sidePots.length > 0
      ? this.state.sidePots
      : [{ amount: this.state.pot, eligiblePlayers: activePlayers.map(p => p.playerId) }];

    for (const sidePot of sidePots) {
      // 找出有资格且排名最高的玩家
      const eligibleResults = results.filter(r =>
        sidePot.eligiblePlayers.includes(r.playerId)
      );
      if (eligibleResults.length === 0) continue;

      // 按排名分组
      const bestRank = eligibleResults[0].handRank;
      const winners = eligibleResults.filter(
        r => HandEvaluator.compareHands(r.handRank, bestRank) === 0
      );

      // 平分边池
      const winAmount = Math.floor(sidePot.amount / winners.length);
      const remainder = sidePot.amount % winners.length;

      for (let i = 0; i < winners.length; i++) {
        const result = results.find(r => r.playerId === winners[i].playerId);
        if (result) {
          result.wonAmount += winAmount + (i < remainder ? 1 : 0);
        }
      }
    }

    // 发放赢得的筹码
    for (const result of results) {
      if (result.wonAmount > 0) {
        const player = this.state.players.find(p => p.playerId === result.playerId);
        if (player) {
          player.chips += result.wonAmount;
        }
      }
    }

    return results;
  }

  /** 计算当前玩家可选动作列表 */
  getValidActions(playerId: string): PlayerAction[] {
    const actions: PlayerAction[] = [];
    const allActions: PlayerAction[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

    for (const action of allActions) {
      if (this.isValidAction(playerId, action)) {
        actions.push(action);
      }
    }

    return actions;
  }

  /** 旋转庄家位 */
  rotateDealer(): void {
    if (this.state.players.length === 0) return;

    // 清除旧的庄家标记
    for (const player of this.state.players) {
      player.isDealer = false;
      player.isSmallBlind = false;
      player.isBigBlind = false;
    }

    // 找到新的庄家
    const sortedPlayers = [...this.state.players].sort((a, b) => a.seatIndex - b.seatIndex);
    if (sortedPlayers.length === 0) return;

    // 找到当前庄家
    let currentDealerIdx = sortedPlayers.findIndex(p => p.seatIndex === this.state.dealerIndex);
    if (currentDealerIdx === -1) {
      currentDealerIdx = -1;
    }

    // 下一个庄家
    const nextDealerIdx = (currentDealerIdx + 1) % sortedPlayers.length;
    const newDealer = sortedPlayers[nextDealerIdx];
    newDealer.isDealer = true;
    this.state.dealerIndex = newDealer.seatIndex;

    // 设置小盲（庄家下家）
    const sbIdx = (nextDealerIdx + 1) % sortedPlayers.length;
    sortedPlayers[sbIdx].isSmallBlind = true;

    // 设置大盲（小盲下家）
    const bbIdx = (nextDealerIdx + 2) % sortedPlayers.length;
    sortedPlayers[bbIdx].isBigBlind = true;
  }

  // ==================== 私有方法 ====================

  private createInitialState(): PokerState {
    return {
      phase: 'waiting',
      players: [],
      communityCards: [],
      pot: 0,
      sidePots: [],
      currentBet: 0,
      minRaise: 0,
      dealerIndex: 0,
      currentPlayerIndex: 0,
      activePlayerCount: 0,
      deck: [],
      actionHistory: [],
      gameOver: false,
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

  /** 发底牌（每人2张） */
  private dealHoleCards(): void {
    // 发两轮，每轮每人一张
    for (let round = 0; round < 2; round++) {
      for (const player of this.state.players) {
        player.holeCards.push(...drawCards(this.state.deck, 1));
      }
    }
  }

  /** 发公共牌 */
  private dealCommunityCards(count: number): void {
    // 先烧一张牌
    if (this.state.deck.length > 0) {
      this.state.deck.shift(); // burn card
    }
    // 发牌
    this.state.communityCards.push(...drawCards(this.state.deck, count));
  }

  /** 收集盲注 */
  private collectBlinds(): void {
    const sbPlayer = this.state.players.find(p => p.isSmallBlind);
    const bbPlayer = this.state.players.find(p => p.isBigBlind);

    if (sbPlayer) {
      const sbAmount = Math.min(this.smallBlind, sbPlayer.chips);
      sbPlayer.chips -= sbAmount;
      sbPlayer.currentBet = sbAmount;
      sbPlayer.totalBet = sbAmount;
      this.state.pot += sbAmount;
      if (sbPlayer.chips === 0) {
        sbPlayer.isAllIn = true;
      }
    }

    if (bbPlayer) {
      const bbAmount = Math.min(this.bigBlind, bbPlayer.chips);
      bbPlayer.chips -= bbAmount;
      bbPlayer.currentBet = bbAmount;
      bbPlayer.totalBet = bbAmount;
      this.state.pot += bbAmount;
      if (bbPlayer.chips === 0) {
        bbPlayer.isAllIn = true;
      }
    }
  }

  /** 检查下注轮是否结束 */
  private isBettingRoundComplete(): boolean {
    const activePlayers = this.state.players.filter(p => p.isActive);

    // 只剩一个活跃玩家
    if (activePlayers.length <= 1) return true;

    // 检查是否所有活跃玩家都已下注匹配
    // 或者allin
    const nonAllInPlayers = activePlayers.filter(p => !p.isAllIn);

    // 如果所有非allin玩家的currentBet都等于currentBet（或没有非allin玩家）
    if (nonAllInPlayers.length === 0) return true;

    // 所有非allin玩家都必须已行动且下注匹配
    const allMatched = nonAllInPlayers.every(
      p => p.currentBet === this.state.currentBet
    );

    return allMatched;
  }

  /** 检查是否只剩一个活跃玩家 */
  private isOnlyOneActive(): boolean {
    return this.state.players.filter(p => p.isActive).length <= 1;
  }

  /** 检查是否所有活跃玩家都已allin */
  private isAllAllIn(): boolean {
    const activePlayers = this.state.players.filter(p => p.isActive);
    if (activePlayers.length <= 1) return true;
    return activePlayers.every(p => p.isAllIn);
  }

  /** 找到下一个活跃玩家的索引 */
  private findNextActivePlayer(fromIndex: number): number {
    const sortedPlayers = [...this.state.players].sort((a, b) => a.seatIndex - b.seatIndex);
    const fromPlayer = this.state.players[fromIndex];
    if (!fromPlayer) return 0;

    let currentSeat = fromPlayer.seatIndex;
    for (let i = 0; i < this.maxPlayers; i++) {
      currentSeat = (currentSeat + 1) % this.maxPlayers;
      const nextPlayer = this.state.players.find(
        p => p.seatIndex === currentSeat && p.isActive && !p.isAllIn
      );
      if (nextPlayer) {
        return this.state.players.findIndex(p => p.playerId === nextPlayer.playerId);
      }
    }
    return fromIndex;
  }

  /** 找到下一个座位号 */
  private findNextSeat(seatIndex: number): number {
    return (seatIndex + 1) % this.maxPlayers;
  }

  /** 通过座位号找玩家索引 */
  private findPlayerIndexBySeat(seatIndex: number): number {
    const player = this.state.players.find(p => p.seatIndex === seatIndex);
    return player ? this.state.players.findIndex(p => p.playerId === player.playerId) : 0;
  }

  /** 找到当前庄家座位 */
  private findDealerSeat(): number {
    const dealer = this.state.players.find(p => p.isDealer);
    return dealer ? dealer.seatIndex : 0;
  }

  /** 记录动作 */
  private recordAction(playerId: string, action: PlayerAction, amount: number): void {
    this.state.actionHistory.push({
      playerId,
      action,
      amount: amount > 0 ? amount : undefined,
      timestamp: Date.now(),
    });
  }
}
