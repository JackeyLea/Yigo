/**
 * ForgiveEscapeDto - 宽恕逃跑记录请求DTO
 */
import { IsInt, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ForgiveEscapeDto {
  @ApiProperty({ description: '逃跑记录ID' })
  @IsInt()
  recordId: number;

  @ApiPropertyOptional({ description: '宽恕原因' })
  @IsString()
  @IsOptional()
  reason?: string;
}
