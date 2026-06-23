import { IsNotEmpty, IsString } from 'class-validator';

export class SendRoomMessageDto {
  @IsNotEmpty()
  @IsString()
  roomId: string;

  @IsNotEmpty()
  @IsString()
  content: string;
}
