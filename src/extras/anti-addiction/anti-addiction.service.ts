import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import {
  RealNameVerification,
  DailyPlayTime,
  HolidayConfig,
} from './anti-addiction.entity';

export interface PlayTimeStatus {
  canPlay: boolean;
  reason?: string;
  remainingMinutes?: number;
  isRestricted: boolean;
}

export interface MinorRechargeLimit {
  dailyLimit: number;
  canRecharge: boolean;
}

@Injectable()
export class AntiAddictionService {
  constructor(
    @InjectRepository(RealNameVerification)
    private readonly realNameRepo: Repository<RealNameVerification>,
    @InjectRepository(DailyPlayTime)
    private readonly playTimeRepo: Repository<DailyPlayTime>,
    @InjectRepository(HolidayConfig)
    private readonly holidayRepo: Repository<HolidayConfig>,
  ) {}

  /**
   * 检查用户游戏时长状态
   */
  async checkPlayTime(userId: number): Promise<PlayTimeStatus> {
    const isRestricted = await this.isRestricted(userId);

    if (isRestricted) {
      const dailyMinutes = await this.getDailyPlayTime(userId);
      const limit = await this.getPlayTimeLimit(userId);
      const remainingMinutes = Math.max(0, limit - dailyMinutes);

      return {
        canPlay: remainingMinutes > 0,
        reason: remainingMinutes <= 0 ? '今日游戏时长已用完' : undefined,
        remainingMinutes,
        isRestricted: true,
      };
    }

    return {
      canPlay: true,
      remainingMinutes: -1, // -1 表示无限制
      isRestricted: false,
    };
  }

  /**
   * 记录游戏时长
   */
  async recordPlayTime(userId: number, duration: number): Promise<void> {
    const today = this.getTodayString();

    let record = await this.playTimeRepo.findOne({
      where: { userId, date: today },
    });

    if (!record) {
      record = new DailyPlayTime();
      record.userId = userId;
      record.date = today;
      record.totalMinutes = 0;
    }

    record.totalMinutes += Math.max(0, duration);
    record.lastSessionEnd = new Date();

    await this.playTimeRepo.save(record);
  }

  /**
   * 获取当日游戏时长（分钟）
   */
  async getDailyPlayTime(userId: number): Promise<number> {
    const today = this.getTodayString();
    const record = await this.playTimeRepo.findOne({
      where: { userId, date: today },
    });

    return record?.totalMinutes ?? 0;
  }

  /**
   * 用户是否受限
   */
  async isRestricted(userId: number): Promise<boolean> {
    const verification = await this.realNameRepo.findOne({
      where: { userId },
    });

    // 未实名用户：受限（每日1小时）
    if (!verification) {
      return true;
    }

    // 成年人：不受限
    if (verification.isAdult) {
      return false;
    }

    // 未成年人：受限
    return true;
  }

  /**
   * 是否可以游戏（时间窗口检查）
   */
  async canPlayNow(userId: number): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    const verification = await this.realNameRepo.findOne({
      where: { userId },
    });

    // 成年人随时可玩
    if (verification?.isAdult) {
      return { allowed: true };
    }

    // 未实名用户：只在8:00-22:00可玩（受1小时限制）
    if (!verification) {
      return this.checkPlayWindowForUnverified();
    }

