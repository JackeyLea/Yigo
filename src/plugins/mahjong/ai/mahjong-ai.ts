/**
 * 麻将插件 - AI 模块
 * Mahjong Plugin - AI Module
 *
 * 三种难度：
 * - easy: 随机合法打牌
 * - medium: 向听数优化 + 基础防守
 * - hard: 牌河读牌 + 攻守平衡 + 振听规避
 */

import {
  Tile, Suit, MahjongState, MahjongPlayer,
  ResponseType, TileUtils, AIDifficulty,
} from '../mahjong.types';
import { MahjongEngine } from '../mahjong.engine';

export class MahjongAI {
  private difficulty: AIDifficulty;
  private engine: MahjongEngine;

  constructor(difficulty: AIDifficulty = 'medium') {
    this.difficulty = difficulty;
    this.engine = new MahjongEngine();
  }

  // ==================== 主决策接口 ====================

  /**
   * 打牌决策：选哪张牌打出
   */
  getDiscard(state: MahjongState): Tile {
    const player = this.getCurrentPlayer(state);

    switch (this.difficulty) {
      case 'easy':
        return this.easyDiscard(player, state);
      case 'medium':
        return this.mediumDiscard(player, state);
      case 'hard':
        return this.hardDiscard(player, state);
      default:
        return this.easyDiscard(player, state);
    }
  }

  /**
   * 响应决策：吃/碰/杠/胡/Pass
   */
  getResponse(state: MahjongState, availableResponses: ResponseType[]): ResponseType | null {
    if (availableResponses.length === 0) return null;

    // 如果只有pass，直接pass
    if (availableResponses.length === 1 && availableResponses[0] === 'pass') {
      return 'pass';
    }

    switch (this.difficulty) {
      case 'easy':
        return this.easyResponse(availableResponses, state);
      case 'medium':
        return this.mediumResponse(availableResponses, state);
      case 'hard':
        return this.hardResponse(availableResponses, state);
      default:
        return 'pass';
    }
  }

  /**
   * 是否立直
   */
  shouldRiichi(state: MahjongState): boolean {
    const player = this.getCurrentPlayer(state);

    // 已经是立直状态
    if (player.isRiichi) return false;

    // 有副露不能立直
    if (player.melds.length > 0) return false;

    // 必须听牌
    if (!player.isTenpai && !this.engine.isTenpai(player.hand)) return false;

    switch (this.difficulty) {
      case 'easy':
        return Math.random() < 0.5; // 50%概率立直
      case 'medium':
        return this.mediumShouldRiichi(player, state);
      case 'hard':
        return this.hardShouldRiichi(player, state);
      default:
        return false;
    }
  }

  // ==================== Easy 难度 ====================

  /**
   * Easy: 随机合法打牌
   * 策略：完全随机选择一张手牌打出
   */
  private easyDiscard(player: MahjongPlayer, _state: MahjongState): Tile {
    const hand = player.hand;
    if (hand.length === 0) {
      throw new Error('Empty hand');
    }

    // 如果有立直，不能换牌
    if (player.isRiichi) {
      return hand[Math.floor(Math.random() * hand.length)];
    }

    // 随机选择一张牌
    return hand[Math.floor(Math.random() * hand.length)];
  }

  /**
   * Easy: 随机响应
   * - 有胡则胡（80%概率）
   * - 否则随机
   */
  private easyResponse(availableResponses: ResponseType[], _state: MahjongState): ResponseType | null {
    // 有胡则大概率胡
    if (availableResponses.includes('ron')) {
      return Math.random() < 0.8 ? 'ron' : 'pass';
    }

    // 从非pass选项中随机选择
    const nonPass = availableResponses.filter(r => r !== 'pass');
    if (nonPass.length === 0) return 'pass';

    // 随机选择，吃概率最低
    return nonPass[Math.floor(Math.random() * nonPass.length)];
  }

  // ==================== Medium 难度 ====================

