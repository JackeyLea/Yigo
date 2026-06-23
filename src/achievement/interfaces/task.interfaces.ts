/**
 * Task Interfaces - 任务系统相关接口
 */

/** 任务类型 */
export enum TaskType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
}

/** 任务状态 */
export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CLAIMED = 'claimed',
  EXPIRED = 'expired',
}

/** 任务实体 */
export interface Task {
  taskId: string;
  taskCode: string;
  name: string;
  description: string;
  type: TaskType;
  iconUrl: string | null;
  requirementJson: Record<string, any>;
  rewardJson: Record<string, any>;
  createdAt: Date;
}

/** 用户任务进度 */
export interface UserTask {
  id: string;
  userId: string;
  taskId: string;
  task: Task;
  status: TaskStatus;
  progressJson: Record<string, any>;
  completedAt: Date | null;
  claimedAt: Date | null;
  cycleStart: Date;
  cycleEnd: Date;
}

/** 任务进度 */
export interface TaskProgress {
  taskId: string;
  taskCode: string;
  name: string;
  description: string;
  currentProgress: number;
  targetProgress: number;
  percentage: number;
  status: TaskStatus;
  completedAt?: Date;
  claimedAt?: Date;
  expiresAt: Date;
}

/** 任务DTO（返回给前端） */
export interface TaskDto {
  taskId: string;
  taskCode: string;
  name: string;
  description: string;
  type: TaskType;
  iconUrl: string | null;
  requirement: Record<string, any>;
  reward: Record<string, any>;
  createdAt: Date;
}

/** 用户任务DTO */
export interface UserTaskDto {
  id: string;
  userId: string;
  task: TaskDto;
  status: TaskStatus;
  progressJson: Record<string, any>;
  completedAt: Date | null;
  claimedAt: Date | null;
  cycleStart: Date;
  cycleEnd: Date;
}
