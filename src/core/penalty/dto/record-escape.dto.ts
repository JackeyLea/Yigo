/**
 * RecordEscapeDto - 记录逃跑请求DTO
 */
import { IsInt, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecordEscapeDto {
  @ApiProperty({ description: '用户ID', example: 12345 })
  @IsInt()
  userId: number;

  @ApiProperty({ description: '房间ID', example: 'ABC123' })
  @IsString()
  roomId: string;

  @ApiProperty({ description: '游戏类型', example: 'chess' })
  @IsString()
  gameType: string;
}
