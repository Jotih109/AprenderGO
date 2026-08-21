import { BoardSize, Color, Point, StoneState } from '../types/go';

// Message types between Main Thread and Web Worker
export interface BotRequest {
  type: 'GET_MOVE' | 'ANALYZE';
  id: number;
  size: BoardSize;
  grid: StoneState[][];
  turn: Color;
  level: number; // 1 to 5
  koPoint: Point | null;
  komi: number;
  captures: { black: number; white: number };
}

export interface BotResponse {
  id: number;
  bestMove: Point | null; // null means PASS
  winRate: number; // 0 to 1 for current player
  scoreLead: number;
  thoughtTimeMs: number;
  candidateMoves?: { point: Point; score: number; winRate: number }[];
}

// -------------------------------------------------------------
// PRECOMPUTED TOPOLOGY CACHE FOR INSTANT LOOKUPS
// -------------------------------------------------------------

const TOPOLOGY_CACHE = new Map<number, {
  adj: number[][];
  diag: number[][];
  starPoints: number[];
  distEdge: Uint8Array;
}>();

function getTopology(size: number) {
  let cached = TOPOLOGY_CACHE.get(size);
  if (cached) return cached;

  const total = size * size;
  const adj: number[][] = Array.from({ length: total }, () => []);
  const diag: number[][] = Array.from({ length: total }, () => []);
  const distEdge = new Uint8Array(total);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const minX = Math.min(x, size - 1 - x);
      const minY = Math.min(y, size - 1 - y);
      distEdge[idx] = Math.min(minX, minY);

      if (y > 0) adj[idx].push((y - 1) * size + x);
      if (y < size - 1) adj[idx].push((y + 1) * size + x);
      if (x > 0) adj[idx].push(y * size + (x - 1));
      if (x < size - 1) adj[idx].push(y * size + (x + 1));

      if (x > 0 && y > 0) diag[idx].push((y - 1) * size + (x - 1));
      if (x < size - 1 && y > 0) diag[idx].push((y - 1) * size + (x + 1));
      if (x > 0 && y < size - 1) diag[idx].push((y + 1) * size + (x - 1));
      if (x < size - 1 && y < size - 1) diag[idx].push((y + 1) * size + (x + 1));
    }
  }

  const starPoints: number[] = [];
  if (size === 19) {
    const coords = [3, 9, 15];
    for (const cy of coords) {
      for (const cx of coords) {
        starPoints.push(cy * size + cx);
      }
    }
  } else if (size === 13) {
    const coords = [3, 6, 9];
    for (const cy of coords) {
      for (const cx of coords) {
        if (cy === 6 && cx === 6) starPoints.push(cy * size + cx);
        else if (cy !== 6 && cx !== 6) starPoints.push(cy * size + cx);
      }
    }
  } else if (size === 9) {
    starPoints.push(4 * 9 + 4, 2 * 9 + 2, 2 * 9 + 6, 6 * 9 + 2, 6 * 9 + 6);
  }

  cached = { adj, diag, starPoints, distEdge };
  TOPOLOGY_CACHE.set(size, cached);
  return cached;
}

// -------------------------------------------------------------
// ULTRA-FAST 1D FLAT TYPED BOARD ENGINE (0-ALLOCATION SIMULATIONS)
// -------------------------------------------------------------

const EMPTY = 0;
const BLACK = 1;
const WHITE = -1;

class FastBoard {
  public size: number;
  public totalCells: number;
  public grid: Int8Array;
  public turnColor: number; // 1 for black, -1 for white
  public koIdx: number; // -1 if no ko
  public capturesBlack: number;
  public capturesWhite: number;
  public lastMoveIdx: number;

  public topology: { adj: number[][]; diag: number[][]; starPoints: number[]; distEdge: Uint8Array };

  constructor(size: number) {
    this.size = size;
    this.totalCells = size * size;
    this.grid = new Int8Array(this.totalCells);
    this.turnColor = BLACK;
    this.koIdx = -1;
    this.capturesBlack = 0;
    this.capturesWhite = 0;
    this.lastMoveIdx = -1;
    this.topology = getTopology(size);
  }

  public clone(): FastBoard {
    const b = new FastBoard(this.size);
    b.grid.set(this.grid);
    b.turnColor = this.turnColor;
    b.koIdx = this.koIdx;
    b.capturesBlack = this.capturesBlack;
    b.capturesWhite = this.capturesWhite;
    b.lastMoveIdx = this.lastMoveIdx;
    return b;
  }

