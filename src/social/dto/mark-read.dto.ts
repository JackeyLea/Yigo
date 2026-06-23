import { IsNotEmpty, IsNumberString } from 'class-validator';

export class MarkReadDto {
  @IsNotEmpty()
  @IsNumberString()
  fromUserId: string;
}
