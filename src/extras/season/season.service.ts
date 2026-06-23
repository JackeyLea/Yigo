import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import {
  Season,
  SeasonReward,
  SeasonRanking,
  SeasonStatus,
  SeasonRewardsConfig,
} from './season.entity';

export interface PlayTimeStatus {
  canPlay: boolean;
  reason?: string;
  remainingMinutes?: number;
}

@Injectable()
export class SeasonService {
  constructor(
    @InjectRepository(Season)
    private readonly seasonRepo: Repository<Season>,
    @InjectRepository(SeasonReward)
    private readonly rewardRepo: Repository<SeasonReward>,
    @InjectRepository(SeasonRanking)
    private readonly rankingRepo: Repository<SeasonRanking>,
  ) {}

  /**
   * 获取当前进行中的赛季
   */
  async getCurrentSeason(gameType: string): Promise<Season> {
    const now = new Date();
    const season = await this.seasonRepo.findOne({
      where: {
        gameType,
        status: SeasonStatus.ACTIVE,
        startDate: LessThanOrEqual(now),
        endDate: MoreThanOrEqual(now),
      },
      order: { startDate: 'DESC' },
    });

    if (!season) {
      throw new NotFoundException(
        `当前没有进行中的赛季 (gameType: ${gameType})`,
      );
    }

    return season;
  }

  /**
   * 获取历史赛季列表
   */
  async getSeasonHistory(gameType: string): Promise<Season[]> {
    return this.seasonRepo.find({
      where: {
        gameType,
        status: SeasonStatus.ENDED,
      },
      order: { endDate: 'DESC' },
    });
  }

  /**
   * 获取用户赛季奖励列表
   */
  async getSeasonRewards(
    userId: number,
    seasonId: string,
  ): Promise<SeasonReward[]> {
    return this.rewardRepo.find({
      where: { userId, seasonId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * 领取赛季奖励
   */
  async claimSeasonReward(userId: number, rewardId: number): Promise<void> {
    const reward = await this.rewardRepo.findOne({
      where: { id: rewardId, userId },
    });

    if (!reward) {
      throw new NotFoundException('奖励不存在');
    }

    if (reward.isClaimed) {
      throw new BadRequestException('奖励已领取');
    }

    reward.isClaimed = true;
    reward.claimedAt = new Date();
    await this.rewardRepo.save(reward);
  }

  /**
   * 获取用户赛季排名
   */
  async getSeasonRank(userId: number, seasonId: string): Promise<number> {
    const ranking = await this.rankingRepo.findOne({
      where: { userId, seasonId },
    });

    if (!ranking) {
      throw new NotFoundException('未找到该赛季的排名记录');
    }

    return ranking.rank;
  }

  /**
   * 创建赛季
   */
  async createSeason(
    name: string,
    gameType: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Season> {
    if (endDate <= startDate) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }

    const season = new Season();
    season.name = name;
    season.gameType = gameType;
    season.startDate = startDate;
    season.endDate = endDate;
    season.status = SeasonStatus.ACTIVE;
    season.rewardsConfig = this.getDefaultRewardsConfig();

    return this.seasonRepo.save(season);
  }

  /**
   * 结束赛季并发放奖励
   */
  async endSeason(seasonId: string): Promise<void> {
    const season = await this.seasonRepo.findOne({
      where: { id: seasonId },
    });

    if (!season) {
      throw new NotFoundException('赛季不存在');
    }

    if (season.status === SeasonStatus.ENDED) {
      throw new BadRequestException('赛季已结束');
    }

    // 1. 更新赛季状态
    season.status = SeasonStatus.ENDED;
    await this.seasonRepo.save(season);

    // 2. 计算最终排名
    await this.finalizeRankings(seasonId);

    // 3. 根据排名发放奖励
    await this.distributeRewards(season);
  }

  /**
   * 计算最终排名
   */
  private async finalizeRankings(seasonId: string): Promise<void> {
    const rankings = await this.rankingRepo.find({
      where: { seasonId },
      order: { score: 'DESC' },
    });

    for (let i = 0; i < rankings.length; i++) {
      rankings[i].rank = i + 1;
    }

    await this.rankingRepo.save(rankings);
  }

  /**
   * 根据排名发放奖励
   */
  private async distributeRewards(season: Season): Promise<void> {
    const rankings = await this.rankingRepo.find({
      where: { seasonId: season.id },
      order: { rank: 'ASC' },
    });

    const config = season.rewardsConfig || this.getDefaultRewardsConfig();

    for (const ranking of rankings) {
      const rankConfig = config.ranks.find(
        (r) => ranking.rank >= r.minRank && ranking.rank <= r.maxRank,
      );

      if (rankConfig) {
        // 发放对应档次奖励
        await this.createRewardRecord(
          season.id,
          ranking.userId,
          'rank_reward',
          `${rankConfig.title}奖励`,
          {
            rank: ranking.rank,
            title: rankConfig.title,
            gold: rankConfig.gold,
            avatarFrame: rankConfig.avatarFrame,
          },
        );
      }

      // 所有参与者都获得参与奖
      await this.createRewardRecord(
        season.id,
        ranking.userId,
        'participation',
        '参与奖',
        {
          title: config.participation.title,
          gold: config.participation.gold,
        },
      );
    }
  }

  /**
   * 创建奖励记录
   */
  private async createRewardRecord(
    seasonId: string,
    userId: number,
    rewardType: string,
    rewardName: string,
    rewardData: Record<string, any>,
  ): Promise<void> {
    const reward = new SeasonReward();
    reward.seasonId = seasonId;
    reward.userId = userId;
    reward.rewardType = rewardType;
    reward.rewardName = rewardName;
    reward.rewardData = rewardData;
    reward.isClaimed = false;
    reward.claimedAt = null;

    await this.rewardRepo.save(reward);
  }

  /**
   * 默认赛季奖励配置
   */
  private getDefaultRewardsConfig(): SeasonRewardsConfig {
    return {
      ranks: [
        {
          minRank: 1,
          maxRank: 1,
          title: '赛季冠军',
          gold: 10000,
          avatarFrame: 'exclusive_champion',
        },
        {
          minRank: 2,
          maxRank: 10,
          title: '赛季十强',
          gold: 5000,
        },
        {
          minRank: 11,
          maxRank: 100,
          title: '赛季百强',
          gold: 2000,
        },
      ],
      participation: {
        title: '赛季参与者',
        gold: 500,
      },
    };
  }
}
