import { Action, GameState } from '../../plugin/interfaces/game-controller.interface';

/**
 * 模拟执行动作后的游戏状态
 */
export type MctsStateSimulator = (state: GameState, action: Action, playerId: string) => GameState | null;

/**
 * 获取当前玩家可执行的合法动作
 */
export type MctsLegalActionsProvider = (state: GameState, playerId: string) => Action[];

/**
 * 检查游戏是否结束，返回游戏结果
 */
export type MctsTerminalChecker = (state: GameState) => { isTerminal: boolean; winner?: string };

/**
 * 从合法动作中随机选择一个（用于模拟阶段的随机 rollout）
 */
export type MctsRandomPolicy = (state: GameState, legalActions: Action[]) => Action;

/**
 * MCTS树节点
 */
export class MCTSNode {
  state: GameState;
  action: Action | null;        // 到达该节点的动作
  parent: MCTSNode | null;
  children: MCTSNode[];
  visits: number;
  wins: number;                 // 从当前玩家视角的累计收益
  playerId: string;             // 该节点对应的玩家
  untriedActions: Action[];     // 尚未扩展的动作
  isTerminal: boolean;

  constructor(
    state: GameState,
    action: Action | null,
    parent: MCTSNode | null,
    playerId: string,
    legalActions: Action[],
    isTerminal: boolean
  ) {
    this.state = state;
    this.action = action;
    this.parent = parent;
    this.children = [];
    this.visits = 0;
    this.wins = 0;
    this.playerId = playerId;
    this.untriedActions = [...legalActions];
    this.isTerminal = isTerminal;
  }

  /**
   * 是否完全扩展（所有动作都已尝试）
   */
  isFullyExpanded(): boolean {
    return this.untriedActions.length === 0;
  }

  /**
   * UCT评分 - Upper Confidence Bound for Trees
   * 
   * UCT = w/n + c * sqrt(ln(N) / n)
   * 
   * 其中：
   * - w/n = 胜率（利用）
   * - c * sqrt(ln(N) / n) = 探索项
   * - c = 探索常数
   * - N = 父节点访问次数
   * - n = 当前节点访问次数
   */
  uctScore(explorationConstant: number): number {
    if (this.visits === 0) {
      return Infinity; // 未访问的节点优先探索
    }

    const exploitation = this.wins / this.visits;
    const parentVisits = this.parent ? this.parent.visits : 1;
    const exploration = explorationConstant * Math.sqrt(Math.log(parentVisits) / this.visits);

    return exploitation + exploration;
  }

  /**
   * 获取最佳子节点（根据访问次数）
   */
  bestChild(): MCTSNode | null {
    if (this.children.length === 0) return null;
    
    let best = this.children[0];
    for (const child of this.children) {
      if (child.visits > best.visits) {
        best = child;
      }
    }
    return best;
  }
}

export interface MctsEngineOptions {
  /** 最大迭代次数 */
  maxIterations: number;
  /** UCT探索常数，默认 sqrt(2) */
  explorationConstant?: number;
  /** 并行模拟数 */
  parallelSims?: number;
  /** 超时时间(ms) */
  timeoutMs?: number;
  /** 状态模拟函数 */
  simulateFn: MctsStateSimulator;
  /** 合法动作提供者 */
  getLegalActionsFn: MctsLegalActionsProvider;
  /** 终止状态检查器 */
  isTerminalFn: MctsTerminalChecker;
  /** 随机策略（用于rollout） */
  randomPolicy?: MctsRandomPolicy;
  /** 快速评估函数（用于替代完整rollout） */
  rapidEvaluationFn?: (state: GameState, playerId: string) => number;
  /** 是否使用快速评估替代随机rollout */
  useRapidEval?: boolean;
  /** 超时检查函数 */
  timeoutCheck?: () => boolean;
}

/**
 * 蒙特卡洛树搜索（MCTS）引擎
 * 
 * 核心算法流程（每次迭代）：
 * 1. SELECT: 从根节点开始，使用UCT公式选择子节点，直到到达未完全扩展的节点
 * 2. EXPAND: 从未尝试的动作中选择一个，创建新子节点
 * 3. SIMULATE: 从新节点开始随机模拟（rollout）直到游戏结束
 * 4. BACKPROPAGATE: 将模拟结果沿路径反向传播，更新节点统计
 * 
 * 优化特性：
 * - UCT公式平衡探索与利用
 * - 支持并行模拟（多线程）
 * - 支持快速评估函数替代完整rollout
 * - 超时控制
 */
export class MctsEngine {
  private maxIterations: number;
  private explorationConstant: number;
  private parallelSims: number;
  private timeoutMs: number;
  private simulateFn: MctsStateSimulator;
  private getLegalActionsFn: MctsLegalActionsProvider;
  private isTerminalFn: MctsTerminalChecker;
  private randomPolicy: MctsRandomPolicy;
  private rapidEvaluationFn?: (state: GameState, playerId: string) => number;
  private useRapidEval: boolean;
  private timeoutCheck?: () => boolean;

