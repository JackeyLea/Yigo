import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  Tournament,
  TournamentConfig,
  TournamentPlayer,
  TournamentStatus,
  PlayerStatus,
  TournamentType,
  TableInfo,
  TournamentStatusDto,
  BlindLevel,
  PayoutResult,
} from './tournament.types';

/** MTT standard blind levels */
export const DEFAULT_MTT_BLINDS: BlindLevel[] = [
  { level: 1, smallBlind: 25, bigBlind: 50, ante: 0, durationMinutes: 10 },
  { level: 2, smallBlind: 50, bigBlind: 100, ante: 0, durationMinutes: 10 },
  { level: 3, smallBlind: 75, bigBlind: 150, ante: 0, durationMinutes: 10 },
  { level: 4, smallBlind: 100, bigBlind: 200, ante: 0, durationMinutes: 10 },
  { level: 5, smallBlind: 150, bigBlind: 300, ante: 25, durationMinutes: 10 },
  { level: 6, smallBlind: 200, bigBlind: 400, ante: 50, durationMinutes: 10 },
  { level: 7, smallBlind: 300, bigBlind: 600, ante: 75, durationMinutes: 10 },
  { level: 8, smallBlind: 400, bigBlind: 800, ante: 100, durationMinutes: 10 },
  { level: 9, smallBlind: 500, bigBlind: 1000, ante: 100, durationMinutes: 10 },
  { level: 10, smallBlind: 600, bigBlind: 1200, ante: 200, durationMinutes: 10 },
  { level: 11, smallBlind: 800, bigBlind: 1600, ante: 200, durationMinutes: 10 },
  { level: 12, smallBlind: 1000, bigBlind: 2000, ante: 300, durationMinutes: 10 },
  { level: 13, smallBlind: 1500, bigBlind: 3000, ante: 400, durationMinutes: 10 },
  { level: 14, smallBlind: 2000, bigBlind: 4000, ante: 500, durationMinutes: 10 },
  { level: 15, smallBlind: 3000, bigBlind: 6000, ante: 1000, durationMinutes: 10 },
  { level: 16, smallBlind: 4000, bigBlind: 8000, ante: 1000, durationMinutes: 10 },
  { level: 17, smallBlind: 5000, bigBlind: 10000, ante: 2000, durationMinutes: 10 },
  { level: 18, smallBlind: 6000, bigBlind: 12000, ante: 2000, durationMinutes: 10 },
];

