import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class JoinApplicationDto {
  @IsNotEmpty()
  @IsString()
  clubId: string;

  @IsOptional()
  @IsString()
  message?: string;
}