    // 未成年人：周五/六/日及节假日 20:00-21:00
    return this.checkPlayWindowForMinor();
  }

  /**
   * 检查未成年人充值限制
   */
  async getMinorRechargeLimit(
    userId: number,
  ): Promise<MinorRechargeLimit> {
    const verification = await this.realNameRepo.findOne({
      where: { userId },
    });

    // 未实名用户禁止充值
    if (!verification) {
      return { dailyLimit: 0, canRecharge: false };
    }

    // 成年人无限制
    if (verification.isAdult) {
      return { dailyLimit: Number.MAX_SAFE_INTEGER, canRecharge: true };
    }

    // 计算年龄
    const age = this.calculateAge(verification.birthDate);

    // 8-16岁：每日50元
    if (age >= 8 && age < 16) {
      return { dailyLimit: 50, canRecharge: true };
    }

    // 16-18岁：每日100元
    if (age >= 16 && age < 18) {
      return { dailyLimit: 100, canRecharge: true };
    }

    // 8岁以下禁止充值
    return { dailyLimit: 0, canRecharge: false };
  }

  /**
   * 开始游戏会话
   */
  async startSession(userId: number): Promise<void> {
    const today = this.getTodayString();

    let record = await this.playTimeRepo.findOne({
      where: { userId, date: today },
    });

    if (!record) {
      record = new DailyPlayTime();
      record.userId = userId;
      record.date = today;
      record.totalMinutes = 0;
    }

    record.lastSessionStart = new Date();
    await this.playTimeRepo.save(record);
  }

  /**
   * 结束游戏会话并累计时长
   */
  async endSession(userId: number): Promise<void> {
    const today = this.getTodayString();

    const record = await this.playTimeRepo.findOne({
      where: { userId, date: today },
    });

    if (record && record.lastSessionStart) {
      const now = new Date();
      const duration = Math.floor(
        (now.getTime() - record.lastSessionStart.getTime()) / 1000 / 60,
      );
      record.totalMinutes += Math.max(0, duration);
      record.lastSessionEnd = now;
      await this.playTimeRepo.save(record);
    }
  }

  /**
   * 实名认证
   */
  async verifyRealName(
    userId: number,
    realName: string,
    idCard: string,
  ): Promise<RealNameVerification> {
    // 解析身份证获取出生日期
    const birthDate = this.extractBirthDateFromIdCard(idCard);
    const age = this.calculateAge(birthDate);

    const verification = new RealNameVerification();
    verification.userId = userId;
    verification.realName = realName;
    verification.idCard = idCard;
    verification.birthDate = birthDate;
    verification.isAdult = age >= 18;
    verification.verifiedAt = new Date();

    return this.realNameRepo.save(verification);
  }

  /**
   * 获取用户实名信息
   */
  async getVerification(userId: number): Promise<RealNameVerification | null> {
    return this.realNameRepo.findOne({ where: { userId } });
  }

  // ==================== 私有方法 ====================

  /**
   * 获取用户游戏时长限制（分钟）
   */
  private async getPlayTimeLimit(userId: number): Promise<number> {
    const verification = await this.realNameRepo.findOne({
      where: { userId },
    });

    // 未实名用户：每日1小时
    if (!verification) {
      return 60;
    }

    // 成年人：无限制
    if (verification.isAdult) {
      return Number.MAX_SAFE_INTEGER;
    }

    // 未成年人：周五/六/日及节假日1小时，其他时间禁止
    const now = new Date();
    const isPlayableDay = await this.isPlayableDayForMinor(now);

    if (!isPlayableDay) {
      return 0;
    }

    return 60; // 1小时
  }

  /**
   * 检查未实名用户的游戏时间窗口
   */
  private checkPlayWindowForUnverified(): {
    allowed: boolean;
    reason?: string;
  } {
    const hour = new Date().getHours();
    // 未实名用户：8:00-22:00 可玩（累计不超过1小时）
    if (hour < 8 || hour >= 22) {
      return {
        allowed: false,
        reason: '未实名认证用户只能在8:00-22:00期间游戏',
      };
    }
    return { allowed: true };
  }

  /**
   * 检查未成年人的游戏时间窗口
   */
  private async checkPlayWindowForMinor(): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    const now = new Date();
    const isPlayableDay = await this.isPlayableDayForMinor(now);

    if (!isPlayableDay) {
      return {
        allowed: false,
        reason: '未成年人只能在周五、周六、周日及法定节假日游戏',
      };
    }

    const hour = now.getHours();
    // 20:00-21:00 可玩
    if (hour < 20 || hour >= 21) {
      return {
        allowed: false,
        reason: '未成年人只能在20:00-21:00期间游戏',
      };
    }

    return { allowed: true };
  }

  /**
   * 判断某天是否对未成年人可游戏（周五/六/日及节假日）
   */
  private async isPlayableDayForMinor(date: Date): Promise<boolean> {
    const dayOfWeek = date.getDay(); // 0=周日, 1=周一, ..., 5=周五, 6=周六

    // 周五、周六、周日
    if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) {
      return true;
    }

    // 检查是否是节假日
    const dateStr = this.formatDate(date);
    const holiday = await this.holidayRepo.findOne({
      where: { holidayDate: dateStr },
    });

    return holiday?.isPlayable ?? false;
  }

  /**
   * 从身份证提取出生日期
   */
  private extractBirthDateFromIdCard(idCard: string): Date {
    if (idCard.length === 18) {
      const year = idCard.substring(6, 10);
      const month = idCard.substring(10, 12);
      const day = idCard.substring(12, 14);
      return new Date(`${year}-${month}-${day}`);
    }
    // 15位身份证
    if (idCard.length === 15) {
      const year = '19' + idCard.substring(6, 8);
      const month = idCard.substring(8, 10);
      const day = idCard.substring(10, 12);
      return new Date(`${year}-${month}-${day}`);
    }
    throw new Error('身份证号格式不正确');
  }

  /**
   * 计算年龄
   */
  private calculateAge(birthDate: Date): number {
    const now = new Date();
    let age = now.getFullYear() - birthDate.getFullYear();
    const monthDiff = now.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }

  /**
   * 获取今天日期字符串 YYYY-MM-DD
   */
  private getTodayString(): string {
    return this.formatDate(new Date());
  }

  /**
   * 格式化日期为 YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
