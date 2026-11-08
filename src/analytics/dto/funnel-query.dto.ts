import { IsArray, IsDateString, IsNotEmpty, IsString } from 'class-validator';

export class FunnelQueryDto {
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  steps: string[];

  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @IsNotEmpty()
  @IsDateString()
  endDate: string;
}
