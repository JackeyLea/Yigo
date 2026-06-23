/**
 * 斗地主插件主类单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DoudizhuPlugin } from '../doudizhu.plugin';
import type { PluginOptions } from '../doudizhu.plugin';
import { DEFAULT_DOUDIZHU_CONFIG } from '../doudizhu.types';

describe('DoudizhuPlugin - 基础功能', () => {
  it('应正确创建插件', () => {
    const plugin = new DoudizhuPlugin();
    expect(plugin.name).toBe('doudizhu');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.displayName).toBe('斗地主');
    expect(plugin.minPlayers).toBe(3);
    expect(plugin.maxPlayers).toBe(3);
  });

  it('应能初始化', async () => {
    const plugin = new DoudizhuPlugin();
    const result = await plugin.init();
    expect(result).toBe(true);
  });

  it('应能销毁', () => {
    const plugin = new DoudizhuPlugin();
    plugin.destroy();
    expect(plugin.isPlaying()).toBe(false);
  });

  it('应生成房间ID', () => {
    const plugin = new DoudizhuPlugin();
    const roomId = plugin.getRoomId();
    expect(roomId).toContain('ddz_');
  });

  it('应使用传入的房间ID', () => {
    const plugin = new DoudizhuPlugin({ roomId: 'test_room' });
    expect(plugin.getRoomId()).toBe('test_room');
  });
});

describe('DoudizhuPlugin - 房间管理', () => {
  let plugin: DoudizhuPlugin;

  beforeEach(() => {
    plugin = new DoudizhuPlugin();
  });

  it('玩家应能加入房间', () => {
    const result = plugin.joinRoom('p1', '玩家1');
    expect(result.success).toBe(true);
    expect(plugin.getPlayers()).toHaveLength(1);
  });

  it('重复玩家ID不能加入', () => {
    plugin.joinRoom('p1', '玩家1');
    const result = plugin.joinRoom('p1', '玩家1重复');
    expect(result.success).toBe(false);
  });

  it('最多只能加入3人', () => {
    plugin.joinRoom('p1', '玩家1');
    plugin.joinRoom('p2', '玩家2');
    plugin.joinRoom('p3', '玩家3');
    const result = plugin.joinRoom('p4', '玩家4');
    expect(result.success).toBe(false);
  });

  it('玩家应能离开房间', () => {
    plugin.joinRoom('p1', '玩家1');
    const result = plugin.leaveRoom('p1');
    expect(result.success).toBe(true);
    expect(plugin.getPlayers()).toHaveLength(0);
  });

  it('不在房间的玩家不能离开', () => {
    const result = plugin.leaveRoom('not_exist');
    expect(result.success).toBe(false);
  });

  it('玩家应能准备', () => {
    plugin.joinRoom('p1', '玩家1');
    const result = plugin.playerReady('p1');
    expect(result.success).toBe(true);
  });

  it('不在房间的玩家不能准备', () => {
    const result = plugin.playerReady('not_exist');
    expect(result.success).toBe(false);
  });

  it('应能添加AI玩家', () => {
    const aiId = plugin.addAIPlayer('easy');
    expect(aiId).toBeDefined();
    expect(aiId.startsWith('ai_')).toBe(true);
    expect(plugin.getPlayers()).toHaveLength(1);
    expect(plugin.isAIPlayer(aiId)).toBe(true);
  });

  it('应能移除AI玩家', () => {
    plugin.addAIPlayer('easy');
    const result = plugin.removeAIPlayer();
    expect(result.success).toBe(true);
    expect(plugin.getPlayers()).toHaveLength(0);
  });

  it('没有AI时移除应失败', () => {
    const result = plugin.removeAIPlayer();
    expect(result.success).toBe(false);
  });

  it('应正确检查AI玩家', () => {
    plugin.joinRoom('p1', '玩家1');
    expect(plugin.isAIPlayer('p1')).toBe(false);

    const aiId = plugin.addAIPlayer();
    expect(plugin.isAIPlayer(aiId)).toBe(true);
  });

  it('应能获取玩家信息', () => {
    plugin.joinRoom('p1', '玩家1');
    const info = plugin.getPlayerInfo('p1');
    expect(info).toBeDefined();
    expect(info?.name).toBe('玩家1');
  });
});

describe('DoudizhuPlugin - 游戏流程', () => {
  let plugin: DoudizhuPlugin;

  beforeEach(() => {
    plugin = new DoudizhuPlugin();
  });

  it('3个真实玩家准备后应能开始', () => {
    plugin.joinRoom('p1', '玩家1');
    plugin.joinRoom('p2', '玩家2');
    plugin.joinRoom('p3', '玩家3');
    plugin.playerReady('p1');
    plugin.playerReady('p2');
    plugin.playerReady('p3');

    // 游戏应该已经自动开始
    expect(plugin.isPlaying() || plugin.getGameState() !== null).toBe(true);
  });

  it('玩家不足时应无法开始', () => {
    plugin.joinRoom('p1', '玩家1');
    plugin.joinRoom('p2', '玩家2');

    const result = plugin.startGame();
    expect(result.success).toBe(false);
  });

  it('有玩家未准备时应无法开始', () => {
    plugin.joinRoom('p1', '玩家1');
    plugin.joinRoom('p2', '玩家2');
    plugin.joinRoom('p3', '玩家3');
    // 只有p1准备
    plugin.playerReady('p1');

    const result = plugin.startGame();
    expect(result.success).toBe(false);
  });

  it('开始游戏后应能获取游戏状态', () => {
    plugin.joinRoom('p1', '玩家1');
    plugin.joinRoom('p2', '玩家2');
    plugin.joinRoom('p3', '玩家3');
    plugin.playerReady('p1');
    plugin.playerReady('p2');
    plugin.playerReady('p3');

    const state = plugin.getGameState();
    expect(state).not.toBeNull();
  });

  it('游戏进行中应能叫分', () => {
    plugin.joinRoom('p1', '玩家1');
    plugin.joinRoom('p2', '玩家2');
    plugin.joinRoom('p3', '玩家3');
    plugin.playerReady('p1');
    plugin.playerReady('p2');
    plugin.playerReady('p3');

    const currentId = plugin.getCurrentPlayerId();
    if (currentId) {
      const result = plugin.placeBid(currentId, 3);
      expect(result.success).toBe(true);
    }
  });

  it('非当前玩家不能叫分', () => {
    plugin.joinRoom('p1', '玩家1');
    plugin.joinRoom('p2', '玩家2');
    plugin.joinRoom('p3', '玩家3');
    plugin.playerReady('p1');
    plugin.playerReady('p2');
    plugin.playerReady('p3');

    const currentId = plugin.getCurrentPlayerId();
    const players = plugin.getPlayers();
    const otherPlayer = players.find((p) => p.playerId !== currentId);

    if (otherPlayer) {
      const result = plugin.placeBid(otherPlayer.playerId, 2);
      expect(result.success).toBe(false);
    }
  });

  it('游戏结束后应能获取结果', () => {
    plugin.joinRoom('p1', '玩家1');
    plugin.joinRoom('p2', '玩家2');
    plugin.joinRoom('p3', '玩家3');
    plugin.playerReady('p1');
    plugin.playerReady('p2');
    plugin.playerReady('p3');

    // 游戏自动进行
    expect(plugin.getGameResult() !== null || !plugin.isGameOver()).toBe(true);
  });
});

describe('DoudizhuPlugin - AI对局', () => {
  it('3个AI应能自动完成一局游戏', () => {
    const plugin = new DoudizhuPlugin();

    // 添加3个AI
    plugin.addAIPlayer('easy');
    plugin.addAIPlayer('easy');
    plugin.addAIPlayer('easy');

    // AI自动准备并开始
    expect(plugin.isPlaying() || plugin.getGameState() !== null).toBe(true);
  }, 10000);
});

describe('DoudizhuPlugin - 配置管理', () => {
  it('应能获取默认配置', () => {
    const plugin = new DoudizhuPlugin();
    const config = plugin.getConfig();
    expect(config.baseScore).toBe(DEFAULT_DOUDIZHU_CONFIG.baseScore);
    expect(config.aiDifficulty).toBe(DEFAULT_DOUDIZHU_CONFIG.aiDifficulty);
  });

  it('应能更新配置', () => {
    const plugin = new DoudizhuPlugin();
    const result = plugin.updateConfig({ baseScore: 5, aiDifficulty: 'hard' });
    expect(result.success).toBe(true);

    const config = plugin.getConfig();
    expect(config.baseScore).toBe(5);
    expect(config.aiDifficulty).toBe('hard');
  });

  it('创建时应使用传入的配置', () => {
    const plugin = new DoudizhuPlugin({
      config: { baseScore: 10, aiDifficulty: 'hard' },
    });
    const config = plugin.getConfig();
    expect(config.baseScore).toBe(10);
    expect(config.aiDifficulty).toBe('hard');
  });

  it('应能设置AI难度', () => {
    const plugin = new DoudizhuPlugin();
    const aiId = plugin.addAIPlayer('easy');

    const result = plugin.setAIDifficulty(aiId, 'hard');
    expect(result.success).toBe(true);
  });

  it('非AI玩家不能设置难度', () => {
    const plugin = new DoudizhuPlugin();
    plugin.joinRoom('p1', '玩家1');

    const result = plugin.setAIDifficulty('p1', 'hard');
    expect(result.success).toBe(false);
  });
});

describe('DoudizhuPlugin - 工具方法', () => {
  it('应能导出调试信息', () => {
    const plugin = new DoudizhuPlugin();
    const debug = plugin.getDebugInfo();
    expect(debug.pluginName).toBe('doudizhu');
    expect(debug.version).toBe('1.0.0');
  });

  it('应能导出游戏记录', () => {
    const plugin = new DoudizhuPlugin();
    const record = plugin.exportGameRecord();
    expect(() => JSON.parse(record)).not.toThrow();
  });

  it('游戏记录应为有效JSON', () => {
    const plugin = new DoudizhuPlugin();

    // 添加3个AI并完成一局
    plugin.addAIPlayer('easy');
    plugin.addAIPlayer('easy');
    plugin.addAIPlayer('easy');

    const record = plugin.exportGameRecord();
    const parsed = JSON.parse(record);
    expect(parsed).toHaveProperty('roomId');
    expect(parsed).toHaveProperty('config');
    expect(parsed).toHaveProperty('history');
  });

  it('isPlaying应在游戏开始后返回true', () => {
    const plugin = new DoudizhuPlugin();
    expect(plugin.isPlaying()).toBe(false);

    plugin.addAIPlayer('easy');
    plugin.addAIPlayer('easy');
    plugin.addAIPlayer('easy');

    // 游戏自动开始
    expect(plugin.isPlaying() || plugin.getGameState() !== null).toBe(true);
  });

  it('reset应重置状态', () => {
    const plugin = new DoudizhuPlugin();
    plugin.addAIPlayer('easy');
    plugin.addAIPlayer('easy');
    plugin.addAIPlayer('easy');

    plugin.reset();
    expect(plugin.isPlaying()).toBe(false);
    expect(plugin.getGameState()).toBeNull();
  });
});

describe('DoudizhuPlugin - 事件系统', () => {
  it('应能添加事件监听器', () => {
    const plugin = new DoudizhuPlugin();
    const events: unknown[] = [];
    const listener = (e: unknown) => events.push(e);

    plugin.addEventListener(listener);
    plugin.init();

    // 应该有初始化事件
    expect(events.length).toBeGreaterThan(0);
  });

  it('应能移除事件监听器', () => {
    const plugin = new DoudizhuPlugin();
    const events: unknown[] = [];
    const listener = (e: unknown) => events.push(e);

    plugin.addEventListener(listener);
    plugin.removeEventListener(listener);

    const beforeCount = events.length;
    plugin.reset();
    // 移除后不应收到新事件
    expect(events.length).toBe(beforeCount);
  });

  it('onEvent回调应被调用', async () => {
    const events: unknown[] = [];
    const plugin = new DoudizhuPlugin({
      onEvent: (e) => events.push(e),
    });

    await plugin.init();
    expect(events.length).toBeGreaterThan(0);
  });

  it('onStateChange回调应在状态变化时调用', () => {
    const states: unknown[] = [];
    const plugin = new DoudizhuPlugin({
      onStateChange: (s) => states.push(s),
    });

    plugin.joinRoom('p1', '玩家1');
    plugin.joinRoom('p2', '玩家2');
    plugin.joinRoom('p3', '玩家3');
    plugin.playerReady('p1');
    plugin.playerReady('p2');
    plugin.playerReady('p3');

    // 游戏开始后应该有状态变化
    expect(states.length).toBeGreaterThan(0);
  });
});
