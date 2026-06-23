import { IsString, IsArray, ValidateNested, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 单个玩家结果
 */
export class PlayerResultDto {
  @IsNumber()
  @Min(1)
  userId: number;

  @IsNumber()
  @Min(1)
  rank: number;

  @IsNumber()
  @Min(0)
  oldRating: number;
}

/**
 * 更新评分DTO（对局结束后调用）
 */
export class UpdateRatingDto {
  @IsString()
  gameType: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlayerResultDto)
  playerResults: PlayerResultDto[];
}
