import { IsString, IsOptional, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 排行榜查询DTO
 */
export class LeaderboardQueryDto {
  @IsString()
  gameType: string;

  @IsOptional()
  @IsString()
  seasonId?: string = 'all_time';

  @IsOptional()
  @IsIn(['global', 'regional', 'friends'])
  scope?: 'global' | 'regional' | 'friends' = 'global';

  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly', 'all_time'])
  period?: 'daily' | 'weekly' | 'monthly' | 'all_time' = 'all_time';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 50;
}
