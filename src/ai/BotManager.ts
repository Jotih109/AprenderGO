import { GoBoard } from '../core/GoBoard';
import { Color, Point } from '../types/go';
import { BotRequest, BotResponse } from './GoBotWorker';

export class BotManager {
  private worker: Worker | null = null;
  private reqIdCounter = 0;
  private pendingRequests: Map<number, (res: BotResponse) => void> = new Map();

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(new URL('./GoBotWorker.ts', import.meta.url), {
        type: 'module'
      });

      this.worker.onmessage = (event: MessageEvent<BotResponse>) => {
        const res = event.data;
        const resolver = this.pendingRequests.get(res.id);
        if (resolver) {
          resolver(res);
          this.pendingRequests.delete(res.id);
        }
      };

      this.worker.onerror = (err) => {
        console.error('Bot Worker Error:', err);
      };
    } catch (e) {
      console.warn('Web Worker not supported or failed to initialize, will use fallback:', e);
    }
  }

  public async getMove(
    board: GoBoard,
    turn: Color,
    level: number,
    komi: number = 6.5
  ): Promise<BotResponse> {
    const id = ++this.reqIdCounter;

    const request: BotRequest = {
      type: 'GET_MOVE',
      id,
      size: board.size,
      grid: board.grid,
      turn,
      level,
      koPoint: board.koPoint,
      komi,
      captures: board.captures
    };

    if (!this.worker) {
      // Fallback: simple legal move pick
      const legal = board.getLegalMoves(turn);
      const move = legal.length > 0 ? legal[Math.floor(Math.random() * legal.length)] : null;
      return {
        id,
        bestMove: move,
        winRate: 0.5,
        scoreLead: 0,
        thoughtTimeMs: 10
      };
    }

    return new Promise<BotResponse>((resolve) => {
      this.pendingRequests.set(id, resolve);
      this.worker!.postMessage(request);
    });
  }

  public async analyzePosition(
    board: GoBoard,
    turn: Color,
    komi: number = 6.5
  ): Promise<BotResponse> {
    return this.getMove(board, turn, 5, komi);
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
