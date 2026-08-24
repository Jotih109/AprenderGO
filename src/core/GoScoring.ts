import { GoBoard } from './GoBoard';
import { Color, Point, RuleSet, TerritoryScore } from '../types/go';

interface Region {
  points: Point[];
  borderColors: Set<Color>;
}

export class GoScoring {
  /**
   * Groups that are alive no matter what, by Benson's algorithm.
   *
   * A chain is unconditionally alive when it is vital to at least two enclosed
   * regions, where "vital" means every empty point of the region is one of the
   * chain's liberties. Chains that fail the test are removed and the check is
   * repeated until the set stops shrinking. These groups can never be marked
   * dead, which is what stops the detector from throwing away live territory.
   */
  public static bensonPassAlive(board: GoBoard, color: Color): Set<string> {
    const size = board.size;
    const chains = board.getAllGroups().filter(g => g.color === color);
    if (chains.length === 0) return new Set();

    // Regions: connected components of points that are not this colour.
    const regionOf = new Int32Array(size * size).fill(-1);
    const regions: { points: number[]; emptyPoints: number[]; enclosed: boolean; neighbourChains: Set<number> }[] = [];

    for (let i = 0; i < size * size; i++) {
      const x = i % size;
      const y = (i - x) / size;
      if (board.grid[y][x] === color || regionOf[i] !== -1) continue;

      const id = regions.length;
      const points: number[] = [];
      const emptyPoints: number[] = [];
      let enclosed = true;
      const stack = [i];
      regionOf[i] = id;

      while (stack.length > 0) {
        const cur = stack.pop()!;
        const cx = cur % size;
        const cy = (cur - cx) / size;
        points.push(cur);
        if (board.grid[cy][cx] === null) emptyPoints.push(cur);

        for (const n of board.getAdjacent(cx, cy)) {
          const nIdx = n.y * size + n.x;
          if (board.grid[n.y][n.x] === color) continue; // region boundary
          if (regionOf[nIdx] === -1) {
            regionOf[nIdx] = id;
            stack.push(nIdx);
          }
        }
      }

      // The flood fill stopped exactly at stones of `color`, so every point on
      // the rim is already one of them: the region is enclosed by construction.
      // Board edges count as walls rather than openings.
      enclosed = points.length > 0;

      regions.push({ points, emptyPoints, enclosed, neighbourChains: new Set() });
    }

    // Map every stone to its chain index and connect chains to regions.
    const chainOf = new Int32Array(size * size).fill(-1);
    chains.forEach((chain, idx) => {
      for (const pt of chain.points) chainOf[pt.y * size + pt.x] = idx;
    });

    const chainRegions: Set<number>[] = chains.map(() => new Set<number>());
    const vitalRegions: Set<number>[] = chains.map(() => new Set<number>());

    for (let r = 0; r < regions.length; r++) {
      const region = regions[r];
      for (const p of region.points) {
        const px = p % size;
        const py = (p - px) / size;
        for (const n of board.getAdjacent(px, py)) {
          const c = chainOf[n.y * size + n.x];
          if (c >= 0) {
            region.neighbourChains.add(c);
            chainRegions[c].add(r);
          }
        }
      }
    }

    // A region is vital to a chain when all its empty points are liberties.
    for (let c = 0; c < chains.length; c++) {
      const libs = chains[c].liberties;
      for (const r of chainRegions[c]) {
        const region = regions[r];
        if (region.emptyPoints.length === 0) continue;
        let allLiberties = true;
        for (const p of region.emptyPoints) {
          const px = p % size;
          const py = (p - px) / size;
          if (!libs.has(`${px},${py}`)) {
            allLiberties = false;
            break;
          }
        }
        if (allLiberties) vitalRegions[c].add(r);
      }
    }

    // Iterate to the greatest fixed point.
    const aliveChains = new Set<number>(chains.map((_, i) => i));
    const aliveRegions = new Set<number>(regions.map((_, i) => i).filter(i => regions[i].enclosed));

    let changed = true;
    while (changed) {
      changed = false;

      for (const c of [...aliveChains]) {
        let vitalCount = 0;
        for (const r of vitalRegions[c]) if (aliveRegions.has(r)) vitalCount++;
        if (vitalCount < 2) {
          aliveChains.delete(c);
          changed = true;
        }
      }

      for (const r of [...aliveRegions]) {
        for (const c of regions[r].neighbourChains) {
          if (!aliveChains.has(c)) {
            aliveRegions.delete(r);
            changed = true;
            break;
          }
        }
      }
    }

    const result = new Set<string>();
    for (const c of aliveChains) {
      for (const pt of chains[c].points) result.add(`${pt.x},${pt.y}`);
    }
    return result;
  }

