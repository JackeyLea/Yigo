import { parentPort, threadId, workerData } from 'worker_threads';
import * as vm from 'vm';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// Worker 线程入口 - 双重隔离架构
// ============================================================
// 主线程 (NestJS) → Worker 线程 (Node.js) → vm.Context (二次隔离)
// 第一层隔离：Worker 线程（进程级）
// 第二层隔离：vm.Context（代码级）
// ============================================================

// ----- 类型定义（Worker 内联，避免模块依赖问题） -----

interface PluginMeta {
  pluginId: string;
  name: string;
  version: string;
  gameType: string;
  category: 'board' | 'card' | 'mahjong';
  minPlayers: number;
  maxPlayers: number;
  entryClass: string;
  supportedModes: string[];
  memoryLimitMB?: number;
  allowedDomains?: string[];
  neuralNetwork?: {
    enabled: boolean;
    modelPath?: string;
    modelHash?: string;
  };
  errorDefinitions?: Record<string, { en: string; zh: string }>;
}

interface GameState {
  status: string;
  players: any[];
  board?: any;
  currentPlayer?: string;
  round?: number;
  winner?: string;
  metadata?: Record<string, any>;
}

interface Action {
  type: string;
  playerId: string;
  data: Record<string, any>;
  timestamp: number;
}

interface FrameworkContext {
  pluginId: string;
  roomId: string;
  config: Record<string, any>;
  eventBus: any;
  logger: any;
  localize: (key: string, params?: Record<string, string>) => string;
}

// ----- Worker 内本地 EventBus -----

type EventHandler = (payload: any, eventType?: string) => void | Promise<void>;

class WorkerEventBus {
  private subscriptions = new Map<string, Set<EventHandler>>();
  private maxSubscriptions = 1000;

  subscribe(eventType: string, handler: EventHandler): void {
    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, new Set());
    }
    const handlers = this.subscriptions.get(eventType)!;
    if (handlers.size >= this.maxSubscriptions) {
      throw new Error(`Max subscriptions reached for ${eventType}`);
    }
    handlers.add(handler);
  }

  unsubscribe(eventType: string, handler: EventHandler): void {
    const handlers = this.subscriptions.get(eventType);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  unsubscribeAll(): void {
    this.subscriptions.clear();
  }

  publish(eventType: string, payload: any): void {
    const handlers = this.subscriptions.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          const result = handler(payload, eventType);
          if (result instanceof Promise) {
            result.catch((err) => {
              logError(`Async event handler error for "${eventType}": ${err?.message}`);
            });
          }
        } catch (err: any) {
          logError(`Event handler error for "${eventType}": ${err?.message}`);
        }
      }
    }

    // 通知主线程（事件转发）
    if (parentPort) {
      parentPort.postMessage({
        type: 'EVENT_FORWARD',
        eventType,
        payload,
      });
    }
  }
}

// ----- Worker 内 Logger -----

function logDebug(msg: string): void {
  if (parentPort) {
    parentPort.postMessage({ type: 'LOG', level: 'debug', message: msg });
  }
}

function logInfo(msg: string): void {
  if (parentPort) {
    parentPort.postMessage({ type: 'LOG', level: 'info', message: msg });
  }
}

function logWarn(msg: string): void {
  if (parentPort) {
    parentPort.postMessage({ type: 'LOG', level: 'warn', message: msg });
  }
}

function logError(msg: string): void {
  if (parentPort) {
    parentPort.postMessage({ type: 'LOG', level: 'error', message: msg });
  }
}

// ----- 本地状态 -----

interface PluginState {
  meta: PluginMeta;
  sandbox: any;
  context: vm.Context;
  exports: any;
  eventBus: WorkerEventBus;
  gameController: any | null;
  aiController: any | null;
  loadedAt: Date;
}

const plugins = new Map<string, PluginState>();
let currentPluginId: string | null = null;

// ----- 禁止访问的 Node.js 模块 -----

const BLOCKED_MODULES = [
  'fs',
  'net',
  'child_process',
  'dgram',
  'cluster',
  'http',
  'https',
  'http2',
  'tls',
  'dns',
  'repl',
  'vm',
  'worker_threads',
];

// ----- 安全的 console 实现 -----

function createSafeConsole(): any {
  const noop = () => {};
  return {
    log: (...args: any[]) => logInfo(args.map(String).join(' ')),
    info: (...args: any[]) => logInfo(args.map(String).join(' ')),
    warn: (...args: any[]) => logWarn(args.map(String).join(' ')),
    error: (...args: any[]) => logError(args.map(String).join(' ')),
    debug: (...args: any[]) => logDebug(args.map(String).join(' ')),
    assert: noop,
    clear: noop,
    dir: noop,
    dirxml: noop,
    table: noop,
    trace: noop,
    profile: noop,
    profileEnd: noop,
    timeStamp: noop,
  };
}

