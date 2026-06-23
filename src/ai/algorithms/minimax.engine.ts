import { Action, GameState } from '../../plugin/interfaces/game-controller.interface';

/**
 * 模拟执行动作后的游戏状态
 * 由游戏插件提供或通过配置注入
 */
export type StateSimulator = (state: GameState, action: Action, playerId: string) => GameState | null;

/**
 * 获取当前玩家可执行的合法动作
 */
export type LegalActionsProvider = (state: GameState, playerId: string) => Action[];

/**
 * 检查游戏是否结束
 */
export type TerminalChecker = (state: GameState) => { isTerminal: boolean; winner?: string };

export interface MinimaxEngineOptions {
  /** 最大搜索深度 */
  maxDepth: number;
  /** 评估函数: (state, playerId) => score */
  evaluateFn: (state: GameState, playerId: string) => number;
  /** 状态模拟器: 执行动作后返回新状态 */
  simulateFn: StateSimulator;
  /** 合法动作提供者 */
  getLegalActionsFn: LegalActionsProvider;
  /** 终止状态检查器 */
  isTerminalFn: TerminalChecker;
  /** 是否随机化相同分数的动作 */
  randomize?: boolean;
  /** 随机种子 */
  seed?: number;
  /** 是否启用杀手启发式优化 */
  killerHeuristic?: boolean;
  /** 杀手启发式表大小 */
  killerTableSize?: number;
  /** 超时检查函数（返回true时停止搜索） */
  timeoutCheck?: () => boolean;
}

/**
 * 杀手启发式条目 - 记录当前深度下导致剪枝的最佳动作
 */
interface KillerEntry {
  primary: Action | null;
  secondary: Action | null;
}

/**
 * Minimax + Alpha-Beta剪枝引擎
 * 
 * 支持以下优化技术：
 * 1. Alpha-Beta剪枝 - 减少搜索节点数
 * 2. 杀手启发式 - 优先尝试 historically good moves
 * 3. 随机化 - 在相同评分的动作中随机选择，增加可玩性
 * 4. 超时控制 - 支持外部中断搜索
 * 5. 迭代加深 - 从浅层到深层逐步搜索
 */
export class MinimaxEngine {
  private maxDepth: number;
  private evaluateFn: (state: GameState, playerId: string) => number;
  private simulateFn: StateSimulator;
  private getLegalActionsFn: LegalActionsProvider;
  private isTerminalFn: TerminalChecker;
  private randomize: boolean;
  private rng: () => number;
  private killerHeuristic: boolean;
  private killerTable: Map<number, KillerEntry>;
  private killerTableSize: number;
  private timeoutCheck?: () => boolean;
  
  // 统计信息
  private nodesEvaluated: number = 0;
  private cutoffs: number = 0;
  private killerHits: number = 0;

  constructor(options: MinimaxEngineOptions) {
    this.maxDepth = options.maxDepth;
    this.evaluateFn = options.evaluateFn;
    this.simulateFn = options.simulateFn;
    this.getLegalActionsFn = options.getLegalActionsFn;
    this.isTerminalFn = options.isTerminalFn;
    this.randomize = options.randomize ?? false;
    this.killerHeuristic = options.killerHeuristic ?? false;
    this.killerTableSize = options.killerTableSize ?? 100;
    this.killerTable = new Map();
    this.timeoutCheck = options.timeoutCheck;
    this.rng = options.seed !== undefined 
      ? this.createSeededRng(options.seed)
      : Math.random;
  }

  /**
   * 执行Minimax搜索，返回最佳动作
   * 
   * @param state 当前游戏状态
   * @param playerId 当前玩家ID
   * @param legalActions 合法动作列表（可选，如果提供会覆盖getLegalActionsFn）
   * @returns 最佳动作
   */
  search(state: GameState, playerId: string, legalActions?: Action[]): Action {
    const actions = legalActions || this.getLegalActionsFn(state, playerId);
    
    if (!actions || actions.length === 0) {
      throw new Error('MinimaxEngine: no legal actions available');
    }

    if (actions.length === 1) {
      return actions[0];
    }

    // 重置统计
    this.nodesEvaluated = 0;
    this.cutoffs = 0;
    this.killerHits = 0;
    this.killerTable.clear();

    // 使用迭代加深搜索
    let bestAction = actions[0];
    let bestScore = -Infinity;

    for (let depth = 1; depth <= this.maxDepth; depth++) {
      if (this.timeoutCheck && this.timeoutCheck()) {
        break;
      }

      const result = this.searchAtDepth(state, playerId, actions, depth);
      if (result.action) {
        bestAction = result.action;
        bestScore = result.score;
      }
    }

    return bestAction;
  }

  /**
   * 在指定深度搜索最佳动作
   */
  private searchAtDepth(
    state: GameState,
    playerId: string,
    actions: Action[],
    depth: number
  ): { action: Action | null; score: number } {
    let bestAction: Action | null = null;
    let bestScore = -Infinity;
    const scores: { action: Action; score: number }[] = [];

    for (const action of actions) {
      if (this.timeoutCheck && this.timeoutCheck()) {
        break;
      }

      const nextState = this.simulateFn(state, action, playerId);
      if (!nextState) continue;

      const score = this.minimax(
        nextState,
        depth - 1,
        -Infinity,
        Infinity,
        false,
        playerId,
        1
      );

      scores.push({ action, score });

      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }

    // 如果启用随机化，在接近最高分的动作中随机选择
    if (this.randomize && scores.length > 0) {
      const threshold = bestScore - Math.abs(bestScore) * 0.05 - 0.5;
      const candidates = scores.filter(s => s.score >= threshold);
      if (candidates.length > 1) {
        const idx = Math.floor(this.rng() * candidates.length);
        return { action: candidates[idx].action, score: candidates[idx].score };
      }
    }

    return { action: bestAction, score: bestScore };
  }