  /**
   * Medium: 向听数优化 + 基础防守
   * 策略：
   * 1. 打完后向听数最小的牌
   * 2. 如果接近听牌，优先打危险度低的牌
   * 3. 保留役牌和对子
   */
  private mediumDiscard(player: MahjongPlayer, state: MahjongState): Tile {
    const hand = player.hand;
    if (hand.length === 0) throw new Error('Empty hand');

    if (player.isRiichi) {
      return hand[0]; // 立直后自动打牌
    }

    // 计算每张牌打出后的向听数
    const candidates: { tile: Tile; shanten: number; danger: number; value: number }[] = [];

    for (const tile of hand) {
      const testHand = hand.filter(t => t.uniqueId !== tile.uniqueId);
      const shanten = this.engine.calculateShanten(testHand);
      const danger = this.estimateDanger(tile, state, player.seatIndex);

      // 牌的价值评分（役牌 > 对子 > 孤张）
      let value = 0;
      if (this.isYakuTile(tile, state.roundWind, player.seatIndex)) {
        value -= 10; // 役牌价值高，扣分表示不愿意打
      }
      const pairCount = hand.filter(t => TileUtils.equals(t, tile)).length;
      if (pairCount >= 2) value -= 5;

      candidates.push({ tile, shanten, danger, value });
    }

    // 排序：向听数小 > 危险度低 > 价值低（更愿意打）
    candidates.sort((a, b) => {
      if (a.shanten !== b.shanten) return a.shanten - b.shanten;
      if (a.danger !== b.danger) return a.danger - b.danger;
      return a.value - b.value;
    });

    return candidates[0].tile;
  }

  /**
   * Medium: 智能响应
   * - 胡牌优先
   * - 接近听牌时积极鸣牌
   * - 否则保守
   */
  private mediumResponse(availableResponses: ResponseType[], state: MahjongState): ResponseType | null {
    const player = this.getCurrentPlayer(state);

    // 有胡必胡
    if (availableResponses.includes('ron')) return 'ron';

    // 计算当前向听数
    const shanten = this.engine.calculateShanten(player.hand);

    // 如果已经听牌或接近听牌，积极鸣牌
    if (shanten <= 2) {
      if (availableResponses.includes('kong')) return 'kong';
      if (availableResponses.includes('pong')) return 'pong';
    }

    // 如果还很远，保守
    if (shanten >= 4) {
      return 'pass';
    }

    // 碰 > 吃
    if (availableResponses.includes('pong')) return 'pong';
    if (availableResponses.includes('chow') && shanten <= 3) return 'chow';

    return 'pass';
  }

  /**
   * Medium: 立直判断
   */
  private mediumShouldRiichi(player: MahjongPlayer, _state: MahjongState): boolean {
    // 分数充足时更愿意立直
    if (player.score < 5000) return false;

    // 听牌数越多越应该立直
    const waits = this.engine.getWaits(player.hand);
    if (waits.length >= 3) return true;
    if (waits.length >= 2 && Math.random() < 0.7) return true;
    if (waits.length >= 1 && Math.random() < 0.4) return true;

    return false;
  }

  // ==================== Hard 难度 ====================

  /**
   * Hard: 牌河读牌 + 攻守平衡 + 振听规避
   * 策略：
   * 1. 读取牌河信息，评估对手听牌可能性
   * 2. 根据场况调整攻守平衡
   * 3. 避免振听
   * 4. 考虑打点效率
   */
  private hardDiscard(player: MahjongPlayer, state: MahjongState): Tile {
    const hand = player.hand;
    if (hand.length === 0) throw new Error('Empty hand');

    if (player.isRiichi) return hand[0];

    // 评估场况
    const opponentDanger = this.assessOpponentThreat(state, player.seatIndex);
    const isLateGame = this.isLateGame(state);
    const shanten = this.engine.calculateShanten(player.hand);

    // 如果对手可能听牌且我们有危险牌，进入防守模式
    if (opponentDanger > 0.6 && shanten > 1) {
      return this.defensiveDiscard(player, state);
    }

    // 终盘防守加强
    if (isLateGame && shanten > 2) {
      return this.defensiveDiscard(player, state);
    }

    // 否则使用medium的策略，但更精细
    const candidates = hand.map(tile => {
      const testHand = hand.filter(t => t.uniqueId !== tile.uniqueId);
      const tileShanten = this.engine.calculateShanten(testHand);
      const danger = this.estimateDanger(tile, state, player.seatIndex);
      const tileValue = this.evaluateTileValue(tile, hand, state, player);
      const furitenRisk = this.estimateFuritenRisk(tile, player, state);

      // 综合评分（越低越好）
      const score = tileShanten * 10 + danger * 8 - tileValue * 3 + furitenRisk * 5;

      return { tile, score, tileShanten, danger, tileValue };
    });

    candidates.sort((a, b) => a.score - b.score);
    return candidates[0].tile;
  }