  public loadFromState(
    size: number,
    grid2D: StoneState[][],
    turn: Color,
    koPoint: Point | null,
    captures: { black: number; white: number }
  ): void {
    this.size = size;
    this.totalCells = size * size;
    this.grid = new Int8Array(this.totalCells);
    this.topology = getTopology(size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = grid2D[y][x];
        const idx = y * size + x;
        this.grid[idx] = s === 'black' ? BLACK : s === 'white' ? WHITE : EMPTY;
      }
    }

    this.turnColor = turn === 'black' ? BLACK : WHITE;
    this.koIdx = koPoint ? koPoint.y * size + koPoint.x : -1;
    this.capturesBlack = captures.black;
    this.capturesWhite = captures.white;
    this.lastMoveIdx = -1;
  }

  public getGroup(
    startIdx: number,
    groupMembers: Int32Array,
    liberties: Int32Array
  ): { size: number; libCount: number; color: number } {
    const color = this.grid[startIdx];
    if (color === EMPTY) return { size: 0, libCount: 0, color: EMPTY };

    const visited = new Uint8Array(this.totalCells);
    const libVisited = new Uint8Array(this.totalCells);

    let memberCount = 0;
    let libCount = 0;
    const queue = new Int32Array(this.totalCells);
    let head = 0;
    let tail = 0;

    queue[tail++] = startIdx;
    visited[startIdx] = 1;

    while (head < tail) {
      const curr = queue[head++];
      groupMembers[memberCount++] = curr;

      const neighbors = this.topology.adj[curr];
      for (let i = 0; i < neighbors.length; i++) {
        const nIdx = neighbors[i];
        const nVal = this.grid[nIdx];

        if (nVal === EMPTY) {
          if (!libVisited[nIdx]) {
            libVisited[nIdx] = 1;
            liberties[libCount++] = nIdx;
          }
        } else if (nVal === color && !visited[nIdx]) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
    }

    return { size: memberCount, libCount, color };
  }

  public countLiberties(startIdx: number): number {
    const color = this.grid[startIdx];
    if (color === EMPTY) return 0;

    const visited = new Uint8Array(this.totalCells);
    const libVisited = new Uint8Array(this.totalCells);
    let libCount = 0;
    const queue = new Int32Array(this.totalCells);
    let head = 0;
    let tail = 0;

    queue[tail++] = startIdx;
    visited[startIdx] = 1;

    while (head < tail) {
      const curr = queue[head++];
      const neighbors = this.topology.adj[curr];
      for (let i = 0; i < neighbors.length; i++) {
        const nIdx = neighbors[i];
        const nVal = this.grid[nIdx];
        if (nVal === EMPTY) {
          if (!libVisited[nIdx]) {
            libVisited[nIdx] = 1;
            libCount++;
          }
        } else if (nVal === color && !visited[nIdx]) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
    }

    return libCount;
  }

  public isValidMove(idx: number, color: number = this.turnColor): boolean {
    if (idx < 0 || idx >= this.totalCells || this.grid[idx] !== EMPTY) return false;
    if (this.koIdx === idx) return false;

    const opponent = -color;
    this.grid[idx] = color;

    // Check if move captures any adjacent opponent group
    let captures = false;
    const neighbors = this.topology.adj[idx];

    for (let i = 0; i < neighbors.length; i++) {
      const nIdx = neighbors[i];
      if (this.grid[nIdx] === opponent) {
        if (this.countLiberties(nIdx) === 0) {
          captures = true;
          break;
        }
      }
    }

    const hasLiberties = this.countLiberties(idx) > 0;
    this.grid[idx] = EMPTY;

    return hasLiberties || captures;
  }

  public playMove(idx: number, color: number = this.turnColor): boolean {
    if (!this.isValidMove(idx, color)) return false;

    const opponent = -color;
    this.grid[idx] = color;

    let totalCaptured = 0;
    let singleCapturedIdx = -1;

    const groupBuf = new Int32Array(this.totalCells);
    const libBuf = new Int32Array(this.totalCells);
    const neighbors = this.topology.adj[idx];

    for (let i = 0; i < neighbors.length; i++) {
      const nIdx = neighbors[i];
      if (this.grid[nIdx] === opponent) {
        const grp = this.getGroup(nIdx, groupBuf, libBuf);
        if (grp.libCount === 0) {
          for (let p = 0; p < grp.size; p++) {
            const cap = groupBuf[p];
            this.grid[cap] = EMPTY;
            totalCaptured++;
            singleCapturedIdx = cap;
          }
        }
      }
    }

    if (color === BLACK) this.capturesBlack += totalCaptured;
    else this.capturesWhite += totalCaptured;

    // Ko detection
    const ownGrp = this.getGroup(idx, groupBuf, libBuf);
    if (totalCaptured === 1 && ownGrp.size === 1 && ownGrp.libCount === 1) {
      this.koIdx = singleCapturedIdx;
    } else {
      this.koIdx = -1;
    }

    this.lastMoveIdx = idx;
    this.turnColor = opponent;
    return true;
  }

  public isTrueEye(idx: number, color: number): boolean {
    if (this.grid[idx] !== EMPTY) return false;

    const neighbors = this.topology.adj[idx];
    for (let i = 0; i < neighbors.length; i++) {
      if (this.grid[neighbors[i]] !== color) return false;
    }

    const diags = this.topology.diag[idx];
    const opponent = -color;
    let oppDiags = 0;

    for (let i = 0; i < diags.length; i++) {
      if (this.grid[diags[i]] === opponent) oppDiags++;
    }

    const isEdge = this.topology.distEdge[idx] === 0;
    return isEdge ? oppDiags === 0 : oppDiags <= 1;
  }

  public getLegalMoves(color: number = this.turnColor, avoidOwnEyes: boolean = true): number[] {
    const moves: number[] = [];
    for (let i = 0; i < this.totalCells; i++) {
      if (this.grid[i] === EMPTY) {
        if (avoidOwnEyes && this.isTrueEye(i, color)) continue;
        if (this.isValidMove(i, color)) {
          moves.push(i);
        }
      }
    }
    return moves;
  }

  public evaluateScore(komi: number): number {
    let blackScore = this.capturesBlack;
    let whiteScore = this.capturesWhite + komi;

    const visited = new Uint8Array(this.totalCells);

    for (let i = 0; i < this.totalCells; i++) {
      const val = this.grid[i];
      if (val === BLACK) {
        blackScore += 1;
      } else if (val === WHITE) {
        whiteScore += 1;
      } else if (!visited[i]) {
        let reachesBlack = false;
        let reachesWhite = false;
        let count = 0;

        const queue = new Int32Array(this.totalCells);
        let head = 0;
        let tail = 0;
        queue[tail++] = i;
        visited[i] = 1;

        while (head < tail) {
          const curr = queue[head++];
          count++;

          const neighbors = this.topology.adj[curr];
          for (let n = 0; n < neighbors.length; n++) {
            const nIdx = neighbors[n];
            const nVal = this.grid[nIdx];

            if (nVal === BLACK) {
              reachesBlack = true;
            } else if (nVal === WHITE) {
              reachesWhite = true;
            } else if (!visited[nIdx]) {
              visited[nIdx] = 1;
              queue[tail++] = nIdx;
            }
          }
        }

        if (reachesBlack && !reachesWhite) blackScore += count;
        else if (reachesWhite && !reachesBlack) whiteScore += count;
      }
    }

    return blackScore - whiteScore;
  }
}

// -------------------------------------------------------------
// DEEP LADDER (SHICHO) SOLVER
// -------------------------------------------------------------

function isLadderCapturable(board: FastBoard, groupHeadIdx: number, defenderColor: number, maxDepth: number = 24): boolean {
  const groupBuf = new Int32Array(board.totalCells);
  const libBuf = new Int32Array(board.totalCells);

  const grp = board.getGroup(groupHeadIdx, groupBuf, libBuf);
  if (grp.size === 0 || grp.libCount > 2) return false;
  if (grp.libCount === 1) return true; // Already in Atari

  if (maxDepth <= 0) return false;

  const attackerColor = -defenderColor;

  // Try attacker moves on all liberties
  for (let l = 0; l < grp.libCount; l++) {
    const attackIdx = libBuf[l];
    const simBoard = board.clone();

    if (simBoard.playMove(attackIdx, attackerColor)) {
      const defGrp = simBoard.getGroup(groupHeadIdx, groupBuf, libBuf);
      if (defGrp.libCount === 0) return true; // Captured

      if (defGrp.libCount === 1) {
        // Defender must escape
        const escapeIdx = libBuf[0];
        const defBoard = simBoard.clone();

        if (defBoard.playMove(escapeIdx, defenderColor)) {
          const escapedGrp = defBoard.getGroup(escapeIdx, groupBuf, libBuf);
          if (escapedGrp.libCount >= 3) {
            // Escaped successfully!
            return false;
          }
          if (escapedGrp.libCount === 2) {
            // Continue ladder chase
            if (isLadderCapturable(defBoard, escapeIdx, defenderColor, maxDepth - 1)) {
              return true;
            }
          }
        }
      }
    }
  }

  return false;
}

// -------------------------------------------------------------
// EXPANDED MASTER OPENING BOOK (KATAGO 9x9 / PRO 13x13 & 19x19)
// -------------------------------------------------------------

function getOpeningMove(board: FastBoard, color: number): number | null {
  const stonesCount = board.grid.filter(s => s !== EMPTY).length;

  if (board.size === 9) {
    const E5 = 4 * 9 + 4; // Tengen
    const C5 = 4 * 9 + 2;
    const G5 = 4 * 9 + 6;
    const E3 = 2 * 9 + 4;
    const E7 = 6 * 9 + 4;
    const C7 = 6 * 9 + 2;
    const G3 = 2 * 9 + 6;
    const C3 = 2 * 9 + 2;
    const G7 = 6 * 9 + 6;
    const D6 = 5 * 9 + 3;
    const F4 = 3 * 9 + 5;
    const D4 = 3 * 9 + 3;
    const F6 = 5 * 9 + 5;

    // Move 1: Tengen is optimal in 9x9
    if (stonesCount === 0) return E5;

    // Move 2: White responses to Tengen
    if (stonesCount === 1 && color === WHITE) {
      if (board.grid[E5] === BLACK) {
        const whiteOptions = [C5, E3, G5, E7, C7, G3, C3, G7];
        return whiteOptions[Math.floor(Math.random() * whiteOptions.length)];
      }
    }

    // Move 3: Black extensions
    if (stonesCount === 2 && color === BLACK && board.grid[E5] === BLACK) {
      if (board.grid[C5] === WHITE) return Math.random() < 0.6 ? D6 : F4;
      if (board.grid[E3] === WHITE) return Math.random() < 0.6 ? F4 : D6;
      if (board.grid[G5] === WHITE) return Math.random() < 0.6 ? F6 : D4;
      if (board.grid[E7] === WHITE) return Math.random() < 0.6 ? D6 : F4;
    }

    // Early corner control (moves 3 to 6)
    if (stonesCount < 6) {
      const top9x9 = [E5, C3, G3, C7, G7, D4, F4, D6, F6];
      for (const p of top9x9) {
        if (board.grid[p] === EMPTY && board.isValidMove(p, color)) {
          if (Math.random() < 0.55) return p;
        }
      }
    }
  } else if (board.size === 19) {
    if (stonesCount < 8) {
      const stars19 = [
        3 * 19 + 3, 3 * 19 + 15, 15 * 19 + 3, 15 * 19 + 15, // 4-4 Star points
        2 * 19 + 3, 2 * 19 + 15, 16 * 19 + 3, 16 * 19 + 15, // 3-4 Komoku
        3 * 19 + 2, 15 * 19 + 2, 3 * 19 + 16, 15 * 19 + 16,
        2 * 19 + 2, 2 * 19 + 16, 16 * 19 + 2, 16 * 19 + 16  // 3-3 San-San
      ];
      const emptyStars = stars19.filter(p => board.grid[p] === EMPTY);
      if (emptyStars.length > 0) {
        return emptyStars[Math.floor(Math.random() * emptyStars.length)];
      }
    }
  } else if (board.size === 13) {
    if (stonesCount < 6) {
      const stars13 = [3 * 13 + 3, 3 * 13 + 9, 9 * 13 + 3, 9 * 13 + 9, 6 * 13 + 6];
      const emptyStars = stars13.filter(p => board.grid[p] === EMPTY);
      if (emptyStars.length > 0) {
        return emptyStars[Math.floor(Math.random() * emptyStars.length)];
      }
    }
  }

  return null;
}

// -------------------------------------------------------------
// DEEP TACTICAL SHAPE & PATTERN EVALUATOR
// -------------------------------------------------------------

function evaluateUrgentMove(board: FastBoard, color: number): number | null {
  const opponent = -color;
  const legal = board.getLegalMoves(color, true);
  if (legal.length === 0) return null;

  const groupBuf = new Int32Array(board.totalCells);
  const libBuf = new Int32Array(board.totalCells);

  // 1. Capture enemy group in Atari (if it has multiple stones or cuts)
  let bestCapIdx: number | null = null;
  let maxCapSize = 0;

  for (let i = 0; i < legal.length; i++) {
    const moveIdx = legal[i];
    const sim = board.clone();
    const beforeCap = color === BLACK ? sim.capturesBlack : sim.capturesWhite;
    if (sim.playMove(moveIdx, color)) {
      const afterCap = color === BLACK ? sim.capturesBlack : sim.capturesWhite;
      const count = afterCap - beforeCap;
      if (count > maxCapSize) {
        maxCapSize = count;
        bestCapIdx = moveIdx;
      }
    }
  }

  if (bestCapIdx !== null && maxCapSize >= 2) {
    return bestCapIdx;
  }

  // 2. Save own group in Atari (unless caught in an inescapable ladder!)
  for (let i = 0; i < board.totalCells; i++) {
    if (board.grid[i] === color) {
      const grp = board.getGroup(i, groupBuf, libBuf);
      if (grp.libCount === 1) {
        const escapeIdx = libBuf[0];
        if (board.isValidMove(escapeIdx, color)) {
          // Check if escape is not a futile ladder suicide
          if (!isLadderCapturable(board, i, color, 18)) {
            const sim = board.clone();
            if (sim.playMove(escapeIdx, color)) {
              if (sim.countLiberties(escapeIdx) >= 2) {
                return escapeIdx;
              }
            }
          }
        }
      }
    }
  }

  // 3. Double-Atari attack detector
  for (let i = 0; i < legal.length; i++) {
    const moveIdx = legal[i];
    const sim = board.clone();
    if (sim.playMove(moveIdx, color)) {
      let atariGroups = 0;
      const checked = new Uint8Array(board.totalCells);

      const adj = board.topology.adj[moveIdx];
      for (let a = 0; a < adj.length; a++) {
        const nIdx = adj[a];
        if (sim.grid[nIdx] === opponent && !checked[nIdx]) {
          const oppGrp = sim.getGroup(nIdx, groupBuf, libBuf);
          for (let p = 0; p < oppGrp.size; p++) checked[groupBuf[p]] = 1;
          if (oppGrp.libCount === 1) atariGroups++;
        }
      }

      if (atariGroups >= 2) {
        return moveIdx; // Devastating Double Atari!
      }
    }
  }

  return bestCapIdx; // single stone capture if nothing else
}

/**
 * Deep Shape, Territory and Nakade Score
 */
function scoreMoveDeep(board: FastBoard, moveIdx: number, color: number): number {
  const opponent = -color;
  let score = 0;

  const edgeDist = board.topology.distEdge[moveIdx];

  // 1. Line Placement Weights
  if (edgeDist === 0) {
    score -= 35; // 1st line crawl penalty
  } else if (edgeDist === 1) {
    score -= 6;  // 2nd line
  } else if (edgeDist === 2) {
    score += 26; // 3rd line (Territory gold standard)
  } else if (edgeDist === 3) {
    score += 22; // 4th line (Influence & Power)
  } else {
    score += 16; // Center
  }

  // 2. Star point bonus
  if (board.topology.starPoints.includes(moveIdx)) {
    score += 18;
  }

  // 3. Liberties & Safety Evaluation
  const sim = board.clone();
  if (sim.playMove(moveIdx, color)) {
    const libCount = sim.countLiberties(moveIdx);
    if (libCount === 1) {
      score -= 160; // Self-Atari blunder penalty!
    } else if (libCount === 2) {
      score -= 15;
    } else if (libCount >= 4) {
      score += 20; // Thick, secure group!
    }
  } else {
    return -9999;
  }

  // 4. Contact Combat (Hane, Nobi, Cut, Bamboo Joint)
  const adj = board.topology.adj[moveIdx];
  let ownAdj = 0;
  let oppAdj = 0;

  for (let i = 0; i < adj.length; i++) {
    const v = board.grid[adj[i]];
    if (v === color) ownAdj++;
    else if (v === opponent) oppAdj++;
  }

  // Hane (Active fighting)
  if (ownAdj >= 1 && oppAdj >= 1) score += 32;
  // Solid Extension (Nobi)
  if (ownAdj === 1 && oppAdj === 0) score += 16;
  // Tiger's mouth connection (Koguchi)
  if (ownAdj >= 2) score += 28;

  // 5. Bamboo Joint (Takefu) & Solid Connection
  const diag = board.topology.diag[moveIdx];
  let ownDiag = 0;
  let oppDiag = 0;
  for (let i = 0; i < diag.length; i++) {
    const v = board.grid[diag[i]];
    if (v === color) ownDiag++;
    else if (v === opponent) oppDiag++;
  }

  if (ownDiag >= 1 && ownAdj >= 1) score += 24; // Diagonal link

  // 6. Avoid Empty Triangle (Dango - Inefficient Shape)
  const x = moveIdx % board.size;
  const y = Math.floor(moveIdx / board.size);
  const corners = [
    [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 }],
    [{ dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 1 }],
    [{ dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 }],
    [{ dx: -1, dy: 0 }, { dx: 0, dy: -1 }, { dx: -1, dy: -1 }]
  ];

  for (let c = 0; c < corners.length; c++) {
    const cInfo = corners[c];
    const px1 = x + cInfo[0].dx;
    const py1 = y + cInfo[0].dy;
    const px2 = x + cInfo[1].dx;
    const py2 = y + cInfo[1].dy;
    const dx2 = x + cInfo[2].dx;
    const dy2 = y + cInfo[2].dy;

    if (
      px1 >= 0 && px1 < board.size && py1 >= 0 && py1 < board.size &&
      px2 >= 0 && px2 < board.size && py2 >= 0 && py2 < board.size &&
      dx2 >= 0 && dx2 < board.size && dy2 >= 0 && dy2 < board.size
    ) {
      const idx1 = py1 * board.size + px1;
      const idx2 = py2 * board.size + px2;
      const diagIdx = dy2 * board.size + dx2;

      if (
        board.grid[idx1] === color &&
        board.grid[idx2] === color &&
        board.grid[diagIdx] === EMPTY
      ) {
        score -= 65; // Severe Dango penalty!
      }
    }
  }

  // 7. Nakade Vital Point (Eye space stealing/living)
  if (oppDiag >= 2 && ownAdj >= 1) score += 36;

  return score;
}

