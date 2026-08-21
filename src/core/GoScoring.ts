import { GoBoard } from './GoBoard';
import { Color, Point, RuleSet, TerritoryScore } from '../types/go';

export class GoScoring {
  /**
   * Automatically detects dead stones based on surroundedness and eye counts.
   */
  public static autoDetectDeadStones(board: GoBoard): Set<string> {
    const dead = new Set<string>();
    const groups = board.getAllGroups();

    for (const group of groups) {
      // Heuristic: Groups with 1 liberty or very small groups deep in opponent territory
      if (group.liberties.size <= 1 && group.points.length <= 3) {
        // Check if all liberties are surrounded by opponent
        let allLibertiesOpponent = true;
        const opponentColor = group.color === 'black' ? 'white' : 'black';

        for (const libKey of group.liberties) {
          const [lx, ly] = libKey.split(',').map(Number);
          const adj = board.getAdjacent(lx, ly);
          const oppCount = adj.filter(p => board.get(p.x, p.y) === opponentColor).length;
          if (oppCount === 0) {
            allLibertiesOpponent = false;
            break;
          }
        }

        if (allLibertiesOpponent) {
          for (const pt of group.points) {
            dead.add(`${pt.x},${pt.y}`);
          }
        }
      }
    }

    return dead;
  }

  /**
   * Calculates the final territory score given the board and a set of marked dead stones.
   */
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

    const visited = new Set<string>();
    let blackTerritory = 0;
    let whiteTerritory = 0;
    let blackStonesOnBoard = 0;
    let whiteStonesOnBoard = 0;
    let blackDeadStonesCount = 0;
    let whiteDeadStonesCount = 0;

    // Count alive stones on board and dead stones
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const stone = board.grid[y][x];
        const key = `${x},${y}`;
        if (stone) {
          if (deadStones.has(key)) {
            if (stone === 'black') blackDeadStonesCount++;
            else whiteDeadStonesCount++;
          } else {
            if (stone === 'black') blackStonesOnBoard++;
            else whiteStonesOnBoard++;
          }
        }
      }
    }

    // Flood fill empty regions (or cells containing dead stones) to determine ownership
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const key = `${x},${y}`;
        const isDeadStone = deadStones.has(key);
        const isEmpty = board.grid[y][x] === null;

        if ((isEmpty || isDeadStone) && !visited.has(key)) {
          const region: Point[] = [];
          const borderingColors = new Set<Color>();
          const queue: Point[] = [{ x, y }];
          visited.add(key);

          while (queue.length > 0) {
            const curr = queue.shift()!;
            region.push(curr);

            const adj = board.getAdjacent(curr.x, curr.y);
            for (const neighbor of adj) {
              const nKey = `${neighbor.x},${neighbor.y}`;
              const nStone = board.grid[neighbor.y][neighbor.x];
              const nIsDead = deadStones.has(nKey);

              if (nStone && !nIsDead) {
                // Bordering alive stone
                borderingColors.add(nStone);
              } else if ((nStone === null || nIsDead) && !visited.has(nKey)) {
                visited.add(nKey);
                queue.push(neighbor);
              }
            }
          }

          let owner: 'black' | 'white' | 'dame' = 'dame';
          if (borderingColors.size === 1) {
            owner = borderingColors.has('black') ? 'black' : 'white';
          }

          for (const pt of region) {
            territoryMap[pt.y][pt.x] = owner;
            // Only count empty intersections as territory (dead stones will be added to captures or area)
            if (board.grid[pt.y][pt.x] === null) {
              if (owner === 'black') blackTerritory++;
              else if (owner === 'white') whiteTerritory++;
            }
          }
        }
      }
    }

    let blackTotal = 0;
    let whiteTotal = 0;

    if (ruleSet === 'japanese') {
      // Japanese scoring: Territory + Opponent Dead Stones + Captures during game
      // White gets komi added
      blackTotal = blackTerritory + whiteDeadStonesCount + board.captures.black;
      whiteTotal = whiteTerritory + blackDeadStonesCount + board.captures.white + komi;
    } else {
      // Chinese scoring: Area scoring = Alive Stones on board + Territory
      blackTotal = blackStonesOnBoard + blackTerritory;
      whiteTotal = whiteStonesOnBoard + whiteTerritory + komi;
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
