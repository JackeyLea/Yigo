import { Injectable, Logger } from '@nestjs/common';

/**
 * ELO Rating Service - ELO评分计算服务
 *
 * 实现标准ELO评分系统：
 * - 预期胜率: E(A) = 1 / (1 + 10^((R_B - R_A)/400))
 * - 新评分: R'_A = R_A + K * (S_A - E(A))
 * - K因子动态调整: 前30局K=40, 30-100局K=20, 100+局K=10
 * - 支持多人游戏评分更新
 */
@Injectable()
export class EloService {
  private readonly logger = new Logger(EloService.name);

  // K因子分段配置
  private readonly K_FACTOR_NEWBIE = 40;   // 新手期（<=30局）
  private readonly K_FACTOR_INTERMEDIATE = 20; // 中级期（31-100局）
  private readonly K_FACTOR_EXPERT = 10;   // 高手期（100+局）

  private readonly K_THRESHOLD_LOW = 30;
  private readonly K_THRESHOLD_HIGH = 100;

  // 多人游戏得分映射
  private readonly MULTIPLAYER_SCORE_STEP = 0.5;

  /**
   * 计算预期胜率
   * E(A) = 1 / (1 + 10^((R_B - R_A)/400))
   * @param ratingA 玩家A的当前评分
   * @param ratingB 玩家B的当前评分
   * @returns 玩家A的预期胜率（0-1之间）
   */
  calculateExpectedScore(ratingA: number, ratingB: number): number {
    const exponent = (ratingB - ratingA) / 400;
    return 1 / (1 + Math.pow(10, exponent));
  }

  /**
   * 更新单个玩家ELO评分
   * R'_A = R_A + K * (S_A - E(A))
   * @param currentRating 当前评分
   * @param expectedScore 预期胜率
   * @param actualScore 实际得分（0=输, 0.5=平, 1=赢）
   * @param kFactor K因子（可选，默认自动计算）
   * @returns 更新后的评分
   */
  updateRating(
    currentRating: number,
    expectedScore: number,
    actualScore: number,
    kFactor?: number,
  ): number {
    const k = kFactor ?? this.K_FACTOR_INTERMEDIATE;
    const ratingChange = k * (actualScore - expectedScore);
    const newRating = Math.round(currentRating + ratingChange);

    // 评分下限100，防止负分
    return Math.max(100, newRating);
  }

  /**
   * 根据对局数获取K因子
   * - 前30局: K=40（新手快速定段）
   * - 31-100局: K=20（稳定发展期）
   * - 100+局: K=10（高手微调期）
   * @param gamesPlayed 已完成的对局数
   * @returns K因子值
   */
  getKFactor(gamesPlayed: number): number {
    if (gamesPlayed <= this.K_THRESHOLD_LOW) {
      return this.K_FACTOR_NEWBIE;
    }
    if (gamesPlayed <= this.K_THRESHOLD_HIGH) {
      return this.K_FACTOR_INTERMEDIATE;
    }
    return this.K_FACTOR_EXPERT;
  }

  /**
   * 计算多人游戏中每个排名的实际得分
   * 第1名=1.0, 第2名=0.5, 第3名=0.0, ... 依次递减
   * 最后一名固定为0.0
   * @param rank 排名（1-based）
   * @param totalPlayers 总人数
   * @returns 实际得分
   */
  calculateMultiplayerActualScore(rank: number, totalPlayers: number): number {
    if (rank < 1 || rank > totalPlayers) {
      throw new Error(`Invalid rank: ${rank}, totalPlayers: ${totalPlayers}`);
    }
    if (totalPlayers === 1) {
      return 1.0;
    }
    // 第1名=1.0，最后一名=0.0，中间线性递减
    const score = 1 - ((rank - 1) / (totalPlayers - 1)) * this.MULTIPLAYER_SCORE_STEP * 2;
    return Math.max(0, Math.min(1, score));
  }

  /**
   * 多人游戏ELO更新
   * 为每个玩家计算与其余所有玩家的预期得分和实际得分，综合更新评分
   * @param ratings 所有玩家的当前评分数组
   * @param rankings 所有玩家的排名数组（1-based，与ratings对应）
   * @param gamesPlayed 每个玩家的对局数数组（用于确定K因子）
   * @returns 更新后的评分数组
   */
  updateRatingsMultiplayer(
    ratings: number[],
    rankings: number[],
    gamesPlayed?: number[],
  ): number[] {
    const n = ratings.length;

    if (n !== rankings.length) {
      throw new Error('ratings and rankings must have the same length');
    }
    if (n < 2) {
      throw new Error(' multiplayer rating update requires at least 2 players');
    }

    const newRatings: number[] = new Array(n);

    for (let i = 0; i < n; i++) {
      // 计算玩家i对每个其他玩家的预期得分
      let totalExpectedScore = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          totalExpectedScore += this.calculateExpectedScore(ratings[i], ratings[j]);
        }
      }
      // 平均预期得分
      const avgExpectedScore = totalExpectedScore / (n - 1);

      // 计算实际得分（基于排名）
      const actualScore = this.calculateMultiplayerActualScore(rankings[i], n);

      // 确定K因子
      const k = gamesPlayed ? this.getKFactor(gamesPlayed[i]) : this.K_FACTOR_INTERMEDIATE;

      // 更新评分
      newRatings[i] = this.updateRating(ratings[i], avgExpectedScore, actualScore, k);

      this.logger.debug(
        `Player ${i}: rating ${ratings[i]} -> ${newRatings[i]}, ` +
        `expected=${avgExpectedScore.toFixed(3)}, actual=${actualScore.toFixed(3)}, k=${k}`,
      );
    }

    return newRatings;
  }

  /**
   * 双人游戏ELO更新快捷方法
   * @param ratingA 玩家A当前评分
   * @param ratingB 玩家B当前评分
   * @param scoreA 玩家A实际得分（0=输, 0.5=平, 1=赢）
   * @param gamesPlayedA 玩家A对局数
   * @param gamesPlayedB 玩家B对局数
   * @returns [玩家A新评分, 玩家B新评分]
   */
  updateRatingsDuel(
    ratingA: number,
    ratingB: number,
    scoreA: number,
    gamesPlayedA: number = 50,
    gamesPlayedB: number = 50,
  ): [number, number] {
    const expectedA = this.calculateExpectedScore(ratingA, ratingB);
    const expectedB = this.calculateExpectedScore(ratingB, ratingA);
    const scoreB = 1 - scoreA;

    const kA = this.getKFactor(gamesPlayedA);
    const kB = this.getKFactor(gamesPlayedB);

    const newRatingA = this.updateRating(ratingA, expectedA, scoreA, kA);
    const newRatingB = this.updateRating(ratingB, expectedB, scoreB, kB);

    return [newRatingA, newRatingB];
  }
}
