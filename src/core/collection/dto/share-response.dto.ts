/**
 * ShareResponseDto - 分享响应DTO
 */
import { IsBoolean, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ShareResponseDto {
  @ApiProperty({ description: '是否成功' })
  @IsBoolean()
  success: boolean;

  @ApiProperty({ description: '分享链接' })
  @IsString()
  shareUrl: string;

  @ApiProperty({ description: '状态消息' })
  @IsString()
  message: string;
}
