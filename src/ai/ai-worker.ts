/**
 * AI工作进程 - worker_threads
 * 
 * 职责：
 * 1. 接收主进程的消息（游戏状态、可用操作、引擎类型、参数）
 * 2. 加载对应的游戏AI逻辑
 * 3. 执行搜索算法（Minimax/MCTS/Random）
 * 4. 返回最佳操作
 * 5. 支持提前终止（收到stop消息时立即停止搜索）
 * 
 * 通信协议：
 * - 主进程 → Worker: WorkerMessage
 * - Worker → 主进程: WorkerResponse
 */

import { parentPort } from 'worker_threads';
import { Action, GameState } from '../plugin/interfaces/game-controller.interface';
import { RandomEngine } from './algorithms/random.engine';
import { MinimaxEngine } from './algorithms/minimax.engine';
import { MctsEngine } from './algorithms/mcts.engine';
import { WorkerMessage, WorkerResponse } from './interfaces/ai-instance.interface';

// Worker状态
let currentInstanceId: string | null = null;
let abortFlag: boolean = false;
let engineRef: any = null;

// 内存监控定时器
let memoryCheckInterval: NodeJS.Timeout | null = null;

/**
 * 检查是否被中断
 */
function isAborted(): boolean {
  return abortFlag;
}

/**
 * 重置中断标志
 */
function resetAbort(): void {
  abortFlag = false;
}

/**
 * 发送响应到主进程
 */
function sendResponse(response: WorkerResponse): void {
  if (parentPort) {
    parentPort.postMessage(response);
  }
}

/**
 * 发送心跳消息（含内存使用信息）
 */
function sendHeartbeat(): void {
  const memUsage = process.memoryUsage();
  sendResponse({
    type: 'heartbeat',
    instanceId: currentInstanceId || undefined,
    memoryUsage: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100,
    timestamp: Date.now(),
  });
}

/**
 * 启动内存监控
 */
function startMemoryMonitoring(intervalMs: number = 5000): void {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
  }
  memoryCheckInterval = setInterval(() => {
    sendHeartbeat();
  }, intervalMs);
}

/**
 * 停止内存监控
 */
function stopMemoryMonitoring(): void {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
    memoryCheckInterval = null;
  }
}

/**
 * 通用状态模拟器 - 通过message传递模拟函数时，Worker需要知道如何模拟
 * 
 * 策略：评估函数和模拟逻辑通过以下方式注入：
 * 1. options中包含evaluateFn/simulateFn的序列化版本（适用于简单逻辑）
 * 2. options中包含插件ID，Worker动态require插件模块
 * 3. 对于复杂游戏，主进程预先计算好合法动作和评估值
 * 
 * 这里提供一个基于GameState的通用模拟框架
 */
function createSimulator(options: any) {
  // 通用模拟函数 - 尝试在state上应用action
  const simulateFn = (state: GameState, action: Action, playerId: string): GameState | null => {
    try {
      // 如果有自定义模拟函数代码，尝试使用
      if (options?.simulateFnCode) {
        const fn = new Function('state', 'action', 'playerId', options.simulateFnCode);
        return fn(state, action, playerId);
      }

      // 默认模拟：浅拷贝state并应用基本变换
      const newState: GameState = {
        ...state,
        metadata: { ...state.metadata },
      };

      // 如果有board，尝试应用动作
      if (state.board && action.data) {
        newState.board = applyActionToBoard(state.board, action);
      }

      // 切换当前玩家
      if (state.players && state.players.length > 0) {
        const currentIdx = state.players.findIndex(p => p.playerId === playerId);
        const nextIdx = (currentIdx + 1) % state.players.length;
        newState.currentPlayer = state.players[nextIdx]?.playerId;
      }

      return newState;
    } catch (err) {
      return null;
    }
  };

  return simulateFn;
}

/**
 * 尝试将动作应用到棋盘
 */
