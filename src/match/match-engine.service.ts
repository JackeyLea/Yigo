import { Injectable, Logger } from '@nestjs/common';

/**
 * 排队玩家信息
 */
export interface QueuedPlayer {
  userId: number;
  ticketId: string;
  rating: number;
  joinTime: number; // 加入时间戳（毫秒）
  criteria: MatchCriteria;
  pluginId: string;
}

/**
 * 匹配条件
 */
export interface MatchCriteria {
  ratingRange?: number;
  maxWaitTime?: number;
  allowAI?: boolean;
  aiDifficulty?: string;
  mode?: string;
  minPlayers?: number;
  maxPlayers?: number;
}

/**
 * 匹配的玩家信息
 */
export interface MatchedPlayer {
  userId: number;
  ticketId: string;
  rating: number;
  isAI?: boolean;
  aiDifficulty?: string;
}

/**
 * 匹配分组结果
 */
export interface MatchedGroup {
  players: MatchedPlayer[];
  matchScore: number;
  pluginId: string;
  mode: string;
}

/**
 * MatchEngineService - 匹配引擎（算法核心）
 *
 * 实现基于ELO评分的贪心匹配算法：
 * 1. 按ELO评分排序玩家队列
 * 2. 为每个玩家计算动态评分范围（基础范围 × (1 + 等待时间/60秒)）
 * 3. 使用贪心算法将玩家分组
 * 4. 匹配分数 = ELO差 × 权重1 + 等待时间差 × 权重2
 * 5. 选择匹配分数最低的合法分组
 */
@Injectable()
export class MatchEngineService {
  private readonly logger = new Logger(MatchEngineService.name);

  // 匹配分数权重
  private readonly WEIGHT_RATING_DIFF = 1.0;     // ELO评分差异权重
  private readonly WEIGHT_WAIT_TIME_DIFF = 0.01; // 等待时间差异权重（转换为秒）
  private readonly WEIGHT_WAIT_TIME_BONUS = -0.1; // 等待时间长的奖励（负数表示鼓励匹配等待久的）

  // 动态范围扩展参数
  private readonly RANGE_EXPANSION_RATE = 1.0; // 每秒扩展速率

  /**
   * 计算ELO评分差
   * @param ratingA 玩家A评分
   * @param ratingB 玩家B评分
   * @returns 评分差绝对值
   */
  calculateRatingDiff(ratingA: number, ratingB: number): number {
    return Math.abs(ratingA - ratingB);
  }

  /**
   * 计算动态评分范围
   * 等待时间越长，允许的评分范围越大
   * @param baseRange 基础评分范围
   * @param waitTime 等待时间（毫秒）
   * @returns 动态评分范围
   */
  calculateDynamicRatingRange(baseRange: number, waitTime: number): number {
    const waitSeconds = waitTime / 1000;
    // 基础范围 × (1 + 等待秒数/60)
    const dynamicRange = baseRange * (1 + waitSeconds / 60 * this.RANGE_EXPANSION_RATE);
    // 最大不超过基础范围的5倍
    return Math.min(dynamicRange, baseRange * 5);
  }

  /**
   * 计算两个玩家的匹配分数（越低表示越匹配）
   * @param playerA 玩家A
   * @param playerB 玩家B
   * @returns 匹配分数
   */
  calculateMatchScore(playerA: QueuedPlayer, playerB: QueuedPlayer): number {
    const ratingDiff = this.calculateRatingDiff(playerA.rating, playerB.rating);
    const waitTimeDiff = Math.abs(playerA.joinTime - playerB.joinTime) / 1000; // 转换为秒

    // 计算平均等待时间（用于奖励等待时间长的玩家）
    const now = Date.now();
    const avgWaitTime = (now - playerA.joinTime + now - playerB.joinTime) / 2 / 1000;

    const score =
      this.WEIGHT_RATING_DIFF * ratingDiff +
      this.WEIGHT_WAIT_TIME_DIFF * waitTimeDiff +
      this.WEIGHT_WAIT_TIME_BONUS * avgWaitTime;

    return Math.max(0, score); // 分数不低于0
  }

  /**
   * 检查两个玩家是否可以匹配
   * @param playerA 玩家A
   * @param playerB 玩家B
   * @returns 是否可以匹配
   */
  canMatch(playerA: QueuedPlayer, playerB: QueuedPlayer): boolean {
    // 检查是否是同一个玩家
    if (playerA.userId === playerB.userId) {
      return false;
    }

    // 检查是否同一游戏插件
    if (playerA.pluginId !== playerB.pluginId) {
      return false;
    }

    // 检查游戏模式是否兼容
    const modeA = playerA.criteria.mode || 'normal';
    const modeB = playerB.criteria.mode || 'normal';
    if (modeA !== modeB) {
      return false;
    }

    const now = Date.now();
    const waitTimeA = now - playerA.joinTime;
    const waitTimeB = now - playerB.joinTime;

    // 计算动态评分范围
    const baseRangeA = playerA.criteria.ratingRange || 200;
    const baseRangeB = playerB.criteria.ratingRange || 200;
    const dynamicRangeA = this.calculateDynamicRatingRange(baseRangeA, waitTimeA);
    const dynamicRangeB = this.calculateDynamicRatingRange(baseRangeB, waitTimeB);

    // 取较小的范围作为匹配标准（更严格）
    const effectiveRange = Math.min(dynamicRangeA, dynamicRangeB);

    // 检查ELO评分差是否在允许范围内
    const ratingDiff = this.calculateRatingDiff(playerA.rating, playerB.rating);
    if (ratingDiff > effectiveRange) {
      return false;
    }

    return true;
  }

