import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateClubDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}
