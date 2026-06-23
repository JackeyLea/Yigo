import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Query,
  DefaultValuePipe,
} from '@nestjs/common';
import { RechargeService, RechargePackDto, PaginatedResult } from './recharge.service';
import { RechargeOrder } from './recharge.entity';
import { CreateOrderDto, ConfirmOrderDto } from './dto/create-order.dto';

@Controller('recharge')
export class RechargeController {
  constructor(private readonly rechargeService: RechargeService) {}

  /**
   * 获取充值套餐列表
   */
  @Get('packs')
  async getRechargePacks(): Promise<RechargePackDto[]> {
    return this.rechargeService.getRechargePacks();
  }

  /**
   * 创建充值订单
   */
  @Post('order')
  async createOrder(@Body() dto: CreateOrderDto): Promise<RechargeOrder> {
    return this.rechargeService.createOrder(
      dto.userId,
      dto.amount,
      dto.channel,
      dto.packId,
    );
  }

  /**
   * 确认充值到账
   */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirmOrder(@Body() dto: ConfirmOrderDto): Promise<void> {
    return this.rechargeService.confirmOrder(dto.orderId, dto.transactionId);
  }

  /**
   * 取消订单
   */
  @Post('cancel/:orderId')
  @HttpCode(HttpStatus.OK)
  async cancelOrder(@Param('orderId') orderId: string): Promise<void> {
    return this.rechargeService.cancelOrder(orderId);
  }

  /**
   * 查询订单
   */
  @Get('order/:orderId')
  async getOrder(@Param('orderId') orderId: string): Promise<RechargeOrder> {
    return this.rechargeService.getOrder(orderId);
  }

  /**
   * 获取充值记录
   */
  @Get('history/:userId')
  async getRechargeHistory(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ): Promise<PaginatedResult<RechargeOrder>> {
    return this.rechargeService.getRechargeHistory(userId, page, pageSize);
  }

  /**
   * 获取用户今日充值金额
   */
  @Get('daily-amount/:userId')
  async getDailyRechargeAmount(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ amount: number }> {
    const amount = await this.rechargeService.getDailyRechargeAmount(userId);
    return { amount };
  }
}
