import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GameState, Action } from '../../plugin/interfaces/game-controller.interface';
import { ReplayData, ReplayAction } from '../dto/sync-state.dto';
import { RecorderService } from './recorder.service';

/**
 * 回放状态
 */
export enum ReplayStatus {
  IDLE = 'idle',
  PLAYING = 'playing',
  PAUSED = 'paused',
  FINISHED = 'finished',
}

/**
 * 回放会话
 */
interface ReplaySession {
  recordId: string;
  replayData: ReplayData;
  currentIndex: number;
  status: ReplayStatus;
  playbackSpeed: number;
  currentState: GameState;
}

/**
 * ReplayService - 回放服务
 *
 * 功能：
 * 1. 获取回放数据（getReplay）
 * 2. 获取指定步骤的游戏状态（getReplayAtIndex）
 * 3. 支持播放控制：快进、快退、暂停
 * 4. 状态重建：从操作序列重建任意时刻的游戏状态
 */
@Injectable()
export class ReplayService {
  private readonly logger = new Logger(ReplayService.name);

  // 内存中的回放会话
  private readonly sessions = new Map<string, ReplaySession>();

  // 默认回放速度
  private readonly DEFAULT_SPEED = 1;

  // 最小/最大回放速度
  private readonly MIN_SPEED = 0.25;
  private readonly MAX_SPEED = 4;

  constructor(private readonly recorderService: RecorderService) {}

  /**
   * 获取回放数据
   * @param recordId 记录ID
   * @returns 回放数据
   */
  async getReplay(recordId: string): Promise<ReplayData> {
    try {
      // 先从内存缓存查找
      const session = this.sessions.get(recordId);
      if (session) {
        return session.replayData;
      }

      // 从存储中读取
      const replayData = await this.recorderService.readFromStorage(recordId);

      this.logger.log(
        `[Replay] Loaded record=${recordId} ` +
        `Actions=${replayData.actions.length} ` +
        `GameType=${replayData.gameType}`,
      );

      return replayData;
    } catch (error) {
      this.logger.error(
        `[Replay] Failed to load replay record=${recordId}: ${error.message}`,
      );
      throw new NotFoundException(`Replay not found: ${recordId}`);
    }
  }

  /**
   * 获取指定步骤的游戏状态
   * 通过重放操作序列到指定索引来重建状态
   * @param recordId 记录ID
   * @param index 操作索引（-1表示初始状态）
   * @returns 该索引对应的游戏状态
   */
  async getReplayAtIndex(recordId: string, index: number): Promise<GameState> {
    // 确保回放会话已加载
    await this.loadSession(recordId);

    const session = this.sessions.get(recordId);
    if (!session) {
      throw new NotFoundException(`Replay session not found: ${recordId}`);
    }

    // 边界检查
    if (index < -1) {
      index = -1;
    }
    if (index >= session.replayData.actions.length) {
      index = session.replayData.actions.length - 1;
    }

    // 重建状态
    const state = this.rebuildState(session.replayData, index);

    this.logger.debug(
      `[Replay] Rebuilt state record=${recordId} index=${index}`,
    );

    return state;
  }

  /**
   * 创建回放会话（用于交互式播放控制）
   * @param recordId 记录ID
   */
  async createPlaybackSession(recordId: string): Promise<string> {
    await this.loadSession(recordId);

    const session = this.sessions.get(recordId);
    if (!session) {
      throw new NotFoundException(`Replay not found: ${recordId}`);
    }

    // 重置到初始状态
    session.currentIndex = -1;
    session.status = ReplayStatus.IDLE;
    session.playbackSpeed = this.DEFAULT_SPEED;
    session.currentState = this.rebuildState(session.replayData, -1);

    this.logger.log(`[Replay] Playback session created record=${recordId}`);

    return recordId;
  }

  /**
   * 播放回放
   * @param recordId 记录ID
   */
  async play(recordId: string): Promise<void> {
    const session = this.getSession(recordId);
    session.status = ReplayStatus.PLAYING;

    this.logger.debug(`[Replay] Playing record=${recordId}`);
  }

  /**
   * 暂停回放
   * @param recordId 记录ID
   */
  async pause(recordId: string): Promise<void> {
    const session = this.getSession(recordId);
    session.status = ReplayStatus.PAUSED;

    this.logger.debug(`[Replay] Paused record=${recordId}`);
  }