  /**
   * Minimax核心算法 + Alpha-Beta剪枝
   * 
   * @param state 当前状态
   * @param depth 剩余搜索深度
   * @param alpha 当前最佳最大值
   * @param beta 当前最佳最小值
   * @param isMaximizing 是否为最大化玩家
   * @param originalPlayerId 原始玩家ID（用于评估函数）
   * @param currentDepth 当前实际深度（用于杀手启发式）
   * @returns 该状态的评分
   */
  private minimax(
    state: GameState,
    depth: number,
    alpha: number,
    beta: number,
    isMaximizing: boolean,
    originalPlayerId: string,
    currentDepth: number
  ): number {
    this.nodesEvaluated++;

    // 超时检查
    if (this.timeoutCheck && this.timeoutCheck()) {
      return this.evaluateFn(state, originalPlayerId);
    }

    // 检查终止状态
    const terminal = this.isTerminalFn(state);
    if (terminal.isTerminal) {
      if (terminal.winner === originalPlayerId) {
        return 10000 + depth; // 获胜，加上depth偏好更快赢
      } else if (terminal.winner) {
        return -10000 - depth; // 失败
      }
      return 0; // 平局
    }

    // 达到最大深度，使用评估函数
    if (depth <= 0) {
      return this.evaluateFn(state, originalPlayerId);
    }

    const currentPlayer = state.currentPlayer || originalPlayerId;
    const actions = this.getLegalActionsFn(state, currentPlayer);

    if (!actions || actions.length === 0) {
      return this.evaluateFn(state, originalPlayerId);
    }

    // 动作排序优化：杀手启发式
    const orderedActions = this.orderActions(actions, currentDepth);

    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const action of orderedActions) {
        const nextState = this.simulateFn(state, action, currentPlayer);
        if (!nextState) continue;

        const evalScore = this.minimax(
          nextState, depth - 1, alpha, beta, false, originalPlayerId, currentDepth + 1
        );
        maxEval = Math.max(maxEval, evalScore);

        // Alpha-Beta剪枝
        if (evalScore > beta) {
          this.cutoffs++;
          this.updateKillerTable(currentDepth, action);
          return evalScore; // 剪枝
        }
        alpha = Math.max(alpha, evalScore);
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const action of orderedActions) {
        const nextState = this.simulateFn(state, action, currentPlayer);
        if (!nextState) continue;

        const evalScore = this.minimax(
          nextState, depth - 1, alpha, beta, true, originalPlayerId, currentDepth + 1
        );
        minEval = Math.min(minEval, evalScore);

        // Alpha-Beta剪枝
        if (evalScore < alpha) {
          this.cutoffs++;
          this.updateKillerTable(currentDepth, action);
          return evalScore; // 剪枝
        }
        beta = Math.min(beta, evalScore);
      }
      return minEval;
    }
  }

  /**
   * 动作排序 - 使用杀手启发式优先尝试historically good moves
   * 
   * 排序优先级：
   * 1. 杀手动作（当前深度下之前导致剪枝的动作）
   * 2. 其他动作（保持原顺序）
   */
  private orderActions(actions: Action[], depth: number): Action[] {
    if (!this.killerHeuristic) {
      return actions;
    }

    const entry = this.killerTable.get(depth % this.killerTableSize);
    if (!entry) {
      return actions;
    }

    return [...actions].sort((a, b) => {
      const aIsKiller = this.isSameAction(a, entry.primary) || this.isSameAction(a, entry.secondary);
      const bIsKiller = this.isSameAction(b, entry.primary) || this.isSameAction(b, entry.secondary);
      
      if (aIsKiller && !bIsKiller) {
        this.killerHits++;
        return -1;
      }
      if (!aIsKiller && bIsKiller) {
        return 1;
      }
      return 0;
    });
  }

  /**
   * 更新杀手表
   */
  private updateKillerTable(depth: number, action: Action): void {
    const key = depth % this.killerTableSize;
    const entry = this.killerTable.get(key) || { primary: null, secondary: null };
    
    if (!this.isSameAction(action, entry.primary)) {
      entry.secondary = entry.primary;
      entry.primary = action;
      this.killerTable.set(key, entry);
    }
  }

  /**
   * 判断两个动作是否相同（用于杀手启发式比较）
   */
  private isSameAction(a: Action | null, b: Action | null): boolean {
    if (!a || !b) return false;
    return a.type === b.type && a.playerId === b.playerId &&
      JSON.stringify(a.data) === JSON.stringify(b.data);
  }

  /**
   * 获取搜索统计信息
   */
  getStats(): { nodesEvaluated: number; cutoffs: number; killerHits: number } {
    return {
      nodesEvaluated: this.nodesEvaluated,
      cutoffs: this.cutoffs,
      killerHits: this.killerHits,
    };
  }

  /**
   * 创建伪随机数生成器
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
