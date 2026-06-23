import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 游戏列表查询参数DTO
 * 支持关键词搜索、分类筛选、视图模式和分页
 */
export class ListGamesQueryDto {
  /** 搜索关键词（匹配游戏名称和plugin_id） */
  @IsOptional()
  @IsString()
  keyword?: string;

  /** 分类过滤：board-桌游 / card-卡牌 / mahjong-麻将 */
  @IsOptional()
  @IsString()
  category?: string;

  /** 视图模式：grid-网格 / list-列表 */
  @IsOptional()
  @IsIn(['grid', 'list'])
  view?: string;

  /** 页码，默认1 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /** 每页数量，默认20，最大100 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
