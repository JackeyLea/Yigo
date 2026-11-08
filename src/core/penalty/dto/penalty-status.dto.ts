/**
 * PenaltyStatusDto - 惩罚状态响应DTO
 */
import { IsBoolean, IsInt, IsString, IsDate, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PenaltyStatusDto {
  @ApiProperty({ description: '是否可以进行匹配' })
  @IsBoolean()
  canPlay: boolean;

  @ApiProperty({ description: '冷却剩余时间（秒）' })
  @IsInt()
  cooldownSeconds: number;

  @ApiProperty({ description: '信誉分', example: 85 })
  @IsInt()
  reputationScore: number;

  @ApiProperty({ description: '惩罚等级', enum: [0, 1, 2, 3, 4] })
  @IsInt()
  penaltyLevel: number;

  @ApiPropertyOptional({ description: '下一等级边界分数' })
  @IsInt()
  @IsOptional()
  nextLevelAt?: number;

  @ApiPropertyOptional({ description: '恢复时间' })
  @IsDate()
  @IsOptional()
  recoverAt?: Date;

  @ApiProperty({ description: '24小时内逃跑次数' })
  @IsInt()
  escapeCount24h: number;

  @ApiProperty({ description: '状态消息' })
  @IsString()
  message: string;
}
