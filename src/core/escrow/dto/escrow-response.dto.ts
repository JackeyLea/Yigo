/**
 * EscrowResponseDto - 托管状态响应DTO
 */
import { IsBoolean, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EscrowResponseDto {
  @ApiProperty({ description: '房间ID' })
  @IsString()
  roomId: string;

  @ApiProperty({ description: '玩家ID' })
  @IsString()
  playerId: string;

  @ApiProperty({ description: '是否处于托管状态' })
  @IsBoolean()
  isEscrowed: boolean;

  @ApiProperty({ description: '状态消息' })
  @IsString()
  @IsOptional()
  message?: string;
}
