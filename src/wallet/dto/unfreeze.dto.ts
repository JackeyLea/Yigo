import { IsString, IsNotEmpty } from 'class-validator';

export class UnfreezeDto {
  @IsString()
  @IsNotEmpty()
  freezeId: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
