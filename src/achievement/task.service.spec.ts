/**
 * TaskService Unit Tests - 任务服务单元测试
 *
 * 测试覆盖：
 * - 每日任务查询（getDailyTasks）
 * - 每周任务查询（getWeeklyTasks）
 * - 任务完成与奖励（completeTask）
 * - 进度查询（getTaskProgress）
 * - 事件驱动任务更新（handleGameEvent）
 * - 任务刷新（refreshTasks）
 * - 任务统计（getTaskStats）
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import { TaskService, UserTaskItem } from './task.service';
import {
  TaskDefinition,
  TaskType,
} from './entities/task-definition.entity';
import {
  UserTaskProgress,
  TaskStatus,
} from './entities/user-task-progress.entity';
import { Wallet } from '../common/entities/wallet.entity';
import { Transaction, TransactionType } from '../common/entities/transaction.entity';
import { User, UserStatus } from '../common/entities/user.entity';

import { GameEvent, TaskProgress, Reward } from './interfaces';

// ---- Mock Data ----

const createMockTaskDefinition = (
  overrides: Partial<TaskDefinition> = {},
): TaskDefinition =>
  ({
    task_id: '1',
    task_code: 'daily_play_1',
    name: '每日对局',
    description: '完成1场任意游戏对局',
    icon_url: null,
    task_type: TaskType.DAILY,
    requirement_json: { eventType: 'game_played', count: 1 },
    reward_json: { type: 'currency', value: 100, currency: 'COIN' },
    sort_order: 1,
    is_enabled: true,
    created_at: new Date(),
    user_task_progresses: [],
    ...overrides,
  }) as TaskDefinition;

const createMockDailyTasks = (): TaskDefinition[] => [
  createMockTaskDefinition({
    task_id: '1',
    task_code: 'daily_play_1',
    name: '每日对局',
    description: '完成1场任意游戏对局',
    requirement_json: { eventType: 'game_played', count: 1 },
    reward_json: { type: 'currency', value: 100, currency: 'COIN' },
    sort_order: 1,
  }),
  createMockTaskDefinition({
    task_id: '2',
    task_code: 'daily_win_1',
    name: '每日首胜',
    description: '赢得1场任意游戏对局',
    requirement_json: { eventType: 'game_won', count: 1 },
    reward_json: { type: 'currency', value: 200, currency: 'COIN' },
    sort_order: 2,
  }),
  createMockTaskDefinition({
    task_id: '3',
    task_code: 'daily_login',
    name: '每日签到',
    description: '登录游戏',
    requirement_json: { eventType: 'login', count: 1 },
    reward_json: { type: 'xp', value: 50 },
    sort_order: 3,
  }),
];

const createMockWeeklyTasks = (): TaskDefinition[] => [
  createMockTaskDefinition({
    task_id: '4',
    task_code: 'weekly_play_10',
    name: '周常对局',
    description: '完成10场任意游戏对局',
    task_type: TaskType.WEEKLY,
    requirement_json: { eventType: 'game_played', count: 10 },
    reward_json: { type: 'currency', value: 1000, currency: 'COIN' },
    sort_order: 1,
  }),
  createMockTaskDefinition({
    task_id: '5',
    task_code: 'weekly_win_5',
    name: '周常胜利',
    description: '赢得5场任意游戏对局',
    task_type: TaskType.WEEKLY,
    requirement_json: { eventType: 'game_won', count: 5 },
    reward_json: { type: 'xp', value: 500 },
    sort_order: 2,
  }),
];

const createMockUserTaskProgress = (
  overrides: Partial<UserTaskProgress> = {},
): UserTaskProgress =>
  ({
    id: '1',
    user_id: '1',
    task_id: '1',
    status: TaskStatus.PENDING,
    progress_json: { gamesPlayed: 0 },
    completed_at: null,
    claimed_at: null,
    cycle_start: new Date(),
    cycle_end: new Date(Date.now() + 86400000),
    task_definition: createMockTaskDefinition(),
    created_at: new Date(),
    ...overrides,
  }) as UserTaskProgress;

// ---- Mock Repository ----

const createMockRepository = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn((entities: any) =>
    Promise.resolve(
      Array.isArray(entities)
        ? entities.map((e: any, i: number) => ({
            ...e,
            id: e.id || String(i + 1),
          }))
        : { ...entities, id: entities.id || '1' },
    ),
  ),
  create: jest.fn((dto: any) => dto),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
    getCount: jest.fn().mockResolvedValue(0),
  })),
  count: jest.fn().mockResolvedValue(0),
});

// ---- Mock QueryRunner ----

const createMockQueryRunner = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  startTransaction: jest.fn().mockResolvedValue(undefined),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  rollbackTransaction: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
  manager: {
    createQueryBuilder: jest.fn(() => ({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    })),
    getRepository: jest.fn(() => createMockRepository()),
    save: jest.fn().mockImplementation((entity: any, data: any) =>
      Promise.resolve({ ...data, id: '1' }),
    ),
    create: jest.fn().mockImplementation((entity: any, data: any) => data),
  },
});

// ---- Mock DataSource ----

const mockDataSource = {
  createQueryRunner: jest.fn().mockReturnValue(createMockQueryRunner()),
};

// ---- Mock ConfigService ----

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'redis') {
      return {
        host: 'localhost',
        port: 6379,
        db: 0,
      };
    }
    return undefined;
  }),
};

// ---- Tests ----

describe('TaskService', () => {
  let service: TaskService;
  let taskDefinitionRepository: Repository<TaskDefinition>;
  let userTaskProgressRepository: Repository<UserTaskProgress>;
  let queryRunner: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        {
          provide: getRepositoryToken(TaskDefinition),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(UserTaskProgress),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(Wallet),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(Transaction),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(User),
          useFactory: createMockRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<TaskService>(TaskService);
    taskDefinitionRepository = module.get<Repository<TaskDefinition>>(
      getRepositoryToken(TaskDefinition),
    );
    userTaskProgressRepository = module.get<Repository<UserTaskProgress>>(
      getRepositoryToken(UserTaskProgress),
    );
    queryRunner = createMockQueryRunner();
    mockDataSource.createQueryRunner.mockReturnValue(queryRunner);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // 1. getDailyTasks 测试
  // ============================================================

  describe('getDailyTasks', () => {
    it('should return daily tasks with progress', async () => {
      const mockDailyTasks = createMockDailyTasks();

      jest
        .spyOn(taskDefinitionRepository, 'find')
        .mockResolvedValue(mockDailyTasks);

      // Mock no existing user tasks
      jest
        .spyOn(userTaskProgressRepository, 'find')
        .mockResolvedValue([]);

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve(
            Array.isArray(data)
              ? data.map((d: any, i: number) => ({ ...d, id: String(i + 1) }))
              : { ...data, id: '1' },
          ),
        );

      const result = await service.getDailyTasks(1);

      expect(result).toHaveLength(3);
      expect(result[0].task.taskCode).toBe('daily_play_1');
      expect(result[1].task.taskCode).toBe('daily_win_1');
      expect(result[2].task.taskCode).toBe('daily_login');
      expect(result[0].status).toBe(TaskStatus.PENDING);
      expect(saveSpy).toHaveBeenCalled();
    });

    it('should return existing daily tasks without recreating', async () => {
      const mockDailyTasks = createMockDailyTasks();

      jest
        .spyOn(taskDefinitionRepository, 'find')
        .mockResolvedValue(mockDailyTasks);

      const futureDate = new Date(Date.now() + 86400000); // Tomorrow
      const existingUserTasks = [
        createMockUserTaskProgress({
          id: '1',
          task_id: '1',
          status: TaskStatus.IN_PROGRESS,
          progress_json: { gamesPlayed: 0 },
          cycle_end: futureDate,
        }),
        createMockUserTaskProgress({
          id: '2',
          task_id: '2',
          status: TaskStatus.PENDING,
          progress_json: {},
          cycle_end: futureDate,
          task_definition: createMockTaskDefinition({
            task_id: '2',
            task_code: 'daily_win_1',
            name: '每日首胜',
            requirement_json: { eventType: 'game_won', count: 1 },
          }),
        }),
        createMockUserTaskProgress({
          id: '3',
          task_id: '3',
          status: TaskStatus.PENDING,
          progress_json: {},
          cycle_end: futureDate,
          task_definition: createMockTaskDefinition({
            task_id: '3',
            task_code: 'daily_login',
            name: '每日签到',
            requirement_json: { eventType: 'login', count: 1 },
          }),
        }),
      ];

      jest
        .spyOn(userTaskProgressRepository, 'find')
        .mockResolvedValue(existingUserTasks);

      const saveSpy = jest.spyOn(userTaskProgressRepository, 'save');

      const result = await service.getDailyTasks(1);

      expect(result).toHaveLength(3);
      // Should not create new records since they exist and are not expired
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('should use default tasks when database is empty', async () => {
      jest
        .spyOn(taskDefinitionRepository, 'find')
        .mockResolvedValue([]);

      jest
        .spyOn(userTaskProgressRepository, 'find')
        .mockResolvedValue([]);

      const saveSpy = jest
        .spyOn(taskDefinitionRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve(
            Array.isArray(data)
              ? data.map((d: any, i: number) => ({
                  ...d,
                  task_id: String(i + 1),
                }))
              : { ...data, task_id: '1' },
          ),
        );

      jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve(
            Array.isArray(data)
              ? data.map((d: any, i: number) => ({ ...d, id: String(i + 1) }))
              : { ...data, id: '1' },
          ),
        );

      const result = await service.getDailyTasks(1);

      expect(result.length).toBeGreaterThan(0);
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  // ============================================================
  // 2. getWeeklyTasks 测试
  // ============================================================

  describe('getWeeklyTasks', () => {
    it('should return weekly tasks with progress', async () => {
      const mockWeeklyTasks = createMockWeeklyTasks();

      jest
        .spyOn(taskDefinitionRepository, 'find')
        .mockResolvedValue(mockWeeklyTasks);

      jest
        .spyOn(userTaskProgressRepository, 'find')
        .mockResolvedValue([]);

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve(
            Array.isArray(data)
              ? data.map((d: any, i: number) => ({ ...d, id: String(i + 1) }))
              : { ...data, id: '1' },
          ),
        );

      const result = await service.getWeeklyTasks(1);

      expect(result).toHaveLength(2);
      expect(result[0].task.taskCode).toBe('weekly_play_10');
      expect(result[1].task.taskCode).toBe('weekly_win_5');
      expect(result[0].task.type).toBe(TaskType.WEEKLY);
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  // ============================================================
  // 3. completeTask 测试
  // ============================================================

  describe('completeTask', () => {
    it('should complete task and grant reward', async () => {
      const mockUserTask = createMockUserTaskProgress({
        status: TaskStatus.COMPLETED,
        completed_at: new Date(),
        progress_json: { gamesPlayed: 1 },
      });

      jest
        .spyOn(userTaskProgressRepository, 'findOne')
        .mockResolvedValue(mockUserTask);

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) => Promise.resolve(data));

      // Mock wallet for currency reward
      queryRunner.manager.createQueryBuilder.mockImplementation(() => ({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          user_id: '1',
          currency: 'COIN',
          balance: '1000',
          frozen: '0',
          total_deposited: '1000',
          total_withdrawn: '0',
        }),
      }));

      const result = await service.completeTask(1, 1);

      expect(result.rewardType).toBe('currency');
      expect(result.rewardValue).toBe(100);
      expect(result.currency).toBe('COIN');
      expect(saveSpy).toHaveBeenCalled();
    });

    it('should complete pending task and auto-check completion', async () => {
      const mockUserTask = createMockUserTaskProgress({
        status: TaskStatus.IN_PROGRESS,
        progress_json: { gamesPlayed: 1 },
        completed_at: null,
      });

      jest
        .spyOn(userTaskProgressRepository, 'findOne')
        .mockResolvedValue(mockUserTask);

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) => Promise.resolve(data));

      // Mock wallet
      queryRunner.manager.createQueryBuilder.mockImplementation(() => ({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          user_id: '1',
          currency: 'COIN',
          balance: '1000',
          frozen: '0',
          total_deposited: '1000',
          total_withdrawn: '0',
        }),
      }));

      const result = await service.completeTask(1, 1);

      expect(result).toBeDefined();
      expect(saveSpy).toHaveBeenCalledTimes(2); // Once for status update, once for claim
    });

    it('should throw NotFoundException when task progress not found', async () => {
      jest
        .spyOn(userTaskProgressRepository, 'findOne')
        .mockResolvedValue(null);

      await expect(service.completeTask(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when task already claimed', async () => {
      const mockUserTask = createMockUserTaskProgress({
        status: TaskStatus.CLAIMED,
        claimed_at: new Date(),
      });

      jest
        .spyOn(userTaskProgressRepository, 'findOne')
        .mockResolvedValue(mockUserTask);

      await expect(service.completeTask(1, 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when task not completed', async () => {
      const mockUserTask = createMockUserTaskProgress({
        status: TaskStatus.PENDING,
        progress_json: { gamesPlayed: 0 },
      });

      jest
        .spyOn(userTaskProgressRepository, 'findOne')
        .mockResolvedValue(mockUserTask);

      await expect(service.completeTask(1, 1)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================================
  // 4. getTaskProgress 测试
  // ============================================================

  describe('getTaskProgress', () => {
    it('should return task progress for new user', async () => {
      const mockTask = createMockTaskDefinition();

      jest
        .spyOn(taskDefinitionRepository, 'findOne')
        .mockResolvedValue(mockTask);

      jest
        .spyOn(userTaskProgressRepository, 'findOne')
        .mockResolvedValue(null);

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve({ ...data, id: '1' }),
        );

      const result = await service.getTaskProgress(1, 1);

      expect(result.taskCode).toBe('daily_play_1');
      expect(result.currentProgress).toBe(0);
      expect(result.targetProgress).toBe(1);
      expect(result.percentage).toBe(0);
      expect(result.status).toBe(TaskStatus.PENDING);
      expect(saveSpy).toHaveBeenCalled();
    });

    it('should return correct progress for in-progress task', async () => {
      const mockTask = createMockTaskDefinition();

      jest
        .spyOn(taskDefinitionRepository, 'findOne')
        .mockResolvedValue(mockTask);

      const userTask = createMockUserTaskProgress({
        progress_json: { gamesPlayed: 0 },
        status: TaskStatus.PENDING,
      });

      jest
        .spyOn(userTaskProgressRepository, 'findOne')
        .mockResolvedValue(userTask);

      const result = await service.getTaskProgress(1, 1);

      expect(result.currentProgress).toBe(0);
      expect(result.targetProgress).toBe(1);
      expect(result.percentage).toBe(0);
    });

    it('should return 100% for completed task', async () => {
      const mockTask = createMockTaskDefinition();

      jest
        .spyOn(taskDefinitionRepository, 'findOne')
        .mockResolvedValue(mockTask);

      const userTask = createMockUserTaskProgress({
        progress_json: { gamesPlayed: 1 },
        status: TaskStatus.COMPLETED,
        completed_at: new Date(),
      });

      jest
        .spyOn(userTaskProgressRepository, 'findOne')
        .mockResolvedValue(userTask);

      const result = await service.getTaskProgress(1, 1);

      expect(result.currentProgress).toBe(1);
      expect(result.targetProgress).toBe(1);
      expect(result.percentage).toBe(100);
      expect(result.status).toBe(TaskStatus.COMPLETED);
    });

    it('should throw NotFoundException when task not found', async () => {
      jest
        .spyOn(taskDefinitionRepository, 'findOne')
        .mockResolvedValue(null);

      await expect(service.getTaskProgress(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================================================
  // 5. handleGameEvent 测试
  // ============================================================

  describe('handleGameEvent', () => {
    it('should update task progress on game_played event', async () => {
      const mockTask = createMockTaskDefinition();
      const mockUserTask = createMockUserTaskProgress({
        status: TaskStatus.PENDING,
        progress_json: { gamesPlayed: 0 },
        task_definition: mockTask,
      });

      jest
        .spyOn(userTaskProgressRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockUserTask]),
            }) as any,
        );

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) => Promise.resolve(data));

      const event: GameEvent = {
        type: 'game_played',
        gameType: 'chess',
        count: 1,
      };

      const result = await service.handleGameEvent(1, event);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(TaskStatus.COMPLETED);
      expect(saveSpy).toHaveBeenCalled();
    });

    it('should update progress but not complete when count is insufficient', async () => {
      const mockTask = createMockTaskDefinition({
        requirement_json: { eventType: 'game_played', count: 3 },
      });
      const mockUserTask = createMockUserTaskProgress({
        status: TaskStatus.PENDING,
        progress_json: { gamesPlayed: 0 },
        task_definition: mockTask,
      });

      jest
        .spyOn(userTaskProgressRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockUserTask]),
            }) as any,
        );

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) => Promise.resolve(data));

      const event: GameEvent = {
        type: 'game_played',
        gameType: 'chess',
        count: 1,
      };

      const result = await service.handleGameEvent(1, event);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(TaskStatus.IN_PROGRESS);
      expect(saveSpy).toHaveBeenCalled();
    });

    it('should not update completed or claimed tasks', async () => {
      const mockTask = createMockTaskDefinition();
      const mockUserTask = createMockUserTaskProgress({
        status: TaskStatus.CLAIMED,
        progress_json: { gamesPlayed: 1 },
        task_definition: mockTask,
      });

      jest
        .spyOn(userTaskProgressRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockUserTask]),
            }) as any,
        );

      const saveSpy = jest.spyOn(userTaskProgressRepository, 'save');

      const event: GameEvent = {
        type: 'game_played',
        gameType: 'chess',
        count: 1,
      };

      const result = await service.handleGameEvent(1, event);

      expect(result).toHaveLength(0);
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('should return empty array when no active tasks match event', async () => {
      jest
        .spyOn(userTaskProgressRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            }) as any,
        );

      const event: GameEvent = {
        type: 'game_won',
        gameType: 'chess',
        pluginId: 'chess_plugin',
        mode: 'ranked',
      };

      const result = await service.handleGameEvent(1, event);

      expect(result).toHaveLength(0);
    });

    it('should handle streak event', async () => {
      const mockTask = createMockTaskDefinition({
        task_id: '5',
        task_code: 'weekly_streak_3',
        name: '连胜达人',
        task_type: TaskType.WEEKLY,
        requirement_json: { eventType: 'streak', count: 3 },
      });
      const mockUserTask = createMockUserTaskProgress({
        task_id: '5',
        status: TaskStatus.PENDING,
        progress_json: { maxStreak: 0 },
        task_definition: mockTask,
      });

      jest
        .spyOn(userTaskProgressRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockUserTask]),
            }) as any,
        );

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) => Promise.resolve(data));

      const event: GameEvent = { type: 'streak', count: 3 };

      const result = await service.handleGameEvent(1, event);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(TaskStatus.COMPLETED);
    });

    it('should handle login event', async () => {
      const mockTask = createMockTaskDefinition({
        task_id: '3',
        task_code: 'daily_login',
        name: '每日签到',
        requirement_json: { eventType: 'login', count: 1 },
      });
      const mockUserTask = createMockUserTaskProgress({
        task_id: '3',
        status: TaskStatus.PENDING,
        progress_json: { loginCount: 0 },
        task_definition: mockTask,
      });

      jest
        .spyOn(userTaskProgressRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockUserTask]),
            }) as any,
        );

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) => Promise.resolve(data));

      const event: GameEvent = { type: 'login', consecutiveDays: 1 };

      const result = await service.handleGameEvent(1, event);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(TaskStatus.COMPLETED);
    });

    it('should handle social event with matching action', async () => {
      const mockTask = createMockTaskDefinition({
        task_id: '4',
        task_code: 'daily_social',
        name: '每日社交',
        requirement_json: { eventType: 'social', action: 'add_friend', count: 1 },
      });
      const mockUserTask = createMockUserTaskProgress({
        task_id: '4',
        status: TaskStatus.PENDING,
        progress_json: { socialActions: 0 },
        task_definition: mockTask,
      });

      jest
        .spyOn(userTaskProgressRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockUserTask]),
            }) as any,
        );

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) => Promise.resolve(data));

      const event: GameEvent = {
        type: 'social',
        action: 'add_friend',
        count: 1,
      };

      const result = await service.handleGameEvent(1, event);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(TaskStatus.COMPLETED);
    });

    it('should ignore social event with non-matching action', async () => {
      const mockTask = createMockTaskDefinition({
        task_id: '4',
        task_code: 'daily_social',
        name: '每日社交',
        requirement_json: { eventType: 'social', action: 'add_friend', count: 1 },
      });
      const mockUserTask = createMockUserTaskProgress({
        task_id: '4',
        status: TaskStatus.PENDING,
        progress_json: { socialActions: 0 },
        task_definition: mockTask,
      });

      jest
        .spyOn(userTaskProgressRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockUserTask]),
            }) as any,
        );

      const saveSpy = jest.spyOn(userTaskProgressRepository, 'save');

      const event: GameEvent = {
        type: 'social',
        action: 'send_message',
        count: 1,
      };

      const result = await service.handleGameEvent(1, event);

      // The action doesn't match 'add_friend', so progress shouldn't update
      expect(result).toHaveLength(0);
    });
  });

  // ============================================================
  // 6. refreshTasks 测试
  // ============================================================

  describe('refreshTasks', () => {
    it('should refresh expired daily tasks', async () => {
      const pastDate = new Date(Date.now() - 86400000); // Yesterday
      const mockTask = createMockTaskDefinition();
      const expiredUserTask = createMockUserTaskProgress({
        status: TaskStatus.CLAIMED,
        progress_json: { gamesPlayed: 1 },
        completed_at: pastDate,
        claimed_at: pastDate,
        cycle_start: pastDate,
        cycle_end: pastDate, // Expired
        task_definition: mockTask,
      });

      jest
        .spyOn(userTaskProgressRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([expiredUserTask]),
            }) as any,
        );

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) => Promise.resolve(data));

      await service.refreshTasks(1, TaskType.DAILY);

      expect(saveSpy).toHaveBeenCalled();
      const savedData = Array.isArray(saveSpy.mock.calls[0][0])
        ? saveSpy.mock.calls[0][0][0]
        : saveSpy.mock.calls[0][0];
      expect(savedData.status).toBe(TaskStatus.PENDING);
      expect(savedData.completed_at).toBeNull();
      expect(savedData.claimed_at).toBeNull();
    });

    it('should refresh all expired tasks when type not specified', async () => {
      const pastDate = new Date(Date.now() - 86400000);
      const mockDailyTask = createMockTaskDefinition();
      const mockWeeklyTask = createMockTaskDefinition({
        task_id: '4',
        task_code: 'weekly_play_10',
        name: '周常对局',
        task_type: TaskType.WEEKLY,
      });

      const expiredDaily = createMockUserTaskProgress({
        task_id: '1',
        status: TaskStatus.CLAIMED,
        cycle_end: pastDate,
        task_definition: mockDailyTask,
      });
      const expiredWeekly = createMockUserTaskProgress({
        task_id: '4',
        status: TaskStatus.CLAIMED,
        cycle_end: pastDate,
        task_definition: mockWeeklyTask,
      });

      jest
        .spyOn(userTaskProgressRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([expiredDaily, expiredWeekly]),
            }) as any,
        );

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) => Promise.resolve(data));

      await service.refreshTasks(1);

      expect(saveSpy).toHaveBeenCalled();
      const savedArray = saveSpy.mock.calls[0][0];
      expect(Array.isArray(savedArray)).toBe(true);
      expect(savedArray).toHaveLength(2);
    });
  });

  // ============================================================
  // 7. getTaskStats 测试
  // ============================================================

  describe('getTaskStats', () => {
    it('should return correct task statistics', async () => {
      const now = new Date();
      const future = new Date(Date.now() + 86400000);

      const mockUserTasks = [
        createMockUserTaskProgress({
          task_id: '1',
          status: TaskStatus.COMPLETED,
          task_definition: createMockTaskDefinition({ task_type: TaskType.DAILY }),
          cycle_end: future,
        }),
        createMockUserTaskProgress({
          task_id: '2',
          status: TaskStatus.CLAIMED,
          task_definition: createMockTaskDefinition({
            task_id: '2',
            task_code: 'daily_win_1',
            task_type: TaskType.DAILY,
          }),
          cycle_end: future,
        }),
        createMockUserTaskProgress({
          task_id: '3',
          status: TaskStatus.PENDING,
          task_definition: createMockTaskDefinition({
            task_id: '3',
            task_code: 'daily_login',
            task_type: TaskType.DAILY,
          }),
          cycle_end: future,
        }),
        createMockUserTaskProgress({
          task_id: '4',
          status: TaskStatus.COMPLETED,
          task_definition: createMockTaskDefinition({
            task_id: '4',
            task_code: 'weekly_play_10',
            task_type: TaskType.WEEKLY,
          }),
          cycle_end: future,
        }),
        createMockUserTaskProgress({
          task_id: '5',
          status: TaskStatus.PENDING,
          task_definition: createMockTaskDefinition({
            task_id: '5',
            task_code: 'weekly_win_5',
            task_type: TaskType.WEEKLY,
          }),
          cycle_end: future,
        }),
      ];

      jest
        .spyOn(userTaskProgressRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue(mockUserTasks),
            }) as any,
        );

      const result = await service.getTaskStats(1);

      expect(result.dailyTotal).toBe(3);
      expect(result.dailyCompleted).toBe(2); // COMPLETED + CLAIMED
      expect(result.dailyClaimed).toBe(1);
      expect(result.weeklyTotal).toBe(2);
      expect(result.weeklyCompleted).toBe(1);
      expect(result.weeklyClaimed).toBe(0);
    });

    it('should return zero stats when no tasks', async () => {
      jest
        .spyOn(userTaskProgressRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            }) as any,
        );

      const result = await service.getTaskStats(1);

      expect(result.dailyTotal).toBe(0);
      expect(result.dailyCompleted).toBe(0);
      expect(result.dailyClaimed).toBe(0);
      expect(result.weeklyTotal).toBe(0);
      expect(result.weeklyCompleted).toBe(0);
      expect(result.weeklyClaimed).toBe(0);
    });
  });

  // ============================================================
  // 8. Task cycle dates 测试
  // ============================================================

  describe('task cycle management', () => {
    it('should reset expired tasks when fetching', async () => {
      const pastDate = new Date(Date.now() - 86400000); // Yesterday
      const mockDailyTasks = createMockDailyTasks();

      jest
        .spyOn(taskDefinitionRepository, 'find')
        .mockResolvedValue(mockDailyTasks);

      // Existing tasks with expired cycle
      const expiredUserTasks = [
        createMockUserTaskProgress({
          task_id: '1',
          status: TaskStatus.CLAIMED,
          progress_json: { gamesPlayed: 1 },
          completed_at: pastDate,
          claimed_at: pastDate,
          cycle_start: pastDate,
          cycle_end: pastDate,
          task_definition: mockDailyTasks[0],
        }),
        createMockUserTaskProgress({
          task_id: '2',
          status: TaskStatus.COMPLETED,
          progress_json: {},
          completed_at: pastDate,
          cycle_start: pastDate,
          cycle_end: pastDate,
          task_definition: mockDailyTasks[1],
        }),
        createMockUserTaskProgress({
          task_id: '3',
          status: TaskStatus.PENDING,
          progress_json: {},
          cycle_start: pastDate,
          cycle_end: pastDate,
          task_definition: mockDailyTasks[2],
        }),
      ];

      jest
        .spyOn(userTaskProgressRepository, 'find')
        .mockResolvedValue(expiredUserTasks);

      const saveSpy = jest
        .spyOn(userTaskProgressRepository, 'save')
        .mockImplementation((data: any) => Promise.resolve(data));

      const result = await service.getDailyTasks(1);

      expect(result).toHaveLength(3);
      // All tasks should be reset to PENDING with fresh progress
      expect(saveSpy).toHaveBeenCalled();
      const savedArray = saveSpy.mock.calls[0][0];
      expect(Array.isArray(savedArray)).toBe(true);
      for (const task of savedArray) {
        expect(task.status).toBe(TaskStatus.PENDING);
        expect(task.completed_at).toBeNull();
        expect(task.claimed_at).toBeNull();
      }
    });

    it('should not reset tasks that are still in cycle', async () => {
      const mockDailyTasks = createMockDailyTasks();
      const futureDate = new Date(Date.now() + 86400000);

      jest
        .spyOn(taskDefinitionRepository, 'find')
        .mockResolvedValue(mockDailyTasks);

      const activeUserTasks = [
        createMockUserTaskProgress({
          task_id: '1',
          status: TaskStatus.IN_PROGRESS,
          progress_json: { gamesPlayed: 0 },
          cycle_end: futureDate,
          task_definition: mockDailyTasks[0],
        }),
      ];

      jest
        .spyOn(userTaskProgressRepository, 'find')
        .mockResolvedValue(activeUserTasks);

      const saveSpy = jest.spyOn(userTaskProgressRepository, 'save');

      const result = await service.getDailyTasks(1);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(TaskStatus.IN_PROGRESS);
      // Should not save since cycle is still active
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });
});