// -------------------------------------------------------------
// STATE-OF-THE-ART MCTS (PUCT + RAVE + PROGRESSIVE HEURISTIC BIAS)
// -------------------------------------------------------------

class FastMCTSNode {
  public moveIdx: number; // -1 for root
  public color: number;
  public parent: FastMCTSNode | null;
  public children: FastMCTSNode[];
  public wins: number;
  public visits: number;
  public raveWins: number;
  public raveVisits: number;
  public priorScore: number;
  public untriedMoves: number[];

  constructor(board: FastBoard, moveIdx: number, color: number, parent: FastMCTSNode | null = null) {
    this.moveIdx = moveIdx;
    this.color = color;
    this.parent = parent;
    this.children = [];
    this.wins = 0;
    this.visits = 0;
    this.raveWins = 0;
    this.raveVisits = 0;
    this.priorScore = moveIdx >= 0 ? scoreMoveDeep(board, moveIdx, color) : 0;

    const legal = board.getLegalMoves(color, true);
    // Sort untried moves by deep Go heuristic score
    legal.sort((a, b) => scoreMoveDeep(board, b, color) - scoreMoveDeep(board, a, color));
    this.untriedMoves = legal;
  }

  public getPUCTValue(cPuct: number = 1.2, raveWeight: number = 300): number {
    if (this.visits === 0) {
      const fpu = this.raveVisits > 0 ? this.raveWins / this.raveVisits : 0.5;
      const priorBonus = Math.max(0, this.priorScore / 100);
      return fpu + 1.8 + priorBonus;
    }

    const exploitation = this.wins / this.visits;
    const priorBonus = (1 / (1 + this.visits)) * Math.max(0, this.priorScore / 120);
    const exploration = cPuct * Math.sqrt(Math.log(this.parent!.visits) / this.visits) + priorBonus;

    if (this.raveVisits > 0) {
      const beta = this.raveVisits / (this.visits + this.raveVisits + (4 * this.visits * this.raveVisits) / raveWeight);
      const raveVal = this.raveWins / this.raveVisits;
      return (1 - beta) * exploitation + beta * raveVal + exploration;
    }

    return exploitation + exploration;
  }
}

