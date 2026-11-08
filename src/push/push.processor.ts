import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PushService } from './push.service';

/**
 * Push Queue Processor
 * Periodically processes the push queue to send notifications
 */
@Injectable()
export class PushQueueProcessor {
  private readonly logger = new Logger(PushQueueProcessor.name);
  private isProcessing = false;

  constructor(private readonly pushService: PushService) {}

  /**
   * Process push queue every 5 seconds
   */
  @Cron('*/5 * * * * *')
  async handleQueueProcessing() {
    if (this.isProcessing) {
      return; // Skip if previous run is still in progress
    }

    this.isProcessing = true;
    try {
      await this.pushService.processPushQueue();
    } catch (error) {
      this.logger.error(`Queue processing error: ${error.message}`, error.stack);
    } finally {
      this.isProcessing = false;
    }
  }
}