  /**
   * 停止回放
   * @param recordId 记录ID
   */
  async stop(recordId: string): Promise<void> {
    const session = this.getSession(recordId);
    session.status = ReplayStatus.IDLE;
    session.currentIndex = -1;
    session.currentState = this.rebuildState(session.replayData, -1);

    this.logger.debug(`[Replay] Stopped record=${recordId}`);
  }

  /**
   * 快进到指定位置
   * @param recordId 记录ID
   * @param targetIndex 目标索引
   */
  async seekTo(recordId: string, targetIndex: number): Promise<GameState> {
    const session = this.getSession(recordId);

    // 边界检查
    if (targetIndex < -1) {
      targetIndex = -1;
    }
    const maxIndex = session.replayData.actions.length - 1;
    if (targetIndex > maxIndex) {
      targetIndex = maxIndex;
    }

    // 重建目标状态
    session.currentIndex = targetIndex;
    session.currentState = this.rebuildState(session.replayData, targetIndex);

    // 检查是否到达末尾
    if (targetIndex >= maxIndex) {
      session.status = ReplayStatus.FINISHED;
    }

    this.logger.debug(
      `[Replay] Seek record=${recordId} -> index=${targetIndex}`,
    );

    return session.currentState;
  }

  /**
   * 快进（增加播放速度）
   * @param recordId 记录ID
   * @returns 当前播放速度
   */
  async fastForward(recordId: string): Promise<number> {
    const session = this.getSession(recordId);
    session.playbackSpeed = Math.min(
      session.playbackSpeed * 2,
      this.MAX_SPEED,
    );

    this.logger.debug(
      `[Replay] FastForward record=${recordId} speed=${session.playbackSpeed}x`,
    );

    return session.playbackSpeed;
  }

  /**
   * 快退（降低播放速度）
   * @param recordId 记录ID
   * @returns 当前播放速度
   */
  async rewind(recordId: string): Promise<number> {
    const session = this.getSession(recordId);

    // 如果当前速度为正，先降为负（倒放）
    if (session.playbackSpeed > 0) {
      session.playbackSpeed = -this.DEFAULT_SPEED;
    } else {
      session.playbackSpeed = Math.max(
        session.playbackSpeed * 2,
        -this.MAX_SPEED,
      );
    }

    this.logger.debug(
      `[Replay] Rewind record=${recordId} speed=${session.playbackSpeed}x`,
    );

    return session.playbackSpeed;
  }

  /**
   * 下一帧（单步前进）
   * @param recordId 记录ID
   * @returns 当前游戏状态
   */
  async nextFrame(recordId: string): Promise<GameState> {
    const session = this.getSession(recordId);
    const nextIndex = session.currentIndex + 1;
    return this.seekTo(recordId, nextIndex);
  }

  /**
   * 上一帧（单步后退）
   * @param recordId 记录ID
   * @returns 当前游戏状态
   */
  async prevFrame(recordId: string): Promise<GameState> {
    const session = this.getSession(recordId);
    const prevIndex = session.currentIndex - 1;
    return this.seekTo(recordId, prevIndex);
  }

  /**
   * 设置播放速度
   * @param recordId 记录ID
   * @param speed 播放速度（0.25x - 4x）
   */
  async setPlaybackSpeed(recordId: string, speed: number): Promise<number> {
    const session = this.getSession(recordId);
    session.playbackSpeed = Math.max(
      this.MIN_SPEED,
      Math.min(this.MAX_SPEED, speed),
    );

    return session.playbackSpeed;
  }

  /**
   * 获取当前播放状态
   */
  getPlaybackStatus(recordId: string): {
    status: ReplayStatus;
    currentIndex: number;
    totalActions: number;
    playbackSpeed: number;
    currentTime: number;
    totalTime: number;
  } {
    const session = this.sessions.get(recordId);
    if (!session) {
      return {
        status: ReplayStatus.IDLE,
        currentIndex: -1,
        totalActions: 0,
        playbackSpeed: 1,
        currentTime: 0,
        totalTime: 0,
      };
    }

    const currentTime =
      session.currentIndex >= 0
        ? session.replayData.actions[session.currentIndex]?.timestamp -
          session.replayData.startTime
        : 0;

    const totalTime = session.replayData.endTime
      ? session.replayData.endTime - session.replayData.startTime
      : 0;

    return {
      status: session.status,
      currentIndex: session.currentIndex,
      totalActions: session.replayData.actions.length,
      playbackSpeed: session.playbackSpeed,
      currentTime,
      totalTime,
    };
  }

