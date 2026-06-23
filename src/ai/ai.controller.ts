import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AiEngineService } from './ai-engine.service';
import { CreateAIDto, AIActionDto } from './dto/create-ai.dto';
import { AIInstance, AIInstanceStatus, AIEngineStats } from './interfaces/ai-instance.interface';
import { Action } from '../plugin/interfaces/game-controller.interface';

/**
 * AI引擎管理控制器（管理员调试用）
 * 
 * 所有端点都需要管理员权限
 */
@ApiTags('Admin - AI Engine')
@ApiBearerAuth()
@Controller('api/v1/admin/ai')
export class AiController {
  constructor(private readonly aiEngineService: AiEngineService) {}

  /**
   * 创建AI实例
   */
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create AI instance', description: 'Create a new AI instance with specified plugin and difficulty' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'AI instance created successfully' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid parameters' })
  async createAI(@Body() dto: CreateAIDto): Promise<AIInstance> {
    return this.aiEngineService.createAI(dto.pluginId, dto.difficulty, dto.options);
  }

  /**
   * 请求AI决策
   */
  @Post(':instanceId/action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request AI action', description: 'Request an AI decision for the given game state' })
  @ApiResponse({ status: HttpStatus.OK, description: 'AI action returned successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'AI instance not found' })
  @ApiResponse({ status: HttpStatus.REQUEST_TIMEOUT, description: 'AI decision timed out' })
  async requestAction(
    @Param('instanceId') instanceId: string,
    @Body() dto: AIActionDto,
  ): Promise<Action> {
    return this.aiEngineService.requestAction(
      instanceId,
      dto.playerId,
      dto.gameState,
      dto.legalActions,
      dto.timeoutMs,
    );
  }

  /**
   * 释放AI实例
   */
  @Delete(':instanceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Release AI instance', description: 'Release and destroy an AI instance' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'AI instance released successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'AI instance not found' })
  async releaseAI(@Param('instanceId') instanceId: string): Promise<void> {
    await this.aiEngineService.releaseAI(instanceId);
  }

  /**
   * 获取AI实例状态
   */
  @Get(':instanceId/status')
  @ApiOperation({ summary: 'Get AI instance status', description: 'Get detailed status of a specific AI instance' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Status retrieved successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'AI instance not found' })
  getInstanceStatus(@Param('instanceId') instanceId: string): AIInstanceStatus {
    return this.aiEngineService.getInstanceStatus(instanceId);
  }

  /**
   * 获取AI引擎统计信息
   */
  @Get('stats')
  @ApiOperation({ summary: 'Get AI engine statistics', description: 'Get overall AI engine statistics including pool status' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Statistics retrieved successfully' })
  getStats(): AIEngineStats {
    return this.aiEngineService.getStats();
  }

  /**
   * 获取所有活跃实例
   */
  @Get('instances')
  @ApiOperation({ summary: 'List all AI instances', description: 'Get all active AI instances' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Instances retrieved successfully' })
  getAllInstances(): AIInstance[] {
    return this.aiEngineService.getAllInstances();
  }

  /**
   * 获取支持的难度级别
   */
  @Get('difficulties')
  @ApiOperation({ summary: 'List supported difficulties', description: 'Get all supported AI difficulty levels' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Difficulties retrieved successfully' })
  getSupportedDifficulties(): { difficulties: string[]; configs: Record<string, any> } {
    const difficulties = this.aiEngineService.getSupportedDifficulties();
    const configs: Record<string, any> = {};
    for (const d of difficulties) {
      configs[d] = this.aiEngineService.getDifficultyConfig(d);
    }
    return { difficulties, configs };
  }
}
