import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class PluginService {
  private readonly logger = new Logger(PluginService.name);
}