  /**
   * Marks stones that are dead at the end of the game.
   *
   * The area a group lives in is flooded through empty points and friendly
   * stones, stopping at enemy stones. A group is dead when that area is small
   * enough to be genuinely sealed off, holds nothing unconditionally alive, and
   * cannot produce two eyes.
   *
   * The size guard is what keeps the rule honest: without it, a wall whose
   * "zone" is the entire rest of the board looks eyeless and gets condemned.
   * The detector deliberately errs towards leaving stones alive, because the
   * scoring UI lets the player click any group to correct it.
   */
  public static autoDetectDeadStones(board: GoBoard): Set<string> {
    const size = board.size;
    const total = size * size;
    const dead = new Set<string>();

    // A zone larger than this is open board, not an enclosed pocket.
    const maxEnclosedZone = Math.max(10, Math.floor(total * 0.3));
    // An empty region this large has room to be split into two eyes.
    const twoEyeSpace = 6;

    const passAlive = {
      black: this.bensonPassAlive(board, 'black'),
      white: this.bensonPassAlive(board, 'white')
    };

    const visited = new Uint8Array(size * size);

    for (let y0 = 0; y0 < size; y0++) {
      for (let x0 = 0; x0 < size; x0++) {
        const color = board.grid[y0][x0];
        const startIdx = y0 * size + x0;
        if (!color || visited[startIdx]) continue;

        // Flood the zone: friendly stones and empty points, blocked by enemies.
        const opponent: Color = color === 'black' ? 'white' : 'black';
        const zoneStones: Point[] = [];
        const zoneEmpty: Point[] = [];
        const inZone = new Uint8Array(size * size);
        const stack = [startIdx];
        inZone[startIdx] = 1;
        let touchesOpponent = false;

        while (stack.length > 0) {
          const cur = stack.pop()!;
          const cx = cur % size;
          const cy = (cur - cx) / size;
          const cell = board.grid[cy][cx];

          if (cell === color) {
            zoneStones.push({ x: cx, y: cy });
            visited[cur] = 1;
          } else {
            zoneEmpty.push({ x: cx, y: cy });
          }

          for (const n of board.getAdjacent(cx, cy)) {
            const nIdx = n.y * size + n.x;
            const nCell = board.grid[n.y][n.x];
            if (nCell === opponent) {
              touchesOpponent = true;
              continue;
            }
            if (!inZone[nIdx]) {
              inZone[nIdx] = 1;
              stack.push(nIdx);
            }
          }
        }

        // An open zone (never walled in by the opponent) is not dead.
        if (!touchesOpponent) continue;

        // A zone this big is open board rather than a sealed pocket.
        if (zoneStones.length + zoneEmpty.length > maxEnclosedZone) continue;

        // Anything unconditionally alive keeps the whole zone alive.
        const alive = passAlive[color];
        if (zoneStones.some(pt => alive.has(`${pt.x},${pt.y}`))) continue;

        // Count eye-shaped regions: connected empty areas inside the zone that
        // touch only friendly stones.
        const eyeVisited = new Uint8Array(size * size);
        let eyes = 0;

        for (const pt of zoneEmpty) {
          const idx = pt.y * size + pt.x;
          if (eyeVisited[idx]) continue;

          const regionStack = [idx];
          eyeVisited[idx] = 1;
          let isEye = true;
          let regionSize = 0;

          while (regionStack.length > 0) {
            const cur = regionStack.pop()!;
            const cx = cur % size;
            const cy = (cur - cx) / size;
            regionSize++;

            for (const n of board.getAdjacent(cx, cy)) {
              const nIdx = n.y * size + n.x;
              const nCell = board.grid[n.y][n.x];
              if (nCell === opponent) {
                isEye = false;
                continue;
              }
              if (nCell === null && !eyeVisited[nIdx]) {
                eyeVisited[nIdx] = 1;
                regionStack.push(nIdx);
              }
            }
          }

          // A roomy eye region can almost always be divided into two eyes, so
          // it counts double rather than being treated as a single point.
          if (isEye) eyes += regionSize >= twoEyeSpace ? 2 : 1;
          if (eyes >= 2) break;
        }

        if (eyes >= 2) continue;

        for (const pt of zoneStones) dead.add(`${pt.x},${pt.y}`);
      }
    }

    return dead;
  }

