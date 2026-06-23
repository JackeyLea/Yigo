import { GameState, Action } from './game-controller.interface';

export interface AIController {
  requestAction(
    playerId: string,
    gameState: GameState,
    legalActions: Action[],
    callback: (action: Action) => void
  ): void;
}
