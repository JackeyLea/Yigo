import {
  Injectable,
  Logger,
  OnModuleDestroy,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as vm from 'vm';
import * as path from 'path';
import * as fs from 'fs';
import { PluginMeta } from './interfaces/plugin-meta.interface';
import { EventBus } from './event-bus';
import {
  GameController,
  GameState,
  Action,
  PlayerState,
} from './interfaces/game-controller.interface';
import { AIController } from './interfaces/ai-controller.interface';
import {
  FrameworkContext,
  Logger as FrameworkLogger,
} from './interfaces/framework-context.interface';

export interface PluginInstance {
  pluginId: string;
  meta: PluginMeta;
  context: vm.Context;
  exports: any;
  status: 'loaded' | 'running' | 'error' | 'degraded';
  loadedAt: Date;
  memoryUsageMB: number;
  eventBusRef: EventBus;
}

interface SandboxMemory {
  lastCheck: number;
  peakMB: number;
  violations: number;
}

// 禁止访问的 Node.js 模块
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
  'crypto',
  'dns',
  'repl',
  'vm',
];

// 安全的 console 实现
const createSafeConsole = (): any => {
  const noop = () => {};
  return {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: (console as any).debug ? (console as any).debug.bind(console) : noop,
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
};

/**
 * PluginSandbox - 插件沙箱隔离系统
 *
 * 使用 Node.js vm 模块创建隔离上下文，实现:
 * - 代码隔离：插件在独立 vm.Context 中运行
 * - 模块白名单：禁止访问 fs、net、child_process 等危险模块
 * - 内存监控：定期检查 process.memoryUsage()
 * - 状态管理：loaded → running → error/degraded
 */
@Injectable()
export class PluginSandbox implements OnModuleDestroy {
  private readonly logger = new Logger(PluginSandbox.name);
  private readonly instances = new Map<string, PluginInstance>();
  private readonly memoryStats = new Map<string, SandboxMemory>();
  private readonly memoryCheckIntervalMs = 5000;
  private readonly memoryViolationThreshold = 3;
  private memoryCheckTimer?: ReturnType<typeof setInterval>;
  private destroyed = false;

  constructor() {
    this.startMemoryMonitoring();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.memoryCheckTimer) {
      clearInterval(this.memoryCheckTimer);
    }
    // 卸载所有插件
    for (const [pluginId] of this.instances) {
      this.unload(pluginId).catch((err) => {
        this.logger.error(`Error unloading plugin ${pluginId}: ${err.message}`);
      });
    }
    this.instances.clear();
    this.memoryStats.clear();
  }

  /**
   * 加载插件到沙箱中
   */
  async load(pluginPath: string, meta: PluginMeta): Promise<PluginInstance> {
    if (this.destroyed) {
      throw new InternalServerErrorException('PluginSandbox has been destroyed');
    }

    if (this.instances.has(meta.pluginId)) {
      throw new BadRequestException(
        `Plugin ${meta.pluginId} is already loaded`,
      );
    }

    // 检查插件文件是否存在
    const resolvedPath = path.resolve(pluginPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new BadRequestException(
        `Plugin file not found: ${resolvedPath}`,
      );
    }

    try {
      // 读取插件代码
      const pluginCode = fs.readFileSync(resolvedPath, 'utf-8');

      // 创建隔离的 vm.Context
      const sandbox = this.createSandbox(meta);
      const context = vm.createContext(sandbox);

      // 编译并执行插件代码
      const script = new vm.Script(pluginCode, {
        filename: `${meta.pluginId}.js`,
        lineOffset: 0,
      });

      const exports = script.runInContext(context, {
        timeout: 10000, // 10秒执行超时
        displayErrors: true,
      });

      const eventBus = new EventBus();

      const instance: PluginInstance = {
        pluginId: meta.pluginId,
        meta,
        context,
        exports,
        status: 'loaded',
        loadedAt: new Date(),
        memoryUsageMB: 0,
        eventBusRef: eventBus,
      };

      this.instances.set(meta.pluginId, instance);
      this.memoryStats.set(meta.pluginId, {
        lastCheck: Date.now(),
        peakMB: 0,
        violations: 0,
      });

      this.logger.log(
        `Plugin "${meta.name}" (${meta.pluginId}) loaded into sandbox`,
      );
      return instance;
    } catch (err: any) {
      this.logger.error(
        `Failed to load plugin "${meta.pluginId}": ${err?.message || err}`,
      );
      throw new InternalServerErrorException(
        `Failed to load plugin: ${err?.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * 卸载插件
   */
  async unload(pluginId: string): Promise<void> {
    const instance = this.instances.get(pluginId);
    if (!instance) {
      this.logger.warn(`Plugin ${pluginId} not found for unload`);
      return;
    }

    // 通知插件进行清理
    try {
      if (instance.exports && typeof instance.exports.onUnload === 'function') {
        const result = instance.exports.onUnload();
        if (result instanceof Promise) {
          await Promise.race([
            result,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Unload timeout')), 5000),
            ),
          ]);
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `Plugin ${pluginId} onUnload error: ${err?.message || err}`,
      );
    }

    // 清理 EventBus 订阅
    try {
      instance.eventBusRef.onModuleDestroy();
    } catch {
      // 忽略
    }

    this.instances.delete(pluginId);
    this.memoryStats.delete(pluginId);
    this.logger.log(`Plugin ${pluginId} unloaded from sandbox`);
  }

  /**
   * 获取插件实例
   */
  getInstance(pluginId: string): PluginInstance | undefined {
    return this.instances.get(pluginId);
  }

  /**
   * 获取插件状态
   */
  getStatus(pluginId: string): 'loaded' | 'running' | 'error' | 'degraded' {
    const instance = this.instances.get(pluginId);
    return instance?.status ?? 'error';
  }

  /**
   * 设置插件状态
   */
  setStatus(
    pluginId: string,
    status: 'loaded' | 'running' | 'error' | 'degraded',
  ): void {
    const instance = this.instances.get(pluginId);
    if (instance) {
      instance.status = status;
    }
  }

  /**
   * 获取所有已加载的插件实例
   */
  getAllInstances(): PluginInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * 创建框架上下文（供插件使用）
   */
  createFrameworkContext(
    pluginId: string,
    roomId: string,
    config: Record<string, any>,
    eventBus: EventBus,
  ): FrameworkContext {
    const logger: FrameworkLogger = {
      debug: (msg: string, ...args: any[]) =>
        this.logger.debug(`[${pluginId}] ${msg}`, ...args),
      info: (msg: string, ...args: any[]) =>
        this.logger.log(`[${pluginId}] ${msg}`, ...args),
      warn: (msg: string, ...args: any[]) =>
        this.logger.warn(`[${pluginId}] ${msg}`, ...args),
      error: (msg: string, ...args: any[]) =>
        this.logger.error(`[${pluginId}] ${msg}`, ...args),
    };

    const localize = (key: string, params?: Record<string, string>): string => {
      let text = key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(new RegExp(`{{${k}}}`, 'g'), v);
        }
      }
      return text;
    };

    return {
      pluginId,
      roomId,
      config,
      eventBus,
      logger,
      localize,
    };
  }

  // ==================== 私有方法 ====================

  private createSandbox(meta: PluginMeta): any {
    const safeConsole = createSafeConsole();

    // 创建安全的 require 函数
    const safeRequire = (moduleName: string): any => {
      // 检查是否在禁止列表中
      const baseName = moduleName.split('/')[0];
      if (BLOCKED_MODULES.includes(baseName)) {
        throw new Error(
          `Module "${moduleName}" is not allowed in plugin sandbox`,
        );
      }

      // 只允许 require 白名单中的模块
      const allowedModules = ['events', 'util', 'path', 'url', 'querystring'];
      if (!allowedModules.includes(baseName)) {
        throw new Error(
          `Module "${moduleName}" is not whitelisted for plugin sandbox`,
        );
      }

      // 使用安全的 require
      try {
        return require(moduleName);
      } catch (err: any) {
        throw new Error(
          `Failed to require "${moduleName}": ${err?.message || err}`,
        );
      }
    };

    // 构建沙箱对象
    const sandbox: any = {
      console: safeConsole,
      require: safeRequire,
      Buffer: {
        from: Buffer.from,
        isBuffer: Buffer.isBuffer,
        alloc: Buffer.alloc,
        allocUnsafe: undefined, // 移除不安全的 allocUnsafe
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
      // 暴露游戏接口类型
      GameController: null,
      GameState: null,
      Action: null,
      PlayerState: null,
      AIController: null,
      FrameworkContext: null,
      // 插件元数据
      __PLUGIN_META__: meta,
      __PLUGIN_ID__: meta.pluginId,
      // Math 和 JSON
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
      Intl: Intl,
      TextEncoder: (typeof TextEncoder !== 'undefined' ? TextEncoder : undefined),
      TextDecoder: (typeof TextDecoder !== 'undefined' ? TextDecoder : undefined),
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
      // 模块导出
      exports: {},
      module: { exports: {} },
      global: undefined, // 禁止访问 global
    };

    // 防止访问 global
    Object.defineProperty(sandbox, 'global', {
      get: () => {
        throw new Error('Access to "global" is not allowed in plugin sandbox');
      },
      configurable: false,
    });

    // 防止访问 process
    Object.defineProperty(sandbox, 'process', {
      get: () => {
        return {
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
        };
      },
      configurable: false,
    });

    return sandbox;
  }

  private startMemoryMonitoring(): void {
    this.memoryCheckTimer = setInterval(() => {
      this.checkMemoryUsage();
    }, this.memoryCheckIntervalMs);
  }

  private checkMemoryUsage(): void {
    if (this.destroyed) return;

    const usage = process.memoryUsage();
    const usedMB = Math.round(usage.heapUsed / 1024 / 1024);

    for (const [pluginId, instance] of this.instances) {
      const limit = instance.meta.memoryLimitMB ?? 128; // 默认 128MB
      const stats = this.memoryStats.get(pluginId);
      if (!stats) continue;

      stats.peakMB = Math.max(stats.peakMB, usedMB);
      instance.memoryUsageMB = usedMB;

      if (usedMB > limit) {
        stats.violations++;
        this.logger.warn(
          `Plugin "${pluginId}" memory usage (${usedMB}MB) exceeds limit (${limit}MB), violation #${stats.violations}`,
        );

        if (stats.violations >= this.memoryViolationThreshold) {
          this.logger.error(
            `Plugin "${pluginId}" exceeded memory limit ${this.memoryViolationThreshold} times, degrading...`,
          );
          instance.status = 'degraded';

          // 通知插件内存超限
          try {
            if (
              instance.exports &&
              typeof instance.exports.onMemoryWarning === 'function'
            ) {
              instance.exports.onMemoryWarning(usedMB, limit);
            }
          } catch {
            // 忽略
          }
        }
      } else {
        // 如果内存恢复正常，减少违规计数
        if (stats.violations > 0) {
          stats.violations = Math.max(0, stats.violations - 1);
        }
        if (instance.status === 'degraded') {
          instance.status = 'running';
        }
      }
    }
  }
}
