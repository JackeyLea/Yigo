import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class DonateDto {
  @IsNotEmpty()
  @IsString()
  clubId: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  amount: number;
}
