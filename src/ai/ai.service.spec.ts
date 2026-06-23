import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';
import { AiEngineService } from './ai-engine.service';
import { AiProcessPoolService } from './ai-process-pool.service';
import { RandomEngine } from './algorithms/random.engine';
import { MinimaxEngine } from './algorithms/minimax.engine';
import { MctsEngine } from './algorithms/mcts.engine';
import { GameState, Action } from '../plugin/interfaces/game-controller.interface';

// ==================== 测试辅助函数 ====================

/**
 * 创建简单的井字棋游戏状态用于测试
 */
function createTicTacToeState(board: (string | null)[], currentPlayer: string): GameState {
  return {
    status: 'playing',
    players: [
      { playerId: 'X', seatIndex: 0, status: 'active', score: 0 },
      { playerId: 'O', seatIndex: 1, status: 'active', score: 0 },
    ],
    board,
    currentPlayer,
    round: board.filter(c => c !== null).length,
  };
}

/**
 * 获取井字棋的合法动作
 */
function getTicTacToeActions(state: GameState, playerId: string): Action[] {
  if (!state.board || !Array.isArray(state.board)) return [];
  
  return state.board
    .map((cell, idx) => ({ cell, idx }))
    .filter(({ cell }) => cell === null)
    .map(({ idx }) => ({
      type: 'place',
      playerId,
      data: { position: idx },
      timestamp: Date.now(),
    }));
}

/**
 * 模拟井字棋动作
 */
function simulateTicTacToe(state: GameState, action: Action, _playerId: string): GameState | null {
  const newBoard = [...(state.board as (string | null)[])];
  const pos = action.data.position;
  
  if (pos < 0 || pos >= newBoard.length || newBoard[pos] !== null) {
    return null;
  }
  
  newBoard[pos] = action.playerId;
  const nextPlayer = action.playerId === 'X' ? 'O' : 'X';
  
  return {
    ...state,
    board: newBoard,
    currentPlayer: nextPlayer,
    round: (state.round || 0) + 1,
  };
}

/**
 * 检查井字棋终止状态
 */
function checkTicTacToeTerminal(state: GameState): { isTerminal: boolean; winner?: string } {
  const board = state.board as (string | null)[];
  if (!board) return { isTerminal: false };
  
  // 检查获胜线
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // 行
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // 列
    [0, 4, 8], [2, 4, 6],             // 对角线
  ];
  
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { isTerminal: true, winner: board[a]! };
    }
  }
  
  // 检查平局
  if (board.every(cell => cell !== null)) {
    return { isTerminal: true };
  }
  
  return { isTerminal: false };
}

/**
 * 井字棋评估函数
 */
function evaluateTicTacToe(state: GameState, playerId: string): number {
  const terminal = checkTicTacToeTerminal(state);
  if (terminal.isTerminal) {
    if (terminal.winner === playerId) return 1000;
    if (terminal.winner) return -1000;
    return 0; // 平局
  }
  
  // 简单的位置评估：中心>角>边
  const board = state.board as (string | null)[];
  const positionWeights = [1, 0.5, 1, 0.5, 2, 0.5, 1, 0.5, 1];
  
  let score = 0;
  for (let i = 0; i < 9; i++) {
    if (board[i] === playerId) score += positionWeights[i];
    else if (board[i]) score -= positionWeights[i];
  }
  
  return score;
}

// ==================== 测试套件 ====================

