/**
 * CollectGameDto - 收藏对局请求DTO
 */
import { IsInt, IsArray, IsOptional, IsString, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CollectGameDto {
  @ApiProperty({ description: '对局记录ID', example: 10001 })
  @IsInt()
  recordId: number;

  @ApiPropertyOptional({ description: '标签列表', example: ['经典对局', '开局陷阱'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(10, { message: '最多添加10个标签' })
  tags?: string[];
}
