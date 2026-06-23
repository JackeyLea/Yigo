export interface GameController {
  start(): void;
  getCurrentState(): GameState;
  getActivePlayer(): string;
  submitAction(playerId: string, action: Action): void;
  getLegalActions(playerId: string): Action[];
  endGame(): void;
}

export interface GameState {
  status: string;
  players: PlayerState[];
  board?: any;
  currentPlayer?: string;
  round?: number;
  winner?: string;
  metadata?: Record<string, any>;
}

export interface Action {
  type: string;
  playerId: string;
  data: Record<string, any>;
  timestamp: number;
}

export interface PlayerState {
  playerId: string;
  seatIndex: number;
  status: string;
  score?: number;
  metadata?: Record<string, any>;
}
