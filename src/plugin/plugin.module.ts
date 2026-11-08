import { Module } from '@nestjs/common';
import { PluginController } from './plugin.controller';
import { PluginService } from './plugin.service';
import { PluginManagerController } from './plugin-manager.controller';
import { PluginLoaderService } from './plugin-loader.service';
import { PluginSandbox } from './plugin-sandbox';
import { WorkerPoolService } from './worker-pool.service';
import { EventBus } from './event-bus';
import { AdminGuard } from './guards/admin.guard';

/**
 * PluginModule - 插件管理模块
 *
 * 基于 worker_threads 的隔离架构：
 * - WorkerPoolService: 管理 Worker 线程池（4个初始，最大8个）
 * - PluginSandbox: 通过 Worker 线程 + MessageChannel 运行插件
 * - PluginLoaderService: 插件生命周期管理
 * - EventBus: 事件总线（主线程）
 *
 * 双重隔离：Worker 线程（进程级）→ vm.Context（代码级）
 */
@Module({
  imports: [],
  controllers: [PluginController, PluginManagerController],
  providers: [
    PluginService,
    // Worker 线程池管理（必须先于 PluginSandbox 注册）
    {
      provide: WorkerPoolService,
      useFactory: () => {
        return new WorkerPoolService({
          initialSize: 4,
          maxSize: 8,
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 64,
        });
      },
    },
    // 插件沙箱（依赖 WorkerPoolService）
    PluginLoaderService,
    PluginSandbox,
    EventBus,
    AdminGuard,
  ],
  exports: [PluginLoaderService, PluginSandbox, EventBus, WorkerPoolService],
})
export class PluginModule {}
