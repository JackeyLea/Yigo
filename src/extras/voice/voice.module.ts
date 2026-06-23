import { Module } from '@nestjs/common';
import { VoiceService } from './voice.service';
import { VoiceGateway } from './voice.gateway';

@Module({
  providers: [VoiceService, VoiceGateway],
  exports: [VoiceService],
})
export class VoiceModule {}