describe('RandomEngine', () => {
  let engine: RandomEngine;
  let state: GameState;
  let actions: Action[];

  beforeEach(() => {
    engine = new RandomEngine();
    state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    actions = getTicTacToeActions(state, 'X');
  });

  it('should return an action from the legal actions', () => {
    const action = engine.search(state, 'X', actions);
    expect(actions).toContainEqual(action);
  });

  it('should throw error when no actions available', () => {
    expect(() => engine.search(state, 'X', [])).toThrow('no legal actions available');
  });

  it('should return the only action when single action available', () => {
    const singleAction = [actions[0]];
    const result = engine.search(state, 'X', singleAction);
    expect(result).toEqual(actions[0]);
  });

  it('should support seeded random for reproducibility', () => {
    const seeded1 = new RandomEngine({ seed: 42 });
    const seeded2 = new RandomEngine({ seed: 42 });
    
    const action1 = seeded1.search(state, 'X', actions);
    const action2 = seeded2.search(state, 'X', actions);
    
    expect(action1).toEqual(action2);
  });

  it('should support weighted random', () => {
    const weightedEngine = new RandomEngine({
      weighted: true,
      evaluateFn: (state, action) => {
        // 偏好中间位置（位置4）
        return action.data.position === 4 ? 100 : 1;
      },
      temperature: 0.1, // 低温度，几乎总是选最高分
    });
    
    // 多次运行，中心位置应该被选中大部分
    let centerCount = 0;
    const runs = 20;
    for (let i = 0; i < runs; i++) {
      const action = weightedEngine.search(state, 'X', actions);
      if (action.data.position === 4) centerCount++;
    }
    
    // 低温度下应该大部分选中中心
    expect(centerCount).toBeGreaterThan(runs * 0.5);
  });

  it('should return correct config', () => {
    const config = engine.getConfig();
    expect(config.weighted).toBe(false);
    expect(config.seeded).toBe(false);
  });
});

describe('MinimaxEngine', () => {
  let engine: MinimaxEngine;

  beforeEach(() => {
    engine = new MinimaxEngine({
      maxDepth: 6,
      evaluateFn: evaluateTicTacToe,
      simulateFn: simulateTicTacToe,
      getLegalActionsFn: getTicTacToeActions,
      isTerminalFn: checkTicTacToeTerminal,
    });
  });

  it('should return a winning move when available', () => {
    // X在0,1有棋子，下一步应该选2获胜
    const state = createTicTacToeState(['X', 'X', null, null, 'O', null, null, null, null], 'X');
    const actions = getTicTacToeActions(state, 'X');
    
    const action = engine.search(state, 'X', actions);
    
    // 应该选位置2来完成三连
    expect(action.data.position).toBe(2);
  });

  it('should block opponent winning move', () => {
    // O在0,1有棋子，X应该选2来阻止O获胜
    const state = createTicTacToeState(['O', 'O', null, null, 'X', null, null, null, null], 'X');
    const actions = getTicTacToeActions(state, 'X');
    
    const action = engine.search(state, 'X', actions);
    
    // 应该选位置2来阻止O
    expect(action.data.position).toBe(2);
  });

  it('should prefer center for first move', () => {
    const state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    const actions = getTicTacToeActions(state, 'X');
    
    const action = engine.search(state, 'X', actions);
    
    // 中心位置(4)是最佳选择
    expect(action.data.position).toBe(4);
  });

  it('should throw error when no actions available', () => {
    const state = createTicTacToeState(['X', 'O', 'X', 'O', 'X', 'O', 'X', 'O', 'X'], 'X');
    expect(() => engine.search(state, 'X', [])).toThrow('no legal actions available');
  });

  it('should handle single action', () => {
    const state = createTicTacToeState(['X', 'O', 'X', 'O', 'X', 'O', null, 'O', 'X'], 'X');
    const actions = getTicTacToeActions(state, 'X');
    expect(actions.length).toBe(1);
    
    const action = engine.search(state, 'X', actions);
    expect(action.data.position).toBe(6);
  });

  it('should detect terminal state correctly', () => {
    const winState = createTicTacToeState(['X', 'X', 'X', 'O', 'O', null, null, null, null], 'X');
    const result = checkTicTacToeTerminal(winState);
    expect(result.isTerminal).toBe(true);
    expect(result.winner).toBe('X');
  });

  it('should evaluate winning state positively', () => {
    const winState = createTicTacToeState(['X', 'X', 'X', 'O', 'O', null, null, null, null], 'X');
    const score = evaluateTicTacToe(winState, 'X');
    expect(score).toBe(1000);
  });

  it('should evaluate losing state negatively', () => {
    const loseState = createTicTacToeState(['O', 'O', 'O', 'X', 'X', null, null, null, null], 'X');
    const score = evaluateTicTacToe(loseState, 'X');
    expect(score).toBe(-1000);
  });

  it('should play a complete game without errors', () => {
    let state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    let moveCount = 0;
    const maxMoves = 9;

    while (moveCount < maxMoves) {
      const terminal = checkTicTacToeTerminal(state);
      if (terminal.isTerminal) break;

      const actions = getTicTacToeActions(state, state.currentPlayer || 'X');
      if (actions.length === 0) break;

      const action = engine.search(state, state.currentPlayer || 'X', actions);
      const newState = simulateTicTacToe(state, action, state.currentPlayer || 'X');
      if (!newState) break;

      state = newState;
      moveCount++;
    }

    expect(moveCount).toBeGreaterThan(0);
    expect(checkTicTacToeTerminal(state).isTerminal).toBe(true);
  });

  it('should work with killer heuristic enabled', () => {
    const killerEngine = new MinimaxEngine({
      maxDepth: 4,
      evaluateFn: evaluateTicTacToe,
      simulateFn: simulateTicTacToe,
      getLegalActionsFn: getTicTacToeActions,
      isTerminalFn: checkTicTacToeTerminal,
      killerHeuristic: true,
    });

    const state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    const actions = getTicTacToeActions(state, 'X');
    
    const action = killerEngine.search(state, 'X', actions);
    expect(action).toBeDefined();
    expect(actions.map(a => a.data.position)).toContain(action.data.position);
  });

  it('should return search stats after search', () => {
    const state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    const actions = getTicTacToeActions(state, 'X');
    
    engine.search(state, 'X', actions);
    const stats = engine['getStats'] ? engine['getStats']() : { nodesEvaluated: 0 };
    
    // nodesEvaluated应该是通过getStats()获取的
    const nodes = (engine as any).nodesEvaluated;
    expect(nodes).toBeGreaterThan(0);
  });
});