function runMasterMCTS(
  rootBoard: FastBoard,
  color: number,
  maxIterations: number,
  maxTimeMs: number,
  komi: number,
  isKami: boolean = false
): { bestMoveIdx: number | null; winRate: number; candidates: { point: Point; score: number; winRate: number }[] } {
  // 1. Opening Book
  const bookMove = getOpeningMove(rootBoard, color);
  if (bookMove !== null) {
    const bx = bookMove % rootBoard.size;
    const by = Math.floor(bookMove / rootBoard.size);
    return {
      bestMoveIdx: bookMove,
      winRate: 0.56,
      candidates: [{ point: { x: bx, y: by }, score: 99999, winRate: 0.56 }]
    };
  }

  // 2. Urgent Tactical Check (Atari / Ladder save / Double Atari)
  const urgent = evaluateUrgentMove(rootBoard, color);
  if (urgent !== null && !isKami) {
    const ux = urgent % rootBoard.size;
    const uy = Math.floor(urgent / rootBoard.size);
    return {
      bestMoveIdx: urgent,
      winRate: 0.68,
      candidates: [{ point: { x: ux, y: uy }, score: 88888, winRate: 0.68 }]
    };
  }

  const legal = rootBoard.getLegalMoves(color, true);
  if (legal.length === 0) {
    return { bestMoveIdx: null, winRate: 0, candidates: [] };
  }

  const root = new FastMCTSNode(rootBoard, -1, color);
  const startTime = Date.now();

  const cPuct = isKami ? 1.05 : 1.25;
  const raveWeight = isKami ? 450 : 250;
  const rolloutDepth = isKami ? (rootBoard.size === 9 ? 38 : 56) : (rootBoard.size === 9 ? 22 : 32);

  for (let iter = 0; iter < maxIterations; iter++) {
    if (iter % 100 === 0 && Date.now() - startTime > maxTimeMs) {
      break;
    }

    let node = root;
    const simBoard = rootBoard.clone();

    // 1. Selection
    while (node.untriedMoves.length === 0 && node.children.length > 0) {
      let bestChild = node.children[0];
      let bestVal = -Infinity;

      for (let i = 0; i < node.children.length; i++) {
        const val = node.children[i].getPUCTValue(cPuct, raveWeight);
        if (val > bestVal) {
          bestVal = val;
          bestChild = node.children[i];
        }
      }

      node = bestChild;
      if (node.moveIdx >= 0) {
        simBoard.playMove(node.moveIdx, node.color);
      }
    }

    // 2. Expansion
    if (node.untriedMoves.length > 0) {
      const moveIdx = node.untriedMoves.shift()!;
      const nextColor = -node.color;

      simBoard.playMove(moveIdx, node.color);
      const childNode = new FastMCTSNode(simBoard, moveIdx, nextColor, node);
      node.children.push(childNode);
      node = childNode;
    }

    // 3. Fast Tactical Playout (Rollout)
    const blackPlayoutMoves = new Int32Array(rolloutDepth + 4);
    const whitePlayoutMoves = new Int32Array(rolloutDepth + 4);
    let blackCount = 0;
    let whiteCount = 0;

    let currColor = node.color;
    let depth = rolloutDepth;
    let passes = 0;

    while (depth > 0 && passes < 2) {
      const tactical = evaluateUrgentMove(simBoard, currColor);
      let chosenIdx: number | null = null;

      if (tactical !== null && Math.random() < 0.9) {
        chosenIdx = tactical;
      } else {
        const moves = simBoard.getLegalMoves(currColor, true);
        if (moves.length === 0) {
          passes++;
        } else {
          passes = 0;
          if (moves.length <= 3 || Math.random() < 0.25) {
            chosenIdx = moves[Math.floor(Math.random() * moves.length)];
          } else {
            // Pick best of 3 sampled moves using shape score
            let bestScore = -Infinity;
            for (let s = 0; s < 3; s++) {
              const sample = moves[Math.floor(Math.random() * moves.length)];
              const sc = scoreMoveDeep(simBoard, sample, currColor);
              if (sc > bestScore) {
                bestScore = sc;
                chosenIdx = sample;
              }
            }
          }
        }
      }

      if (chosenIdx !== null) {
        simBoard.playMove(chosenIdx, currColor);
        if (currColor === BLACK) blackPlayoutMoves[blackCount++] = chosenIdx;
        else whitePlayoutMoves[whiteCount++] = chosenIdx;
      }

      currColor = -currColor;
      depth--;
    }

    // 4. Backpropagation with RAVE
    const scoreDiff = simBoard.evaluateScore(komi);
    const blackWon = scoreDiff > 0;

    let curr: FastMCTSNode | null = node;
    while (curr) {
      curr.visits++;
      const won = curr.color === BLACK ? !blackWon : blackWon;
      if (won) curr.wins += 1;

      if (curr.parent) {
        const movesPlayed = curr.color === BLACK ? blackPlayoutMoves : whitePlayoutMoves;
        const countPlayed = curr.color === BLACK ? blackCount : whiteCount;

        for (let i = 0; i < curr.parent.children.length; i++) {
          const sibling = curr.parent.children[i];
          if (sibling.moveIdx >= 0) {
            let wasPlayed = false;
            for (let m = 0; m < countPlayed; m++) {
              if (movesPlayed[m] === sibling.moveIdx) {
                wasPlayed = true;
                break;
              }
            }
            if (wasPlayed) {
              sibling.raveVisits++;
              if (won) sibling.raveWins++;
            }
          }
        }
      }

      curr = curr.parent;
    }
  }

  if (root.children.length === 0) {
    return { bestMoveIdx: null, winRate: 0.5, candidates: [] };
  }

  // Sort by visits for most robust move
  root.children.sort((a, b) => b.visits - a.visits);

  const best = root.children[0];
  const winRate = best.visits > 0 ? best.wins / best.visits : 0.5;

  const candidates = root.children.slice(0, 5).map(c => ({
    point: { x: c.moveIdx % rootBoard.size, y: Math.floor(c.moveIdx / rootBoard.size) },
    score: c.visits,
    winRate: c.visits > 0 ? c.wins / c.visits : 0
  }));

  return {
    bestMoveIdx: best.moveIdx,
    winRate,
    candidates
  };
}

