import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumberString,
  IsEnum,
} from 'class-validator';
import { ReportType } from '../entities/report.entity';

export class SubmitReportDto {
  @IsNotEmpty()
  @IsNumberString()
  targetId: string;

  @IsNotEmpty()
  @IsEnum(ReportType)
  type: ReportType;

  @IsNotEmpty()
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  evidence?: string;
}