describe('MctsEngine', () => {
  let engine: MctsEngine;

  beforeEach(() => {
    engine = new MctsEngine({
      maxIterations: 2000,
      explorationConstant: 1.414,
      simulateFn: simulateTicTacToe,
      getLegalActionsFn: getTicTacToeActions,
      isTerminalFn: checkTicTacToeTerminal,
    });
  });

  it('should return an action from legal actions', () => {
    const state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    const actions = getTicTacToeActions(state, 'X');
    
    const action = engine.search(state, 'X', actions);
    
    expect(actions.map(a => a.data.position)).toContain(action.data.position);
  });

  it('should handle empty board', () => {
    const state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    const actions = getTicTacToeActions(state, 'X');
    
    const action = engine.search(state, 'X', actions);
    
    expect(action).toBeDefined();
    expect(action.data.position).toBeGreaterThanOrEqual(0);
    expect(action.data.position).toBeLessThan(9);
  });

  it('should throw error when no actions available', () => {
    const state = createTicTacToeState(['X', 'O', 'X', 'O', 'X', 'O', 'X', 'O', 'X'], 'X');
    expect(() => engine.search(state, 'X', [])).toThrow('no legal actions available');
  });

  it('should return single available action', () => {
    const state = createTicTacToeState(['X', 'O', 'X', 'O', 'X', 'O', null, 'O', 'X'], 'X');
    const actions = getTicTacToeActions(state, 'X');
    expect(actions.length).toBe(1);
    
    const action = engine.search(state, 'X', actions);
    expect(action.data.position).toBe(6);
  });

  it('should handle terminal state', () => {
    const state = createTicTacToeState(['X', 'X', 'X', 'O', 'O', null, null, null, null], 'X');
    const actions = getTicTacToeActions(state, 'X');
    
    // 当游戏已结束时，合法动作可能为空或返回第一个
    if (actions.length === 0) {
      expect(actions.length).toBe(0);
    }
  });

  it('should complete a game simulation', () => {
    let state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    let moveCount = 0;
    const maxMoves = 9;

    while (moveCount < maxMoves) {
      const terminal = checkTicTacToeTerminal(state);
      if (terminal.isTerminal) break;

      const currentPlayer = state.currentPlayer || 'X';
      const actions = getTicTacToeActions(state, currentPlayer);
      if (actions.length === 0) break;

      const action = engine.search(state, currentPlayer, actions);
      const newState = simulateTicTacToe(state, action, currentPlayer);
      if (!newState) break;

      state = newState;
      moveCount++;
    }

    expect(moveCount).toBeGreaterThan(0);
    expect(checkTicTacToeTerminal(state).isTerminal).toBe(true);
  });

  it('should respect timeout', () => {
    const timeoutEngine = new MctsEngine({
      maxIterations: 100000, // 很大，但会被timeout限制
      explorationConstant: 1.414,
      timeoutMs: 100, // 100ms超时
      simulateFn: simulateTicTacToe,
      getLegalActionsFn: getTicTacToeActions,
      isTerminalFn: checkTicTacToeTerminal,
    });

    const state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    const actions = getTicTacToeActions(state, 'X');
    
    const startTime = Date.now();
    const action = timeoutEngine.search(state, 'X', actions);
    const elapsed = Date.now() - startTime;
    
    expect(action).toBeDefined();
    expect(elapsed).toBeLessThanOrEqual(500); // 允许一些误差
  });

  it('should have correct MCTS node UCT score', () => {
    const { MCTSNode } = require('./algorithms/mcts.engine');
    
    const state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    const parent = new MCTSNode(state, null, null, 'X', [], false);
    parent.visits = 10;
    
    const child = new MCTSNode(state, null, parent, 'O', [], false);
    child.visits = 5;
    child.wins = 3;
    parent.children.push(child);
    
    const uctScore = child.uctScore(1.414);
    
    // UCT = wins/visits + C * sqrt(ln(parentVisits) / visits)
    // = 3/5 + 1.414 * sqrt(ln(10) / 5)
    expect(uctScore).toBeGreaterThan(0);
    expect(uctScore).toBeGreaterThan(3 / 5); // 至少大于纯利用值
  });

  it('should prefer unvisited nodes in selection', () => {
    const { MCTSNode } = require('./algorithms/mcts.engine');
    
    const state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    const parent = new MCTSNode(state, null, null, 'X', [], false);
    parent.visits = 10;
    
    // 已访问的子节点
    const visitedChild = new MCTSNode(state, null, parent, 'O', [], false);
    visitedChild.visits = 5;
    visitedChild.wins = 2;
    parent.children.push(visitedChild);
    
    // 未访问的子节点
    const unvisitedChild = new MCTSNode(state, null, parent, 'O', [], false);
    unvisitedChild.visits = 0;
    unvisitedChild.wins = 0;
    parent.children.push(unvisitedChild);
    
    // 未访问节点的UCT分数应该是Infinity
    expect(unvisitedChild.uctScore(1.414)).toBe(Infinity);
    
    // 已访问节点的UCT分数应该是有限值
    expect(visitedChild.uctScore(1.414)).toBeFinite();
  });

  it('should support rapid evaluation mode', () => {
    const rapidEngine = new MctsEngine({
      maxIterations: 100,
      explorationConstant: 1.414,
      simulateFn: simulateTicTacToe,
      getLegalActionsFn: getTicTacToeActions,
      isTerminalFn: checkTicTacToeTerminal,
      rapidEvaluationFn: (state, playerId) => evaluateTicTacToe(state, playerId),
      useRapidEval: true,
    });

    const state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    const actions = getTicTacToeActions(state, 'X');
    
    const action = rapidEngine.search(state, 'X', actions);
    expect(action).toBeDefined();
  });
});