  /**
   * 清理回放会话
   */
  cleanupSession(recordId: string): void {
    this.sessions.delete(recordId);
    this.logger.debug(`[Replay] Session cleaned up record=${recordId}`);
  }

  // ==================== 私有方法 ====================

  /**
   * 加载回放会话
   */
  private async loadSession(recordId: string): Promise<void> {
    if (this.sessions.has(recordId)) {
      return;
    }

    const replayData = await this.getReplay(recordId);

    // 构建初始状态
    const initialState = this.buildInitialState(replayData);

    const session: ReplaySession = {
      recordId,
      replayData,
      currentIndex: -1,
      status: ReplayStatus.IDLE,
      playbackSpeed: this.DEFAULT_SPEED,
      currentState: initialState,
    };

    this.sessions.set(recordId, session);
  }

  /**
   * 获取会话（带错误处理）
   */
  private getSession(recordId: string): ReplaySession {
    const session = this.sessions.get(recordId);
    if (!session) {
      throw new NotFoundException(`Playback session not found: ${recordId}`);
    }
    return session;
  }

  /**
   * 构建初始状态
   */
  private buildInitialState(replayData: ReplayData): GameState {
    if (replayData.actions.length > 0 && replayData.actions[0].stateSnapshot) {
      // 使用第一个操作之前的状态快照
      return { ...replayData.actions[0].stateSnapshot };
    }

    // 从回放数据构建最基础的初始状态
    return {
      status: 'playing',
      players: replayData.players.map((p) => ({
        playerId: p.playerId,
        seatIndex: p.seatIndex,
        status: 'active',
        score: 0,
        metadata: {},
      })),
      currentPlayer: replayData.players[0]?.playerId,
      round: 1,
      metadata: {
        gameType: replayData.gameType,
        replayMode: true,
      },
    };
  }

  /**
   * 重建指定索引的游戏状态
   * 通过依次应用操作到初始状态来重建
   */
  private rebuildState(replayData: ReplayData, targetIndex: number): GameState {
    // 从初始状态开始
    let state = this.buildInitialState(replayData);

    if (targetIndex < 0) {
      return state;
    }

    // 依次应用每个操作
    for (let i = 0; i <= targetIndex && i < replayData.actions.length; i++) {
      const replayAction = replayData.actions[i];

      // 如果有状态快照，直接使用（优化性能）
      if (i === targetIndex && replayAction.stateSnapshot) {
        return { ...replayAction.stateSnapshot };
      }

      // 否则应用操作到状态
      state = this.applyAction(state, replayAction.action);

      // 更新当前玩家等信息
      state = {
        ...state,
        metadata: {
          ...state.metadata,
          lastAction: replayAction.action,
          lastActionTimestamp: replayAction.timestamp,
        },
      };
    }

    return state;
  }

  /**
   * 将操作应用到状态
   * 这是一个通用的状态更新函数，具体游戏逻辑可能需要定制
   */
  private applyAction(state: GameState, action: Action): GameState {
    // 基础实现：记录操作到metadata中
    // 具体的游戏状态更新应由游戏插件实现
    const moveHistory = (state.metadata?.moveHistory || []) as Action[];

    return {
      ...state,
      currentPlayer: this.getNextPlayer(state),
      metadata: {
        ...state.metadata,
        moveHistory: [...moveHistory, action],
      },
    };
  }

  /**
   * 获取下一个玩家
   */
  private getNextPlayer(state: GameState): string {
    if (!state.players || state.players.length === 0) {
      return state.currentPlayer || '';
    }

    const currentIndex = state.players.findIndex(
      (p) => p.playerId === state.currentPlayer,
    );

    if (currentIndex === -1) {
      return state.players[0].playerId;
    }

    const nextIndex = (currentIndex + 1) % state.players.length;
    return state.players[nextIndex].playerId;
  }
}
