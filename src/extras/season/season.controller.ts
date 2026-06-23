import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SeasonService } from './season.service';
import { Season, SeasonReward } from './season.entity';
import { CreateSeasonDto } from './dto/create-season.dto';
import { ClaimRewardDto } from './dto/claim-reward.dto';

@Controller('seasons')
export class SeasonController {
  constructor(private readonly seasonService: SeasonService) {}

  /**
   * 获取当前进行中的赛季
   */
  @Get('current/:gameType')
  async getCurrentSeason(
    @Param('gameType') gameType: string,
  ): Promise<Season> {
    return this.seasonService.getCurrentSeason(gameType);
  }

  /**
   * 获取历史赛季列表
   */
  @Get('history/:gameType')
  async getSeasonHistory(
    @Param('gameType') gameType: string,
  ): Promise<Season[]> {
    return this.seasonService.getSeasonHistory(gameType);
  }

  /**
   * 获取用户赛季奖励
   */
  @Get('rewards/:userId/:seasonId')
  async getSeasonRewards(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('seasonId') seasonId: string,
  ): Promise<SeasonReward[]> {
    return this.seasonService.getSeasonRewards(userId, seasonId);
  }

  /**
   * 领取赛季奖励
   */
  @Post('claim-reward/:userId')
  @HttpCode(HttpStatus.OK)
  async claimSeasonReward(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: ClaimRewardDto,
  ): Promise<void> {
    return this.seasonService.claimSeasonReward(userId, dto.rewardId);
  }

  /**
   * 获取用户赛季排名
   */
  @Get('rank/:userId/:seasonId')
  async getSeasonRank(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('seasonId') seasonId: string,
  ): Promise<{ rank: number }> {
    const rank = await this.seasonService.getSeasonRank(userId, seasonId);
    return { rank };
  }

  /**
   * 创建赛季
   */
  @Post('create')
  async createSeason(@Body() dto: CreateSeasonDto): Promise<Season> {
    return this.seasonService.createSeason(
      dto.name,
      dto.gameType,
      dto.startDate,
      dto.endDate,
    );
  }

  /**
   * 结束赛季
   */
  @Post('end/:seasonId')
  @HttpCode(HttpStatus.OK)
  async endSeason(@Param('seasonId') seasonId: string): Promise<void> {
    return this.seasonService.endSeason(seasonId);
  }
}
