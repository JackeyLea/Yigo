import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SearchPlayersDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  keyword: string;
}
