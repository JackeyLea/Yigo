import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class HeatmapQueryDto {
  @IsOptional()
  @IsString()
  gameType?: string;

  @IsNotEmpty()
  @IsDateString()
  date: string;
}
