import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  ParseUUIDPipe,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { PluginLoaderService } from './plugin-loader.service';
import { PluginSandbox } from './plugin-sandbox';
import { AdminGuard } from './guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PluginMeta } from './interfaces/plugin-meta.interface';

class LoadPluginDto {
  pluginPath!: string;
}

class PluginStatusResponse {
  pluginId!: string;
  name!: string;
  version!: string;
  status!: string;
  loadedAt!: Date | null;
  memoryUsageMB!: number;
  uptimeSeconds!: number;
}

class PluginListResponse {
  plugins!: Array<{
    meta: PluginMeta;
    status: string;
    loadedAt: Date;
  }>;
  total!: number;
}

class PluginActionResponse {
  success!: boolean;
  pluginId!: string;
  message!: string;
  meta?: PluginMeta;
}

/**
 * PluginManagerController - 插件管理控制器
 *
 * 提供管理员专用的插件管理 HTTP API:
 * - GET  /api/v1/admin/plugins              — 已加载插件列表
 * - POST /api/v1/admin/plugins/load         — 加载插件
 * - POST /api/v1/admin/plugins/:pluginId/unload   — 卸载插件
 * - POST /api/v1/admin/plugins/:pluginId/reload   — 热重载插件
 * - GET  /api/v1/admin/plugins/:pluginId/status   — 插件状态
 *
 * 所有端点需要 JWT 认证 + 管理员权限
 */
@Controller('api/v1/admin/plugins')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PluginManagerController {
  private readonly logger = new Logger(PluginManagerController.name);

  constructor(
    private readonly pluginLoaderService: PluginLoaderService,
    private readonly sandbox: PluginSandbox,
  ) {}

  /**
   * 获取已加载插件列表
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getLoadedPlugins(): Promise<PluginListResponse> {
    const plugins = this.pluginLoaderService.getLoadedPlugins();
    const results = plugins.map((meta) => {
      const loadedPlugin = this.pluginLoaderService.getLoadedPlugin(meta.pluginId);
      const instance = this.sandbox.getInstance(meta.pluginId);
      return {
        meta,
        status: instance?.status ?? loadedPlugin?.status ?? 'unknown',
        loadedAt: loadedPlugin?.loadedAt ?? new Date(),
      };
    });

    this.logger.log(`Admin listed ${results.length} plugins`);
    return {
      plugins: results,
      total: results.length,
    };
  }

  /**
   * 加载插件
   */
  @Post('load')
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ transform: true }))
  async loadPlugin(
    @Body(new ValidationPipe({ transform: true })) dto: LoadPluginDto,
  ): Promise<PluginActionResponse> {
    this.logger.log(`Admin requested to load plugin from: ${dto.pluginPath}`);

    const meta = await this.pluginLoaderService.loadPlugin(dto.pluginPath);

    return {
      success: true,
      pluginId: meta.pluginId,
      message: `Plugin "${meta.name}" (${meta.pluginId}) loaded successfully`,
      meta,
    };
  }

  /**
   * 卸载插件
   */
  @Post(':pluginId/unload')
  @HttpCode(HttpStatus.OK)
  async unloadPlugin(
    @Param('pluginId') pluginId: string,
  ): Promise<PluginActionResponse> {
    this.logger.log(`Admin requested to unload plugin: ${pluginId}`);

    await this.pluginLoaderService.unloadPlugin(pluginId);

    return {
      success: true,
      pluginId,
      message: `Plugin "${pluginId}" unloaded successfully`,
    };
  }

  /**
   * 热重载插件
   */
  @Post(':pluginId/reload')
  @HttpCode(HttpStatus.OK)
  async reloadPlugin(
    @Param('pluginId') pluginId: string,
  ): Promise<PluginActionResponse> {
    this.logger.log(`Admin requested to reload plugin: ${pluginId}`);

    const meta = await this.pluginLoaderService.reloadPlugin(pluginId);

    return {
      success: true,
      pluginId,
      message: `Plugin "${meta.name}" (${pluginId}) hot reloaded successfully`,
      meta,
    };
  }

  /**
   * 获取插件状态
   */
  @Get(':pluginId/status')
  @HttpCode(HttpStatus.OK)
  async getPluginStatus(
    @Param('pluginId') pluginId: string,
  ): Promise<PluginStatusResponse> {
    const meta = this.pluginLoaderService.getPlugin(pluginId);
    const instance = this.sandbox.getInstance(pluginId);
    const loadedPlugin = this.pluginLoaderService.getLoadedPlugin(pluginId);

    if (!meta && !instance) {
      return {
        pluginId,
        name: 'unknown',
        version: 'unknown',
        status: 'not_found',
        loadedAt: null,
        memoryUsageMB: 0,
        uptimeSeconds: 0,
      };
    }

    const loadedAt = loadedPlugin?.loadedAt || instance?.loadedAt;
    const uptimeSeconds = loadedAt
      ? Math.floor((Date.now() - loadedAt.getTime()) / 1000)
      : 0;

    return {
      pluginId,
      name: meta?.name || 'unknown',
      version: meta?.version || 'unknown',
      status: instance?.status || loadedPlugin?.status || 'unknown',
      loadedAt: loadedAt || null,
      memoryUsageMB: instance?.memoryUsageMB || 0,
      uptimeSeconds,
    };
  }
}
