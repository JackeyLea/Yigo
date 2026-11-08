import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShareService } from './share.service';
import { ShareController } from './share.controller';
import { ShareRecord } from './share-record.entity';
import { GameRecord } from '../../common/entities/game-record.entity';
import { User } from '../../common/entities/user.entity';
import { Room } from '../../common/entities/room.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ShareRecord, GameRecord, User, Room])],
  controllers: [ShareController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
