import { GoBoard } from './GoBoard';
import { Color, Point } from '../types/go';

export class InfluenceMap {
  /**
   * Calculates influence map across the board.
   * Returns a 2D matrix where > 0 is Black influence, < 0 is White influence.
   * Scaled approximately between -1.0 and +1.0.
   */
  public static calculate(board: GoBoard, iterations: number = 5): {
    matrix: number[][];
    ownership: ('black' | 'white' | 'neutral')[][];
    blackEstimate: number;
    whiteEstimate: number;
    neutralEstimate: number;
  } {
    const size = board.size;
    let inf: number[][] = Array.from({ length: size }, () => Array(size).fill(0));

    // Initial source assignment: Living stones exert high influence
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const stone = board.grid[y][x];
        if (stone === 'black') {
          inf[y][x] = 64;
        } else if (stone === 'white') {
          inf[y][x] = -64;
        }
      }
    }

    // Dilate / radiate influence with exponential distance decay & boundary aware
    for (let iter = 0; iter < iterations; iter++) {
      const nextInf: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let sum = inf[y][x] * 2; // self retention
          const adj = board.getAdjacent(x, y);
          for (const nb of adj) {
            sum += inf[nb.y][nb.x];
          }
          nextInf[y][x] = sum / (2 + adj.length);
        }
      }
      inf = nextInf;
    }

    // Normalize to range [-1.0, 1.0]
    let maxAbs = 1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const absVal = Math.abs(inf[y][x]);
        if (absVal > maxAbs) maxAbs = absVal;
      }
    }

    const normalized: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
    const ownership: ('black' | 'white' | 'neutral')[][] = Array.from({ length: size }, () =>
      Array(size).fill('neutral')
    );

    let blackEst = 0;
    let whiteEst = 0;
    let neutralEst = 0;

    const THRESHOLD = 0.22;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const norm = inf[y][x] / maxAbs;
        normalized[y][x] = norm;

        if (norm >= THRESHOLD) {
          ownership[y][x] = 'black';
          blackEst++;
        } else if (norm <= -THRESHOLD) {
          ownership[y][x] = 'white';
          whiteEst++;
        } else {
          ownership[y][x] = 'neutral';
          neutralEst++;
        }
      }
    }

    return {
      matrix: normalized,
      ownership,
      blackEstimate: blackEst,
      whiteEstimate: whiteEst,
      neutralEstimate: neutralEst
    };
  }
}