  // 统计信息
  private totalIterations: number = 0;
  private totalSimulations: number = 0;

  constructor(options: MctsEngineOptions) {
    this.maxIterations = options.maxIterations;
    this.explorationConstant = options.explorationConstant ?? Math.sqrt(2);
    this.parallelSims = Math.max(1, options.parallelSims ?? 1);
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.simulateFn = options.simulateFn;
    this.getLegalActionsFn = options.getLegalActionsFn;
    this.isTerminalFn = options.isTerminalFn;
    this.randomPolicy = options.randomPolicy ?? this.defaultRandomPolicy.bind(this);
    this.rapidEvaluationFn = options.rapidEvaluationFn;
    this.useRapidEval = options.useRapidEval ?? false;
    this.timeoutCheck = options.timeoutCheck;
  }

  /**
   * 执行MCTS搜索，返回最佳动作
   * 
   * @param state 当前游戏状态
   * @param playerId 当前玩家ID
   * @param legalActions 合法动作列表（可选）
   * @returns 最佳动作
   */
  search(state: GameState, playerId: string, legalActions?: Action[]): Action {
    const actions = legalActions || this.getLegalActionsFn(state, playerId);
    
    if (!actions || actions.length === 0) {
      throw new Error('MctsEngine: no legal actions available');
    }

    if (actions.length === 1) {
      return actions[0];
    }

    // 检查是否终止状态
    const terminal = this.isTerminalFn(state);
    if (terminal.isTerminal) {
      return actions[0];
    }

    // 重置统计
    this.totalIterations = 0;
    this.totalSimulations = 0;

    const rootNode = new MCTSNode(state, null, null, playerId, actions, false);
    const startTime = Date.now();

    // 主循环
    for (let i = 0; i < this.maxIterations; i++) {
      // 超时检查
      if (Date.now() - startTime > this.timeoutMs) {
        break;
      }
      if (this.timeoutCheck && this.timeoutCheck()) {
        break;
      }

      // 1. SELECT
      const selectedNode = this.uctSelect(rootNode);
      if (!selectedNode) break;

      // 2. EXPAND
      let expandedNode = selectedNode;
      if (!selectedNode.isTerminal && !selectedNode.isFullyExpanded()) {
        expandedNode = this.expand(selectedNode);
      }

      // 3. SIMULATE
      let result: number;
      if (this.useRapidEval && this.rapidEvaluationFn) {
        result = this.rapidEvaluationFn(expandedNode.state, playerId);
      } else {
        result = this.simulate(expandedNode, playerId);
      }

      // 4. BACKPROPAGATE
      this.backpropagate(expandedNode, result);
      this.totalIterations++;
    }

    // 选择访问次数最多的子节点
    const bestChild = rootNode.bestChild();
    if (!bestChild || !bestChild.action) {
      // 回退到随机选择
      return actions[Math.floor(Math.random() * actions.length)];
    }

    return bestChild.action;
  }

  /**
   * SELECT阶段：使用UCT公式选择最有潜力的节点
   * 
   * 策略：
   * - 如果节点未完全扩展，返回该节点
   * - 否则选择UCT评分最高的子节点继续
   */
  uctSelect(node: MCTSNode): MCTSNode {
    let current = node;
    
    while (current.isFullyExpanded() && current.children.length > 0 && !current.isTerminal) {
      let bestScore = -Infinity;
      let bestChild: MCTSNode | null = null;

      for (const child of current.children) {
        const score = child.uctScore(this.explorationConstant);
        if (score > bestScore) {
          bestScore = score;
          bestChild = child;
        }
      }

      if (!bestChild) break;
      current = bestChild;
    }

    return current;
  }

  /**
   * EXPAND阶段：从当前节点未尝试的动作中选择一个创建新子节点
   */
  expand(node: MCTSNode): MCTSNode {
    if (node.untriedActions.length === 0 || node.isTerminal) {
      return node;
    }

    // 随机选择一个未尝试的动作
    const actionIndex = Math.floor(Math.random() * node.untriedActions.length);
    const action = node.untriedActions.splice(actionIndex, 1)[0];

    // 模拟执行动作
    const nextState = this.simulateFn(node.state, action, node.playerId);
    if (!nextState) {
      return node;
    }

    // 检查新状态是否终止
    const terminal = this.isTerminalFn(nextState);
    
    // 获取下一个玩家
    const nextPlayer = nextState.currentPlayer || node.playerId;
    const nextActions = terminal.isTerminal 
      ? [] 
      : (this.getLegalActionsFn(nextState, nextPlayer) || []);

    // 创建新节点
    const childNode = new MCTSNode(
      nextState,
      action,
      node,
      nextPlayer,
      nextActions,
      terminal.isTerminal
    );

    node.children.push(childNode);
    return childNode;
  }

