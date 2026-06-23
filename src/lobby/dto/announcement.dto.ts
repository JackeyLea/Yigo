/**
 * 公告DTO
 * 用于展示大厅公告/轮播信息
 */
export class AnnouncementDto {
  /** 公告ID */
  id: number;

  /** 公告标题 */
  title: string;

  /** 公告内容 */
  content: string;

  /** 图片URL（可选） */
  imageUrl?: string;

  /** 链接URL（可选） */
  linkUrl?: string;

  /** 开始展示时间 */
  startTime: Date;

  /** 结束展示时间 */
  endTime: Date;

  /** 优先级，数值越大优先级越高 */
  priority: number;
}
