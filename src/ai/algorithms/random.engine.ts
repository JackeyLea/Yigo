import { Action, GameState } from '../../plugin/interfaces/game-controller.interface';

export interface RandomEngineOptions {
  /** 是否启用加权随机（根据简单启发式评分） */
  weighted?: boolean;
  /** 评估函数，用于加权随机时给每个动作评分 */
  evaluateFn?: (state: GameState, action: Action, playerId: string) => number;
  /** 温度参数，控制随机性程度（越高越随机，0表示总是选最高分） */
  temperature?: number;
  /** 随机种子，用于可复现性 */
  seed?: number;
}

/**
 * 随机引擎 - 用于简单难度的AI
 * 
 * 特性：
 * 1. 纯随机选择：从合法操作中均匀随机选择
 * 2. 加权随机：根据简单启发式评分给好动作更高权重
 * 3. 支持种子以实现可复现的结果
 * 4. 零依赖，高性能
 */
export class RandomEngine {
  private weighted: boolean;
  private evaluateFn?: (state: GameState, action: Action, playerId: string) => number;
  private temperature: number;
  private rng: () => number;
  private seeded: boolean;

  constructor(options: RandomEngineOptions = {}) {
    this.weighted = options.weighted ?? false;
    this.evaluateFn = options.evaluateFn;
    this.temperature = Math.max(0, options.temperature ?? 1.0);
    this.seeded = options.seed !== undefined;
    this.rng = options.seed !== undefined 
      ? this.createSeededRng(options.seed!)
      : Math.random;
  }

  /**
   * 从合法动作中随机选择一个
   * @param state 当前游戏状态
   * @param playerId 当前玩家ID
   * @param legalActions 合法动作列表
   * @returns 选择的动作
   */
  search(state: GameState, playerId: string, legalActions: Action[]): Action {
    if (!legalActions || legalActions.length === 0) {
      throw new Error('RandomEngine: no legal actions available');
    }

    if (legalActions.length === 1) {
      return legalActions[0];
    }

    if (this.weighted && this.evaluateFn) {
      return this.weightedRandom(state, playerId, legalActions);
    }

    return this.uniformRandom(legalActions);
  }

  /**
   * 均匀随机选择
   */
  private uniformRandom(actions: Action[]): Action {
    const index = Math.floor(this.rng() * actions.length);
    return actions[index];
  }

  /**
   * 加权随机选择 - 根据启发式评分给予好动作更高概率
   * 
   * 使用softmax函数将评分转换为概率分布：
   * P(a_i) = exp(score_i / T) / sum(exp(score_j / T))
   * 
   * T为温度参数，T越高分布越均匀（越随机），T越低越偏向高分动作
   */
  private weightedRandom(state: GameState, playerId: string, actions: Action[]): Action {
    const scores = actions.map(action => {
      try {
        return this.evaluateFn!(state, action, playerId);
      } catch {
        return 0;
      }
    });

    // 如果温度接近0，直接选最高分
    if (this.temperature < 0.001) {
      let bestIndex = 0;
      let bestScore = scores[0];
      for (let i = 1; i < scores.length; i++) {
        if (scores[i] > bestScore) {
          bestScore = scores[i];
          bestIndex = i;
        }
      }
      return actions[bestIndex];
    }

    // Softmax转换
    const maxScore = Math.max(...scores);
    const exps = scores.map(s => Math.exp((s - maxScore) / this.temperature));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map(e => e / sumExps);

    // 累积概率采样
    const rand = this.rng();
    let cumulative = 0;
    for (let i = 0; i < probs.length; i++) {
      cumulative += probs[i];
      if (rand <= cumulative) {
        return actions[i];
      }
    }

    // 兜底返回最后一个
    return actions[actions.length - 1];
  }

  /**
   * 获取引擎配置信息
   */
  getConfig(): { weighted: boolean; temperature: number; seeded: boolean } {
    return {
      weighted: this.weighted,
      temperature: this.temperature,
      seeded: this.seeded,
    };
  }

  /**
   * 创建伪随机数生成器（xorshift算法，速度快，质量足够）
   */
  private createSeededRng(seed: number): () => number {
    let x = seed || 123456789;
    let y = 362436069;
    let z = 521288629;
    let w = 88675123;

    return () => {
      const t = x ^ (x << 11);
      x = y;
      y = z;
      z = w;
      w = w ^ (w >>> 19) ^ (t ^ (t >>> 8));
      return (w >>> 0) / 4294967296;
    };
  }
}