  /**
   * 为指定玩家寻找最佳匹配对象
   * @param player 目标玩家
   * @param candidates 候选玩家列表
   * @returns 最佳匹配的玩家，如果没有找到则返回null
   */
  findBestMatch(player: QueuedPlayer, candidates: QueuedPlayer[]): QueuedPlayer | null {
    let bestMatch: QueuedPlayer | null = null;
    let bestScore = Infinity;

    for (const candidate of candidates) {
      if (!this.canMatch(player, candidate)) {
        continue;
      }

      const score = this.calculateMatchScore(player, candidate);
      if (score < bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }

    return bestMatch;
  }

  /**
   * 贪心匹配算法
   * 将玩家列表按ELO排序，然后贪心地将最匹配的玩家分组
   * @param players 排队玩家列表
   * @param groupSize 每组需要的玩家数（默认2）
   * @returns 匹配分组列表
   */
  greedyMatch(players: QueuedPlayer[], groupSize: number = 2): MatchedGroup[] {
    if (players.length < groupSize) {
      return [];
    }

    const groups: MatchedGroup[] = [];
    const matched = new Set<string>(); // 已匹配的玩家ticketId集合

    // 按ELO评分排序（升序）
    const sortedPlayers = [...players].sort((a, b) => a.rating - b.rating);

    for (const player of sortedPlayers) {
      if (matched.has(player.ticketId)) {
        continue;
      }

      const group: QueuedPlayer[] = [player];
      const candidates = sortedPlayers.filter(
        (p) => !matched.has(p.ticketId) && p.ticketId !== player.ticketId,
      );

      // 贪心选择最匹配的候选玩家
      while (group.length < groupSize && candidates.length > 0) {
        let bestCandidate: QueuedPlayer | null = null;
        let bestScore = Infinity;
        let bestIndex = -1;

        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];

          // 检查候选是否与组内所有玩家兼容
          const isCompatible = group.every((g) => this.canMatch(g, candidate));
          if (!isCompatible) {
            continue;
          }

          // 计算候选与组内所有玩家的平均匹配分数
          let totalScore = 0;
          for (const g of group) {
            totalScore += this.calculateMatchScore(g, candidate);
          }
          const avgScore = totalScore / group.length;

          if (avgScore < bestScore) {
            bestScore = avgScore;
            bestCandidate = candidate;
            bestIndex = i;
          }
        }

        if (bestCandidate) {
          group.push(bestCandidate);
          matched.add(bestCandidate.ticketId);
          candidates.splice(bestIndex, 1);
        } else {
          break; // 找不到更多兼容的玩家
        }
      }

      // 如果组满员，创建匹配分组
      if (group.length === groupSize) {
        matched.add(player.ticketId);

        const totalMatchScore = this.calculateGroupMatchScore(group);
        const mode = player.criteria.mode || 'normal';

        groups.push({
          players: group.map((p) => ({
            userId: p.userId,
            ticketId: p.ticketId,
            rating: p.rating,
            isAI: false,
          })),
          matchScore: totalMatchScore,
          pluginId: player.pluginId,
          mode,
        });

        this.logger.debug(
          `Matched group: ${group.map((p) => `${p.userId}(ELO:${p.rating})`).join(', ')} ` +
          `score=${totalMatchScore.toFixed(2)}`,
        );
      }
    }

    return groups;
  }

  /**
   * 创建AI玩家填充
   * @param targetRating 目标评分（AI评分会接近此值）
   * @param ticketIdPrefix 票号前缀
   * @param aiDifficulty AI难度
   * @param count 需要创建的AI数量
   * @returns AI玩家数组
   */
  createAIPlayers(
    targetRating: number,
    ticketIdPrefix: string,
    aiDifficulty: string = 'medium',
    count: number = 1,
  ): MatchedPlayer[] {
    const aiPlayers: MatchedPlayer[] = [];

    for (let i = 0; i < count; i++) {
      // AI评分在目标评分 ± 50 范围内随机
      const ratingVariation = Math.floor(Math.random() * 100) - 50;
      aiPlayers.push({
        userId: -(i + 1), // AI使用负数userId
        ticketId: `${ticketIdPrefix}:ai:${i}:${Date.now()}`,
        rating: targetRating + ratingVariation,
        isAI: true,
        aiDifficulty,
      });
    }

    return aiPlayers;
  }

  /**
   * 计算组内匹配分数
   * @param group 玩家组
   * @returns 平均匹配分数
   */
  private calculateGroupMatchScore(group: QueuedPlayer[]): number {
    if (group.length < 2) {
      return Infinity;
    }

    let totalScore = 0;
    let pairCount = 0;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        totalScore += this.calculateMatchScore(group[i], group[j]);
        pairCount++;
      }
    }

    return pairCount > 0 ? totalScore / pairCount : Infinity;
  }

  /**
   * 获取推荐的组大小
   * @param criteria 匹配条件
   * @returns 推荐的每组玩家数
   */
  getRecommendedGroupSize(criteria: MatchCriteria): number {
    if (criteria.minPlayers && criteria.maxPlayers) {
      // 取中间值
      return Math.floor((criteria.minPlayers + criteria.maxPlayers) / 2);
    }
    if (criteria.maxPlayers) {
      return criteria.maxPlayers;
    }
    if (criteria.minPlayers) {
      return criteria.minPlayers;
    }
    return 2; // 默认2人
  }
}
