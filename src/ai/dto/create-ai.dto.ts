import { IsString, IsIn, IsObject, IsOptional } from 'class-validator';
import { GameState } from '../../plugin/interfaces/game-controller.interface';

export class CreateAIDto {
  @IsString()
  pluginId: string;

  @IsString()
  @IsIn(['easy', 'medium', 'hard', 'expert'])
  difficulty: string;

  @IsObject()
  @IsOptional()
  gameState?: GameState;

  @IsObject()
  @IsOptional()
  options?: Record<string, any>;
}

export class AIActionDto {
  @IsString()
  playerId: string;

  @IsObject()
  gameState: GameState;

  @IsObject({ each: true })
  legalActions: any[];

  @IsOptional()
  timeoutMs?: number;
}

export class AIInstanceResponseDto {
  instanceId: string;
  pluginId: string;
  difficulty: string;
  status: 'idle' | 'thinking' | 'error';
  createdAt: Date;
  lastUsedAt: Date;
  totalRequests: number;
}
