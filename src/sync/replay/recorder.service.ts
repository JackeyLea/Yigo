import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Action, GameState, PlayerState } from '../../plugin/interfaces/game-controller.interface';
import { ReplayAction, ReplayData } from '../dto/sync-state.dto';

/**
 * 录制会话
 */
interface RecordingSession {
  roomId: string;
  players: PlayerState[];
  gameType: string;
  actions: ReplayAction[];
  startTime: number;
  startState?: GameState;
}

/**
 * S3兼容对象存储配置
 */
interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/**
 * RecorderService - 对局记录器
 *
 * 功能：
 * 1. 开始录制对局（startRecording）
 * 2. 记录每个操作（recordAction）
 * 3. 停止录制并生成回放数据（stopRecording）
 * 4. 将操作序列写入对象存储（S3兼容）
 */
@Injectable()
export class RecorderService {
  private readonly logger = new Logger(RecorderService.name);

  // 内存中的录制会话
  private readonly sessions = new Map<string, RecordingSession>();

  // S3配置（可从环境变量或配置服务获取）
  private readonly s3Config: S3Config;

  // 录制文件存储路径前缀
  private readonly RECORD_PREFIX = 'replays';

  constructor() {
    // 从环境变量读取S3配置
    this.s3Config = {
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
      bucket: process.env.S3_BUCKET || 'chess-platform-replays',
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
      region: process.env.S3_REGION || 'us-east-1',
    };
  }

  /**
   * 开始录制对局
   * @param roomId 房间ID
   * @param players 玩家状态数组
   * @param gameType 游戏类型
   * @param initialState 初始状态（可选）
   */
  startRecording(
    roomId: string,
    players: PlayerState[],
    gameType?: string,
    initialState?: GameState,
  ): void {
    if (this.sessions.has(roomId)) {
      this.logger.warn(`[Recorder] Recording already started for Room=${roomId}`);
      return;
    }

    const session: RecordingSession = {
      roomId,
      players: players.map((p) => ({ ...p })),
      gameType: gameType || 'unknown',
      actions: [],
      startTime: Date.now(),
      startState: initialState ? { ...initialState } : undefined,
    };

    this.sessions.set(roomId, session);

    this.logger.log(
      `[Recorder] Recording started Room=${roomId} ` +
      `Players=${players.length} GameType=${session.gameType}`,
    );
  }

  /**
   * 记录操作
   * @param roomId 房间ID
   * @param action 操作指令
   * @param stateSnapshot 操作后的状态快照（可选，用于关键帧）
   */
  recordAction(roomId: string, action: Action, stateSnapshot?: GameState): void {
    const session = this.sessions.get(roomId);
    if (!session) {
      this.logger.warn(`[Recorder] No active recording for Room=${roomId}`);
      return;
    }

    const replayAction: ReplayAction = {
      index: session.actions.length,
      timestamp: Date.now(),
      action: { ...action },
      stateSnapshot: stateSnapshot ? { ...stateSnapshot } : undefined,
    };

    session.actions.push(replayAction);

    // 每50个操作记录一次日志
    if (session.actions.length % 50 === 0) {
      this.logger.debug(
        `[Recorder] Room=${roomId} Actions=${session.actions.length}`,
      );
    }
  }

