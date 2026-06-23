/**
 * 五子棋开局库（Opening Book）
 *
 * 提供前10步的预定义最优走法，包含经典开局及其应对。
 * 开局库覆盖天元开局、星位开局等常见开局流派。
 */

import type { Position } from './gomoku.types';

/** 开局条目：定义某一步的推荐走法及可选变招 */
export interface OpeningEntry {
  /** 推荐的主走法 */
  move: Position;
  /** 可选变招列表（用于增加多样性） */
  alternatives?: Position[];
  /** 开局名称说明 */
  name: string;
}

/**
 * 开局库数据结构：
 * 键 = 走子序列的字符串表示（每步用 "x,y" 格式，多步用 ";" 分隔）
 * 值 = 当前局面下的推荐走法
 *
 * 序列始终以黑方视角构建（奇数步为黑，偶数步为白）。
 */
export const OPENING_BOOK: Record<string, OpeningEntry> = {
  // ========== 第1手（黑方开局） ==========
  // 空盘 — 天元开局（最正统）
  '': {
    move: { x: 7, y: 7 },
    alternatives: [
      { x: 7, y: 7 }, // 天元（重复确保概率最高）
    ],
    name: '天元开局',
  },

  // ========== 第2手（白方应对天元） ==========
  // 黑: 天元(7,7) — 白方直止/斜止应对
  '7,7': {
    move: { x: 7, y: 8 },
    alternatives: [
      { x: 7, y: 8 }, // 直止（正对天元下方）
      { x: 8, y: 8 }, // 斜止
    ],
    name: '直止应对',
  },

  // ========== 第3手（黑方第2手） ==========
  // 黑: 天元 → 白: 直止(7,8) — 黑方花月开局
  '7,7;7,8': {
    move: { x: 6, y: 7 },
    alternatives: [
      { x: 6, y: 7 }, // 花月（邻天元）
      { x: 8, y: 7 }, // 右侧邻天元
    ],
    name: '花月开局',
  },

  // 黑: 天元 → 白: 斜止(8,8) — 黑方丘月/斜止应对
  '7,7;8,8': {
    move: { x: 7, y: 8 },
    alternatives: [
      { x: 7, y: 8 },
      { x: 6, y: 6 },
    ],
    name: '丘月开局',
  },

  // ========== 第4手（白方第2手） ==========
  // 花月: 黑(7,7) → 白(7,8) → 黑(6,7) — 白方挡下方
  '7,7;7,8;6,7': {
    move: { x: 7, y: 6 },
    alternatives: [
      { x: 7, y: 6 },
      { x: 8, y: 7 },
    ],
    name: '白方防守',
  },

  // ========== 第5手（黑方第3手） ==========
  // 黑(7,7) → 白(7,8) → 黑(6,7) → 白(7,6) — 黑方形成活二
  '7,7;7,8;6,7;7,6': {
    move: { x: 5, y: 7 },
    alternatives: [
      { x: 5, y: 7 },
      { x: 8, y: 6 },
    ],
    name: '黑方展开',
  },

  // ========== 其他经典开局序列 ==========

  // 浦月开局序列
  '7,7;7,8;8,7': {
    move: { x: 7, y: 6 },
    alternatives: [
      { x: 7, y: 6 },
      { x: 6, y: 8 },
    ],
    name: '浦月开局',
  },

  // 流星开局序列
  '7,7;6,6': {
    move: { x: 8, y: 8 },
    alternatives: [
      { x: 8, y: 8 },
      { x: 7, y: 8 },
    ],
    name: '流星开局',
  },

  // 游星开局序列
  '7,7;6,8': {
    move: { x: 8, y: 6 },
    alternatives: [
      { x: 8, y: 6 },
      { x: 7, y: 8 },
    ],
    name: '游星开局',
  },

  // 寒星开局
  '7,7;6,7': {
    move: { x: 8, y: 8 },
    alternatives: [
      { x: 8, y: 8 },
      { x: 7, y: 8 },
    ],
    name: '寒星开局',
  },

  // 花月扩展
  '7,7;7,8;6,7;8,7': {
    move: { x: 7, y: 6 },
    alternatives: [{ x: 7, y: 6 }],
    name: '花月展开',
  },

  // 雨月开局
  '7,7;7,6': {
    move: { x: 8, y: 7 },
    alternatives: [
      { x: 8, y: 7 },
      { x: 6, y: 7 },
    ],
    name: '雨月开局',
  },

  // 金星开局
  '7,7;8,7': {
    move: { x: 7, y: 8 },
    alternatives: [
      { x: 7, y: 8 },
      { x: 6, y: 7 },
    ],
    name: '金星开局',
  },

  // 松月开局
  '7,7;8,6': {
    move: { x: 7, y: 8 },
    alternatives: [
      { x: 7, y: 8 },
      { x: 6, y: 7 },
    ],
    name: '松月开局',
  },
};

/**
 * 根据走子历史查询开局库推荐走法。
 *
 * @param moveHistory - 已走步的坐标列表（仅含 x,y）
 * @returns 推荐的走法及开局名称，若无匹配则返回 null
 */
export function queryOpeningBook(moveHistory: Array<{ x: number; y: number }>): {
  move: Position;
  name: string;
} | null {
  const key = moveHistory.map((m) => `${m.x},${m.y}`).join(';');
  const entry = OPENING_BOOK[key];

  if (!entry) {
    return null;
  }

  // 如果有变招，随机选择一个（含主走法）
  if (entry.alternatives && entry.alternatives.length > 0) {
    const candidates = [entry.move, ...entry.alternatives];
    const randomIndex = Math.floor(Math.random() * candidates.length);
    return {
      move: { ...candidates[randomIndex] },
      name: entry.name,
    };
  }

  return {
    move: { ...entry.move },
    name: entry.name,
  };
}

/**
 * 判断当前是否仍处于开局阶段（前10步内）。
 */
export function isInOpeningPhase(moveCount: number): boolean {
  return moveCount < 10;
}

/**
 * 开局库覆盖统计（调试用）。
 */
export function getOpeningBookStats(): {
  totalOpenings: number;
  maxDepth: number;
} {
  let maxDepth = 0;
  for (const key of Object.keys(OPENING_BOOK)) {
    const depth = key === '' ? 0 : key.split(';').length;
    if (depth > maxDepth) maxDepth = depth;
  }
  return {
    totalOpenings: Object.keys(OPENING_BOOK).length,
    maxDepth,
  };
}
