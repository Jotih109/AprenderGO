import { GoBoard } from '../core/GoBoard';
import { Color } from '../types/go';
import { BotRequest, BotResponse, processBotRequest } from './GoBotWorker';
// Inlined so the single-file build really is a single file: without this the
// bundler emits the worker as a sibling script that JOGAR.html cannot find.
import GoBotWorkerCtor from './GoBotWorker?worker&inline';

export interface MoveOptions {
  /** Overrides the level default thinking time. */
  timeBudgetMs?: number;
  /** True when the previous move was a pass, letting the engine close a won game. */
  opponentPassed?: boolean;
  /** Fixed seed for reproducible analysis. */
  seed?: number;
}

/**
 * Owns the search worker and keeps the main thread responsive.
 *
 * Requests carry a generation number: anything the UI supersedes (a new game,
 * an undo, a mode switch) is dropped when it comes back, so a slow search can
 * never apply a move to a board that has already moved on.
 */
export class BotManager {
  private worker: Worker | null = null;
  private reqIdCounter = 0;
  private generation = 0;
  private pending = new Map<number, { resolve: (r: BotResponse) => void; reject: (e: Error) => void; generation: number }>();
  private workerFailed = false;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    if (typeof Worker === 'undefined') {
      this.workerFailed = true;
      return;
    }

    try {
      this.worker = new GoBotWorkerCtor();

      this.worker.onmessage = (event: MessageEvent<BotResponse>) => {
        const res = event.data;
        const entry = this.pending.get(res.id);
        if (!entry) return;
        this.pending.delete(res.id);
        entry.resolve(res);
      };

      this.worker.onerror = (err) => {
        console.warn('Bot worker failed, falling back to in-thread search:', err.message || err);
        this.disposeWorker();
        this.workerFailed = true;
        // Nothing can arrive from the worker any more; settle what is waiting.
        for (const [, entry] of this.pending) {
          entry.reject(new Error('Bot worker terminated'));
        }
        this.pending.clear();
      };
    } catch (e) {
      console.warn('Web Worker unavailable, using in-thread search:', e);
      this.worker = null;
      this.workerFailed = true;
    }
  }

  private disposeWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /** True when searches run off the main thread. */
  public get isThreaded(): boolean {
    return this.worker !== null;
  }

  /**
   * Invalidates every in-flight request. Their promises still settle, but with
   * `null`, so callers know the answer is no longer wanted.
   */
  public cancelPending(): void {
    this.generation++;
    // A worker mid-search cannot be interrupted, so recreate it. This is the
    // only way to stop a long search from occupying the worker thread.
    if (this.worker && this.pending.size > 0) {
      this.disposeWorker();
      this.initWorker();
      this.workerFailed = this.worker === null;
    }
    for (const [, entry] of this.pending) {
      entry.reject(new CancelledError());
    }
    this.pending.clear();
  }

  public async getMove(
    board: GoBoard,
    turn: Color,
    level: number,
    komi: number = 6.5,
    options: MoveOptions = {}
  ): Promise<BotResponse | null> {
    const id = ++this.reqIdCounter;
    const generation = this.generation;

    const request: BotRequest = {
      type: 'GET_MOVE',
      id,
      size: board.size,
      // Send a plain copy: the board keeps mutating while the worker thinks.
      grid: board.grid.map(row => [...row]),
      turn,
      level,
      koPoint: board.koPoint ? { ...board.koPoint } : null,
      komi,
      captures: { ...board.captures },
      opponentPassed: options.opponentPassed,
      timeBudgetMs: options.timeBudgetMs,
      seed: options.seed
    };

    if (!this.worker) {
      // In-thread fallback. The timeout hands one frame back to the browser so
      // the "thinking" status actually paints before the search blocks.
      const res = await new Promise<BotResponse>((resolve) => {
        setTimeout(() => resolve(processBotRequest(request)), 16);
      });
      return generation === this.generation ? res : null;
    }

    try {
      const res = await new Promise<BotResponse>((resolve, reject) => {
        this.pending.set(id, { resolve, reject, generation });
        this.worker!.postMessage(request);
      });
      return generation === this.generation ? res : null;
    } catch (err) {
      if (err instanceof CancelledError) return null;
      // The worker died mid-request: retry once in-thread so play continues.
      if (this.workerFailed) return processBotRequest(request);
      throw err;
    }
  }

  /** Full-strength evaluation of a position, used for hints and review. */
  public async analyzePosition(
    board: GoBoard,
    turn: Color,
    komi: number = 6.5,
    options: MoveOptions = {}
  ): Promise<BotResponse | null> {
    return this.getMove(board, turn, 5, komi, options);
  }

  public terminate(): void {
    this.cancelPending();
    this.disposeWorker();
  }
}

/** Thrown internally when a request is superseded; never surfaced to callers. */
class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}