/** Default payout structures by player count category */
export const DEFAULT_PAYOUTS: Record<string, number[]> = {
  headsUp: [100],                 // 2 players
  sng6: [50, 30, 20],            // 6 players
  sng9: [40, 25, 15, 10, 6, 4],  // 9 players
  mtt: [25, 16, 11, 8, 6, 5, 4, 3, 2, 1.5, 1.2, 1, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
};

@Injectable()
export class TournamentService {
  private readonly tournaments = new Map<string, Tournament>();
  private readonly playerTournaments = new Map<number, Set<string>>();

  // ─── Helpers ───────────────────────────────────────────────────────

  private generateId(): string {
    return `tour_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private generateTableId(): string {
    return `tbl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  private resolvePayoutStructure(config: TournamentConfig): number[] {
    if (config.payoutStructure && config.payoutStructure.length > 0) {
      return config.payoutStructure;
    }
    if (config.type === 'sng') {
      if (config.maxPlayers <= 2) return DEFAULT_PAYOUTS.headsUp;
      if (config.maxPlayers <= 6) return DEFAULT_PAYOUTS.sng6;
      return DEFAULT_PAYOUTS.sng9;
    }
    return DEFAULT_PAYOUTS.mtt;
  }

  private assignTables(tournament: Tournament): void {
    const activePlayers = Array.from(tournament.players.values())
      .filter((p) => p.status === 'active' || p.status === 'registered');

    const maxSeatsPerTable = 9;
    const tablesNeeded = Math.ceil(activePlayers.length / maxSeatsPerTable);

    tournament.tables.clear();

    for (let t = 0; t < tablesNeeded; t++) {
      const tableId = this.generateTableId();
      const startIdx = t * maxSeatsPerTable;
      const endIdx = Math.min(startIdx + maxSeatsPerTable, activePlayers.length);
      const tablePlayers = activePlayers.slice(startIdx, endIdx);

      const tableInfo: TableInfo = {
        tableId,
        playerIds: tablePlayers.map((p) => p.userId),
        maxSeats: maxSeatsPerTable,
      };

      tournament.tables.set(tableId, tableInfo);

      tablePlayers.forEach((p, idx) => {
        p.tableId = tableId;
        p.seatIndex = idx;
        p.status = 'seated';
      });
    }
  }

  private getBlindForLevel(tournament: Tournament, level: number): BlindLevel {
    const levels = tournament.config.blindLevels;
    if (level <= 0) return levels[0];
    if (level > levels.length) {
      // After scheduled levels, continue increasing by doubling every 2 levels
      const lastLevel = levels[levels.length - 1];
      const extra = level - levels.length;
      const multiplier = Math.pow(2, Math.ceil(extra / 2));
      return {
        level,
        smallBlind: lastLevel.smallBlind * multiplier,
        bigBlind: lastLevel.bigBlind * multiplier,
        ante: lastLevel.ante * multiplier,
        durationMinutes: lastLevel.durationMinutes,
      };
    }
    return levels[level - 1];
  }

  // ─── Tournament Lifecycle ───────────────────────────────────────────

  /**
   * Create a new tournament.
   */
  async createTournament(hostId: number, config: TournamentConfig): Promise<Tournament> {
    const id = this.generateId();

    const blindLevels = config.blindLevels?.length
      ? config.blindLevels
      : DEFAULT_MTT_BLINDS;

    const resolvedPayout = this.resolvePayoutStructure({
      ...config,
      blindLevels,
    });

    const tournament: Tournament = {
      id,
      hostId,
      config: {
        ...config,
        blindLevels,
        payoutStructure: resolvedPayout,
      },
      status: 'registering',
      players: new Map(),
      tables: new Map(),
      currentLevel: 0,
      levelStartedAt: null,
      startedAt: null,
      finishedAt: null,
      totalPrizePool: 0,
      eliminatedCount: 0,
      createdAt: new Date(),
    };

    this.tournaments.set(id, tournament);
    return tournament;
  }

  /**
   * Register a player for a tournament.
   */
  async registerPlayer(tournamentId: string, userId: number, buyIn: number): Promise<void> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    if (tournament.status !== 'registering') {
      throw new BadRequestException('Tournament is not open for registration');
    }

    if (tournament.players.has(userId)) {
      throw new BadRequestException('Player already registered');
    }

    if (tournament.players.size >= tournament.config.maxPlayers) {
      throw new BadRequestException('Tournament is full');
    }

    if (buyIn < tournament.config.buyIn) {
      throw new BadRequestException(`Buy-in must be at least ${tournament.config.buyIn}`);
    }

    const player: TournamentPlayer = {
      userId,
      chips: tournament.config.startingChips,
      status: 'registered',
      registeredAt: new Date(),
    };

    tournament.players.set(userId, player);
    tournament.totalPrizePool += tournament.config.buyIn;

    // Track player -> tournaments mapping
    if (!this.playerTournaments.has(userId)) {
      this.playerTournaments.set(userId, new Set());
    }
    this.playerTournaments.get(userId)!.add(tournamentId);

    // Auto-start SNG when full
    if (tournament.config.type === 'sng' && tournament.players.size >= tournament.config.maxPlayers) {
      await this.startTournament(tournamentId);
    }
  }

  /**
   * Unregister a player before tournament starts.
   */
  async unregisterPlayer(tournamentId: string, userId: number): Promise<void> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    if (tournament.status !== 'registering') {
      throw new BadRequestException('Cannot unregister after tournament has started');
    }

    const player = tournament.players.get(userId);
    if (!player) throw new NotFoundException('Player not registered in this tournament');

    tournament.players.delete(userId);
    tournament.totalPrizePool -= tournament.config.buyIn;

    const playerSet = this.playerTournaments.get(userId);
    if (playerSet) {
      playerSet.delete(tournamentId);
    }
  }

  /**
   * Start the tournament.
   */
  async startTournament(tournamentId: string): Promise<void> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    if (tournament.status !== 'registering') {
      throw new BadRequestException('Tournament has already started');
    }

    if (tournament.players.size < 2) {
      throw new BadRequestException('Need at least 2 players to start');
    }

    // Activate all registered players
    for (const player of tournament.players.values()) {
      player.status = 'active';
    }

    // Assign tables
    this.assignTables(tournament);

    tournament.status = 'running';
    tournament.currentLevel = 1;
    tournament.levelStartedAt = new Date();
    tournament.startedAt = new Date();
  }

  /**
   * Get tournament status DTO.
   */
  async getTournamentStatus(tournamentId: string): Promise<TournamentStatusDto> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const blind = this.getBlindForLevel(tournament, tournament.currentLevel);

    let levelRemainingSeconds = 0;
    if (tournament.status === 'running' && tournament.levelStartedAt) {
      const elapsed = (Date.now() - tournament.levelStartedAt.getTime()) / 1000;
      levelRemainingSeconds = Math.max(0, blind.durationMinutes * 60 - elapsed);
    }

    return {
      id: tournament.id,
      name: tournament.config.name,
      type: tournament.config.type,
      status: tournament.status,
      currentLevel: tournament.currentLevel,
      smallBlind: blind.smallBlind,
      bigBlind: blind.bigBlind,
      ante: blind.ante,
      registeredPlayers: tournament.players.size,
      maxPlayers: tournament.config.maxPlayers,
      totalPrizePool: tournament.totalPrizePool,
      levelDurationSeconds: blind.durationMinutes * 60,
      levelRemainingSeconds: Math.round(levelRemainingSeconds),
      startedAt: tournament.startedAt,
      finishedAt: tournament.finishedAt,
    };
  }

  /**
   * Advance a player to another table (table balancing).
   */
  async advancePlayer(tournamentId: string, userId: number, tableId: string): Promise<void> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const player = tournament.players.get(userId);
    if (!player) throw new NotFoundException('Player not found');

    if (player.status === 'eliminated') {
      throw new BadRequestException('Eliminated players cannot be moved');
    }

    const targetTable = tournament.tables.get(tableId);
    if (!targetTable) throw new NotFoundException('Target table not found');

    // Remove from current table
    if (player.tableId) {
      const currentTable = tournament.tables.get(player.tableId);
      if (currentTable) {
        currentTable.playerIds = currentTable.playerIds.filter((id) => id !== userId);
      }
    }

    // Add to new table
    targetTable.playerIds.push(userId);
    player.tableId = tableId;
    player.seatIndex = targetTable.playerIds.length - 1;
    player.status = 'advanced';
  }

  /**
   * Eliminate a player from the tournament.
   */
  async eliminatePlayer(tournamentId: string, userId: number): Promise<void> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const player = tournament.players.get(userId);
    if (!player) throw new NotFoundException('Player not found');

    if (player.status === 'eliminated') {
      throw new BadRequestException('Player already eliminated');
    }

    player.status = 'eliminated';
    player.eliminatedAt = new Date();
    tournament.eliminatedCount += 1;

    // Assign rank (reverse elimination order)
    const totalPlayers = tournament.players.size;
    player.rank = totalPlayers - tournament.eliminatedCount + 1;

    // Remove from table
    if (player.tableId) {
      const table = tournament.tables.get(player.tableId);
      if (table) {
        table.playerIds = table.playerIds.filter((id) => id !== userId);
      }
    }

    // Check if tournament should end
    const remainingActive = Array.from(tournament.players.values()).filter(
      (p) => p.status !== 'eliminated',
    );

    if (remainingActive.length <= 1) {
      // Tournament finished
      tournament.status = 'finished';
      tournament.finishedAt = new Date();

      // Assign rank 1 to the winner
      if (remainingActive.length === 1) {
        const winner = remainingActive[0];
        winner.rank = 1;
      }
    } else if (remainingActive.length <= tournament.tables.size * 3) {
      // Trigger table balancing when tables are getting sparse
      this.balanceTables(tournament);
    }
  }

  /**
   * Balance tables in MTT when players are unevenly distributed.
   */
  private balanceTables(tournament: Tournament): void {
    const activePlayers = Array.from(tournament.players.values()).filter(
      (p) => p.status !== 'eliminated',
    );

    const maxSeatsPerTable = 9;
    const idealTableCount = Math.ceil(activePlayers.length / maxSeatsPerTable);

    // If we have more tables than needed, consolidate
    if (tournament.tables.size > idealTableCount) {
      this.assignTables(tournament);
    }
  }

  /**
   * Calculate payout for a given rank using the payout structure.
   */
  async getPayout(tournamentId: string, rank: number): Promise<number> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const prizePool = tournament.totalPrizePool;
    const payouts = tournament.config.payoutStructure;

    if (rank < 1 || rank > payouts.length) {
      return 0;
    }

    const percentage = payouts[rank - 1];
    return Math.floor((prizePool * percentage) / 100);
  }

  /**
   * Calculate all payouts (ICM model).
   */
  async calculateAllPayouts(tournamentId: string): Promise<PayoutResult[]> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const results: PayoutResult[] = [];
    const payouts = tournament.config.payoutStructure;

    for (const [userId, player] of tournament.players) {
      if (player.rank && player.rank <= payouts.length) {
        const percentage = payouts[player.rank - 1];
        const amount = Math.floor((tournament.totalPrizePool * percentage) / 100);
        results.push({
          rank: player.rank,
          userId,
          amount,
          percentage,
        });
      }
    }

    return results.sort((a, b) => a.rank - b.rank);
  }

  /**
   * Advance blind level (called by timer).
   */
  async advanceBlindLevel(tournamentId: string): Promise<void> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament || tournament.status !== 'running') return;

    tournament.currentLevel += 1;
    tournament.levelStartedAt = new Date();
  }

  /**
   * Pause tournament.
   */
  async pauseTournament(tournamentId: string): Promise<void> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    if (tournament.status !== 'running') throw new BadRequestException('Tournament is not running');
    tournament.status = 'paused';
  }

  /**
   * Resume tournament.
   */
  async resumeTournament(tournamentId: string): Promise<void> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    if (tournament.status !== 'paused') throw new BadRequestException('Tournament is not paused');
    tournament.status = 'running';
    tournament.levelStartedAt = new Date();
  }

  /**
   * Cancel tournament and refund players.
   */
  async cancelTournament(tournamentId: string): Promise<void> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    if (tournament.status === 'finished') throw new BadRequestException('Tournament already finished');

    tournament.status = 'cancelled';
    tournament.finishedAt = new Date();

    // In a real implementation, refund logic would go here
  }

  // ─── Queries ────────────────────────────────────────────────────────

  /**
   * Get tournament by ID.
   */
  async getTournament(tournamentId: string): Promise<Tournament> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    return tournament;
  }

  /**
   * List all tournaments with optional status filter.
   */
  async listTournaments(status?: TournamentStatus): Promise<Tournament[]> {
    const all = Array.from(this.tournaments.values());
    if (!status) return all;
    return all.filter((t) => t.status === status);
  }

  /**
   * Get tournaments for a specific player.
   */
  async getPlayerTournaments(userId: number): Promise<Tournament[]> {
    const tournamentIds = this.playerTournaments.get(userId);
    if (!tournamentIds) return [];
    return Array.from(tournamentIds)
      .map((id) => this.tournaments.get(id))
      .filter((t): t is Tournament => !!t);
  }

  /**
   * Get leaderboard (ranked players).
   */
  async getLeaderboard(tournamentId: string): Promise<TournamentPlayer[]> {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    return Array.from(tournament.players.values())
      .filter((p) => p.rank !== undefined)
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  }
}