  /**
   * 停止录制并生成回放数据
   * @param roomId 房间ID
   * @param finalState 最终状态（可选）
   * @returns 回放数据URL
   */
  async stopRecording(roomId: string, finalState?: GameState): Promise<string> {
    const session = this.sessions.get(roomId);
    if (!session) {
      throw new Error(`No active recording for Room=${roomId}`);
    }

    const endTime = Date.now();

    // 构建回放数据
    const recordId = this.generateRecordId(roomId, session.startTime);

    const replayData: ReplayData = {
      recordId,
      roomId: session.roomId,
      players: session.players.map((p) => ({
        playerId: p.playerId,
        seatIndex: p.seatIndex,
        nickname: p.metadata?.nickname as string,
      })),
      gameType: session.gameType,
      actions: session.actions,
      startTime: session.startTime,
      endTime,
      finalState: finalState ? { ...finalState } : undefined,
    };

    try {
      // 写入对象存储
      const dataUrl = await this.saveToStorage(recordId, replayData);

      this.logger.log(
        `[Recorder] Recording stopped Room=${roomId} ` +
        `RecordId=${recordId} Actions=${session.actions.length} ` +
        `Duration=${endTime - session.startTime}ms`,
      );

      // 清理内存会话
      this.sessions.delete(roomId);

      return dataUrl;
    } catch (error) {
      this.logger.error(
        `[Recorder] Failed to save replay Room=${roomId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * 获取录制会话信息
   */
  getSessionInfo(roomId: string): {
    isRecording: boolean;
    actionCount: number;
    duration: number;
  } {
    const session = this.sessions.get(roomId);
    if (!session) {
      return { isRecording: false, actionCount: 0, duration: 0 };
    }

    return {
      isRecording: true,
      actionCount: session.actions.length,
      duration: Date.now() - session.startTime,
    };
  }

  /**
   * 获取所有活跃录制
   */
  getActiveRecordings(): Array<{
    roomId: string;
    actionCount: number;
    duration: number;
  }> {
    const now = Date.now();
    return Array.from(this.sessions.entries()).map(([roomId, session]) => ({
      roomId,
      actionCount: session.actions.length,
      duration: now - session.startTime,
    }));
  }

  /**
   * 强制丢弃录制
   */
  discardRecording(roomId: string): void {
    const deleted = this.sessions.delete(roomId);
    if (deleted) {
      this.logger.log(`[Recorder] Recording discarded Room=${roomId}`);
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 生成回放记录ID
   */
  private generateRecordId(roomId: string, startTime: number): string {
    const data = `${roomId}:${startTime}:${randomBytes(8).toString('hex')}`;
    return createHash('sha256').update(data).digest('hex').substring(0, 32);
  }

  /**
   * 保存回放数据到对象存储（S3兼容）
   */
  private async saveToStorage(recordId: string, replayData: ReplayData): Promise<string> {
    const key = `${this.RECORD_PREFIX}/${recordId.substring(0, 2)}/${recordId}.json`;
    const jsonData = JSON.stringify(replayData, null, 2);

    try {
      // 使用fetch API进行S3兼容上传
      const uploadUrl = `${this.s3Config.endpoint}/${this.s3Config.bucket}/${key}`;

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-amz-access-key': this.s3Config.accessKeyId,
          'x-amz-secret-key': this.s3Config.secretAccessKey,
        },
        body: jsonData,
      });

      if (!response.ok) {
        // 如果S3上传失败，保存到本地文件系统作为降级方案
        return this.saveToLocalFallback(recordId, jsonData);
      }

      this.logger.log(`[Recorder] Replay saved to S3: ${key}`);
      return uploadUrl;
    } catch (error) {
      // 网络错误时降级到本地存储
      this.logger.warn(
        `[Recorder] S3 upload failed, falling back to local storage: ${error.message}`,
      );
      return this.saveToLocalFallback(recordId, jsonData);
    }
  }

  /**
   * 本地文件系统降级存储
   */
  private async saveToLocalFallback(recordId: string, jsonData: string): Promise<string> {
    const fs = await import('fs').catch(() => null);
    const path = await import('path').catch(() => null);

    if (!fs || !path) {
      // 如果连fs模块都不可用，返回数据URL
      this.logger.warn('[Recorder] fs module not available, returning data URL');
      return `data:application/json;base64,${Buffer.from(jsonData).toString('base64')}`;
    }

    try {
      const storageDir = process.env.REPLAY_LOCAL_PATH || '/tmp/chess-platform-replays';
      const subDir = path.join(storageDir, recordId.substring(0, 2));

      // 递归创建目录
      await fs.promises.mkdir(subDir, { recursive: true });

      const filePath = path.join(subDir, `${recordId}.json`);
      await fs.promises.writeFile(filePath, jsonData, 'utf-8');

      this.logger.log(`[Recorder] Replay saved locally: ${filePath}`);
      return `file://${filePath}`;
    } catch (error) {
      this.logger.error(`[Recorder] Local save failed: ${error.message}`);
      // 最后降级：返回base64 data URL
      return `data:application/json;base64,${Buffer.from(jsonData).toString('base64')}`;
    }
  }

  /**
   * 从存储中读取回放数据
   */
  async readFromStorage(recordId: string): Promise<ReplayData> {
    // 优先尝试本地文件系统
    const fs = await import('fs').catch(() => null);
    const path = await import('path').catch(() => null);

    if (fs && path) {
      try {
        const storageDir = process.env.REPLAY_LOCAL_PATH || '/tmp/chess-platform-replays';
        const filePath = path.join(storageDir, recordId.substring(0, 2), `${recordId}.json`);
        const data = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(data) as ReplayData;
      } catch {
        // 本地文件不存在，继续尝试S3
      }
    }

    // 尝试从S3读取
    const key = `${this.RECORD_PREFIX}/${recordId.substring(0, 2)}/${recordId}.json`;
    const downloadUrl = `${this.s3Config.endpoint}/${this.s3Config.bucket}/${key}`;

    const response = await fetch(downloadUrl, {
      headers: {
        'x-amz-access-key': this.s3Config.accessKeyId,
        'x-amz-secret-key': this.s3Config.secretAccessKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Replay not found: ${recordId}`);
    }

    return response.json() as Promise<ReplayData>;
  }
}