  /**
   * Hard: 高级响应策略
   */
  private hardResponse(availableResponses: ResponseType[], state: MahjongState): ResponseType | null {
    const player = this.getCurrentPlayer(state);

    // 胡牌优先
    if (availableResponses.includes('ron')) return 'ron';

    const shanten = this.engine.calculateShanten(player.hand);
    const isTenpai = shanten === 0;

    // 如果会进入振听，跳过
    if (player.isFuriten && availableResponses.includes('chow')) {
      return 'pass';
    }

    // 听牌状态：积极鸣牌
    if (isTenpai) {
      if (availableResponses.includes('pong')) return 'pong';
      if (availableResponses.includes('kong')) return 'kong';
    }

    // 根据剩余牌数决定策略
    const remainingTiles = state.wall.length;
    if (remainingTiles < 20) {
      // 终盘：保守
      if (shanten > 2) return 'pass';
    }

    // 中盘积极
    if (shanten <= 2) {
      if (availableResponses.includes('pong')) return 'pong';
      if (availableResponses.includes('chow') && shanten <= 1) return 'chow';
    }

    return 'pass';
  }

  /**
   * Hard: 立直判断（更精细）
   */
  private hardShouldRiichi(player: MahjongPlayer, state: MahjongState): boolean {
    // 分数检查
    if (player.score < 3000) return false;

    const waits = this.engine.getWaits(player.hand);
    const waitCount = waits.length;

    // 宝牌加成
    const doraBonus = state.doraTiles.length > 0 ? 1 : 0;

    // 待牌质量评估
    const waitQuality = this.evaluateWaitQuality(waits, state);

    // 对手弃牌分析
    const safeDiscardRatio = this.calculateSafeDiscardRatio(state, player);

    // 综合评分
    let riichiScore = 0;
    riichiScore += waitCount * 15;
    riichiScore += doraBonus * 10;
    riichiScore += waitQuality * 10;
    riichiScore += safeDiscardRatio * 20;

    // 场况调整
    if (state.wall.length < 30) riichiScore -= 20; // 终盘不利
    if (player.isDealer) riichiScore += 15; // 庄家优势

    return riichiScore >= 40;
  }

  // ==================== 防守策略 ====================

  /**
   * 防守打牌：选择最安全的牌
   */
  private defensiveDiscard(player: MahjongPlayer, state: MahjongState): Tile {
    const hand = player.hand;

    let safestTile = hand[0];
    let minDanger = Infinity;

    for (const tile of hand) {
      const danger = this.estimateDanger(tile, state, player.seatIndex);
      if (danger < minDanger) {
        minDanger = danger;
        safestTile = tile;
      }
    }

    return safestTile;
  }

  /**
   * 评估一张牌的危险度
   * 危险度：0（绝对安全）到 100（极度危险）
   */
  private estimateDanger(tile: Tile, state: MahjongState, mySeat: number): number {
    let danger = 50; // 基础危险度

    // 1. 已经被打出过的牌更安全（筋牌理论）
    for (let i = 0; i < 4; i++) {
      if (i === mySeat) continue;
      for (const discard of state.discardPiles[i]) {
        if (TileUtils.equals(tile, discard)) {
          danger -= 15;
          break;
        }
      }
    }

    // 2. 字牌在有人副露同种字牌后更危险
    if (tile.suit === 'zi') {
      for (let i = 0; i < 4; i++) {
        if (i === mySeat) continue;
        const opponent = state.players[i];
        for (const meld of opponent.melds) {
          if (meld.tiles[0].suit === 'zi' && meld.tiles[0].rank === tile.rank) {
            danger += 20;
          }
        }
      }
    }

    // 3. 数牌在有人副露同花色后更危险
    if (tile.suit !== 'zi') {
      for (let i = 0; i < 4; i++) {
        if (i === mySeat) continue;
        const opponent = state.players[i];
        for (const meld of opponent.melds) {
          if (meld.tiles[0].suit === tile.suit) {
            danger += 10;
          }
        }
      }
    }

    // 4. 幺九牌相对安全
    if (TileUtils.isTerminalOrHonor(tile)) {
      danger -= 10;
    }

    // 5. 中张牌（3-7）最危险
    if (tile.suit !== 'zi') {
      const rank = typeof tile.rank === 'number' ? tile.rank : parseInt(tile.rank);
      if (rank >= 3 && rank <= 7) {
        danger += 15;
      }
    }

    // 6. 同筋牌已被打出过的更安全
    // 简化处理

    return Math.max(0, Math.min(100, danger));
  }

