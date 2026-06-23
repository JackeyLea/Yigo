import { IsString, IsNumber, IsPositive, IsNotEmpty } from 'class-validator';

export class TransferDto {
  @IsNumber()
  toUserId: number;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
