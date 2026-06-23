import { Module } from '@nestjs/common';
import { PluginController } from './plugin.controller';
import { PluginService } from './plugin.service';
import { PluginManagerController } from './plugin-manager.controller';
import { PluginLoaderService } from './plugin-loader.service';
import { PluginSandbox } from './plugin-sandbox';
import { EventBus } from './event-bus';
import { AdminGuard } from './guards/admin.guard';

@Module({
  imports: [],
  controllers: [PluginController, PluginManagerController],
  providers: [
    PluginService,
    PluginLoaderService,
    PluginSandbox,
    EventBus,
    AdminGuard,
  ],
  exports: [PluginLoaderService, PluginSandbox, EventBus],
})
export class PluginModule {}
