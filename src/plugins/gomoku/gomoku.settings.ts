/**
 * 五子棋插件配置 Schema
 *
 * 定义游戏设置项的数据结构，用于前端表单渲染和配置校验。
 */

export const gomokuSettingsSchema = {
  /** 棋盘大小：标准15路或19路 */
  boardSize: {
    type: 'select' as const,
    options: [15, 19],
    default: 15,
    label: '棋盘大小',
    description: '15路为标准棋盘，19路为扩展棋盘',
  },

  /** 是否启用禁手规则（仅对黑方生效） */
  useForbidden: {
    type: 'switch' as const,
    default: true,
    label: '启用禁手',
    description: '黑方禁手：三三禁手、四四禁手、长连禁手',
  },

  /** AI思考时间限制（秒） */
  thinkTime: {
    type: 'number' as const,
    min: 1,
    max: 60,
    default: 10,
    label: '思考时间(秒)',
    description: 'AI每步的最大思考时间',
  },

  /** AI难度级别 */
  aiDifficulty: {
    type: 'select' as const,
    options: ['easy', 'medium', 'hard'],
    default: 'medium',
    label: 'AI难度',
    description: '简单：搜索深度2；中等：深度4；困难：深度6+开局库',
  },
};

/** 从 schema 推导出的设置类型 */
export interface GomokuSettings {
  boardSize: 15 | 19;
  useForbidden: boolean;
  thinkTime: number;
  aiDifficulty: 'easy' | 'medium' | 'hard';
}

/** 默认设置值 */
export const defaultGomokuSettings: GomokuSettings = {
  boardSize: 15,
  useForbidden: true,
  thinkTime: 10,
  aiDifficulty: 'medium',
};
