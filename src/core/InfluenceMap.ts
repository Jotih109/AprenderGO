import { GoBoard } from './GoBoard';

export interface InfluenceResult {
  /** Normalised to [-1, 1]: positive is Black, negative is White. */
  matrix: number[][];
  ownership: ('black' | 'white' | 'neutral')[][];
  blackEstimate: number;
  whiteEstimate: number;
  neutralEstimate: number;
}

/** Points closer to the threshold than this are reported as neutral. */
const OWNERSHIP_THRESHOLD = 0.22;

export class InfluenceMap {
  /**
   * Radiates influence outwards from the stones by repeated local averaging,
   * a cheap stand-in for territory estimation during play.
   *
   * Runs on flat typed arrays: the previous version allocated a fresh
   * neighbour array for every intersection on every iteration, which meant
   * about 1,400 short-lived arrays per call on a 19x19 board, and the call
   * happened on every UI refresh.
   */
  public static calculate(board: GoBoard, iterations: number = 5): InfluenceResult {
    const size = board.size;
    const total = size * size;

    let current = new Float64Array(total);
    let next = new Float64Array(total);

    for (let y = 0; y < size; y++) {
      const row = board.grid[y];
      for (let x = 0; x < size; x++) {
        const stone = row[x];
        if (stone === 'black') current[y * size + x] = 64;
        else if (stone === 'white') current[y * size + x] = -64;
      }
    }

    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = y * size + x;
          // Self-retention of 2 keeps stones dominant over their surroundings.
          let sum = current[idx] * 2;
          let neighbours = 0;
          if (y > 0) {
            sum += current[idx - size];
            neighbours++;
          }
          if (y < size - 1) {
            sum += current[idx + size];
            neighbours++;
          }
          if (x > 0) {
            sum += current[idx - 1];
            neighbours++;
          }
          if (x < size - 1) {
            sum += current[idx + 1];
            neighbours++;
          }
          next[idx] = sum / (2 + neighbours);
        }
      }
      const swap = current;
      current = next;
      next = swap;
    }

    let maxAbs = 1;
    for (let i = 0; i < total; i++) {
      const abs = Math.abs(current[i]);
      if (abs > maxAbs) maxAbs = abs;
    }

    const matrix: number[][] = Array.from({ length: size }, () => Array(size).fill(0) as number[]);
    const ownership: ('black' | 'white' | 'neutral')[][] = Array.from({ length: size }, () =>
      Array(size).fill('neutral') as ('black' | 'white' | 'neutral')[]
    );

    let blackEstimate = 0;
    let whiteEstimate = 0;
    let neutralEstimate = 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const norm = current[y * size + x] / maxAbs;
        matrix[y][x] = norm;

        if (norm >= OWNERSHIP_THRESHOLD) {
          ownership[y][x] = 'black';
          blackEstimate++;
        } else if (norm <= -OWNERSHIP_THRESHOLD) {
          ownership[y][x] = 'white';
          whiteEstimate++;
        } else {
          neutralEstimate++;
        }
      }
    }

    return { matrix, ownership, blackEstimate, whiteEstimate, neutralEstimate };
  }
}
