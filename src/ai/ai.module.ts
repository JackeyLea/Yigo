import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiEngineService } from './ai-engine.service';
import { AiProcessPoolService } from './ai-process-pool.service';

/**
 * AI引擎模块
 * 
 * 提供以下功能：
 * 1. AI实例管理（创建、使用、释放）
 * 2. 多引擎支持（Minimax、MCTS、Random）
 * 3. 工作进程池（预创建 + 动态扩缩容）
 * 4. 管理员调试端点
 * 
 * 导出服务：
 * - AiEngineService: AI引擎主服务，其他模块可通过此服务请求AI决策
 * - AiProcessPoolService: 进程池管理，可独立使用
 */
@Module({
  imports: [],
  controllers: [AiController],
  providers: [AiEngineService, AiProcessPoolService],
  exports: [AiEngineService, AiProcessPoolService],
})
export class AiModule {}
