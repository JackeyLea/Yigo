/**
 * EscapeHistoryResponseDto - 逃跑历史响应DTO
 */
import { IsArray, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EscapeRecord } from '../entities/escape-record.entity';

export class EscapeHistoryResponseDto {
  @ApiProperty({ description: '用户ID' })
  @IsInt()
  userId: number;

  @ApiProperty({ description: '逃跑记录列表', type: [EscapeRecord] })
  @IsArray()
  records: EscapeRecord[];

  @ApiProperty({ description: '记录总数' })
  @IsInt()
  count: number;
}
