/**
 * 游戏列表响应DTO
 * 包含游戏基本信息、在线状态和用户相关数据
 */
export class GameResponseDto {
  /** 插件ID */
  pluginId: string;

  /** 游戏名称 */
  name: string;

  /** 游戏分类：board-桌游 / card-卡牌 / mahjong-麻将 */
  category: 'board' | 'card' | 'mahjong';

  /** 游戏描述 */
  description: string;

  /** 图标URL */
  iconUrl: string;

  /** 最小玩家数 */
  minPlayers: number;

  /** 最大玩家数 */
  maxPlayers: number;

  /** 当前在线人数（从Redis读取） */
  onlineCount: number;

  /** 当前房间数 */
  totalRooms: number;

  /** 是否启用 */
  isEnabled: boolean;

  /** 是否收藏（仅登录用户） */
  isFavorite?: boolean;

  /** 最近游玩时间 */
  lastPlayedAt?: Date;
}
