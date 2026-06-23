/**
 * GameEvent - 成就触发事件类型
 * 各种游戏内事件，用于驱动成就系统的检查与解锁
 */
export type GameEvent =
  | { type: 'game_won'; gameType: string; pluginId: string; mode: string }
  | { type: 'game_played'; gameType: string; count: number }
  | { type: 'streak'; count: number }
  | { type: 'special_move'; gameType: string; moveType: string }
  | { type: 'social'; action: string; count: number }
  | { type: 'login'; consecutiveDays: number };
