import { EventBus } from '../event-bus';

export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

export interface FrameworkContext {
  pluginId: string;
  roomId: string;
  config: Record<string, any>;
  eventBus: EventBus;
  logger: Logger;
  localize: (key: string, params?: Record<string, string>) => string;
}
