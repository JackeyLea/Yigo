/**
 * 麻将插件 - 麻将引擎
 * Mahjong Plugin - Game Engine
 *
 * 实现完整的麻将游戏逻辑：
 * - 洗牌发牌
 * - 摸牌/打牌
 * - 吃/碰/杠/胡
 * - 立直
 * - 向听数计算
 * - 振听检查
 * - 宝牌翻牌
 * - 流局判定
 */

import {
  Tile, Suit, ZiRank, Meld, MeldType,
  MahjongState, MahjongPlayer, MahjongWinResult,
  ResponseType, GamePhase,
  MahjongEngineConfig, DEFAULT_ENGINE_CONFIG,
  TileUtils,
} from './mahjong.types';

import { HandEvaluator } from './mahjong.hand-evaluator';

export class MahjongEngine {
  private state: MahjongState;
  private config: MahjongEngineConfig;
  private tileIdCounter: number = 0;

  constructor(config: Partial<MahjongEngineConfig> = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };

    this.state = this.createInitialState();
  }

  /** 获取当前状态 */
  getState(): MahjongState {
    return this.deepCloneState(this.state);
  }

  /** 重置游戏 */
  reset(): void {
    this.state = this.createInitialState();
  }

  // ==================== 游戏初始化 ====================

  /** 创建初始状态 */
  private createInitialState(): MahjongState {
    return {
      phase: 'deal',
      players: Array.from({ length: 4 }, (_, i) => ({
        playerId: `player_${i}`,
        seatIndex: i,
        hand: [],
        melds: [],
        discardPile: [],
        isRiichi: false,
        isTenpai: false,
        isFuriten: false,
        score: this.config.initialScore,
        isDealer: i === 0,
        isAI: i > 0, // 0号是人类，其余是AI
      })),
      wall: [],
      deadWall: [],
      doraIndicator: [],
      doraTiles: [],
      discardPiles: [[], [], [], []],
      currentPlayerIndex: 0,
      currentTile: null,
      lastDiscard: null,
      lastDiscardPlayer: -1,
      roundWind: 0,
      honba: 0,
      riichiSticks: 0,
      gameOver: false,
      winners: [],
    };
  }

  /** 洗牌发牌 */
  dealTiles(): void {
    // 创建136张标准牌
    const tiles = TileUtils.createStandardDeck();

    // Fisher-Yates 洗牌
    this.shuffle(tiles);

    // 设置牌山
    this.state.wall = tiles;

    // 设置王牌（岭上牌区），从牌山末尾取14张
    this.state.deadWall = this.state.wall.splice(-14, 14);

    // 翻第一张宝牌指示牌
    this.flipDora();

    // 发牌：每人13张，庄家14张
    for (let i = 0; i < 4; i++) {
      const handSize = i === 0 ? 14 : 13;
      this.state.players[i].hand = this.state.wall.splice(0, handSize);
      TileUtils.sortHand(this.state.players[i].hand);
    }

    // 检查初始配牌是否九种九牌（流局）
    if (this.checkKyuushuKyuuhai()) {
      this.state.phase = 'exhaust';
      return;
    }

    // 庄家先打
    this.state.currentPlayerIndex = 0;
    this.state.phase = 'discard';

    // 更新各玩家的听牌状态
    for (const player of this.state.players) {
      player.isTenpai = this.isTenpai(player.hand);
    }
  }

  /** 检查九种九牌（开局流局） */
  private checkKyuushuKyuuhai(): boolean {
    for (const player of this.state.players) {
      const terminals = new Set<string>();
      for (const tile of player.hand) {
        if (TileUtils.isTerminalOrHonor(tile)) {
          terminals.add(`${tile.suit}${tile.rank}`);
        }
      }
      if (terminals.size >= 9) return true;
    }
    return false;
  }

  // ==================== 核心操作 ====================

  /**
   * 摸牌
   * 返回摸到的牌
   */
  drawTile(): Tile {
    if (this.state.wall.length === 0) {
      this.state.phase = 'exhaust';
      throw new Error('No more tiles in wall');
    }

    const tile = this.state.wall.shift()!;
    const player = this.state.players[this.state.currentPlayerIndex];
    player.hand.push(tile);
    this.state.currentTile = tile;
    this.state.phase = 'discard';

    // 摸牌后检查是否自摸
    if (this.canWin(player.hand)) {
      // 玩家可以选择自摸或继续打牌
    }

    return tile;
  }

  /**
   * 打牌
   * @returns 是否成功
   */
  discardTile(playerId: string, tileId: string): boolean {
    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return false;

    // 只能打自己的牌
    if (player.seatIndex !== this.state.currentPlayerIndex) return false;

    // 找到要打出的牌
    const tileIndex = player.hand.findIndex(t => t.uniqueId === tileId);
    if (tileIndex === -1) return false;

    const tile = player.hand.splice(tileIndex, 1)[0];

    // 添加到弃牌
    player.discardPile.push(tile);
    this.state.discardPiles[player.seatIndex].push(tile);
    this.state.lastDiscard = tile;
    this.state.lastDiscardPlayer = player.seatIndex;

    // 清理当前摸牌标记
    this.state.currentTile = null;

    // 更新振听状态（如果打掉了听牌需要的牌）
    if (player.isRiichi) {
      // 立直状态下不能改变手牌
      return false;
    }

    // 检查是否进入振听
    player.isFuriten = this.checkFuriten(player);

    // 进入响应阶段，其他玩家可以响应
    this.state.phase = 'respond';

    return true;
  }

  /**
   * 吃（仅上家）
   * @param playerId 要吃牌的玩家
   * @param tileIds 用于吃的两张手牌ID
   * @returns 是否成功
   */
  chow(playerId: string, tileIds: string[]): boolean {
    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return false;

    // 只能吃上家的牌
    const discardPlayer = this.state.lastDiscardPlayer;
    const expectedPlayer = (discardPlayer + 1) % 4;
    if (player.seatIndex !== expectedPlayer) return false;

    if (!this.state.lastDiscard) return false;

    const targetTile = this.state.lastDiscard;

    // 验证选中的两张手牌
    if (tileIds.length !== 2) return false;
    const chowTiles = player.hand.filter(t => tileIds.includes(t.uniqueId));
    if (chowTiles.length !== 2) return false;

    // 检查是否可以组成顺子
    const allTiles = [...chowTiles, targetTile];
    if (!this.isValidChow(allTiles)) return false;

    // 移除手牌
    player.hand = player.hand.filter(t => !tileIds.includes(t.uniqueId));

    // 创建副露
    const meld: Meld = {
      type: 'chow',
      tiles: TileUtils.sortHand(allTiles),
      fromPlayer: discardPlayer,
    };
    player.melds.push(meld);

    // 清除最后打出的牌
    this.state.lastDiscard = null;

    // 该玩家继续打牌
    this.state.currentPlayerIndex = player.seatIndex;
    this.state.phase = 'discard';

    return true;
  }

  /**
   * 碰
   * @param playerId 要碰的玩家
   * @param tileIds 用于碰的两张手牌ID
   */
  pong(playerId: string, tileIds: string[]): boolean {
    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return false;

    if (!this.state.lastDiscard) return false;

    const targetTile = this.state.lastDiscard;

    // 验证选中的两张手牌
    if (tileIds.length !== 2) return false;
    const pongTiles = player.hand.filter(t => tileIds.includes(t.uniqueId));
    if (pongTiles.length !== 2) return false;

    // 检查三张牌是否相同
    const allTiles = [...pongTiles, targetTile];
    if (!this.isValidPong(allTiles)) return false;

    // 移除手牌
    player.hand = player.hand.filter(t => !tileIds.includes(t.uniqueId));

    // 创建副露
    const meld: Meld = {
      type: 'pong',
      tiles: allTiles,
      fromPlayer: this.state.lastDiscardPlayer,
    };
    player.melds.push(meld);

    // 清除最后打出的牌
    this.state.lastDiscard = null;

    // 该玩家继续打牌
    this.state.currentPlayerIndex = player.seatIndex;
    this.state.phase = 'discard';

    return true;
  }

  /**
   * 明杠（加杠别人的牌）
   */
  kong(playerId: string, tileIds: string[]): boolean {
    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return false;

    if (!this.state.lastDiscard) return false;

    const targetTile = this.state.lastDiscard;

    // 需要3张手牌
    if (tileIds.length !== 3) return false;
    const kongTiles = player.hand.filter(t => tileIds.includes(t.uniqueId));
    if (kongTiles.length !== 3) return false;

    const allTiles = [...kongTiles, targetTile];
    if (!this.isValidKong(allTiles)) return false;

    // 移除手牌
    player.hand = player.hand.filter(t => !tileIds.includes(t.uniqueId));

    // 创建副露
    const meld: Meld = {
      type: 'kong',
      tiles: allTiles,
      fromPlayer: this.state.lastDiscardPlayer,
    };
    player.melds.push(meld);

    // 清除最后打出的牌
    this.state.lastDiscard = null;

    // 翻一张新的宝牌
    this.flipDora();

    // 从岭上补一张牌
    const replacement = this.drawFromDeadWall();
    if (replacement) {
      player.hand.push(replacement);
    }

    // 该玩家继续打牌
    this.state.currentPlayerIndex = player.seatIndex;
    this.state.phase = 'discard';

    return true;
  }

  /**
   * 加杠（在已有的碰上加杠）
   */
  addedKong(playerId: string, tileId: string): boolean {
    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return false;

    if (player.seatIndex !== this.state.currentPlayerIndex) return false;

    // 找到要加杠的牌
    const tileIndex = player.hand.findIndex(t => t.uniqueId === tileId);
    if (tileIndex === -1) return false;

    const tile = player.hand[tileIndex];

    // 找到对应的碰
    const pongMeldIndex = player.melds.findIndex(
      m => m.type === 'pong' && TileUtils.equals(m.tiles[0], tile)
    );
    if (pongMeldIndex === -1) return false;

    // 移除手牌
    player.hand.splice(tileIndex, 1);

    // 更新副露类型
    const meld = player.melds[pongMeldIndex];
    meld.type = 'added_kong';
    meld.tiles.push(tile);

    // 翻宝牌
    this.flipDora();

    // 从岭上补牌
    const replacement = this.drawFromDeadWall();
    if (replacement) {
      player.hand.push(replacement);
    }

    return true;
  }

  /**
   * 暗杠
   */
  concealedKong(playerId: string, tileIds: string[]): boolean {
    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return false;

    if (player.seatIndex !== this.state.currentPlayerIndex) return false;

    if (tileIds.length !== 4) return false;

    // 验证4张牌是否在手牌中
    const kongTiles = player.hand.filter(t => tileIds.includes(t.uniqueId));
    if (kongTiles.length !== 4) return false;

    // 检查4张牌是否相同
    const first = kongTiles[0];
    if (!kongTiles.every(t => TileUtils.equals(t, first))) return false;

    // 移除手牌
    player.hand = player.hand.filter(t => !tileIds.includes(t.uniqueId));

    // 创建暗杠副露
    const meld: Meld = {
      type: 'concealed_kong',
      tiles: kongTiles,
      fromPlayer: -1,
    };
    player.melds.push(meld);

    // 翻宝牌
    this.flipDora();

    // 从岭上补牌
    const replacement = this.drawFromDeadWall();
    if (replacement) {
      player.hand.push(replacement);
    }

    return true;
  }

  /**
   * 自摸和牌
   */
  declareWin(playerId: string): MahjongWinResult | null {
    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return null;

    if (!this.canWin(player.hand)) return null;

    const context = this.createYakuContext(player, true);
    const evaluation = HandEvaluator.evaluateWinningHand(player.hand, player.hand[player.hand.length - 1], context);

    const score = HandEvaluator.calculateScore(evaluation.fan, evaluation.fu, player.isDealer, true);

    const result: MahjongWinResult = {
      playerId,
      hand: evaluation.handTypes,
      fan: evaluation.fan,
      fu: evaluation.fu,
      score,
      isDealer: player.isDealer,
      isTsumo: true,
      yaku: evaluation.handTypes,
    };

    this.state.winners.push(result);
    this.state.phase = 'win';
    this.state.gameOver = true;

    // 转移点数
    this.transferPoints(result);

    return result;
  }

  /**
   * 荣和
   */
  ron(playerId: string): MahjongWinResult | null {
    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return null;

    if (!this.state.lastDiscard) return null;

    if (!this.canWin(player.hand, this.state.lastDiscard)) return null;

    // 振听检查
    if (player.isFuriten) return null;

    const context = this.createYakuContext(player, false);
    const evaluation = HandEvaluator.evaluateWinningHand(player.hand, this.state.lastDiscard!, context);

    const score = HandEvaluator.calculateScore(evaluation.fan, evaluation.fu, player.isDealer, false);

    const result: MahjongWinResult = {
      playerId,
      hand: evaluation.handTypes,
      fan: evaluation.fan,
      fu: evaluation.fu,
      score,
      isDealer: player.isDealer,
      isTsumo: false,
      yaku: evaluation.handTypes,
    };

    this.state.winners.push(result);
    this.state.phase = 'win';
    this.state.gameOver = true;

    // 转移点数
    this.transferPoints(result);

    return result;
  }

  /**
   * 立直
   */
  declareRiichi(playerId: string, discardTileId: string): boolean {
    if (!this.config.enableRiichi) return false;

    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return false;

    if (player.seatIndex !== this.state.currentPlayerIndex) return false;

    // 已经立直了
    if (player.isRiichi) return false;

    // 必须门前清（无副露）
    if (player.melds.length > 0) return false;

    // 必须听牌
    if (!this.isTenpai(player.hand)) return false;

    // 找到要打出的牌
    const tileIndex = player.hand.findIndex(t => t.uniqueId === discardTileId);
    if (tileIndex === -1) return false;

    // 扣除立直棒1000点
    if (player.score < 1000) return false;
    player.score -= 1000;
    this.state.riichiSticks += 1;

    // 打出指定牌
    const tile = player.hand.splice(tileIndex, 1)[0];
    player.discardPile.push(tile);
    this.state.discardPiles[player.seatIndex].push(tile);
    this.state.lastDiscard = tile;
    this.state.lastDiscardPlayer = player.seatIndex;

    // 设置立直状态
    player.isRiichi = true;

    return true;
  }

  /**
   * Pass（放弃响应）
   */
  pass(playerId: string): void {
    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return;

    // 如果所有玩家都pass，则轮到下家
    // 实际逻辑由上层管理，这里只做记录
  }

  // ==================== 检查方法 ====================

  /**
   * 检查是否可以吃
   */
  canChow(playerId: string, tile: Tile): boolean {
    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return false;

    // 不能吃字牌
    if (tile.suit === 'zi') return false;

    // 必须是上家的牌
    if (this.state.lastDiscardPlayer === -1) return false;
    const expectedPlayer = (this.state.lastDiscardPlayer + 1) % 4;
    if (player.seatIndex !== expectedPlayer) return false;

    const rank = typeof tile.rank === 'number' ? tile.rank : parseInt(tile.rank);
    const suit = tile.suit;

    // 检查手牌中是否有能组成顺子的两张牌
    // 三种可能的顺子: (rank-2, rank-1, rank), (rank-1, rank, rank+1), (rank, rank+1, rank+2)
    const possibilities = [
      [rank - 2, rank - 1],
      [rank - 1, rank + 1],
      [rank + 1, rank + 2],
    ];

    for (const [r1, r2] of possibilities) {
      if (r1 >= 1 && r2 <= 9) {
        const has1 = player.hand.some(t => t.suit === suit && t.rank === r1);
        const has2 = player.hand.some(t => t.suit === suit && t.rank === r2);
        if (has1 && has2) return true;
      }
    }

    return false;
  }

  /**
   * 检查是否可以碰
   */
  canPong(hand: Tile[], tile: Tile): boolean {
    const sameTiles = hand.filter(t => TileUtils.equals(t, tile));
    return sameTiles.length >= 2;
  }

  /**
   * 检查是否可以杠
   */
  canKong(hand: Tile[], tile: Tile): boolean {
    const sameTiles = hand.filter(t => TileUtils.equals(t, tile));
    return sameTiles.length >= 3;
  }

  /**
   * 检查是否可以暗杠
   */
  canConcealedKong(hand: Tile[]): boolean {
    const counts = new Map<string, number>();
    for (const tile of hand) {
      const key = `${tile.suit}${tile.rank}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const count of counts.values()) {
      if (count >= 4) return true;
    }
    return false;
  }

  /**
   * 检查是否可以胡
   */
  canWin(hand: Tile[], tile?: Tile): boolean {
    return HandEvaluator.canWin(hand, tile);
  }

  // ==================== 向听数计算 ====================

  /**
   * 计算向听数（距离听牌还差几步）
   * 返回：
   *   -1: 已和牌
   *    0: 听牌
   *    1+: 还需几步
   */
  calculateShanten(hand: Tile[]): number {
    // 标准型向听数
    const standardShanten = this.calculateStandardShanten(hand);

    // 七对子向听数
    const sevenPairsShanten = this.calculateSevenPairsShanten(hand);

    // 国士无双向听数
    const kokushiShanten = this.calculateKokushiShanten(hand);

    return Math.min(standardShanten, sevenPairsShanten, kokushiShanten);
  }

  /**
   * 标准型向听数计算
   */
  private calculateStandardShanten(hand: Tile[]): number {
    if (hand.length < 13) return Infinity;

    // 复制手牌用于计算
    const tiles = [...hand];
    const counts = this.buildCountArray(tiles);

    // 寻找最佳分解
    let bestShanten = Infinity;

    // 尝试每种牌作为雀头
    for (let i = 0; i < 34; i++) {
      if (counts[i] >= 2) {
        counts[i] -= 2;
        const groups = this.findBestGroups(counts, 0, 4, 0);
        const shanten = 8 - groups * 2; // 近似公式
        if (shanten < bestShanten) bestShanten = shanten;
        counts[i] += 2;
      }
    }

    // 如果没有雀头
    if (bestShanten === Infinity) {
      const groups = this.findBestGroups(counts, 0, 4, 0);
      bestShanten = 8 - groups * 2 + 1; // 缺少雀头 +1
    }

    return Math.max(0, bestShanten);
  }

  /**
   * 七对子向听数
   */
  private calculateSevenPairsShanten(hand: Tile[]): number {
    const counts = new Map<string, number>();
    for (const tile of hand) {
      const key = `${tile.suit}${tile.rank}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    let pairs = 0;
    let singles = 0;
    for (const count of counts.values()) {
      if (count >= 2) pairs++;
      singles++;
    }

    // 向听数 = 6 - 对子数（最多6个对子）
    // 还需要不同种类的牌 >= 7
    const shanten = 6 - Math.min(pairs, 7);
    return Math.max(0, shanten);
  }

  /**
   * 国士无双向听数
   */
  private calculateKokushiShanten(hand: Tile[]): number {
    const required = new Set([
      'wan1', 'wan9', 'tong1', 'tong9', 'tiao1', 'tiao9',
      'zidong', 'zinan', 'zixi', 'zibei', 'zizhong', 'zifa', 'zibai',
    ]);

    const counts = new Map<string, number>();
    for (const tile of hand) {
      const key = `${tile.suit}${tile.rank}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    let uniqueTerminals = 0;
    let hasPair = false;

    for (const key of required) {
      const count = counts.get(key) || 0;
      if (count > 0) uniqueTerminals++;
      if (count >= 2) hasPair = true;
    }

    // 向听数 = 12 - 独特幺九牌数 - (有对子?1:0)
    let shanten = 12 - uniqueTerminals;
    if (hasPair) shanten--;

    return Math.max(0, shanten);
  }

  /**
   * 获取待牌（听的牌）
   */
  getWaits(hand: Tile[]): Tile[] {
    if (!this.isTenpai(hand)) return [];

    const waits: Tile[] = [];
    const allTiles = TileUtils.createStandardDeck();
    const checked = new Set<string>();

    for (const tile of allTiles) {
      const key = `${tile.suit}${tile.rank}`;
      if (checked.has(key)) continue;
      checked.add(key);

      if (HandEvaluator.canWin(hand, tile)) {
        waits.push(tile);
      }
    }

    return waits;
  }

  /**
   * 检查听牌
   */
  isTenpai(hand: Tile[]): boolean {
    return this.calculateShanten(hand) === 0;
  }

  /**
   * 检查振听
   * 振听：玩家处于听牌状态，但需要胡的牌中有自己曾打出过的牌
   */
  checkFuriten(player: MahjongPlayer): boolean {
    if (!player.isTenpai) return false;

    const waits = this.getWaits(player.hand);

    // 检查待牌是否在弃牌中
    for (const waitTile of waits) {
      for (const discard of player.discardPile) {
        if (TileUtils.equals(waitTile, discard)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 响应优先级
   */
  getResponsePriority(response: ResponseType): number {
    const priorities: Record<ResponseType, number> = {
      'ron': 100,    // 胡牌最高
      'kong': 50,    // 杠次之
      'pong': 30,    // 碰
      'chow': 10,    // 吃最低
      'pass': 0,     // pass
    };
    return priorities[response];
  }

  // ==================== 流局判定 ====================

  /**
   * 检查流局（牌山摸完）
   */
  checkExhaustiveDraw(): boolean {
    if (this.state.wall.length > 0) return false;

    // 计算听牌人数
    const tenpaiCount = this.state.players.filter(p => p.isTenpai).length;

    // 不听罚符
    for (const player of this.state.players) {
      if (player.isTenpai) {
        player.score += 3000 - tenpaiCount * 1000;
      } else {
        player.score -= 3000;
      }
    }

    this.state.phase = 'exhaust';
    this.state.gameOver = true;

    return true;
  }

  // ==================== 宝牌翻牌 ====================

  /**
   * 翻开一张宝牌指示牌
   */
  flipDora(): void {
    if (this.state.deadWall.length === 0) return;

    const indicator = this.state.deadWall.shift();
    if (indicator) {
      this.state.doraIndicator.push(indicator);

      // 计算宝牌（指示牌的下一张）
      const dora = TileUtils.getNextTile(indicator);
      if (dora) {
        this.state.doraTiles.push(dora);
      }
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 切换到下一个玩家
   */
  nextPlayer(): void {
    this.state.currentPlayerIndex = (this.state.currentPlayerIndex + 1) % 4;
    this.state.phase = 'draw';
  }

  /**
   * 获取当前玩家
   */
  getCurrentPlayer(): MahjongPlayer {
    return this.state.players[this.state.currentPlayerIndex];
  }

  /**
   * 检查某玩家对某张牌的可用响应
   */
  getAvailableResponses(playerId: string, tile: Tile): ResponseType[] {
    const player = this.state.players.find(p => p.playerId === playerId);
    if (!player) return [];

    const responses: ResponseType[] = [];

    // 胡
    if (this.canWin(player.hand, tile) && !player.isFuriten) {
      responses.push('ron');
    }

    // 杠
    if (this.canKong(player.hand, tile)) {
      responses.push('kong');
    }

    // 碰
    if (this.canPong(player.hand, tile)) {
      responses.push('pong');
    }

    // 吃（仅限上家）
    if (this.canChow(playerId, tile)) {
      responses.push('chow');
    }

    responses.push('pass');

    return responses;
  }

  /**
   * 从岭上补牌
   */
  private drawFromDeadWall(): Tile | null {
    if (this.state.deadWall.length === 0) return null;
    return this.state.deadWall.shift()!;
  }

  /**
   * Fisher-Yates 洗牌
   */
  private shuffle(tiles: Tile[]): Tile[] {
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    return tiles;
  }

  /**
   * 深度克隆状态
   */
  private deepCloneState(state: MahjongState): MahjongState {
    return JSON.parse(JSON.stringify(state));
  }

  /**
   * 构建计数数组（34种牌）
   */
  private buildCountArray(hand: Tile[]): number[] {
    const counts = new Array(34).fill(0);
    const suitOffsets: Record<Suit, number> = { wan: 0, tong: 9, tiao: 18, zi: 27 };
    const ziIndex: Record<string, number> = {
      dong: 0, nan: 1, xi: 2, bei: 3, zhong: 4, fa: 5, bai: 6,
    };

    for (const tile of hand) {
      let idx: number;
      if (tile.suit === 'zi') {
        idx = 27 + ziIndex[String(tile.rank)];
      } else {
        const rank = typeof tile.rank === 'number' ? tile.rank : parseInt(tile.rank);
        idx = suitOffsets[tile.suit] + (rank - 1);
      }
      if (idx >= 0 && idx < 34) {
        counts[idx]++;
      }
    }

    return counts;
  }

  /**
   * 寻找最佳面子组合
   */
  private findBestGroups(counts: number[], start: number, target: number, found: number): number {
    if (found >= target) return found;

    let best = found;

    // 找到第一个有剩余的牌
    let i = start;
    while (i < 34 && counts[i] === 0) i++;

    if (i >= 34) return found;

    // 尝试刻子
    if (counts[i] >= 3) {
      counts[i] -= 3;
      best = Math.max(best, this.findBestGroups(counts, i, target, found + 1));
      counts[i] += 3;
    }

    // 尝试顺子（仅数牌）
    if (i < 27) {
      const suitStart = Math.floor(i / 9) * 9;
      const rank = i - suitStart;
      if (rank <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
        counts[i]--;
        counts[i + 1]--;
        counts[i + 2]--;
        best = Math.max(best, this.findBestGroups(counts, i, target, found + 1));
        counts[i]++;
        counts[i + 1]++;
        counts[i + 2]++;
      }
    }

    // 跳过这张牌
    counts[i]--;
    best = Math.max(best, this.findBestGroups(counts, i, target, found));
    counts[i]++;

    return best;
  }

  /**
   * 创建役种判定上下文
   */
  private createYakuContext(player: MahjongPlayer, isTsumo: boolean): import('./mahjong.types').YakuContext {
    return {
      isTsumo,
      isDealer: player.isDealer,
      isRiichi: player.isRiichi,
      roundWind: this.state.roundWind,
      seatWind: player.seatIndex,
      doraTiles: [...this.state.doraTiles],
      melds: [...player.melds],
      isFuriten: player.isFuriten,
    };
  }

  /**
   * 转移点数
   */
  private transferPoints(result: MahjongWinResult): void {
    const winner = this.state.players.find(p => p.playerId === result.playerId);
    if (!winner) return;

    winner.score += result.score;

    if (result.isTsumo) {
      // 自摸：其他三家支付
      for (const player of this.state.players) {
        if (player.playerId !== result.playerId) {
          player.score -= Math.floor(result.score / 3);
        }
      }
    } else {
      // 荣胡：放铳者支付
      const discarder = this.state.players[this.state.lastDiscardPlayer];
      if (discarder) {
        discarder.score -= result.score;
      }
    }
  }

  /**
   * 验证顺子
   */
  private isValidChow(tiles: Tile[]): boolean {
    if (tiles.length !== 3) return false;

    const sorted = TileUtils.sortHand(tiles);
    const first = sorted[0];

    // 必须同花色且为数字牌
    if (first.suit === 'zi') return false;
    if (!sorted.every(t => t.suit === first.suit)) return false;

    const ranks = sorted.map(t => typeof t.rank === 'number' ? t.rank : parseInt(t.rank));
    return ranks[1] === ranks[0] + 1 && ranks[2] === ranks[0] + 2;
  }

  /**
   * 验证碰
   */
  private isValidPong(tiles: Tile[]): boolean {
    if (tiles.length !== 3) return false;
    return tiles.every(t => TileUtils.equals(t, tiles[0]));
  }

  /**
   * 验证杠
   */
  private isValidKong(tiles: Tile[]): boolean {
    if (tiles.length !== 4) return false;
    return tiles.every(t => TileUtils.equals(t, tiles[0]));
  }
}
