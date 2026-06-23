import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  IsNumberString,
} from 'class-validator';
import { ChatMessageType } from '../entities/chat-message.entity';

export class SendMessageDto {
  @IsNotEmpty()
  @IsNumberString()
  toUserId: string;

  @IsNotEmpty()
  @IsString()
  content: string;

  @IsOptional()
  @IsEnum(ChatMessageType)
  type?: ChatMessageType;
}
