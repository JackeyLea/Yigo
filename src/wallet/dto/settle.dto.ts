import { IsString, IsNumber, IsPositive, IsNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SettlementItemDto {
  @IsNumber()
  userId: number;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsNumber()
  amount: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class SettleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettlementItemDto)
  settlements: SettlementItemDto[];

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
