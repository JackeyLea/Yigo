/**
 * ELO Rating Calculator - ELO评分计算器
 *
 * 从 match 模块复用并封装 ELO 评分系统：
 * - 预期胜率: E(A) = 1 / (1 + 10^((R_B - R_A)/400))
 * - 新评分: R'_A = R_A + K * (S_A - E(A))
 * - K因子动态调整: 前30局K=40, 30-100局K=20, 100+局K=10
 * - 支持单对单和多人游戏评分更新
 */
import { Injectable, Logger } from '@nestjs/common';

/**
 * 玩家评分结果
 */
export interface RatingUpdateResult {
  userId: number;
  oldRating: number;
  newRating: number;
  ratingChange: number;
  kFactor: number;
  expectedScore: number;
  actualScore: number;
}

/**
 * 赛季配置
 */
export interface SeasonConfig {
  seasonId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
}

@Injectable()
export class EloCalculator {
  private readonly logger = new Logger(EloCalculator.name);

  // K因子分段配置
  private readonly K_FACTOR_NEWBIE = 40; // 新手期（<=30局）
  private readonly K_FACTOR_INTERMEDIATE = 20; // 中级期（31-100局）
  private readonly K_FACTOR_EXPERT = 10; // 高手期（100+局）

  private readonly K_THRESHOLD_LOW = 30;
  private readonly K_THRESHOLD_HIGH = 100;

  // 多人游戏得分映射
  private readonly MULTIPLAYER_SCORE_STEP = 0.5;

