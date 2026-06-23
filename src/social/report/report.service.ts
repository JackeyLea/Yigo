/**
 * ReportService - 举报服务
 * 管理举报提交、查询、处理
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Report,
  ReportStatus,
  ReportAction,
  ReportType,
} from '../entities/report.entity';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    @InjectRepository(Report)
    private readonly reportRepository: Repository<Report>,
  ) {}

  /**
   * 提交举报
   */
  async submitReport(
    reporterId: number,
    targetId: number,
    type: string,
    reason: string,
    evidence?: string,
  ): Promise<void> {
    if (reporterId === targetId) {
      throw new BadRequestException('Cannot report yourself');
    }

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Reason cannot be empty');
    }

    // 验证举报类型
    const reportType = Object.values(ReportType).find((t) => t === type);
    if (!reportType) {
      throw new BadRequestException(`Invalid report type: ${type}`);
    }

    // 检查是否已有相同举报人在处理中的重复举报
    const existing = await this.reportRepository.findOne({
      where: {
        reporter_id: String(reporterId),
        target_id: String(targetId),
        status: ReportStatus.PENDING,
      },
    });

    if (existing) {
      throw new ConflictException('You already have a pending report against this user');
    }

    const report = this.reportRepository.create({
      reporter_id: String(reporterId),
      target_id: String(targetId),
      type: reportType as ReportType,
      reason: reason.trim(),
      evidence: evidence || null,
      status: ReportStatus.PENDING,
      action: null,
      note: null,
      processor_id: null,
    });

    await this.reportRepository.save(report);

    this.logger.log(`Report submitted: reporter=${reporterId}, target=${targetId}, type=${type}`);
  }

  /**
   * 查询举报列表（管理员权限）
   */
  async getReports(
    adminUserId: number,
    status?: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<PaginatedResult<Report>> {
    // 构建查询条件
    const where: any = {};

    if (status) {
      const reportStatus = Object.values(ReportStatus).find((s) => s === status);
      if (!reportStatus) {
        throw new BadRequestException(`Invalid status: ${status}`);
      }
      where.status = reportStatus;
    }

    const [items, total] = await this.reportRepository.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 处理举报
   */
  async processReport(
    adminUserId: number,
    reportId: string,
    action: string,
    note?: string,
  ): Promise<void> {
    // 验证处理动作
    const reportAction = Object.values(ReportAction).find((a) => a === action);
    if (!reportAction) {
      throw new BadRequestException(`Invalid action: ${action}`);
    }

    // 查找举报记录
    const report = await this.reportRepository.findOne({
      where: { report_id: reportId },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    if (report.status === ReportStatus.RESOLVED || report.status === ReportStatus.REJECTED) {
      throw new BadRequestException('Report has already been processed');
    }

    // 更新举报记录
    report.status =
      reportAction === ReportAction.DISMISS
        ? ReportStatus.REJECTED
        : ReportStatus.RESOLVED;
    report.action = reportAction as ReportAction;
    report.note = note || null;
    report.processor_id = String(adminUserId);

    await this.reportRepository.save(report);

    this.logger.log(
      `Report processed: reportId=${reportId}, action=${action}, processor=${adminUserId}`,
    );
  }

  /**
   * 获取单个举报详情
   */
  async getReportById(
    adminUserId: number,
    reportId: string,
  ): Promise<Report> {
    const report = await this.reportRepository.findOne({
      where: { report_id: reportId },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    return report;
  }

  /**
   * 获取针对特定用户的举报统计
   */
  async getReportStats(targetId: number): Promise<{
    total: number;
    pending: number;
    resolved: number;
    rejected: number;
  }> {
    const reports = await this.reportRepository.find({
      where: { target_id: String(targetId) },
    });

    return {
      total: reports.length,
      pending: reports.filter((r) => r.status === ReportStatus.PENDING).length,
      resolved: reports.filter((r) => r.status === ReportStatus.RESOLVED).length,
      rejected: reports.filter((r) => r.status === ReportStatus.REJECTED).length,
    };
  }
}
