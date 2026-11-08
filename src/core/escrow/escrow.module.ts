/**
 * EscrowModule - 断线托管模块
 *
 * 当玩家断线时自动启动AI代打，玩家重连后可恢复控制。
 */
import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';

@Module({
  controllers: [EscrowController],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
