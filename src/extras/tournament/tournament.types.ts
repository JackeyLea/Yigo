export type TournamentType = 'sng' | 'mtts';
export type TournamentStatus = 'registering' | 'running' | 'paused' | 'finished' | 'cancelled';
export type PlayerStatus = 'registered' | 'seated' | 'active' | 'eliminated' | 'advanced';

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
}

export interface TournamentConfig {
  name: string;
  type: TournamentType;
  buyIn: number;
  entryFee: number;
  startingChips: number;
  blindLevels: BlindLevel[];
  maxPlayers: number;
  payoutStructure: number[];
  lateRegistrationMinutes: number;
}

export interface TournamentPlayer {
  userId: number;
  tableId?: string;
  seatIndex?: number;
  chips: number;
  status: PlayerStatus;
  registeredAt: Date;
  eliminatedAt?: Date;
  rank?: number;
}

export interface Tournament {
  id: string;
  hostId: number;
  config: TournamentConfig;
  status: TournamentStatus;
  players: Map<number, TournamentPlayer>;
  tables: Map<string, TableInfo>;
  currentLevel: number;
  levelStartedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  totalPrizePool: number;
  eliminatedCount: number;
  createdAt: Date;
}

export interface TableInfo {
  tableId: string;
  playerIds: number[];
  maxSeats: number;
}

export interface TournamentStatusDto {
  id: string;
  name: string;
  type: TournamentType;
  status: TournamentStatus;
  currentLevel: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  registeredPlayers: number;
  maxPlayers: number;
  totalPrizePool: number;
  levelDurationSeconds: number;
  levelRemainingSeconds: number;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface PayoutResult {
  rank: number;
  userId: number;
  amount: number;
  percentage: number;
}
