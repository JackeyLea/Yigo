import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { RoomStateMachine } from './room-state-machine';
import { RoomHostGuard } from './guards/room-host.guard';
import { RoomPlayerGuard } from './guards/room-player.guard';

import { Room } from '../common/entities/room.entity';
import { RoomPlayer } from '../common/entities/room-player.entity';
import { User } from '../common/entities/user.entity';
import { PluginModule } from '../plugin/plugin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Room, RoomPlayer, User]),
    forwardRef(() => PluginModule),
  ],
  controllers: [RoomController],
  providers: [RoomService, RoomStateMachine, RoomHostGuard, RoomPlayerGuard],
  exports: [RoomService, RoomStateMachine, RoomHostGuard, RoomPlayerGuard],
})
export class RoomModule {}
