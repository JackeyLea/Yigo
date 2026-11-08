import { IsDateString, IsEnum, IsNotEmpty } from 'class-validator';
import { CohortType } from '../entities';

export class RetentionQueryDto {
  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @IsNotEmpty()
  @IsDateString()
  endDate: string;

  @IsNotEmpty()
  @IsEnum(CohortType)
  cohortType: CohortType;
}
