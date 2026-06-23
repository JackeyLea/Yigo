import { IsNotEmpty, IsNumberString } from 'class-validator';

export class BlockUserDto {
  @IsNotEmpty()
  @IsNumberString()
  blockUserId: string;
}