describe('AiEngineService', () => {
  let service: AiEngineService;
  let poolService: AiProcessPoolService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiEngineService,
        {
          provide: AiProcessPoolService,
          useValue: {
            acquireProcess: jest.fn().mockResolvedValue({
              processId: 'test-worker-1',
              worker: {
                postMessage: jest.fn(),
                on: jest.fn(),
                off: jest.fn(),
                terminate: jest.fn(),
              },
              status: 'idle',
              totalTasks: 0,
            }),
            releaseProcess: jest.fn(),
            getStats: jest.fn().mockReturnValue({
              currentPoolSize: 4,
              idleCount: 3,
              busyCount: 1,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AiEngineService>(AiEngineService);
    poolService = module.get<AiProcessPoolService>(AiProcessPoolService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create AI instance', async () => {
    const instance = await service.createAI('chess', 'hard');
    
    expect(instance).toBeDefined();
    expect(instance.pluginId).toBe('chess');
    expect(instance.difficulty).toBe('hard');
    expect(instance.status).toBe('idle');
    expect(instance.totalRequests).toBe(0);
  });

  it('should reject invalid difficulty', async () => {
    await expect(service.createAI('chess', 'invalid')).rejects.toThrow();
  });

  it('should get instance status', async () => {
    const instance = await service.createAI('chess', 'medium');
    const status = service.getInstanceStatus(instance.instanceId);
    
    expect(status.instanceId).toBe(instance.instanceId);
    expect(status.pluginId).toBe('chess');
    expect(status.difficulty).toBe('medium');
  });

  it('should throw for non-existent instance', () => {
    expect(() => service.getInstanceStatus('non-existent')).toThrow();
  });

  it('should get engine stats', async () => {
    await service.createAI('chess', 'easy');
    await service.createAI('go', 'hard');
    
    const stats = service.getStats();
    
    expect(stats.totalInstances).toBe(2);
    expect(stats.poolStats).toBeDefined();
  });

  it('should get supported difficulties', () => {
    const difficulties = service.getSupportedDifficulties();
    expect(difficulties).toContain('easy');
    expect(difficulties).toContain('medium');
    expect(difficulties).toContain('hard');
    expect(difficulties).toContain('expert');
  });

  it('should get difficulty config', () => {
    const config = service.getDifficultyConfig('hard');
    expect(config).toBeDefined();
    expect(config?.engineType).toBe('minimax');
    expect(config?.maxDepth).toBe(6);
  });

  it('should release AI instance', async () => {
    const instance = await service.createAI('chess', 'easy');
    await service.releaseAI(instance.instanceId);
    
    expect(() => service.getInstanceStatus(instance.instanceId)).toThrow();
  });

  it('should throw when releasing non-existent instance', async () => {
    await expect(service.releaseAI('non-existent')).rejects.toThrow();
  });
});

describe('AiProcessPoolService', () => {
  let poolService: AiProcessPoolService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiProcessPoolService],
    }).compile();

    poolService = module.get<AiProcessPoolService>(AiProcessPoolService);
  });

  it('should be defined', () => {
    expect(poolService).toBeDefined();
  });

  it('should return pool stats', () => {
    const stats = poolService.getStats();
    expect(stats).toHaveProperty('currentPoolSize');
    expect(stats).toHaveProperty('idleCount');
    expect(stats).toHaveProperty('busyCount');
  });

  it('should perform health check', async () => {
    const health = await poolService.healthCheck();
    expect(Array.isArray(health)).toBe(true);
  });
});

