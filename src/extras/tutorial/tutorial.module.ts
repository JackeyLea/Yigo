import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TutorialService } from './tutorial.service';
import { TutorialController } from './tutorial.controller';
import { TutorialProgress } from './tutorial-progress.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TutorialProgress])],
  controllers: [TutorialController],
  providers: [TutorialService],
  exports: [TutorialService],
})
export class TutorialModule {}
