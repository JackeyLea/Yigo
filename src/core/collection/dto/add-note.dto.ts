/**
 * AddNoteDto - 添加备注请求DTO
 */
import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddNoteDto {
  @ApiProperty({ description: '备注内容', example: '这是一局精彩的对局，开局采用了意大利开局' })
  @IsString()
  @MaxLength(1000, { message: '备注最多1000个字符' })
  note: string;
}
