/**
 * EscrowActionDto - 托管AI操作请求DTO
 */
import { IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EscrowActionDto {
  @ApiProperty({ description: '当前游戏状态', type: 'object' })
  @IsObject()
  gameState: any;

  @ApiPropertyOptional({ description: '游戏插件ID', example: 'chess' })
  @IsString()
  @IsOptional()
  pluginId?: string;
}
