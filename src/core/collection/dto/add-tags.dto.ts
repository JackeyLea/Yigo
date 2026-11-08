/**
 * AddTagsDto - 添加/移除标签请求DTO
 */
import { IsArray, IsString, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddTagsDto {
  @ApiProperty({ description: '标签列表', example: ['经典对局', '开局陷阱'] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1, { message: '至少提供一个标签' })
  @ArrayMaxSize(10, { message: '最多10个标签' })
  tags: string[];
}