function applyActionToBoard(board: any, action: Action): any {
  if (typeof board === 'object' && board !== null) {
    const newBoard = Array.isArray(board) ? [...board] : { ...board };
    
    // 处理常见的棋盘更新模式
    if (action.data?.from && action.data?.to && Array.isArray(newBoard)) {
      // 移动类游戏（如象棋、围棋）
      const from = action.data.from;
      const to = action.data.to;
      if (from >= 0 && from < newBoard.length && to >= 0 && to < newBoard.length) {
        newBoard[to] = newBoard[from];
        newBoard[from] = null;
      }
    } else if (action.data?.position !== undefined && Array.isArray(newBoard)) {
      // 放置类游戏（如井字棋、五子棋）
      const pos = action.data.position;
      if (pos >= 0 && pos < newBoard.length) {
        newBoard[pos] = action.data.value || action.playerId;
      }
    } else if (action.data?.boardDelta) {
      // 增量更新
      return mergeDelta(newBoard, action.data.boardDelta);
    }
    
    return newBoard;
  }
  return board;
}

/**
 * 合并增量更新
 */
function mergeDelta(board: any, delta: any): any {
  if (typeof delta !== 'object' || delta === null) return board;
  const result = Array.isArray(board) ? [...board] : { ...board };
  for (const key of Object.keys(delta)) {
    result[key] = delta[key];
  }
  return result;
}

/**
 * 通用终止状态检查器
 */
function createTerminalChecker(options: any) {
  return (state: GameState): { isTerminal: boolean; winner?: string } => {
    // 优先使用状态中的winner字段
    if (state.winner) {
      return { isTerminal: true, winner: state.winner };
    }

    // 如果状态status为finished，认为是终止状态
    if (state.status === 'finished' || state.status === 'ended') {
      return { isTerminal: true };
    }

    // 如果有自定义终止检查代码
    if (options?.terminalCheckCode) {
      try {
        const fn = new Function('state', options.terminalCheckCode);
        return fn(state);
      } catch {
        // 忽略错误
      }
    }

    return { isTerminal: false };
  };
}

/**
 * 通用合法动作提供者
 */
function createLegalActionsProvider() {
  return (state: GameState, _playerId: string): Action[] => {
    // 如果状态中已有预计算的合法动作，直接使用
    if (state.metadata?.legalActions && Array.isArray(state.metadata.legalActions)) {
      return state.metadata.legalActions;
    }
    return [];
  };
}

/**
 * 执行搜索
 */