// ----- 沙箱创建 -----

function createSandbox(meta: PluginMeta): any {
  const safeConsole = createSafeConsole();

  const safeRequire = (moduleName: string): any => {
    const baseName = moduleName.split('/')[0];
    if (BLOCKED_MODULES.includes(baseName)) {
      throw new Error(`Module "${moduleName}" is not allowed in plugin sandbox`);
    }

    const allowedModules = ['events', 'util', 'path', 'url', 'querystring'];
    if (!allowedModules.includes(baseName)) {
      throw new Error(`Module "${moduleName}" is not whitelisted`);
    }

    try {
      return require(moduleName);
    } catch (err: any) {
      throw new Error(`Failed to require "${moduleName}": ${err?.message || err}`);
    }
  };

  const sandbox: any = {
    console: safeConsole,
    require: safeRequire,
    Buffer: {
      from: Buffer.from,
      isBuffer: Buffer.isBuffer,
      alloc: Buffer.alloc,
      allocUnsafe: undefined,
      concat: Buffer.concat,
    },
    setTimeout: (cb: (...args: any[]) => void, ms: number, ...args: any[]) =>
      setTimeout(cb, Math.min(ms || 0, 30000), ...args),
    setInterval: (cb: (...args: any[]) => void, ms: number, ...args: any[]) =>
      setInterval(cb, Math.min(ms || 0, 30000), ...args),
    clearTimeout: clearTimeout,
    clearInterval: clearInterval,
    setImmediate: setImmediate,
    clearImmediate: clearImmediate,
    // 全局构造函数
    Math,
    JSON,
    Date,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Promise,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Symbol,
    Proxy,
    Reflect,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURI,
    encodeURIComponent,
    decodeURI,
    decodeURIComponent,
    escape: (globalThis as any).escape,
    unescape: (globalThis as any).unescape,
    Intl,
    TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : undefined,
    TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : undefined,
    ArrayBuffer,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    DataView,
    // 插件元数据
    __PLUGIN_META__: meta,
    __PLUGIN_ID__: meta.pluginId,
    // 模块导出
    exports: {},
    module: { exports: {} },
  };

  // 防止访问 global
  Object.defineProperty(sandbox, 'global', {
    get: () => {
      throw new Error('Access to "global" is not allowed in plugin sandbox');
    },
    configurable: false,
  });

  // 受限的 process
  Object.defineProperty(sandbox, 'process', {
    get: () => ({
      memoryUsage: () => ({
        rss: 0,
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0,
      }),
      hrtime: process.hrtime,
      cwd: () => '/sandbox',
      env: {},
      version: process.version,
      platform: process.platform,
    }),
    configurable: false,
  });

  return sandbox;
}

// ----- 插件加载 -----