  // 评分下限
  private readonly RATING_FLOOR = 100;

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
    const score =
      1 - ((rank - 1) / (totalPlayers - 1)) * this.MULTIPLAYER_SCORE_STEP * 2;
    return Math.max(0, Math.min(1, score));
  }

  /**
   * 更新单个玩家ELO评分（内部方法）
   * R'_A = R_A + K * (S_A - E(A))
   */
  private updateSingleRating(
    currentRating: number,
    expectedScore: number,
    actualScore: number,
    kFactor: number,
  ): { newRating: number; ratingChange: number } {
    const ratingChange = kFactor * (actualScore - expectedScore);
    const newRating = Math.round(currentRating + ratingChange);

    // 评分下限保护，防止负分
    return {
      newRating: Math.max(this.RATING_FLOOR, newRating),
      ratingChange: Math.round(ratingChange * 100) / 100,
    };
  }

  /**
   * 双人游戏ELO更新
   * @param playerA 玩家A信息
   * @param playerB 玩家B信息
   * @returns 两个玩家的评分更新结果
   */
  calculateDuelRating(
    playerA: {
      userId: number;
      rating: number;
      gamesPlayed: number;
      score: number; // 1=win, 0.5=draw, 0=loss
    },
    playerB: {
      userId: number;
      rating: number;
      gamesPlayed: number;
      score: number;
    },
  ): [RatingUpdateResult, RatingUpdateResult] {
    const expectedA = this.calculateExpectedScore(playerA.rating, playerB.rating);
    const expectedB = this.calculateExpectedScore(playerB.rating, playerA.rating);

    const kA = this.getKFactor(playerA.gamesPlayed);
    const kB = this.getKFactor(playerB.gamesPlayed);

    const resultA = this.updateSingleRating(
      playerA.rating,
      expectedA,
      playerA.score,
      kA,
    );
    const resultB = this.updateSingleRating(
      playerB.rating,
      expectedB,
      playerB.score,
      kB,
    );

    const updateA: RatingUpdateResult = {
      userId: playerA.userId,
      oldRating: playerA.rating,
      newRating: resultA.newRating,
      ratingChange: resultA.ratingChange,
      kFactor: kA,
      expectedScore: Math.round(expectedA * 1000) / 1000,
      actualScore: playerA.score,
    };

    const updateB: RatingUpdateResult = {
      userId: playerB.userId,
      oldRating: playerB.rating,
      newRating: resultB.newRating,
      ratingChange: resultB.ratingChange,
      kFactor: kB,
      expectedScore: Math.round(expectedB * 1000) / 1000,
      actualScore: playerB.score,
    };

    this.logger.debug(
      `Duel ELO: A(${playerA.userId}) ${playerA.rating}->${updateA.newRating} ` +
        `B(${playerB.userId}) ${playerB.rating}->${updateB.newRating}`,
    );

    return [updateA, updateB];
  }

  /**
   * 多人游戏ELO更新
   * 为每个玩家计算与其余所有玩家的预期得分和实际得分，综合更新评分
   * @param players 所有玩家信息数组
   * @returns 所有玩家的评分更新结果
   */
  calculateMultiplayerRating(
    players: {
      userId: number;
      rating: number;
      gamesPlayed: number;
      rank: number; // 1-based排名
    }[],
  ): RatingUpdateResult[] {
    const n = players.length;

    if (n < 2) {
      throw new Error('Multiplayer rating update requires at least 2 players');
    }

    const results: RatingUpdateResult[] = [];

    for (let i = 0; i < n; i++) {
      const player = players[i];

      // 计算玩家i对每个其他玩家的预期得分
      let totalExpectedScore = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          totalExpectedScore += this.calculateExpectedScore(
            player.rating,
            players[j].rating,
          );
        }
      }
      // 平均预期得分
      const avgExpectedScore = totalExpectedScore / (n - 1);

      // 计算实际得分（基于排名）
      const actualScore = this.calculateMultiplayerActualScore(player.rank, n);

      // 确定K因子
      const k = this.getKFactor(player.gamesPlayed);

      // 更新评分
      const ratingResult = this.updateSingleRating(
        player.rating,
        avgExpectedScore,
        actualScore,
        k,
      );

      const result: RatingUpdateResult = {
        userId: player.userId,
        oldRating: player.rating,
        newRating: ratingResult.newRating,
        ratingChange: ratingResult.ratingChange,
        kFactor: k,
        expectedScore: Math.round(avgExpectedScore * 1000) / 1000,
        actualScore,
      };

      results.push(result);

      this.logger.debug(
        `Multiplayer ELO: ${player.userId} ${player.rating}->${result.newRating} ` +
          `rank=${player.rank}, expected=${avgExpectedScore.toFixed(3)}, ` +
          `actual=${actualScore.toFixed(3)}, k=${k}`,
      );
    }

    return results;
  }

  /**
   * 通用评分更新入口
   * 根据玩家数量自动选择双人或多人计算模式
   */
  calculateRatingUpdates(
    players: {
      userId: number;
      rating: number;
      gamesPlayed: number;
      rank?: number; // 多人模式需要
      score?: number; // 双人模式需要
    }[],
  ): RatingUpdateResult[] {
    if (players.length === 2) {
      // 双人模式
      const [playerA, playerB] = players;
      const [resultA, resultB] = this.calculateDuelRating(
        {
          userId: playerA.userId,
          rating: playerA.rating,
          gamesPlayed: playerA.gamesPlayed,
          score: playerA.score ?? (playerA.rank === 1 ? 1 : 0),
        },
        {
          userId: playerB.userId,
          rating: playerB.rating,
          gamesPlayed: playerB.gamesPlayed,
          score: playerB.score ?? (playerB.rank === 1 ? 1 : 0),
        },
      );
      return [resultA, resultB];
    } else if (players.length > 2) {
      // 多人模式
      const multiplayerPlayers = players.map((p) => ({
        userId: p.userId,
        rating: p.rating,
        gamesPlayed: p.gamesPlayed,
        rank: p.rank ?? (p.score === 1 ? 1 : p.score === 0 ? players.length : Math.ceil(players.length / 2)),
      }));
      return this.calculateMultiplayerRating(multiplayerPlayers);
    } else {
      throw new Error('At least 2 players are required for rating update');
    }
  }
}
