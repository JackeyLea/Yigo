/**
 * HeartbeatService - 心跳管理服务
 *
 * 管理WebSocket连接的心跳检测：
 * - 30秒间隔发送心跳检测
 * - 3次未响应判定为断线
 * - 断线后标记离线，触发清理流程
 */
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Socket } from 'socket.io';
import { ConnectionManagerService } from './connection-manager.service';
import { WS_EVENTS } from '../dto/ws-events';

/** 心跳检测间隔（毫秒） */
const HEARTBEAT_INTERVAL = 30000; // 30秒

/** 最大未响应次数 */
const MAX_MISSED_HEARTBEATS = 3;

/** 心跳超时时间（毫秒） */
const HEARTBEAT_TIMEOUT = HEARTBEAT_INTERVAL * MAX_MISSED_HEARTBEATS; // 90秒

/** 客户端心跳键前缀 */
const REDIS_KEY = {
  HEARTBEAT: (socketId: string) => `hb:${socketId}`,
};

@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /** 客户端心跳计数器 Map<socketId, missedCount> */
  private heartbeatCounters = new Map<string, number>();

  /** 断线回调 */
  private disconnectCallback: ((socketId: string) => void) | null = null;

  constructor(
    private readonly connectionManager: ConnectionManagerService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    // 启动心跳检测定时器
    this.startHeartbeatCheck();
    this.logger.log('HeartbeatService initialized');
  }

  onModuleDestroy(): void {
    this.stopHeartbeatCheck();
    this.heartbeatCounters.clear();
    this.logger.log('HeartbeatService destroyed');
  }

  /**
   * 注册断线回调
   */
  onDisconnect(callback: (socketId: string) => void): void {
    this.disconnectCallback = callback;
  }

  // ==================== 客户端心跳管理 ====================

  /**
   * 注册新连接的心跳监控
   * @param client - Socket 客户端
   */
  registerClient(client: Socket): void {
    this.heartbeatCounters.set(client.id, 0);
    this.logger.debug(`Heartbeat registered for client: ${client.id}`);
  }

  /**
   * 注销客户端心跳监控
   * @param clientId - Socket ID
   */
  unregisterClient(clientId: string): void {
    this.heartbeatCounters.delete(clientId);
    this.logger.debug(`Heartbeat unregistered for client: ${clientId}`);
  }

  /**
   * 处理客户端心跳响应（pong）
   * @param clientId - Socket ID
   */
  handlePong(clientId: string): void {
    // 重置未响应计数
    this.heartbeatCounters.set(clientId, 0);
    this.logger.debug(`Heartbeat pong received: ${clientId}`);
  }

  /**
   * 处理客户端主动发送的心跳（ping）
   * @param client - Socket 客户端
   */
  async handlePing(client: Socket): Promise<void> {
    // 重置计数器
    this.heartbeatCounters.set(client.id, 0);

    // 回复心跳确认
    client.emit(WS_EVENTS.C_HEARTBEAT, { timestamp: Date.now() });

    this.logger.debug(`Heartbeat ping processed: ${client.id}`);
  }

  // ==================== 心跳检测定时器 ====================

  /**
   * 启动心跳检测定时器
   */
  private startHeartbeatCheck(): void {
    if (this.heartbeatInterval) {
      return;
    }

    this.heartbeatInterval = setInterval(() => {
      this.checkHeartbeats();
    }, HEARTBEAT_INTERVAL);

    // 注册到调度器以便清理
    try {
      this.schedulerRegistry.addInterval('heartbeat-check', this.heartbeatInterval);
    } catch {
      // 已存在则忽略
    }

    this.logger.log(
      `Heartbeat check started: interval=${HEARTBEAT_INTERVAL}ms, maxMissed=${MAX_MISSED_HEARTBEATS}`,
    );
  }

  /**
   * 停止心跳检测定时器
   */
  private stopHeartbeatCheck(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;

      try {
        this.schedulerRegistry.deleteInterval('heartbeat-check');
      } catch {
        // 不存在则忽略
      }
    }
  }

  /**
   * 检查所有客户端的心跳状态
   */
  private checkHeartbeats(): void {
    const now = Date.now();
    const expiredClients: string[] = [];

    for (const [socketId, missedCount] of this.heartbeatCounters.entries()) {
      const newMissedCount = missedCount + 1;

      if (newMissedCount >= MAX_MISSED_HEARTBEATS) {
        // 超过最大未响应次数，判定断线
        expiredClients.push(socketId);
        this.logger.warn(
          `Client heartbeat timeout: socketId=${socketId}, missed=${newMissedCount}`,
        );
      } else {
        // 更新未响应计数
        this.heartbeatCounters.set(socketId, newMissedCount);

        // 发送心跳检测请求
        this.sendPing(socketId);
      }
    }

    // 处理断线客户端
    for (const socketId of expiredClients) {
      this.handleClientTimeout(socketId);
    }
  }

  /**
   * 向客户端发送心跳检测请求
   */
  private sendPing(socketId: string): void {
    const server = this.connectionManager.getServer();
    if (!server) {
      return;
    }

    // 向指定socket发送ping
    server.to(socketId).emit('ping', { timestamp: Date.now() });
    this.logger.debug(`Ping sent to client: ${socketId}`);
  }

  /**
   * 处理客户端心跳超时
   */
  private handleClientTimeout(socketId: string): void {
    // 移除心跳监控
    this.heartbeatCounters.delete(socketId);

    // 触发断线回调
    if (this.disconnectCallback) {
      try {
        this.disconnectCallback(socketId);
      } catch (error) {
        this.logger.error(`Disconnect callback error: ${error.message}`);
      }
    }

    this.logger.log(`Client timed out and disconnected: ${socketId}`);
  }

  // ==================== 工具方法 ====================

  /**
   * 获取当前监控的客户端数量
   */
  getMonitoredClientCount(): number {
    return this.heartbeatCounters.size;
  }

  /**
   * 获取指定客户端的未响应次数
   */
  getMissedCount(socketId: string): number {
    return this.heartbeatCounters.get(socketId) || 0;
  }

  /**
   * 重置指定客户端的心跳计数
   */
  resetCounter(socketId: string): void {
    this.heartbeatCounters.set(socketId, 0);
  }
}