  /**
   * SIMULATE阶段：从当前节点开始随机模拟直到游戏结束
   * 
   * 使用随机策略进行rollout，直到达到终止状态
   * 返回结果：从原始玩家视角的评分 (1=赢, 0.5=平, 0=输)
   */
  simulate(node: MCTSNode, originalPlayerId: string): number {
    let currentState = node.state;
    let currentPlayer = node.playerId;
    let steps = 0;
    const maxSteps = 200; // 防止无限循环

    while (steps < maxSteps) {
      const terminal = this.isTerminalFn(currentState);
      if (terminal.isTerminal) {
        return this.getResult(terminal, originalPlayerId);
      }

      const actions = this.getLegalActionsFn(currentState, currentPlayer);
      if (!actions || actions.length === 0) {
        return this.getResult({ isTerminal: true }, originalPlayerId);
      }

      // 使用随机策略选择动作
      const action = this.randomPolicy(currentState, actions);
      const nextState = this.simulateFn(currentState, action, currentPlayer);
      
      if (!nextState) {
        return 0.5; // 模拟失败，返回平局
      }

      currentState = nextState;
      currentPlayer = nextState.currentPlayer || currentPlayer;
      steps++;
    }

    // 达到最大步数，使用快速评估或返回平局
    if (this.rapidEvaluationFn) {
      return this.normalizeScore(this.rapidEvaluationFn(currentState, originalPlayerId));
    }
    return 0.5;
  }

  /**
   * BACKPROPAGATE阶段：将模拟结果沿路径反向传播
   * 
   * 更新从扩展节点到根节点路径上所有节点的访问次数和胜利次数
   */
  backpropagate(node: MCTSNode | null, result: number): void {
    let current: MCTSNode | null = node;
    
    while (current !== null) {
      current.visits++;
      
      // 从当前节点的玩家视角更新胜利次数
      // result 是从原始玩家视角的，需要转换
      current.wins += result;
      
      current = current.parent;
    }
  }

  /**
   * 从终止状态获取游戏结果
   */
  private getResult(
    terminal: { isTerminal: boolean; winner?: string },
    playerId: string
  ): number {
    if (!terminal.winner) {
      return 0.5; // 平局
    }
    return terminal.winner === playerId ? 1 : 0;
  }

  /**
   * 将评估函数分数归一化到[0, 1]
   */
  private normalizeScore(score: number): number {
    // 假设评估函数返回的范围大约在 [-10000, 10000]
    const clamped = Math.max(-10000, Math.min(10000, score));
    return (clamped + 10000) / 20000;
  }

  /**
   * 默认随机策略 - 均匀随机选择
   */
  private defaultRandomPolicy(_state: GameState, actions: Action[]): Action {
    return actions[Math.floor(Math.random() * actions.length)];
  }

  /**
   * 获取搜索统计信息
   */
  getStats(): { totalIterations: number; totalSimulations: number; avgSimulationsPerIter: number } {
    return {
      totalIterations: this.totalIterations,
      totalSimulations: this.totalSimulations,
      avgSimulationsPerIter: this.totalIterations > 0 ? this.totalSimulations / this.totalIterations : 0,
    };
  }

  /**
   * 并行搜索（使用Promise.all进行并行模拟）
   * 注意：由于JS单线程特性，这里的"并行"是指批量执行
   */
  async searchParallel(state: GameState, playerId: string, legalActions?: Action[]): Promise<Action> {
    const actions = legalActions || this.getLegalActionsFn(state, playerId);
    
    if (!actions || actions.length === 0) {
      throw new Error('MctsEngine: no legal actions available');
    }

    if (actions.length === 1) {
      return actions[0];
    }

    const rootNode = new MCTSNode(state, null, null, playerId, actions, false);
    const startTime = Date.now();
    let iterations = 0;

    while (iterations < this.maxIterations) {
      if (Date.now() - startTime > this.timeoutMs) break;
      if (this.timeoutCheck && this.timeoutCheck()) break;

      // 批量进行并行模拟
      const batchPromises: Promise<void>[] = [];
      for (let i = 0; i < this.parallelSims; i++) {
        if (iterations + i >= this.maxIterations) break;
        batchPromises.push(this.runSingleSimulation(rootNode, playerId));
      }

      await Promise.all(batchPromises);
      iterations += batchPromises.length;
    }

    this.totalIterations = iterations;

    const bestChild = rootNode.bestChild();
    if (!bestChild || !bestChild.action) {
      return actions[Math.floor(Math.random() * actions.length)];
    }

    return bestChild.action;
  }

  /**
   * 执行单次模拟（用于并行搜索）
   */
  private async runSingleSimulation(rootNode: MCTSNode, playerId: string): Promise<void> {
    // SELECT
    const selectedNode = this.uctSelect(rootNode);
    if (!selectedNode) return;

    // EXPAND
    let expandedNode = selectedNode;
    if (!selectedNode.isTerminal && !selectedNode.isFullyExpanded()) {
      expandedNode = this.expand(selectedNode);
    }

    // SIMULATE
    let result: number;
    if (this.useRapidEval && this.rapidEvaluationFn) {
      result = this.rapidEvaluationFn(expandedNode.state, playerId);
    } else {
      result = this.simulate(expandedNode, playerId);
    }

    // BACKPROPAGATE
    this.backpropagate(expandedNode, result);
  }
}
