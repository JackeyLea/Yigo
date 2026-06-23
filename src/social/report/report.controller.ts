/**
 * ReportController - 举报控制器
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReportService } from './report.service';
import {
  SubmitReportDto,
  ProcessReportDto,
} from '../dto';

@Controller('social/reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  /**
   * 提交举报
   */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async submitReport(
    @Body('reporterId', ParseIntPipe) reporterId: number,
    @Body() dto: SubmitReportDto,
  ): Promise<void> {
    return this.reportService.submitReport(
      reporterId,
      Number(dto.targetId),
      dto.type,
      dto.reason,
      dto.evidence,
    );
  }

  /**
   * 查询举报列表（管理员）
   */
  @Get()
  async getReports(
    @Query('adminUserId', ParseIntPipe) adminUserId: number,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.reportService.getReports(
      adminUserId,
      status,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  /**
   * 获取举报详情
   */
  @Get(':reportId')
  async getReportById(
    @Query('adminUserId', ParseIntPipe) adminUserId: number,
    @Param('reportId') reportId: string,
  ) {
    return this.reportService.getReportById(adminUserId, reportId);
  }

  /**
   * 处理举报
   */
  @Post(':reportId/process')
  @HttpCode(HttpStatus.NO_CONTENT)
  async processReport(
    @Body('adminUserId', ParseIntPipe) adminUserId: number,
    @Param('reportId') reportId: string,
    @Body() dto: ProcessReportDto,
  ): Promise<void> {
    return this.reportService.processReport(
      adminUserId,
      reportId,
      dto.action,
      dto.note,
    );
  }
}
