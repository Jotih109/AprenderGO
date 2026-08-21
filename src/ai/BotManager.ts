import { GoBoard } from '../core/GoBoard';
import { Color, Point } from '../types/go';
import { BotRequest, BotResponse, processBotRequest } from './GoBotWorker';

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
        console.warn('Bot Worker Error, falling back to in-thread calculation:', err);
        this.worker = null;
      };
    } catch (e) {
      console.warn('Web Worker not initialized, will use direct in-thread calculation:', e);
      this.worker = null;
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
      // Robust direct execution with microtask yielding
      return new Promise<BotResponse>((resolve) => {
        setTimeout(() => {
          const res = processBotRequest(request);
          resolve(res);
        }, 16);
      });
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

