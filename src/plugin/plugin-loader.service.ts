import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PluginSandbox } from './plugin-sandbox';
import { EventBus } from './event-bus';
import { PluginMeta } from './interfaces/plugin-meta.interface';
import {
  GameController,
  GameState,
  Action,
} from './interfaces/game-controller.interface';
import { AIController } from './interfaces/ai-controller.interface';
import { FrameworkContext } from './interfaces/framework-context.interface';

export interface RoomConfig {
  roomId: string;
  gameMode: string;
  playerIds: string[];
  config?: Record<string, any>;
}

export interface LoadedPlugin {
  meta: PluginMeta;
  pluginPath: string;
  loadedAt: Date;
  status: 'active' | 'unloading' | 'reloading' | 'error';
  lastError?: string;
}

/**
 * PluginLoaderService - 插件加载与生命周期管理服务
 *
 * 管理插件的完整生命周期：
 * 加载 → 启动 → 停止 → 卸载
 *
 * 支持：
 * - 动态 require/import 加载
 * - 插件热重载（先加载新版本→切换引用→卸载旧版本）
 * - 内存限制通过定期检查 process.memoryUsage() 实现
 * - 所有操作记录审计日志
 */
@Injectable()
export class PluginLoaderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PluginLoaderService.name);
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly auditLog: Array<{
    timestamp: Date;
    action: string;
    pluginId: string;
    details: string;
    success: boolean;
  }> = [];
  private readonly maxAuditLogEntries = 10000;
  private initialized = false;
  private destroyed = false;

  constructor(private readonly sandbox: PluginSandbox) {}

  async onModuleInit(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.logger.log('PluginLoaderService initialized');

    // 启动时扫描插件目录
    await this.scanPluginDirectory();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    // 卸载所有插件
    const pluginIds = Array.from(this.plugins.keys());
    for (const pluginId of pluginIds) {
      try {
        await this.unloadPlugin(pluginId);
      } catch (err: any) {
        this.logger.error(
          `Error unloading plugin ${pluginId} during shutdown: ${err.message}`,
        );
      }
    }
    this.plugins.clear();
    this.logger.log('PluginLoaderService destroyed');
  }

  // ==================== 插件目录扫描 ====================

  /**
   * 扫描插件目录，自动加载有效的插件
   */
  private async scanPluginDirectory(): Promise<void> {
    const pluginDir = this.getPluginDirectory();
    if (!fs.existsSync(pluginDir)) {
      this.logger.log(`Plugin directory does not exist: ${pluginDir}, skipping scan`);
      return;
    }

    try {
      const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
      const pluginFolders = entries
        .filter((e: fs.Dirent) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e: fs.Dirent) => e.name);

      for (const folder of pluginFolders) {
        const metaPath = path.join(pluginDir, folder, 'plugin.json');
        const pluginPath = path.join(pluginDir, folder, 'index.js');

        if (fs.existsSync(metaPath) && fs.existsSync(pluginPath)) {
          try {
            await this.loadPlugin(pluginPath);
          } catch (err: any) {
            this.logger.warn(
              `Auto-load failed for plugin in ${folder}: ${err.message}`,
            );
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Plugin directory scan failed: ${err.message}`);
    }
  }

  // ==================== 核心生命周期方法 ====================

  /**
   * 加载插件
   * 生命周期阶段：加载 (load)
   */
  async loadPlugin(pluginPath: string): Promise<PluginMeta> {
    if (this.destroyed) {
      throw new InternalServerErrorException(
        'PluginLoaderService has been destroyed',
      );
    }

    const resolvedPath = path.resolve(pluginPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new NotFoundException(`Plugin file not found: ${resolvedPath}`);
    }

    // 读取 plugin.json 元数据
    const meta = await this.readPluginMeta(resolvedPath);

    // 检查是否已加载
    if (this.plugins.has(meta.pluginId)) {
      throw new BadRequestException(
        `Plugin "${meta.pluginId}" is already loaded`,
      );
    }

    try {
      // 加载到沙箱
      await this.sandbox.load(resolvedPath, meta);

      const loadedPlugin: LoadedPlugin = {
        meta,
        pluginPath: resolvedPath,
        loadedAt: new Date(),
        status: 'active',
      };

      this.plugins.set(meta.pluginId, loadedPlugin);
      this.sandbox.setStatus(meta.pluginId, 'loaded');

      this.logAudit('LOAD', meta.pluginId, `Loaded from ${resolvedPath}`, true);
      this.logger.log(
        `Plugin "${meta.name}" (${meta.pluginId} v${meta.version}) loaded successfully`,
      );

      return meta;
    } catch (err: any) {
      this.logAudit(
        'LOAD',
        meta.pluginId,
        `Failed: ${err.message}`,
        false,
      );
      throw err;
    }
  }

  /**
   * 卸载插件
   * 生命周期阶段：停止 (stop) → 卸载 (unload)
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    if (this.destroyed) {
      throw new InternalServerErrorException(
        'PluginLoaderService has been destroyed',
      );
    }

    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new NotFoundException(`Plugin "${pluginId}" is not loaded`);
    }

    plugin.status = 'unloading';

    try {
      // 停止插件（如果正在运行）
      const instance = this.sandbox.getInstance(pluginId);
      if (
        instance &&
        instance.exports &&
        typeof instance.exports.onStop === 'function'
      ) {
        try {
          const result = instance.exports.onStop();
          if (result instanceof Promise) {
            await Promise.race([
              result,
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Stop timeout')), 5000),
              ),
            ]);
          }
        } catch (stopErr: any) {
          this.logger.warn(
            `Plugin ${pluginId} onStop error: ${stopErr.message}`,
          );
        }
      }

      // 从沙箱卸载
      await this.sandbox.unload(pluginId);
      this.plugins.delete(pluginId);

      this.logAudit('UNLOAD', pluginId, 'Unloaded successfully', true);
      this.logger.log(`Plugin "${pluginId}" unloaded successfully`);
    } catch (err: any) {
      plugin.status = 'error';
      plugin.lastError = err.message;
      this.logAudit('UNLOAD', pluginId, `Failed: ${err.message}`, false);
      throw new InternalServerErrorException(
        `Failed to unload plugin "${pluginId}": ${err.message}`,
      );
    }
  }

  /**
   * 热重载插件
   * 流程：先加载新版本 → 切换引用 → 卸载旧版本
   */
  async reloadPlugin(pluginId: string): Promise<PluginMeta> {
    if (this.destroyed) {
      throw new InternalServerErrorException(
        'PluginLoaderService has been destroyed',
      );
    }

    const oldPlugin = this.plugins.get(pluginId);
    if (!oldPlugin) {
      throw new NotFoundException(`Plugin "${pluginId}" is not loaded`);
    }

    this.logAudit('RELOAD', pluginId, 'Starting hot reload...', true);

    // 备份旧插件信息
    const oldPluginPath = oldPlugin.pluginPath;
    const tempId = `${pluginId}_old_${Date.now()}`;

    try {
      oldPlugin.status = 'reloading';

      // 读取新的元数据
      const newMeta = await this.readPluginMeta(oldPluginPath);

      // 使用临时 ID 加载新版本
      const tempMeta = { ...newMeta, pluginId: `${pluginId}_new` };
      await this.sandbox.load(oldPluginPath, tempMeta);

      // 停止旧版本
      const oldInstance = this.sandbox.getInstance(pluginId);
      if (
        oldInstance &&
        oldInstance.exports &&
        typeof oldInstance.exports.onStop === 'function'
      ) {
        try {
          const result = oldInstance.exports.onStop();
          if (result instanceof Promise) {
            await Promise.race([
              result,
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Stop timeout')), 5000),
              ),
            ]);
          }
        } catch (stopErr: any) {
          this.logger.warn(
            `Old plugin ${pluginId} onStop error: ${stopErr.message}`,
          );
        }
      }

      // 切换：卸载旧版本
      await this.sandbox.unload(pluginId);
      this.plugins.delete(pluginId);

      // 切换：重新用正确 ID 加载新版本
      await this.sandbox.unload(tempMeta.pluginId);
      const finalMeta = await this.sandbox.load(oldPluginPath, newMeta);

      const loadedPlugin: LoadedPlugin = {
        meta: newMeta,
        pluginPath: oldPluginPath,
        loadedAt: new Date(),
        status: 'active',
      };

      this.plugins.set(pluginId, loadedPlugin);
      this.sandbox.setStatus(pluginId, 'loaded');

      // 启动新版本
      const newInstance = this.sandbox.getInstance(pluginId);
      if (
        newInstance &&
        newInstance.exports &&
        typeof newInstance.exports.onStart === 'function'
      ) {
        try {
          newInstance.exports.onStart();
          this.sandbox.setStatus(pluginId, 'running');
        } catch (startErr: any) {
          this.logger.warn(
            `Reloaded plugin ${pluginId} onStart error: ${startErr.message}`,
          );
          this.sandbox.setStatus(pluginId, 'error');
        }
      }

      this.logAudit('RELOAD', pluginId, 'Hot reload completed', true);
      this.logger.log(`Plugin "${pluginId}" hot reloaded successfully`);

      return newMeta;
    } catch (err: any) {
      // 回滚：如果旧版本还在，恢复状态
      if (this.plugins.has(pluginId)) {
        const plugin = this.plugins.get(pluginId)!;
        plugin.status = 'error';
        plugin.lastError = err.message;
      }

      this.logAudit('RELOAD', pluginId, `Failed: ${err.message}`, false);
      throw new InternalServerErrorException(
        `Failed to reload plugin "${pluginId}": ${err.message}`,
      );
    }
  }

  /**
   * 启动插件
   * 生命周期阶段：启动 (start)
   */
  async startPlugin(pluginId: string): Promise<void> {
    const instance = this.sandbox.getInstance(pluginId);
    if (!instance) {
      throw new NotFoundException(`Plugin "${pluginId}" is not loaded`);
    }

    if (
      instance.exports &&
      typeof instance.exports.onStart === 'function'
    ) {
      try {
        const result = instance.exports.onStart();
        if (result instanceof Promise) {
          await Promise.race([
            result,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Start timeout')), 10000),
            ),
          ]);
        }
        this.sandbox.setStatus(pluginId, 'running');
        this.logAudit('START', pluginId, 'Plugin started', true);
      } catch (err: any) {
        this.sandbox.setStatus(pluginId, 'error');
        this.logAudit('START', pluginId, `Failed: ${err.message}`, false);
        throw new InternalServerErrorException(
          `Failed to start plugin "${pluginId}": ${err.message}`,
        );
      }
    } else {
      this.sandbox.setStatus(pluginId, 'running');
    }
  }

  // ==================== 查询方法 ====================

  /**
   * 获取所有已加载的插件元数据
   */
  getLoadedPlugins(): PluginMeta[] {
    return Array.from(this.plugins.values())
      .filter((p) => p.status === 'active')
      .map((p) => p.meta);
  }

  /**
   * 获取指定插件的元数据
   */
  getPlugin(pluginId: string): PluginMeta | undefined {
    return this.plugins.get(pluginId)?.meta;
  }

  /**
   * 获取插件加载信息
   */
  getLoadedPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  // ==================== 控制器工厂 ====================

  /**
   * 创建游戏控制器
   */
  async createGameController(
    pluginId: string,
    roomConfig: RoomConfig,
  ): Promise<GameController> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new NotFoundException(
        `Plugin "${pluginId}" is not loaded`,
      );
    }

    const instance = this.sandbox.getInstance(pluginId);
    if (!instance) {
      throw new NotFoundException(
        `Plugin "${pluginId}" sandbox instance not found`,
      );
    }

    // 确保插件已启动
    if (instance.status !== 'running') {
      await this.startPlugin(pluginId);
    }

    // 创建 EventBus
    const eventBus = new EventBus();

    // 创建框架上下文
    const frameworkContext = this.sandbox.createFrameworkContext(
      pluginId,
      roomConfig.roomId,
      roomConfig.config || {},
      eventBus,
    );

    // 如果插件导出了 createGameController 工厂函数，使用它
    if (
      instance.exports &&
      typeof instance.exports.createGameController === 'function'
    ) {
      try {
        const controller = instance.exports.createGameController(
          frameworkContext,
          roomConfig,
        );

        if (controller && this.isValidGameController(controller)) {
          this.logAudit(
            'CREATE_CONTROLLER',
            pluginId,
            `GameController created for room ${roomConfig.roomId}`,
            true,
          );
          return controller as GameController;
        }
      } catch (err: any) {
        throw new InternalServerErrorException(
          `Failed to create GameController: ${err.message}`,
        );
      }
    }

    // 如果插件导出了 entry class，实例化它
    if (instance.exports && instance.meta.entryClass) {
      const EntryClass = instance.exports[instance.meta.entryClass];
      if (typeof EntryClass === 'function') {
        try {
          const entryInstance = new EntryClass(frameworkContext, roomConfig);
          if (this.isValidGameController(entryInstance)) {
            this.logAudit(
              'CREATE_CONTROLLER',
              pluginId,
              `GameController created via entry class for room ${roomConfig.roomId}`,
              true,
            );
            return entryInstance as GameController;
          }
        } catch (err: any) {
          throw new InternalServerErrorException(
            `Failed to instantiate entry class: ${err.message}`,
          );
        }
      }
    }

    throw new BadRequestException(
      `Plugin "${pluginId}" does not export a valid GameController`,
    );
  }

  /**
   * 创建 AI 控制器
   */
  async createAIController(
    pluginId: string,
    difficulty: string,
    gameController: GameController,
  ): Promise<AIController> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new NotFoundException(
        `Plugin "${pluginId}" is not loaded`,
      );
    }

    const instance = this.sandbox.getInstance(pluginId);
    if (!instance) {
      throw new NotFoundException(
        `Plugin "${pluginId}" sandbox instance not found`,
      );
    }

    // 如果插件导出了 createAIController 工厂函数，使用它
    if (
      instance.exports &&
      typeof instance.exports.createAIController === 'function'
    ) {
      try {
        const controller = instance.exports.createAIController(
          difficulty,
          gameController,
        );

        if (controller && this.isValidAIController(controller)) {
          this.logAudit(
            'CREATE_AI',
            pluginId,
            `AIController created with difficulty ${difficulty}`,
            true,
          );
          return controller as AIController;
        }
      } catch (err: any) {
        throw new InternalServerErrorException(
          `Failed to create AIController: ${err.message}`,
        );
      }
    }

    // 如果插件导出了 AI 相关的类
    if (instance.exports) {
      const aiClassNames = ['AIController', 'GameAI', 'PluginAI'];
      for (const className of aiClassNames) {
        const AIClass = instance.exports[className];
        if (typeof AIClass === 'function') {
          try {
            const aiInstance = new AIClass(difficulty, gameController);
            if (this.isValidAIController(aiInstance)) {
              this.logAudit(
                'CREATE_AI',
                pluginId,
                `AIController created via ${className}`,
                true,
              );
              return aiInstance as AIController;
            }
          } catch (err: any) {
            this.logger.warn(
              `Failed to instantiate AI class ${className}: ${err.message}`,
            );
          }
        }
      }
    }

    throw new BadRequestException(
      `Plugin "${pluginId}" does not export a valid AIController`,
    );
  }

  // ==================== 审计日志 ====================

  /**
   * 获取审计日志
   */
  getAuditLog(
    pluginId?: string,
    limit = 100,
  ): Array<{
    timestamp: Date;
    action: string;
    pluginId: string;
    details: string;
    success: boolean;
  }> {
    let logs = this.auditLog;
    if (pluginId) {
      logs = logs.filter((l) => l.pluginId === pluginId);
    }
    return logs.slice(-limit).reverse();
  }

  // ==================== 私有方法 ====================

  private async readPluginMeta(pluginPath: string): Promise<PluginMeta> {
    const dir = path.dirname(pluginPath);
    const metaPath = path.join(dir, 'plugin.json');

    if (!fs.existsSync(metaPath)) {
      throw new NotFoundException(
        `Plugin metadata not found: ${metaPath}`,
      );
    }

    try {
      const content = fs.readFileSync(metaPath, 'utf-8');
      const raw = JSON.parse(content);

      // 基本验证
      if (!raw.pluginId || !raw.name || !raw.version) {
        throw new BadRequestException(
          'Plugin metadata missing required fields: pluginId, name, version',
        );
      }

      const meta: PluginMeta = {
        pluginId: raw.pluginId,
        name: raw.name,
        version: raw.version,
        gameType: raw.gameType || raw.game_type || 'unknown',
        category: raw.category || raw.gameType || 'board',
        minPlayers: raw.minPlayers ?? raw.min_players ?? 1,
        maxPlayers: raw.maxPlayers ?? raw.max_players ?? 1,
        entryClass: raw.entryClass || raw.entry_class || 'default',
        supportedModes: raw.supportedModes || raw.supported_modes || [],
        memoryLimitMB: raw.memoryLimitMB ?? raw.memory_limit_mb ?? 128,
        allowedDomains: raw.allowedDomains || raw.allowed_domains,
        neuralNetwork: raw.neuralNetwork || raw.neural_network,
        errorDefinitions: raw.errorDefinitions || raw.error_definitions,
      };

      // 验证 category
      if (!['board', 'card', 'mahjong'].includes(meta.category)) {
        meta.category = 'board';
      }

      return meta;
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        `Invalid plugin metadata: ${err.message}`,
      );
    }
  }

  private getPluginDirectory(): string {
    return (
      process.env.PLUGIN_DIR || path.resolve(process.cwd(), 'plugins')
    );
  }

  private isValidGameController(obj: any): boolean {
    return (
      obj &&
      typeof obj.start === 'function' &&
      typeof obj.getCurrentState === 'function' &&
      typeof obj.getActivePlayer === 'function' &&
      typeof obj.submitAction === 'function' &&
      typeof obj.getLegalActions === 'function' &&
      typeof obj.endGame === 'function'
    );
  }

  private isValidAIController(obj: any): boolean {
    return obj && typeof obj.requestAction === 'function';
  }

  private logAudit(
    action: string,
    pluginId: string,
    details: string,
    success: boolean,
  ): void {
    this.auditLog.push({
      timestamp: new Date(),
      action,
      pluginId,
      details,
      success,
    });

    // 限制日志数量
    if (this.auditLog.length > this.maxAuditLogEntries) {
      this.auditLog.splice(0, this.auditLog.length - this.maxAuditLogEntries);
    }
  }
}
