import { FastBoard, processBotRequest, BotRequest } from '../src/ai/GoBotWorker';
import { StoneState } from '../src/types/go';
import { check, equal, suite } from './harness';

const EMPTY = 0;

interface RefGroup {
  stones: Set<number>;
  liberties: Set<number>;
}

/** Flood-fill ground truth, used to keep the union-find index honest. */
function refGroup(board: FastBoard, start: number): RefGroup | null {
  const color = board.grid[start];
  if (color === EMPTY) return null;

  const stones = new Set<number>([start]);
  const liberties = new Set<number>();
  const stack = [start];

  while (stack.length > 0) {
    const cur = stack.pop()!;
    const base = cur * 4;
    for (let i = 0; i < board.topo.adjN[cur]; i++) {
      const n = board.topo.adj[base + i];
      const v = board.grid[n];
      if (v === EMPTY) liberties.add(n);
      else if (v === color && !stones.has(n)) {
        stones.add(n);
        stack.push(n);
      }
    }
  }
  return { stones, liberties };
}

function refLegal(board: FastBoard, idx: number, color: number): boolean {
  if (board.grid[idx] !== EMPTY) return false;
  if (board.koIdx === idx) return false;

  board.grid[idx] = color as -1 | 0 | 1;
  let captures = false;
  const base = idx * 4;
  for (let i = 0; i < board.topo.adjN[idx]; i++) {
    const n = board.topo.adj[base + i];
    if (board.grid[n] === -color) {
      const g = refGroup(board, n);
      if (g && g.liberties.size === 0) {
        captures = true;
        break;
      }
    }
  }
  const own = refGroup(board, idx);
  const alive = own !== null && own.liberties.size > 0;
  board.grid[idx] = EMPTY;
  return alive || captures;
}

function emptyGrid(size: number): StoneState[][] {
  return Array.from({ length: size }, () => Array(size).fill(null) as StoneState[]);
}

export function runEngineTests(): void {
  suite('group index agrees with flood fill across random games', () => {
    let checks = 0;
    let errors = 0;

    for (const size of [9, 13]) {
      for (let game = 0; game < 4; game++) {
        const b = new FastBoard(size);
        let seed = game * 7919 + size;
        const rnd = () => {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          return seed / 0x7fffffff;
        };

        let passes = 0;
        for (let move = 0; move < size * size * 2 && passes < 2; move++) {
          const color = b.turnColor;

          for (let idx = 0; idx < b.total; idx++) {
            checks++;
            if (b.grid[idx] !== EMPTY) {
              const g = refGroup(b, idx)!;
              if (b.groupStones(idx) !== g.stones.size) errors++;
              const inAtari = g.liberties.size === 1;
              if (b.isGroupInAtari(idx) !== inAtari) errors++;
              if (inAtari && b.groupAtariLiberty(idx) !== [...g.liberties][0]) errors++;
            } else if (b.isLegal(idx, color) !== refLegal(b, idx, color)) {
              errors++;
            }
          }

          const legal: number[] = [];
          for (let idx = 0; idx < b.total; idx++) {
            if (b.isLegal(idx, color) && !b.isTrueEye(idx, color)) legal.push(idx);
          }
          if (legal.length === 0) {
            b.pass(color);
            passes++;
            continue;
          }
          passes = 0;
          b.playLegal(legal[Math.floor(rnd() * legal.length)], color);
        }
      }
    }

    check(`${checks} board assertions all agree`, errors === 0, `${errors} mismatches`);
  });

  suite('captures and ko on the fast board', () => {
    const b = new FastBoard(9);
    b.playLegal(1, 1); // black at (1,0)
    equal('black to white', b.turnColor, -1);
    b.playLegal(0, -1); // white at (0,0)
    b.playLegal(9, 1); // black at (0,1) captures white corner
    equal('white corner captured', b.grid[0], EMPTY);
    equal('capture counted', b.capturesBlack, 1);
  });

  suite('area scoring on an empty board is just komi', () => {
    const b = new FastBoard(9);
    equal('black trails by komi', b.areaScore(6.5), -6.5);
  });

  suite('area scoring counts surrounded space', () => {
    const b = new FastBoard(9);
    // Black wall down the middle: columns 0-3 become black area.
    for (let y = 0; y < 9; y++) b.playLegal(y * 9 + 4, 1);
    const score = b.areaScore(0);
    check('black leads with the whole left side', score > 0, `score=${score}`);
  });

  suite('the engine returns a legal move in reasonable time', () => {
    for (const size of [9, 13, 19] as const) {
      const req: BotRequest = {
        type: 'GET_MOVE',
        id: 1,
        size,
        grid: emptyGrid(size),
        turn: 'black',
        level: 3,
        koPoint: null,
        komi: 6.5,
        captures: { black: 0, white: 0 },
        timeBudgetMs: 300,
        seed: 12345
      };
      const t0 = Date.now();
      const res = processBotRequest(req);
      const dt = Date.now() - t0;

      check(`${size}x${size} returns a move`, res.bestMove !== null);
      if (res.bestMove) {
        check(
          `${size}x${size} move is on the board`,
          res.bestMove.x >= 0 && res.bestMove.x < size && res.bestMove.y >= 0 && res.bestMove.y < size,
          JSON.stringify(res.bestMove)
        );
      }
      // The budget plus generous slack for opening-book and startup work.
      check(`${size}x${size} respects the time budget`, dt < 2500, `${dt}ms`);
    }
  });

  suite('the same seed and position give the same move', () => {
    const make = (): BotRequest => ({
      type: 'GET_MOVE',
      id: 7,
      size: 9,
      grid: emptyGrid(9),
      turn: 'black',
      level: 2,
      koPoint: null,
      komi: 6.5,
      captures: { black: 0, white: 0 },
      timeBudgetMs: 200,
      seed: 99
    });
    // Put a stone down so the opening book does not short-circuit the search.
    const a = make();
    a.grid[4][4] = 'white';
    const b = make();
    b.grid[4][4] = 'white';

    const ra = processBotRequest(a);
    const rb = processBotRequest(b);
    check(
      'deterministic under a fixed seed',
      ra.bestMove?.x === rb.bestMove?.x && ra.bestMove?.y === rb.bestMove?.y,
      `${JSON.stringify(ra.bestMove)} vs ${JSON.stringify(rb.bestMove)}`
    );
  });

  suite('the engine never fills its own eye', () => {
    // Black lives with two eyes; white has nothing left but to pass.
    const grid = emptyGrid(9);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) grid[y][x] = 'black';
    }
    grid[0][0] = null;
    grid[0][2] = null;
    grid[8][8] = null;

    const res = processBotRequest({
      type: 'GET_MOVE',
      id: 2,
      size: 9,
      grid,
      turn: 'black',
      level: 2,
      koPoint: null,
      komi: 6.5,
      captures: { black: 0, white: 0 },
      timeBudgetMs: 200,
      seed: 5
    });
    check('black passes rather than filling an eye', res.bestMove === null, JSON.stringify(res.bestMove));
  });

  suite('search actually runs enough playouts to be meaningful', () => {
    const grid = emptyGrid(9);
    grid[4][4] = 'black';
    const res = processBotRequest({
      type: 'GET_MOVE',
      id: 3,
      size: 9,
      grid,
      turn: 'white',
      level: 5,
      koPoint: null,
      komi: 6.5,
      captures: { black: 0, white: 0 },
      timeBudgetMs: 600,
      seed: 1
    });
    // The old engine managed roughly five playouts per move on any board.
    check('thousands of playouts in 600ms on 9x9', res.playouts > 1000, `${res.playouts} playouts`);
  });
}
