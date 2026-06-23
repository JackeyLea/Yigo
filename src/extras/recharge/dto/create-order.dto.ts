import {
  IsInt,
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsIn,
} from 'class-validator';

export class CreateOrderDto {
  @IsInt()
  @IsNotEmpty()
  userId: number;

  @IsNumber()
  @Min(0.01)
  @IsNotEmpty()
  amount: number;

  @IsString()
  @IsNotEmpty()
  @IsIn(['wechat', 'alipay', 'apple', 'google'])
  channel: string;

  @IsString()
  @IsNotEmpty()
  packId: string;
}

export class ConfirmOrderDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsString()
  @IsNotEmpty()
  transactionId: string;
}