async function handleSearch(message: WorkerMessage): Promise<void> {
  const startTime = Date.now();
  
  try {
    const { gameState, playerId, legalActions, engineType, options, timeoutMs, instanceId } = message;
    
    if (!gameState || !playerId || !legalActions || legalActions.length === 0) {
      sendResponse({
        type: 'error',
        instanceId,
        error: 'Missing required parameters: gameState, playerId, or legalActions',
        timestamp: Date.now(),
      });
      return;
    }

    currentInstanceId = instanceId || null;
    resetAbort();
    startMemoryMonitoring();

    // 设置超时
    const effectiveTimeout = timeoutMs || 10000;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      abortFlag = true;
    }, effectiveTimeout);

    let action: Action | null = null;

    switch (engineType) {
      case 'random': {
        const randomEngine = new RandomEngine({
          weighted: options?.weighted ?? false,
          temperature: options?.temperature ?? 1.0,
          seed: options?.seed,
        });
        
        // 如果有评估函数代码，尝试创建
        if (options?.evaluateFnCode) {
          try {
            const evaluateFn = new Function('state', 'action', 'playerId', options.evaluateFnCode) as (
              state: GameState,
              action: Action,
              playerId: string,
            ) => number;
            randomEngine['evaluateFn'] = evaluateFn;
            randomEngine['weighted'] = true;
          } catch {
            // 忽略评估函数加载错误，使用纯随机
          }
        }

        action = randomEngine.search(gameState, playerId, legalActions);
        engineRef = randomEngine;
        break;
      }

      case 'minimax': {
        const simulateFn = createSimulator(options);
        const terminalChecker = createTerminalChecker(options);
        const legalActionsProvider = createLegalActionsProvider();

        // 创建评估函数
        let evaluateFn: (state: GameState, pid: string) => number;
        if (options?.evaluateFnCode) {
          evaluateFn = new Function('state', 'playerId', options.evaluateFnCode) as any;
        } else {
          evaluateFn = (state: GameState, pid: string) => {
            // 默认评估：基于分数差
            const me = state.players?.find(p => p.playerId === pid);
            const opponent = state.players?.find(p => p.playerId !== pid);
            return (me?.score || 0) - (opponent?.score || 0);
          };
        }

        const minimaxEngine = new MinimaxEngine({
          maxDepth: options?.maxDepth || 4,
          evaluateFn,
          simulateFn,
          getLegalActionsFn: legalActionsProvider,
          isTerminalFn: terminalChecker,
          randomize: options?.randomize ?? true,
          seed: options?.seed,
          killerHeuristic: options?.killerHeuristic ?? true,
          timeoutCheck: () => isAborted(),
        });

        action = minimaxEngine.search(gameState, playerId, legalActions);
        engineRef = minimaxEngine;
        break;
      }

      case 'mcts': {
        const simulateFn = createSimulator(options);
        const terminalChecker = createTerminalChecker(options);
        const legalActionsProvider = createLegalActionsProvider();

        const mctsEngine = new MctsEngine({
          maxIterations: options?.maxIterations || 1000,
          explorationConstant: options?.explorationConstant ?? Math.sqrt(2),
          parallelSims: options?.parallelSims ?? 1,
          timeoutMs: Math.min(effectiveTimeout, options?.timeoutMs || 10000),
          simulateFn,
          getLegalActionsFn: legalActionsProvider,
          isTerminalFn: terminalChecker,
          timeoutCheck: () => isAborted(),
        });

        if (options?.parallelSims && options.parallelSims > 1) {
          action = await mctsEngine.searchParallel(gameState, playerId, legalActions);
        } else {
          action = mctsEngine.search(gameState, playerId, legalActions);
        }
        engineRef = mctsEngine;
        break;
      }

      default:
        // 未知引擎类型，回退到随机
        const fallbackEngine = new RandomEngine();
        action = fallbackEngine.search(gameState, playerId, legalActions);
        engineRef = fallbackEngine;
    }

    clearTimeout(timeoutId);

    if (timedOut && !action) {
      // 超时但无结果，随机选择一个
      action = legalActions[Math.floor(Math.random() * legalActions.length)];
    }

    const elapsedMs = Date.now() - startTime;

    sendResponse({
      type: 'search_result',
      instanceId: instanceId || undefined,
      action: action || legalActions[0],
      timestamp: Date.now(),
    });

    // 记录性能日志
    if (elapsedMs > effectiveTimeout * 0.8) {
      console.warn(`[AI Worker] Search took ${elapsedMs}ms, close to timeout ${effectiveTimeout}ms`);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[AI Worker] Search error: ${errorMessage}`);
    
    sendResponse({
      type: 'error',
      instanceId: message.instanceId || undefined,
      error: errorMessage,
      timestamp: Date.now(),
    });
  } finally {
    stopMemoryMonitoring();
    engineRef = null;
  }
}

/**
 * 处理停止命令
 */
function handleStop(message: WorkerMessage): void {
  abortFlag = true;
  currentInstanceId = null;
  
  sendResponse({
    type: 'search_result',
    instanceId: message.instanceId || undefined,
    action: null as any,
    timestamp: Date.now(),
  });
}

/**
 * 处理初始化命令
 */
function handleInit(message: WorkerMessage): void {
  currentInstanceId = message.instanceId || null;
  resetAbort();
  startMemoryMonitoring();
  
  sendResponse({
    type: 'init_complete',
    instanceId: message.instanceId || undefined,
    timestamp: Date.now(),
  });
}

/**
 * 主消息处理循环
 */
if (parentPort) {
  parentPort.on('message', async (message: WorkerMessage) => {
    switch (message.type) {
      case 'init':
        handleInit(message);
        break;
      
      case 'search':
        await handleSearch(message);
        break;
      
      case 'stop':
        handleStop(message);
        break;
      
      case 'heartbeat':
        sendHeartbeat();
        break;
      
      default:
        sendResponse({
          type: 'error',
          error: `Unknown message type`,
          timestamp: Date.now(),
        });
    }
  });

  // Worker启动时发送就绪信号
  sendResponse({
    type: 'init_complete',
    timestamp: Date.now(),
  });
}

// Worker优雅退出
process.on('exit', () => {
  stopMemoryMonitoring();
});
