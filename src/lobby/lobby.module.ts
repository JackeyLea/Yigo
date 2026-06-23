import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LobbyController } from './lobby.controller';
import { LobbyService } from './lobby.service';
import { Plugin } from '../common/entities/plugin.entity';
import { Announcement } from './entities/announcement.entity';

/**
 * LobbyModule - 游戏大厅模块
 *
 * 提供游戏大厅相关功能：
 * - 游戏列表查询（支持搜索、筛选、分页）
 * - 游戏详情查看
 * - 在线人数统计
 * - 公告展示
 * - 用户收藏管理
 * - 最近游玩记录
 *
 * 导出LobbyService供其他模块使用。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Plugin, Announcement]),
  ],
  controllers: [LobbyController],
  providers: [LobbyService],
  exports: [LobbyService],
})
export class LobbyModule {}
