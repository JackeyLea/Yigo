/**
 * 德州扑克 AI
 * Texas Hold'em Poker AI
 *
 * 支持三种难度：
 * - easy: 基于牌力的简单决策
 * - medium: 加入EV计算和位置意识
 * - hard: 对手建模、诈唬、高级策略
 */

import {
  PokerState, PokerPlayer, PlayerAction, PokerPhase,
  HandRanking, AIDifficulty, AIDecision, Card, RANK_VALUES,
} from '../poker.types';
import { HandEvaluator } from '../poker.hand-evaluator';

/** 手牌强度分类 */
enum HandStrength {
  PREMIUM = 'premium',     // 超强牌：AA, KK, QQ, AKs
  STRONG = 'strong',       // 强牌：JJ, TT, AKo, AQs, AJs, KQs
  MEDIUM = 'medium',       // 中等牌：99-22, ATs, KJs, QJs
  WEAK = 'weak',           // 弱牌：其他有花色的高牌
  TRASH = 'trash',         // 垃圾牌：其他
}

export class PokerAI {
  private difficulty: AIDifficulty;
  private opponentHistory: Map<string, { actions: PlayerAction[]; bets: number[] }> = new Map();
  private handHistory: Map<string, { showedDown: boolean; won: boolean }[]> = new Map();

  constructor(difficulty: AIDifficulty = 'medium') {
    this.difficulty = difficulty;
  }

  /**
   * 获取AI决策
   */
  getAction(state: PokerState, playerId: string): AIDecision {
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) {
      return { action: 'fold' };
    }

    // 如果只有check可选
    const validActions = this.getValidActions(state, playerId);
    if (validActions.length === 0) {
      return { action: 'fold' };
    }

    // 如果只能check
    if (validActions.length === 1 && validActions[0] === 'check') {
      return { action: 'check' };
    }

    // 评估手牌
    let handRank: HandRanking;
    if (state.communityCards.length > 0) {
      handRank = HandEvaluator.evaluateBestHand(player.holeCards, state.communityCards);
    } else {
      // preflop：基于底牌估算
      handRank = this.estimatePreflopStrength(player.holeCards);
    }

