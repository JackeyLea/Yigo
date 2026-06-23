import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);
}