  /**
   * 评估对手威胁程度
   * 返回 0-1 的值
   */
  private assessOpponentThreat(state: MahjongState, mySeat: number): number {
    let maxThreat = 0;

    for (let i = 0; i < 4; i++) {
      if (i === mySeat) continue;
      const opponent = state.players[i];

      let threat = 0;

      // 立直状态 = 高威胁
      if (opponent.isRiichi) threat += 0.8;

      // 副露数多 = 较高威胁
      threat += opponent.melds.length * 0.1;

      // 弃牌整齐（可能是好型听牌）
      if (opponent.discardPile.length > 8) threat += 0.1;

      maxThreat = Math.max(maxThreat, threat);
    }

    return Math.min(1, maxThreat);
  }

  /**
   * 是否为终盘
   */
  private isLateGame(state: MahjongState): boolean {
    return state.wall.length <= 20;
  }

  // ==================== 辅助方法 ====================

  /**
   * 评估单张牌的价值
   */
  private evaluateTileValue(tile: Tile, hand: Tile[], state: MahjongState, player: MahjongPlayer): number {
    let value = 0;

    // 役牌价值
    if (this.isYakuTile(tile, state.roundWind, player.seatIndex)) {
      value += 10;
    }

    // 三元牌
    if (TileUtils.isDragon(tile)) {
      value += 8;
    }

    // 对子价值
    const pairCount = hand.filter(t => TileUtils.equals(t, tile)).length;
    if (pairCount >= 2) value += 5;

    // 宝牌价值
    for (const dora of state.doraTiles) {
      if (TileUtils.equals(tile, dora)) {
        value += 15;
      }
    }

    // 连牌价值（如3万，如果手中有2万或4万）
    if (tile.suit !== 'zi') {
      const rank = typeof tile.rank === 'number' ? tile.rank : parseInt(tile.rank);
      for (const t of hand) {
        if (t.suit === tile.suit) {
          const otherRank = typeof t.rank === 'number' ? t.rank : parseInt(t.rank);
          if (Math.abs(otherRank - rank) === 1) value += 3;
          if (Math.abs(otherRank - rank) === 2) value += 1;
        }
      }
    }

    return value;
  }

  /**
   * 评估振听风险
   */
  private estimateFuritenRisk(tile: Tile, player: MahjongPlayer, state: MahjongState): number {
    // 如果已经在振听状态，风险更高
    if (player.isFuriten) return 0;

    // 检查打出这张牌是否会导致振听
    // 简化：检查这张牌的附近牌是否在自己弃牌中
    for (const discard of player.discardPile) {
      if (TileUtils.equals(tile, discard)) {
        return 20; // 高风险
      }
    }

    return 0;
  }

  /**
   * 评估待牌质量
   */
  private evaluateWaitQuality(waits: Tile[], state: MahjongState): number {
    if (waits.length === 0) return 0;

    let quality = 0;
    for (const wait of waits) {
      // 剩余枚数估算
      const remaining = this.estimateRemainingTiles(wait, state);
      quality += remaining;
    }

    return quality / waits.length;
  }

  /**
   * 估算剩余牌数
   */
  private estimateRemainingTiles(tile: Tile, state: MahjongState): number {
    let used = 0;

    // 统计已使用的牌
    for (const player of state.players) {
      for (const t of player.hand) {
        if (TileUtils.equals(t, tile)) used++;
      }
      for (const meld of player.melds) {
        for (const t of meld.tiles) {
          if (TileUtils.equals(t, tile)) used++;
        }
      }
      for (const t of player.discardPile) {
        if (TileUtils.equals(t, tile)) used++;
      }
    }

    return Math.max(0, 4 - used);
  }

  /**
   * 计算安全弃牌比例
   */
  private calculateSafeDiscardRatio(state: MahjongState, player: MahjongPlayer): number {
    const totalDiscards = player.discardPile.length;
    if (totalDiscards === 0) return 0.5;

    let safeCount = 0;
    for (const discard of player.discardPile) {
      if (TileUtils.isTerminalOrHonor(discard)) {
        safeCount++;
      }
    }

    return safeCount / totalDiscards;
  }

  /**
   * 检查是否为役牌
   */
  private isYakuTile(tile: Tile, roundWind: number, seatIndex: number): boolean {
    if (tile.suit !== 'zi') return false;

    const windTiles: string[] = ['dong', 'nan', 'xi', 'bei'];
    const dragonTiles: string[] = ['zhong', 'fa', 'bai'];

    // 三元牌都是役牌
    if (dragonTiles.includes(String(tile.rank))) return true;

    // 场风或自风
    if (tile.rank === windTiles[roundWind]) return true;
    if (tile.rank === windTiles[seatIndex]) return true;

    return false;
  }

  /**
   * 获取当前玩家
   */
  private getCurrentPlayer(state: MahjongState): MahjongPlayer {
    return state.players[state.currentPlayerIndex];
  }
}