function loadPlugin(pluginPath: string, meta: PluginMeta): { success: boolean; error?: string } {
  try {
    // 读取插件代码
    if (!fs.existsSync(pluginPath)) {
      return { success: false, error: `Plugin file not found: ${pluginPath}` };
    }

    const pluginCode = fs.readFileSync(pluginPath, 'utf-8');

    // 创建沙箱
    const sandbox = createSandbox(meta);
    const context = vm.createContext(sandbox);

    // 编译并执行（10秒超时）
    const script = new vm.Script(pluginCode, {
      filename: `${meta.pluginId}.js`,
      lineOffset: 0,
    });

    const exports = script.runInContext(context, {
      timeout: 10000,
      displayErrors: true,
    });

    // 创建本地 EventBus
    const eventBus = new WorkerEventBus();

    const state: PluginState = {
      meta,
      sandbox,
      context,
      exports,
      eventBus,
      gameController: null,
      aiController: null,
      loadedAt: new Date(),
    };

    plugins.set(meta.pluginId, state);
    currentPluginId = meta.pluginId;

    logInfo(`Plugin "${meta.name}" (${meta.pluginId}) loaded in Worker #${threadId}`);

    return { success: true };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    logError(`Failed to load plugin "${meta.pluginId}": ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// ----- 游戏控制器操作 -----

function createGameController(
  pluginId: string,
  roomConfig: any,
): { success: boolean; error?: string } {
  const state = plugins.get(pluginId);
  if (!state) {
    return { success: false, error: `Plugin ${pluginId} not loaded` };
  }

  try {
    // 创建框架上下文
    const frameworkContext: FrameworkContext = {
      pluginId,
      roomId: roomConfig.roomId,
      config: roomConfig.config || {},
      eventBus: state.eventBus as any,
      logger: {
        debug: (msg: string) => logDebug(`[${pluginId}] ${msg}`),
        info: (msg: string) => logInfo(`[${pluginId}] ${msg}`),
        warn: (msg: string) => logWarn(`[${pluginId}] ${msg}`),
        error: (msg: string) => logError(`[${pluginId}] ${msg}`),
      },
      localize: (key: string, params?: Record<string, string>) => {
        let text = key;
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            text = text.replace(new RegExp(`{{${k}}}`, 'g'), v);
          }
        }
        return text;
      },
    };

    let controller: any = null;

    // 尝试工厂函数
    if (state.exports && typeof state.exports.createGameController === 'function') {
      controller = state.exports.createGameController(frameworkContext, roomConfig);
    }

    // 尝试入口类
    if (!controller && state.exports && state.meta.entryClass) {
      const EntryClass = state.exports[state.meta.entryClass];
      if (typeof EntryClass === 'function') {
        controller = new EntryClass(frameworkContext, roomConfig);
      }
    }

    // 尝试默认导出
    if (!controller && state.exports && typeof state.exports === 'function') {
      controller = new state.exports(frameworkContext, roomConfig);
    }

    if (!controller) {
      return { success: false, error: 'No valid GameController found in plugin exports' };
    }

    state.gameController = controller;

    // 调用 onStart（如果存在）
    if (typeof controller.onStart === 'function') {
      const result = controller.onStart();
      if (result instanceof Promise) {
        // 同步等待不允许，但我们可以启动它
        result.catch((err: any) => {
          logWarn(`onStart async error: ${err?.message}`);
        });
      }
    }

    logInfo(`GameController created for plugin "${pluginId}" in room ${roomConfig.roomId}`);
    return { success: true };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    logError(`Failed to create GameController: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

function handleGameAction(
  pluginId: string,
  action: Action,
): { success: boolean; result?: any; error?: string } {
  const state = plugins.get(pluginId);
  if (!state || !state.gameController) {
    return { success: false, error: 'GameController not initialized' };
  }

  try {
    const gc = state.gameController;

    switch (action.type) {
      case 'start':
        gc.start();
        return { success: true, result: { status: 'started' } };

      case 'getCurrentState':
        return { success: true, result: gc.getCurrentState() };

      case 'getActivePlayer':
        return { success: true, result: gc.getActivePlayer() };

      case 'submitAction': {
        const playerId = action.data.playerId;
        const playerAction: Action = {
          type: action.data.actionType,
          playerId,
          data: action.data.actionData || {},
          timestamp: Date.now(),
        };
        gc.submitAction(playerId, playerAction);
        return { success: true, result: { status: 'action_submitted' } };
      }

      case 'getLegalActions': {
        const legalActions = gc.getLegalActions(action.data.playerId);
        return { success: true, result: legalActions };
      }

      case 'endGame':
        gc.endGame();
        return { success: true, result: { status: 'ended' } };

      case 'callMethod': {
        const methodName = action.data.method;
        const args = action.data.args || [];
        if (typeof gc[methodName] === 'function') {
          const result = gc[methodName](...args);
          return { success: true, result };
        }
        return { success: false, error: `Method "${methodName}" not found` };
      }

      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ----- AI 控制器操作 -----

function createAIController(
  pluginId: string,
  difficulty: string,
): { success: boolean; error?: string } {
  const state = plugins.get(pluginId);
  if (!state) {
    return { success: false, error: `Plugin ${pluginId} not loaded` };
  }

  try {
    let ai: any = null;

    if (state.exports && typeof state.exports.createAIController === 'function') {
      ai = state.exports.createAIController(difficulty, state.gameController);
    }

    if (!ai) {
      const aiClassNames = ['AIController', 'GameAI', 'PluginAI'];
      for (const className of aiClassNames) {
        const AIClass = state.exports[className];
        if (typeof AIClass === 'function') {
          ai = new AIClass(difficulty, state.gameController);
          break;
        }
      }
    }

    if (!ai) {
      return { success: false, error: 'No valid AIController found in plugin exports' };
    }

    state.aiController = ai;
    logInfo(`AIController created for plugin "${pluginId}" with difficulty ${difficulty}`);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

function handleAIDecision(
  pluginId: string,
  playerId: string,
  gameState: GameState,
  legalActions: Action[],
): { success: boolean; move?: Action; error?: string } {
  const state = plugins.get(pluginId);
  if (!state || !state.aiController) {
    return { success: false, error: 'AIController not initialized' };
  }

  try {
    let decisionResult: Action | null = null;

    state.aiController.requestAction(
      playerId,
      gameState,
      legalActions,
      (action: Action) => {
        decisionResult = action;
      },
    );

    if (decisionResult) {
      return { success: true, move: decisionResult };
    }

    return { success: false, error: 'AI returned no decision' };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ----- 插件卸载 -----

function unloadPlugin(pluginId: string): void {
  const state = plugins.get(pluginId);
  if (!state) return;

  try {
    // 调用 onUnload
    if (state.gameController && typeof state.gameController.onUnload === 'function') {
      try {
        state.gameController.onUnload();
      } catch (err: any) {
        logWarn(`onUnload error for "${pluginId}": ${err?.message}`);
      }
    }

    // 清理 EventBus
    state.eventBus.unsubscribeAll();

    // 清理引用
    state.gameController = null;
    state.aiController = null;
    plugins.delete(pluginId);

    if (currentPluginId === pluginId) {
      currentPluginId = null;
    }

    logInfo(`Plugin "${pluginId}" unloaded from Worker #${threadId}`);
  } catch (err: any) {
    logError(`Error unloading plugin "${pluginId}": ${err?.message}`);
  }
}

// ----- 消息处理主循环 -----

if (!parentPort) {
  throw new Error('plugin-worker.ts must be run inside a Worker thread');
}

const workerCategories = workerData?.categories || [];
logInfo(`Worker #${threadId} started, categories: [${workerCategories.join(', ')}]`);

parentPort.on('message', async (message) => {
  const { type, requestId } = message;

  // 辅助函数：发送响应
  const sendResponse = (data: any) => {
    if (parentPort) {
      parentPort.postMessage({ type: `${type}_RESPONSE`, requestId, ...data });
    }
  };

  try {
    switch (type) {
      case 'LOAD_PLUGIN': {
        const { pluginPath, meta } = message;
        const result = loadPlugin(pluginPath, meta);
        sendResponse(result);
        break;
      }

      case 'CREATE_GAME_CONTROLLER': {
        const { pluginId, roomConfig } = message;
        const result = createGameController(pluginId, roomConfig);
        sendResponse(result);
        break;
      }

      case 'GAME_ACTION': {
        const { pluginId, action } = message;
        const result = handleGameAction(pluginId, action);
        sendResponse(result);
        break;
      }

      case 'CREATE_AI_CONTROLLER': {
        const { pluginId, difficulty } = message;
        const result = createAIController(pluginId, difficulty);
        sendResponse(result);
        break;
      }

      case 'AI_DECISION': {
        const { pluginId, playerId, gameState, legalActions } = message;
        const result = handleAIDecision(pluginId, playerId, gameState, legalActions);
        sendResponse(result);
        break;
      }

      case 'GET_PLUGIN_EXPORTS': {
        const { pluginId } = message;
        const state = plugins.get(pluginId);
        if (state) {
          const exportNames = Object.keys(state.exports || {});
          sendResponse({ success: true, exports: exportNames });
        } else {
          sendResponse({ success: false, error: `Plugin ${pluginId} not found` });
        }
        break;
      }

      case 'CALL_EXPORT': {
        const { pluginId, methodName, args } = message;
        const state = plugins.get(pluginId);
        if (!state) {
          sendResponse({ success: false, error: `Plugin ${pluginId} not found` });
          break;
        }
        if (state.exports && typeof state.exports[methodName] === 'function') {
          try {
            const result = state.exports[methodName](...(args || []));
            sendResponse({ success: true, result });
          } catch (err: any) {
            sendResponse({ success: false, error: err?.message || String(err) });
          }
        } else {
          sendResponse({ success: false, error: `Method "${methodName}" not found` });
        }
        break;
      }

      case 'EVENT': {
        const { pluginId, eventType, payload } = message;
        const state = plugins.get(pluginId);
        if (state) {
          state.eventBus.publish(eventType, payload);
        }
        sendResponse({ success: true });
        break;
      }

      case 'UNLOAD_PLUGIN': {
        const { pluginId } = message;
        unloadPlugin(pluginId);
        sendResponse({ success: true });
        break;
      }

      case 'PING': {
        sendResponse({ success: true, threadId });
        break;
      }

      case 'GET_MEMORY_USAGE': {
        const usage = process.memoryUsage();
        sendResponse({
          success: true,
          memory: {
            rss: usage.rss,
            heapTotal: usage.heapTotal,
            heapUsed: usage.heapUsed,
            external: usage.external,
            arrayBuffers: usage.arrayBuffers,
          },
        });
        break;
      }

      default: {
        logWarn(`Unknown message type: ${type}`);
        sendResponse({ success: false, error: `Unknown message type: ${type}` });
      }
    }
  } catch (err: any) {
    logError(`Error handling message ${type}: ${err?.message}`);
    sendResponse({ success: false, error: err?.message || String(err) });
  }
});

// 监听未捕获的异常
process.on('uncaughtException', (err) => {
  logError(`Uncaught exception in Worker #${threadId}: ${err.message}`);
  // 通知主线程
  if (parentPort) {
    parentPort.postMessage({ type: 'WORKER_CRASH', error: err.message });
  }
});

process.on('unhandledRejection', (reason) => {
  logError(`Unhandled rejection in Worker #${threadId}: ${reason}`);
});