  /** Connected empty regions with the colours that border them. */
  private static emptyRegions(board: GoBoard, deadStones: Set<string>): Region[] {
    const size = board.size;
    const visited = new Uint8Array(size * size);
    const regions: Region[] = [];

    const isOpen = (x: number, y: number): boolean =>
      board.grid[y][x] === null || deadStones.has(`${x},${y}`);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        if (visited[idx] || !isOpen(x, y)) continue;

        const points: Point[] = [];
        const borderColors = new Set<Color>();
        const stack = [idx];
        visited[idx] = 1;

        while (stack.length > 0) {
          const cur = stack.pop()!;
          const cx = cur % size;
          const cy = (cur - cx) / size;
          points.push({ x: cx, y: cy });

          for (const n of board.getAdjacent(cx, cy)) {
            const nIdx = n.y * size + n.x;
            if (isOpen(n.x, n.y)) {
              if (!visited[nIdx]) {
                visited[nIdx] = 1;
                stack.push(nIdx);
              }
            } else {
              const stone = board.grid[n.y][n.x];
              if (stone) borderColors.add(stone);
            }
          }
        }

        regions.push({ points, borderColors });
      }
    }

    return regions;
  }

  /** Final score for the board plus the supplied dead-stone markings. */
  public static calculateScore(
    board: GoBoard,
    deadStones: Set<string> = new Set<string>(),
    ruleSet: RuleSet = 'japanese',
    komi: number = 6.5
  ): TerritoryScore {
    const size = board.size;
    const territoryMap: ('black' | 'white' | 'dame' | null)[][] = Array.from({ length: size }, () =>
      Array(size).fill(null)
    );

    let blackTerritory = 0;
    let whiteTerritory = 0;
    let blackStonesOnBoard = 0;
    let whiteStonesOnBoard = 0;
    let blackDeadCount = 0;
    let whiteDeadCount = 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const stone = board.grid[y][x];
        if (!stone) continue;
        if (deadStones.has(`${x},${y}`)) {
          if (stone === 'black') blackDeadCount++;
          else whiteDeadCount++;
        } else if (stone === 'black') {
          blackStonesOnBoard++;
        } else {
          whiteStonesOnBoard++;
        }
      }
    }

    for (const region of this.emptyRegions(board, deadStones)) {
      const owner: 'black' | 'white' | 'dame' =
        region.borderColors.size === 1 ? (region.borderColors.has('black') ? 'black' : 'white') : 'dame';

      for (const pt of region.points) {
        territoryMap[pt.y][pt.x] = owner;
        // Dead stones sit on points that count as territory too, but they are
        // tallied separately as prisoners, so only truly empty points add here.
        if (board.grid[pt.y][pt.x] === null) {
          if (owner === 'black') blackTerritory++;
          else if (owner === 'white') whiteTerritory++;
        }
      }
    }

    let blackTotal: number;
    let whiteTotal: number;

    if (ruleSet === 'japanese') {
      // Territory plus prisoners, with dead stones counting as prisoners.
      blackTotal = blackTerritory + whiteDeadCount + board.captures.black;
      whiteTotal = whiteTerritory + blackDeadCount + board.captures.white + komi;
    } else {
      // Area scoring: living stones plus surrounded points. Dead stones become
      // territory for the surrounding colour, which the region pass already did.
      blackTotal = blackStonesOnBoard + blackTerritory + whiteDeadCount;
      whiteTotal = whiteStonesOnBoard + whiteTerritory + blackDeadCount + komi;
    }

    const margin = Math.abs(blackTotal - whiteTotal);
    let winner: Color | 'draw' = 'draw';
    if (blackTotal > whiteTotal) winner = 'black';
    else if (whiteTotal > blackTotal) winner = 'white';

    return {
      blackTerritory,
      whiteTerritory,
      blackCaptures: board.captures.black,
      whiteCaptures: board.captures.white,
      komi,
      blackStonesOnBoard,
      whiteStonesOnBoard,
      blackTotal,
      whiteTotal,
      winner,
      margin,
      territoryMap
    };
  }
}
