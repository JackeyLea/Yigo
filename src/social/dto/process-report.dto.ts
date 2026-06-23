import { IsNotEmpty, IsString, IsOptional, IsEnum } from 'class-validator';
import { ReportAction } from '../entities/report.entity';

export class ProcessReportDto {
  @IsNotEmpty()
  @IsString()
  reportId: string;

  @IsNotEmpty()
  @IsEnum(ReportAction)
  action: ReportAction;

  @IsOptional()
  @IsString()
  note?: string;
}
