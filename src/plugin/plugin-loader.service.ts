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
import { PluginSandbox, PluginInstance } from './plugin-sandbox';
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
 * 基于 Worker 线程架构，所有插件操作通过 MessagePort 异步通信：
 * - 插件代码在独立 Worker 线程中运行（进程级隔离）
 * - Worker 内使用 vm 模块做二次隔离（双重防护）
 * - 支持插件热重载
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
    this.logger.log('PluginLoaderService initialized (Worker thread mode)');

    // 启动时扫描插件目录
    await this.scanPluginDirectory();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
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
   * 加载插件到 Worker 沙箱中
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

    const meta = await this.readPluginMeta(resolvedPath);

    if (this.plugins.has(meta.pluginId)) {
      throw new BadRequestException(
        `Plugin "${meta.pluginId}" is already loaded`,
      );
    }

    try {
      // 加载到 Worker 沙箱
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
        `Plugin "${meta.name}" (${meta.pluginId} v${meta.version}) loaded successfully (Worker sandbox)`,
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
      // 通过 Worker 调用 onStop（如果存在）
      const instance = this.sandbox.getInstance(pluginId);
      if (instance) {
        try {
          await this.callPluginExport(pluginId, 'onStop', [], 5000);
        } catch (stopErr: any) {
          this.logger.warn(
            `Plugin ${pluginId} onStop error: ${stopErr.message}`,
          );
        }
      }

      // 从沙箱卸载（Worker 会被释放回池中）
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

    const oldPluginPath = oldPlugin.pluginPath;

    try {
      oldPlugin.status = 'reloading';

      // 读取新的元数据
      const newMeta = await this.readPluginMeta(oldPluginPath);

      // 使用临时 ID 加载新版本
      const tempMeta = { ...newMeta, pluginId: `${pluginId}_new` };
      await this.sandbox.load(oldPluginPath, tempMeta);

      // 停止旧版本
      try {
        await this.callPluginExport(pluginId, 'onStop', [], 5000);
      } catch (stopErr: any) {
        this.logger.warn(
          `Old plugin ${pluginId} onStop error: ${stopErr.message}`,
        );
      }

      // 卸载旧版本
      await this.sandbox.unload(pluginId);
      this.plugins.delete(pluginId);

      // 卸载临时版本，然后重新加载为正式版本
      await this.sandbox.unload(tempMeta.pluginId);
      await this.sandbox.load(oldPluginPath, newMeta);

      const loadedPlugin: LoadedPlugin = {
        meta: newMeta,
        pluginPath: oldPluginPath,
        loadedAt: new Date(),
        status: 'active',
      };

      this.plugins.set(pluginId, loadedPlugin);
      this.sandbox.setStatus(pluginId, 'loaded');

      // 启动新版本
      try {
        await this.callPluginExport(pluginId, 'onStart', [], 5000);
        this.sandbox.setStatus(pluginId, 'running');
      } catch (startErr: any) {
        this.logger.warn(
          `Reloaded plugin ${pluginId} onStart error: ${startErr.message}`,
        );
        this.sandbox.setStatus(pluginId, 'error');
      }

      this.logAudit('RELOAD', pluginId, 'Hot reload completed', true);
      this.logger.log(`Plugin "${pluginId}" hot reloaded successfully`);

      return newMeta;
    } catch (err: any) {
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
   */
  async startPlugin(pluginId: string): Promise<void> {
    const instance = this.sandbox.getInstance(pluginId);
    if (!instance) {
      throw new NotFoundException(`Plugin "${pluginId}" is not loaded`);
    }

    try {
      await this.callPluginExport(pluginId, 'onStart', [], 10000);
      this.sandbox.setStatus(pluginId, 'running');
      this.logAudit('START', pluginId, 'Plugin started', true);
    } catch (err: any) {
      this.sandbox.setStatus(pluginId, 'error');
      this.logAudit('START', pluginId, `Failed: ${err.message}`, false);
      throw new InternalServerErrorException(
        `Failed to start plugin "${pluginId}": ${err.message}`,
      );
    }
  }

  // ==================== 查询方法 ====================

  getLoadedPlugins(): PluginMeta[] {
    return Array.from(this.plugins.values())
      .filter((p) => p.status === 'active')
      .map((p) => p.meta);
  }

  getPlugin(pluginId: string): PluginMeta | undefined {
    return this.plugins.get(pluginId)?.meta;
  }

  getLoadedPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  // ==================== 控制器工厂 ====================

  /**
   * 创建游戏控制器
   * 通过 Worker 消息在沙箱内实例化，返回代理对象
   */
  async createGameController(
    pluginId: string,
    roomConfig: RoomConfig,
  ): Promise<GameController> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new NotFoundException(`Plugin "${pluginId}" is not loaded`);
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

    // 通过 Worker 创建 GameController
    const result = await this.sendWorkerMessage(instance, {
      type: 'CREATE_GAME_CONTROLLER',
      pluginId,
      roomConfig,
    }, 10000);

    if (!result.success) {
      throw new InternalServerErrorException(
        `Failed to create GameController: ${result.error}`,
      );
    }

    instance.gameControllerCreated = true;
    this.logAudit(
      'CREATE_CONTROLLER',
      pluginId,
      `GameController created for room ${roomConfig.roomId}`,
      true,
    );

    // 返回代理对象（所有调用通过 MessagePort 转发）
    return this.sandbox.createGameController(pluginId, roomConfig);
  }

  /**
   * 创建 AI 控制器
   */
  async createAIController(
    pluginId: string,
    difficulty: string,
    _gameController: GameController,
  ): Promise<AIController> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new NotFoundException(`Plugin "${pluginId}" is not loaded`);
    }

    const instance = this.sandbox.getInstance(pluginId);
    if (!instance) {
      throw new NotFoundException(
        `Plugin "${pluginId}" sandbox instance not found`,
      );
    }

    // 通过 Worker 创建 AIController
    const result = await this.sendWorkerMessage(instance, {
      type: 'CREATE_AI_CONTROLLER',
      pluginId,
      difficulty,
    }, 10000);

    if (!result.success) {
      throw new InternalServerErrorException(
        `Failed to create AIController: ${result.error}`,
      );
    }

    instance.aiControllerCreated = true;
    this.logAudit(
      'CREATE_AI',
      pluginId,
      `AIController created with difficulty ${difficulty}`,
      true,
    );

    return this.sandbox.createAIController(pluginId, difficulty);
  }

  // ==================== Worker 通信辅助 ====================

  /**
   * 调用插件导出方法（通过 Worker MessagePort）
   */
  private async callPluginExport(
    pluginId: string,
    methodName: string,
    args: any[] = [],
    timeoutMs: number = 5000,
  ): Promise<any> {
    return this.sandbox.callPluginExport(pluginId, methodName, args, timeoutMs);
  }

  /**
   * 发送消息到 Worker（通过 PluginSandbox 的 MessagePort）
   */
  private async sendWorkerMessage(
    instance: PluginInstance,
    message: any,
    timeoutMs: number,
  ): Promise<any> {
    return this.sandbox.sendPortMessage(instance.port, {
      ...message,
      requestId: this.sandbox.generateRequestId(),
    }, timeoutMs);
  }

  // ==================== 审计日志 ====================

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
      throw new NotFoundException(`Plugin metadata not found: ${metaPath}`);
    }

    try {
      const content = fs.readFileSync(metaPath, 'utf-8');
      const raw = JSON.parse(content);

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

      if (!['board', 'card', 'mahjong'].includes(meta.category)) {
        meta.category = 'board';
      }

      return meta;
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Invalid plugin metadata: ${err.message}`);
    }
  }

  private getPluginDirectory(): string {
    return process.env.PLUGIN_DIR || path.resolve(process.cwd(), 'plugins');
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

    if (this.auditLog.length > this.maxAuditLogEntries) {
      this.auditLog.splice(0, this.auditLog.length - this.maxAuditLogEntries);
    }
  }
}