    // 根据难度选择策略
    switch (this.difficulty) {
      case 'easy':
        return this.easyDecision(state, player, handRank, validActions);
      case 'medium':
        return this.mediumDecision(state, player, handRank, validActions);
      case 'hard':
        return this.hardDecision(state, player, handRank, validActions);
      default:
        return this.easyDecision(state, player, handRank, validActions);
    }
  }

  // ==================== Easy 策略 ====================

  /**
   * Easy难度：简单基于牌力的决策
   * - 强牌：加注/下注
   * - 中等牌：跟注
   * - 弱牌：弃牌
   */
  private easyDecision(
    state: PokerState,
    player: PokerPlayer,
    handRank: HandRanking,
    validActions: PlayerAction[]
  ): AIDecision {
    const potOdds = this.calculatePotOdds(state, player);
    const strength = this.normalizeHandStrength(handRank);

    // 极强牌型（顺子以上）：积极下注
    if (handRank.rank >= 5) {
      if (validActions.includes('raise')) {
        return { action: 'raise', amount: this.calculateRaiseAmount(state, player) };
      }
      if (validActions.includes('bet')) {
        return { action: 'bet', amount: this.calculateBetAmount(state, player) };
      }
      if (validActions.includes('call')) return { action: 'call' };
      if (validActions.includes('check')) return { action: 'check' };
      return { action: 'call' };
    }

    // 强牌型（三条、两对）：根据底池赔率决定
    if (handRank.rank >= 3) {
      if (strength > potOdds * 1.5) {
        if (validActions.includes('raise')) {
          return { action: 'raise', amount: this.calculateRaiseAmount(state, player) };
        }
        if (validActions.includes('bet')) {
          return { action: 'bet', amount: this.calculateBetAmount(state, player) };
        }
      }
      if (validActions.includes('call')) return { action: 'call' };
      if (validActions.includes('check')) return { action: 'check' };
      return { action: 'fold' };
    }

    // 中等牌型（一对）：跟注或弃牌
    if (handRank.rank === 2) {
      if (strength > potOdds) {
        if (validActions.includes('call')) return { action: 'call' };
        if (validActions.includes('check')) return { action: 'check' };
      }
      return { action: 'fold' };
    }

    // 弱牌：大多数情况下弃牌，偶尔诈唬
    if (strength > potOdds * 0.8 && validActions.includes('call')) {
      return { action: 'call' };
    }
    if (validActions.includes('check')) return { action: 'check' };
    return { action: 'fold' };
  }

  // ==================== Medium 策略 ====================

  /**
   * Medium难度：加入EV计算和位置意识
   */
  private mediumDecision(
    state: PokerState,
    player: PokerPlayer,
    handRank: HandRanking,
    validActions: PlayerAction[]
  ): AIDecision {
    const ev = this.calculateEV(state, player.playerId);
    const position = this.getPosition(state, player);
    const potOdds = this.calculatePotOdds(state, player);
    const strength = this.normalizeHandStrength(handRank);

    // 位置调整
    const positionMultiplier = position === 'late' ? 1.2 : position === 'early' ? 0.8 : 1.0;
    const adjustedStrength = strength * positionMultiplier;

    // EV为正且有强牌：加注
    if (ev > 0 && adjustedStrength > 0.6) {
      if (validActions.includes('raise')) {
        return { action: 'raise', amount: this.calculateRaiseAmount(state, player) };
      }
      if (validActions.includes('bet')) {
        return { action: 'bet', amount: this.calculateBetAmount(state, player) };
      }
    }

    // EV为正或底池赔率合理：跟注
    if (ev > 0 || adjustedStrength > potOdds) {
      if (validActions.includes('call')) return { action: 'call' };
      if (validActions.includes('check')) return { action: 'check' };
    }

    // 后位可以check更多
    if (position === 'late' && validActions.includes('check')) {
      return { action: 'check' };
    }

    if (validActions.includes('fold')) return { action: 'fold' };
    if (validActions.includes('check')) return { action: 'check' };
    return { action: 'fold' };
  }

  // ==================== Hard 策略 ====================

  /**
   * Hard难度：对手建模、诈唬、高级策略
   */
  private hardDecision(
    state: PokerState,
    player: PokerPlayer,
    handRank: HandRanking,
    validActions: PlayerAction[]
  ): AIDecision {
    const ev = this.calculateEV(state, player.playerId);
    const position = this.getPosition(state, player);
    const potOdds = this.calculatePotOdds(state, player);
    const strength = this.normalizeHandStrength(handRank);

    // 分析对手风格
    const opponents = state.players.filter(
      p => p.playerId !== player.playerId && p.isActive
    );
    let avgTightness = 0.5;
    if (opponents.length > 0) {
      avgTightness = opponents.reduce((sum, o) => {
        const style = this.getOpponentStyle(o.playerId);
        return sum + (style.startsWith('tight') ? 0.7 : 0.3);
      }, 0) / opponents.length;
    }

    // 对手紧 => 可以偷更多盲注
    const stealOpportunity = avgTightness > 0.6 && position === 'late';

    // 诈唬决策
    const shouldBluff = this.shouldBluff(state, strength);

    // 极强牌：价值下注
    if (handRank.rank >= 5) {
      if (validActions.includes('raise')) {
        return { action: 'raise', amount: this.calculateRaiseAmount(state, player) * 1.2 };
      }
      if (validActions.includes('bet')) {
        return { action: 'bet', amount: state.pot * 0.75 };
      }
      if (validActions.includes('call')) return { action: 'call' };
      if (validActions.includes('check')) return { action: 'check' };
    }

    // 强牌 + EV正：加注
    if (ev > 0 && strength > 0.55) {
      if (validActions.includes('raise')) {
        return { action: 'raise', amount: this.calculateRaiseAmount(state, player) };
      }
      if (validActions.includes('bet')) {
        return { action: 'bet', amount: state.pot * 0.6 };
      }
      if (validActions.includes('call')) return { action: 'call' };
    }

    // 诈唬机会
    if (shouldBluff && stealOpportunity && validActions.includes('raise')) {
      return { action: 'raise', amount: this.calculateRaiseAmount(state, player) * 0.8 };
    }

    // 中等牌
    if (strength > potOdds * 0.9) {
      if (validActions.includes('call')) return { action: 'call' };
      if (validActions.includes('check')) return { action: 'check' };
    }

    // 后位check选项
    if (position === 'late' && validActions.includes('check')) {
      return { action: 'check' };
    }

    if (validActions.includes('fold')) return { action: 'fold' };
    if (validActions.includes('check')) return { action: 'check' };
    return { action: 'fold' };
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 估算翻牌前手牌强度
   */
  private estimatePreflopStrength(holeCards: Card[]): HandRanking {
    if (holeCards.length !== 2) {
      return { type: 'high_card', rank: 1, kickers: [0] };
    }

    const [c1, c2] = holeCards;
    const v1 = RANK_VALUES[c1.rank];
    const v2 = RANK_VALUES[c2.rank];
    const isSuited = c1.suit === c2.suit;
    const isPair = c1.rank === c2.rank;
    const high = Math.max(v1, v2);
    const low = Math.min(v1, v2);

    // 对子
    if (isPair) {
      if (high >= 13) return { type: 'one_pair', rank: 2, kickers: [high, high, high, high, 14] }; // AA, KK
      if (high >= 10) return { type: 'one_pair', rank: 2, kickers: [high, high, high, high, 12] }; // QQ-JJ
      if (high >= 7) return { type: 'one_pair', rank: 2, kickers: [high, high, high, high, 10] };  // TT-77
      return { type: 'one_pair', rank: 2, kickers: [high, high, high, high, 8] };                    // 66-22
    }

    // 同花大牌
    if (isSuited) {
      if (high === 14 && low >= 12) return { type: 'high_card', rank: 1, kickers: [14, 13, 12, 10, 8] }; // AKs, AQs
      if (high === 14 && low >= 10) return { type: 'high_card', rank: 1, kickers: [14, 11, 10, 9, 8] };  // AJs, ATs
      if (high >= 13 && low >= 11) return { type: 'high_card', rank: 1, kickers: [13, 12, 11, 9, 8] };   // KQs, KJs
    }

    // 非同花大牌
    if (high === 14 && low >= 13) return { type: 'high_card', rank: 1, kickers: [14, 13, 10, 8, 6] };   // AKo
    if (high === 14 && low >= 11) return { type: 'high_card', rank: 1, kickers: [14, 12, 10, 8, 6] };    // AQo, AJo
    if (high >= 13 && low >= 11) return { type: 'high_card', rank: 1, kickers: [13, 12, 10, 8, 6] };     // KQo, KJo

    // 连牌同花
    if (isSuited && high - low <= 3) {
      return { type: 'high_card', rank: 1, kickers: [high, low, Math.max(low - 1, 2), 5, 4] };
    }

    // 弱牌
    return { type: 'high_card', rank: 1, kickers: [high, low, 8, 6, 4] };
  }

  /**
   * 标准化手牌强度到0-1范围
   */
  private normalizeHandStrength(handRank: HandRanking): number {
    // 基于rank和kickers计算一个0-1的强度值
    const baseStrength = handRank.rank / 10; // 0.1 - 1.0
    const kickerBonus = handRank.kickers.length > 0
      ? handRank.kickers[0] / 28  // 最大约0.5的加成
      : 0;
    return Math.min(baseStrength + kickerBonus * 0.1, 1);
  }

  /**
   * 计算底池赔率
   */
  private calculatePotOdds(state: PokerState, player: PokerPlayer): number {
    const callAmount = state.currentBet - player.currentBet;
    if (callAmount <= 0) return 1; // 可以check
    const totalPot = state.pot + callAmount;
    return totalPot > 0 ? callAmount / totalPot : 0;
  }

  /**
   * 计算下注额
   */
  private calculateBetAmount(state: PokerState, player: PokerPlayer): number {
    const potSize = state.pot;
    const bet = Math.floor(potSize * 0.5);
    return Math.min(Math.max(bet, state.minRaise), player.chips);
  }

  /**
   * 计算加注额
   */
  private calculateRaiseAmount(state: PokerState, player: PokerPlayer): number {
    const minRaise = state.currentBet + state.minRaise;
    const potRaise = state.pot + state.currentBet * 2;
    const raiseTo = Math.max(minRaise, Math.floor(potRaise * 0.5));
    return Math.min(raiseTo, player.chips + player.currentBet);
  }

  /**
   * 获取玩家在牌桌上的位置
   */
  private getPosition(state: PokerState, player: PokerPlayer): 'early' | 'middle' | 'late' {
    const activePlayers = state.players.filter(p => p.isActive);
    const playerCount = activePlayers.length;
    if (playerCount <= 2) return 'late';

    // 根据与庄家的距离判断位置
    const dealerSeat = state.players.find(p => p.isDealer)?.seatIndex ?? 0;
    const playerSeat = player.seatIndex;

    // 计算距离（考虑环形）
    let distance = (playerSeat - dealerSeat + this.maxPlayers) % this.maxPlayers;
    const ratio = distance / playerCount;

    if (ratio < 0.33) return 'early';
    if (ratio < 0.66) return 'middle';
    return 'late';
  }

  /**
   * 计算期望值（简化版）
   * 基于手牌强度和底池赔率
   */
  private calculateEV(state: PokerState, playerId: string): number {
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) return -1;

    const handRank = state.communityCards.length > 0
      ? HandEvaluator.evaluateBestHand(player.holeCards, state.communityCards)
      : this.estimatePreflopStrength(player.holeCards);

    const strength = this.normalizeHandStrength(handRank);
    const callAmount = state.currentBet - player.currentBet;

    if (callAmount <= 0) return strength; // 可以check

    // 简化EV = 获胜概率 * 赢得金额 - 失败概率 * 投入金额
    const winProb = strength;
    const potWin = state.pot;
    const ev = winProb * potWin - (1 - winProb) * callAmount;

    return ev;
  }

  /**
   * 获取对手风格
   * 基于历史行为分析
   */
  private getOpponentStyle(playerId: string): 'tight-aggressive' | 'loose-aggressive' | 'tight-passive' | 'loose-passive' {
    const history = this.opponentHistory.get(playerId);
    if (!history || history.actions.length < 5) {
      // 数据不足，默认tight-passive
      return 'tight-passive';
    }

    const totalActions = history.actions.length;
    const foldCount = history.actions.filter(a => a === 'fold').length;
    const raiseCount = history.actions.filter(a => a === 'raise' || a === 'bet' || a === 'allin').length;

    const foldRate = foldCount / totalActions;
    const aggressionRate = raiseCount / totalActions;

    const isTight = foldRate > 0.5;
    const isAggressive = aggressionRate > 0.3;

    if (isTight && isAggressive) return 'tight-aggressive';
    if (!isTight && isAggressive) return 'loose-aggressive';
    if (isTight && !isAggressive) return 'tight-passive';
    return 'loose-passive';
  }

  /**
   * 判断是否诈唬
   */
  private shouldBluff(state: PokerState, handStrength: number): boolean {
    // 只有在手牌较弱时才可能诈唬
    if (handStrength > 0.4) return false;

    // 翻牌后诈唬概率更高
    const bluffProbability = state.phase === 'preflop' ? 0.1 :
                              state.phase === 'flop' ? 0.2 :
                              state.phase === 'turn' ? 0.15 : 0.1;

    return Math.random() < bluffProbability;
  }

  /**
   * 获取当前玩家可选动作
   */
  private getValidActions(state: PokerState, playerId: string): PlayerAction[] {
    const actions: PlayerAction[] = [];
    const player = state.players.find(p => p.playerId === playerId);
    if (!player || !player.isActive || player.isAllIn) return actions;

    // fold总是可选（除非已经allin）
    actions.push('fold');

    const callAmount = state.currentBet - player.currentBet;

    // check: 没有需要跟注的金额
    if (callAmount <= 0) {
      actions.push('check');
    }

    // call: 有需要跟注的金额且筹码足够
    if (callAmount > 0 && player.chips >= callAmount) {
      actions.push('call');
    }

    // bet: 当前没有下注（非preflop轮）
    if (state.currentBet === 0 && state.phase !== 'preflop' && player.chips > 0) {
      actions.push('bet');
    }

    // raise: 可以加注（有筹码且加注额合法）
    const minRaiseTotal = state.currentBet + state.minRaise;
    if (player.chips > callAmount && state.currentBet > 0) {
      actions.push('raise');
    }

    // allin: 有筹码
    if (player.chips > 0) {
      actions.push('allin');
    }

    return actions;
  }

  /**
   * 记录对手行为（用于对手建模）
   */
  recordOpponentAction(playerId: string, action: PlayerAction, betAmount: number): void {
    if (!this.opponentHistory.has(playerId)) {
      this.opponentHistory.set(playerId, { actions: [], bets: [] });
    }
    const history = this.opponentHistory.get(playerId)!;
    history.actions.push(action);
    history.bets.push(betAmount);

    // 只保留最近50条记录
    if (history.actions.length > 50) {
      history.actions.shift();
      history.bets.shift();
    }
  }

  /**
   * 记录摊牌结果
   */
  recordShowdownResult(playerId: string, showedDown: boolean, won: boolean): void {
    if (!this.handHistory.has(playerId)) {
      this.handHistory.set(playerId, []);
    }
    this.handHistory.get(playerId)!.push({ showedDown, won });
  }

  /** 设置难度 */
  setDifficulty(difficulty: AIDifficulty): void {
    this.difficulty = difficulty;
  }
}
