import { IsString, IsDateString, IsOptional } from 'class-validator';

/**
 * 创建赛季DTO
 */
export class CreateSeasonDto {
  @IsString()
  name: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsString()
  gameType?: string;
}
