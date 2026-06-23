export interface AIInstance {
  instanceId: string;
  pluginId: string;
  difficulty: string;
  status: 'idle' | 'thinking' | 'error';
  createdAt: Date;
  lastUsedAt: Date;
  totalRequests: number;
}

export interface AIInstanceStatus {
  instanceId: string;
  pluginId: string;
  difficulty: string;
  status: 'idle' | 'thinking' | 'error';
  createdAt: Date;
  lastUsedAt: Date;
  totalRequests: number;
  currentTask?: {
    playerId: string;
    startTime: Date;
    elapsedMs: number;
  };
}

export interface AIEngineStats {
  totalInstances: number;
  activeInstances: number;
  idleInstances: number;
  errorInstances: number;
  totalRequests: number;
  averageResponseTimeMs: number;
  poolStats: {
    totalProcesses: number;
    idleProcesses: number;
    busyProcesses: number;
    errorProcesses: number;
  };
}

export interface AIProcess {
  processId: string;
  worker: any;
  status: 'idle' | 'busy' | 'error';
  assignedPlugin?: string;
  assignedInstance?: string;
  memoryUsage: number;
  cpuUsage: number;
  createdAt: Date;
  lastUsedAt: Date;
  restartCount: number;
  totalTasks: number;
}

export interface ProcessHealth {
  processId: string;
  status: 'healthy' | 'unhealthy';
  memoryUsageMB: number;
  uptimeSeconds: number;
  restartCount: number;
  lastTaskTime?: Date;
}

export interface WorkerMessage {
  type: 'init' | 'search' | 'stop' | 'heartbeat';
  instanceId?: string;
  pluginId?: string;
  engineType?: 'minimax' | 'mcts' | 'random';
  gameState?: any;
  playerId?: string;
  legalActions?: any[];
  options?: any;
  timeoutMs?: number;
}

export interface WorkerResponse {
  type: 'init_complete' | 'search_result' | 'error' | 'heartbeat';
  instanceId?: string;
  action?: any;
  error?: string;
  memoryUsage?: number;
  timestamp: number;
}

export interface DifficultyConfig {
  engineType: 'minimax' | 'mcts' | 'random';
  maxDepth?: number;
  maxIterations?: number;
  explorationConstant?: number;
  randomize?: boolean;
  parallelSims?: number;
  timeoutMs?: number;
}