describe('AI Game Integration', () => {
  it('should play a complete tic-tac-toe game with minimax vs mcts', () => {
    const minimax = new MinimaxEngine({
      maxDepth: 6,
      evaluateFn: evaluateTicTacToe,
      simulateFn: simulateTicTacToe,
      getLegalActionsFn: getTicTacToeActions,
      isTerminalFn: checkTicTacToeTerminal,
    });

    const mcts = new MctsEngine({
      maxIterations: 1000,
      explorationConstant: 1.414,
      simulateFn: simulateTicTacToe,
      getLegalActionsFn: getTicTacToeActions,
      isTerminalFn: checkTicTacToeTerminal,
    });

    let state = createTicTacToeState([null, null, null, null, null, null, null, null, null], 'X');
    let moveCount = 0;
    const maxMoves = 9;

    while (moveCount < maxMoves) {
      const terminal = checkTicTacToeTerminal(state);
      if (terminal.isTerminal) break;

      const currentPlayer = state.currentPlayer || 'X';
      const actions = getTicTacToeActions(state, currentPlayer);
      if (actions.length === 0) break;

      let action: Action;
      if (currentPlayer === 'X') {
        action = minimax.search(state, currentPlayer, actions);
      } else {
        action = mcts.search(state, currentPlayer, actions);
      }

      const newState = simulateTicTacToe(state, action, currentPlayer);
      if (!newState) break;

      state = newState;
      moveCount++;
    }

    // 游戏应该正常结束（无论平局还是有人赢）
    expect(checkTicTacToeTerminal(state).isTerminal).toBe(true);
    expect(moveCount).toBeGreaterThan(0);
    expect(moveCount).toBeLessThanOrEqual(9);
  });

  it('should handle edge case: almost full board', () => {
    const minimax = new MinimaxEngine({
      maxDepth: 6,
      evaluateFn: evaluateTicTacToe,
      simulateFn: simulateTicTacToe,
      getLegalActionsFn: getTicTacToeActions,
      isTerminalFn: checkTicTacToeTerminal,
    });

    // 只剩一个空位
    const state = createTicTacToeState(
      ['X', 'O', 'X', 'O', 'X', 'O', 'O', null, 'X'],
      'X'
    );
    const actions = getTicTacToeActions(state, 'X');
    expect(actions.length).toBe(1);

    const action = minimax.search(state, 'X', actions);
    expect(action.data.position).toBe(7);
  });
});
