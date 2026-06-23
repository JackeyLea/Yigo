/**
 * ReportService Unit Tests
 * 举报服务单元测试
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

import { ReportService } from './report.service';
import {
  Report,
  ReportStatus,
  ReportType,
  ReportAction,
} from '../entities/report.entity';

describe('ReportService', () => {
  let service: ReportService;
  let reportRepository: Repository<Report>;

  const mockReportRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(0),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        {
          provide: getRepositoryToken(Report),
          useValue: mockReportRepository,
        },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
    reportRepository = module.get<Repository<Report>>(getRepositoryToken(Report));
  });

  describe('submitReport', () => {
    it('should submit report successfully', async () => {
      const reporterId = 1;
      const targetId = 2;
      const type = ReportType.HARASSMENT;
      const reason = 'This user is harassing me';
      const evidence = 'screenshot.png';

      mockReportRepository.findOne.mockResolvedValue(null);
      mockReportRepository.create.mockReturnValue({
        reporter_id: '1',
        target_id: '2',
        type,
        reason,
        evidence,
        status: ReportStatus.PENDING,
      });
      mockReportRepository.save.mockResolvedValue({
        report_id: '1',
        reporter_id: '1',
        target_id: '2',
        type,
        reason,
        evidence,
        status: ReportStatus.PENDING,
      });

      await service.submitReport(reporterId, targetId, type, reason, evidence);

      expect(mockReportRepository.create).toHaveBeenCalled();
      expect(mockReportRepository.save).toHaveBeenCalled();
    });

    it('should submit report without evidence', async () => {
      mockReportRepository.findOne.mockResolvedValue(null);
      mockReportRepository.create.mockReturnValue({
        reporter_id: '1',
        target_id: '2',
        type: ReportType.SPAM,
        reason: 'Spam messages',
        evidence: null,
        status: ReportStatus.PENDING,
      });
      mockReportRepository.save.mockResolvedValue({ report_id: '1' });

      await service.submitReport(1, 2, ReportType.SPAM, 'Spam messages');

      expect(mockReportRepository.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException when reporting self', async () => {
      await expect(
        service.submitReport(1, 1, ReportType.ABUSE, 'test'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when reason is empty', async () => {
      await expect(
        service.submitReport(1, 2, ReportType.OTHER, ''),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.submitReport(1, 2, ReportType.OTHER, '   '),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when type is invalid', async () => {
      await expect(
        service.submitReport(1, 2, 'invalid_type', 'test reason'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when duplicate pending report exists', async () => {
      mockReportRepository.findOne.mockResolvedValue({
        report_id: '1',
        reporter_id: '1',
        target_id: '2',
        status: ReportStatus.PENDING,
      });

      await expect(
        service.submitReport(1, 2, ReportType.ABUSE, 'test'),
      ).rejects.toThrow(ConflictException);
    });

    it('should accept all valid report types', async () => {
      mockReportRepository.findOne.mockResolvedValue(null);
      mockReportRepository.create.mockReturnValue({});
      mockReportRepository.save.mockResolvedValue({ report_id: '1' });

      for (const type of Object.values(ReportType)) {
        await service.submitReport(1, 2, type, `Report for ${type}`);
      }

      expect(mockReportRepository.save).toHaveBeenCalledTimes(
        Object.values(ReportType).length,
      );
    });
  });

  describe('getReports', () => {
    it('should return paginated reports without status filter', async () => {
      const mockReports = [
        {
          report_id: '1',
          reporter_id: '1',
          target_id: '2',
          type: ReportType.HARASSMENT,
          reason: 'test',
          status: ReportStatus.PENDING,
          created_at: new Date(),
        },
        {
          report_id: '2',
          reporter_id: '3',
          target_id: '4',
          type: ReportType.CHEATING,
          reason: 'test2',
          status: ReportStatus.RESOLVED,
          created_at: new Date(),
        },
      ];

      mockReportRepository.findAndCount.mockResolvedValue([mockReports, 2]);

      const result = await service.getReports(1);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('should return filtered reports by status', async () => {
      const mockReports = [
        {
          report_id: '1',
          status: ReportStatus.PENDING,
          created_at: new Date(),
        },
      ];

      mockReportRepository.findAndCount.mockResolvedValue([mockReports, 1]);

      const result = await service.getReports(1, 'pending');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].status).toBe(ReportStatus.PENDING);
    });

    it('should throw BadRequestException for invalid status', async () => {
      await expect(service.getReports(1, 'invalid_status')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should handle pagination correctly', async () => {
      const mockReports = Array.from({ length: 25 }, (_, i) => ({
        report_id: String(i + 1),
        status: ReportStatus.PENDING,
        created_at: new Date(),
      }));

      mockReportRepository.findAndCount.mockResolvedValue([
        mockReports.slice(0, 20),
        25,
      ]);

      const result = await service.getReports(1, undefined, 1, 20);

      expect(result.items).toHaveLength(20);
      expect(result.total).toBe(25);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(2);
    });
  });

  describe('processReport', () => {
    it('should process report with warn action', async () => {
      const mockReport = {
        report_id: '1',
        status: ReportStatus.PENDING,
        target_id: '2',
      };

      mockReportRepository.findOne.mockResolvedValue(mockReport);
      mockReportRepository.save.mockResolvedValue({
        ...mockReport,
        status: ReportStatus.RESOLVED,
        action: ReportAction.WARN,
      });

      await service.processReport(1, '1', ReportAction.WARN, 'Warning issued');

      expect(mockReportRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ReportStatus.RESOLVED,
          action: ReportAction.WARN,
          note: 'Warning issued',
          processor_id: '1',
        }),
      );
    });

    it('should process report with dismiss action (rejected)', async () => {
      const mockReport = {
        report_id: '1',
        status: ReportStatus.PENDING,
      };

      mockReportRepository.findOne.mockResolvedValue(mockReport);

      await service.processReport(1, '1', ReportAction.DISMISS, 'No evidence');

      expect(mockReportRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ReportStatus.REJECTED,
          action: ReportAction.DISMISS,
        }),
      );
    });

    it('should process report with ban action', async () => {
      const mockReport = {
        report_id: '1',
        status: ReportStatus.PENDING,
      };

      mockReportRepository.findOne.mockResolvedValue(mockReport);

      await service.processReport(1, '1', ReportAction.BAN);

      expect(mockReportRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ReportStatus.RESOLVED,
          action: ReportAction.BAN,
        }),
      );
    });

    it('should process report with mute action', async () => {
      const mockReport = {
        report_id: '1',
        status: ReportStatus.PENDING,
      };

      mockReportRepository.findOne.mockResolvedValue(mockReport);

      await service.processReport(1, '1', ReportAction.MUTE);

      expect(mockReportRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ReportStatus.RESOLVED,
          action: ReportAction.MUTE,
        }),
      );
    });

    it('should throw NotFoundException when report not found', async () => {
      mockReportRepository.findOne.mockResolvedValue(null);

      await expect(
        service.processReport(1, 'nonexistent', ReportAction.WARN),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when report already processed', async () => {
      mockReportRepository.findOne.mockResolvedValue({
        report_id: '1',
        status: ReportStatus.RESOLVED,
      });

      await expect(
        service.processReport(1, '1', ReportAction.WARN),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for already rejected report', async () => {
      mockReportRepository.findOne.mockResolvedValue({
        report_id: '1',
        status: ReportStatus.REJECTED,
      });

      await expect(
        service.processReport(1, '1', ReportAction.WARN),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid action', async () => {
      mockReportRepository.findOne.mockResolvedValue({
        report_id: '1',
        status: ReportStatus.PENDING,
      });

      await expect(
        service.processReport(1, '1', 'invalid_action'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getReportById', () => {
    it('should return report by id', async () => {
      const mockReport = {
        report_id: '1',
        reporter_id: '1',
        target_id: '2',
        type: ReportType.HARASSMENT,
        status: ReportStatus.PENDING,
      };

      mockReportRepository.findOne.mockResolvedValue(mockReport);

      const result = await service.getReportById(1, '1');

      expect(result).toBeDefined();
      expect(result.report_id).toBe('1');
    });

    it('should throw NotFoundException when report not found', async () => {
      mockReportRepository.findOne.mockResolvedValue(null);

      await expect(service.getReportById(1, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getReportStats', () => {
    it('should return report statistics for target user', async () => {
      const mockReports = [
        { status: ReportStatus.PENDING },
        { status: ReportStatus.PENDING },
        { status: ReportStatus.RESOLVED },
        { status: ReportStatus.REJECTED },
      ];

      mockReportRepository.find.mockResolvedValue(mockReports);

      const result = await service.getReportStats(2);

      expect(result).toEqual({
        total: 4,
        pending: 2,
        resolved: 1,
        rejected: 1,
      });
    });

    it('should return zeros when no reports', async () => {
      mockReportRepository.find.mockResolvedValue([]);

      const result = await service.getReportStats(999);

      expect(result).toEqual({
        total: 0,
        pending: 0,
        resolved: 0,
        rejected: 0,
      });
    });
  });
});
