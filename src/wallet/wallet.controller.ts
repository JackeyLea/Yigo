import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { TransferDto } from './dto/transfer.dto';
import { FreezeDto } from './dto/freeze.dto';
import { UnfreezeDto } from './dto/unfreeze.dto';
import { SettleDto } from './dto/settle.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../common/decorators/current-user.decorator';

@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  @UseGuards(JwtAuthGuard)
  async getBalance(
    @CurrentUser() user: CurrentUserData,
    @Query('currency') currency?: string,
  ) {
    return this.walletService.getBalance(user.userId, currency);
  }

  @Post('transfer')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async transfer(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: TransferDto,
  ) {
    return this.walletService.transfer(
      user.userId,
      dto.toUserId,
      dto.currency,
      dto.amount,
      dto.reason,
      dto.idempotencyKey,
    );
  }

  @Post('freeze')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async freeze(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: FreezeDto,
  ) {
    return this.walletService.freeze(
      user.userId,
      dto.currency,
      dto.amount,
      dto.reason,
      dto.idempotencyKey,
    );
  }

  @Post('unfreeze')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async unfreeze(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UnfreezeDto,
  ) {
    // unfreeze doesn't need current user check - freezeId is sufficient
    void user;
    return this.walletService.unfreeze(dto.freezeId, dto.idempotencyKey);
  }

  @Post('settle')
  @HttpCode(HttpStatus.OK)
  async settle(@Body() dto: SettleDto) {
    return this.walletService.settle(
      dto.settlements.map((s) => ({
        userId: s.userId,
        currency: s.currency,
        amount: s.amount,
        reason: s.reason,
      })),
      dto.idempotencyKey,
    );
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  async getHistory(
    @CurrentUser() user: CurrentUserData,
    @Query('currency') currency?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize?: number,
  ) {
    return this.walletService.getHistory(user.userId, currency, page, pageSize);
  }
}