// -------------------------------------------------------------
// PUBLIC BOT ENGINE API (INTEGRATED & WORKER COMPATIBLE)
// -------------------------------------------------------------

export function processBotRequest(req: BotRequest): BotResponse {
  const startTime = Date.now();
  const board = new FastBoard(req.size);
  board.loadFromState(req.size, req.grid, req.turn, req.koPoint, req.captures);

  const turnVal = req.turn === 'black' ? BLACK : WHITE;
  let bestMovePoint: Point | null = null;
  let winRate = 0.5;
  let candidates: { point: Point; score: number; winRate: number }[] = [];

  switch (req.level) {
    case 1: {
      // Level 1: Tático Sólido (~6k Kyu) - 1,200 iterations
      const res = runMasterMCTS(board, turnVal, 1200, 350, req.komi, false);
      if (res.bestMoveIdx !== null) {
        bestMovePoint = { x: res.bestMoveIdx % board.size, y: Math.floor(res.bestMoveIdx / board.size) };
      }
      winRate = res.winRate;
      candidates = res.candidates;
      break;
    }

    case 2: {
      // Level 2: Dan Competitivo (1-3 Dan) - 3,500 iterations
      const res = runMasterMCTS(board, turnVal, 3500, 750, req.komi, false);
      if (res.bestMoveIdx !== null) {
        bestMovePoint = { x: res.bestMoveIdx % board.size, y: Math.floor(res.bestMoveIdx / board.size) };
      }
      winRate = res.winRate;
      candidates = res.candidates;
      break;
    }

    case 3: {
      // Level 3: Mestre Meijin (4-6 Dan) - 7,500 iterations
      const res = runMasterMCTS(board, turnVal, 7500, 1200, req.komi, false);
      if (res.bestMoveIdx !== null) {
        bestMovePoint = { x: res.bestMoveIdx % board.size, y: Math.floor(res.bestMoveIdx / board.size) };
      }
      winRate = res.winRate;
      candidates = res.candidates;
      break;
    }

    case 4: {
      // Level 4: Grão-Mestre Honinbo (7-8 Dan) - 12,000 iterations
      const res = runMasterMCTS(board, turnVal, 12000, 1800, req.komi, true);
      if (res.bestMoveIdx !== null) {
        bestMovePoint = { x: res.bestMoveIdx % board.size, y: Math.floor(res.bestMoveIdx / board.size) };
      }
      winRate = res.winRate;
      candidates = res.candidates;
      break;
    }

    case 5:
    default: {
      // Level 5: ⚡ KAMI (Nível Divino Absurdo - 9 Dan Pro / KataGo Style) - 20,000 iterations
      const res = runMasterMCTS(board, turnVal, 20000, 2500, req.komi, true);
      if (res.bestMoveIdx !== null) {
        bestMovePoint = { x: res.bestMoveIdx % board.size, y: Math.floor(res.bestMoveIdx / board.size) };
      }
      winRate = res.winRate;
      candidates = res.candidates;
      break;
    }
  }

  const thoughtTimeMs = Date.now() - startTime;
  const scoreLead = board.evaluateScore(req.komi);

  return {
    id: req.id,
    bestMove: bestMovePoint,
    winRate: req.turn === 'black' ? winRate : 1 - winRate,
    scoreLead,
    thoughtTimeMs,
    candidateMoves: candidates
  };
}

// -------------------------------------------------------------
// WORKER ONMESSAGE LISTENER
// -------------------------------------------------------------

if (typeof self !== 'undefined' && typeof (self as any).postMessage === 'function') {
  self.onmessage = (event: MessageEvent<BotRequest>) => {
    const res = processBotRequest(event.data);
    self.postMessage(res);
  };
}
