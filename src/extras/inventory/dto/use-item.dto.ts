import { IsInt, IsNotEmpty, IsOptional, Min } from 'class-validator';

export class UseItemDto {
  @IsInt()
  @IsNotEmpty()
  itemId: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  count?: number;
}

export class AddItemDto {
  @IsInt()
  @IsNotEmpty()
  itemId: number;

  @IsInt()
  @Min(1)
  @IsNotEmpty()
  count: number;

  @IsInt()
  @IsNotEmpty()
  userId: number;

  @IsNotEmpty()
  source: string;
}

export class RemoveItemDto {
  @IsInt()
  @IsNotEmpty()
  itemId: number;

  @IsInt()
  @Min(1)
  @IsNotEmpty()
  count: number;

  @IsInt()
  @IsNotEmpty()
  userId: number;
}
