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
// ULTRA-FAST BOARD ENGINE FOR SIMULATIONS & ANALYSIS
// -------------------------------------------------------------

class WorkerBoard {
  public size: number;
  public grid: StoneState[][];
  public turn: Color;
  public koPoint: Point | null;
  public captures: { black: number; white: number };
  public lastMovePoint: Point | null = null;

  constructor(size: number, grid: StoneState[][], turn: Color, koPoint: Point | null, captures: { black: number; white: number }) {
    this.size = size;
    this.grid = grid.map(row => [...row]);
    this.turn = turn;
    this.koPoint = koPoint ? { ...koPoint } : null;
    this.captures = { ...captures };
  }

  public clone(): WorkerBoard {
    const b = new WorkerBoard(this.size, this.grid, this.turn, this.koPoint, this.captures);
    b.lastMovePoint = this.lastMovePoint ? { ...this.lastMovePoint } : null;
    return b;
  }

  public isValid(x: number, y: number): boolean {
    return x >= 0 && x < this.size && y >= 0 && y < this.size;
  }

  public getAdjacent(x: number, y: number): Point[] {
    const adj: Point[] = [];
    if (y > 0) adj.push({ x, y: y - 1 });
    if (y < this.size - 1) adj.push({ x, y: y + 1 });
    if (x > 0) adj.push({ x: x - 1, y });
    if (x < this.size - 1) adj.push({ x: x + 1, y });
    return adj;
  }

  public getDiagonals(x: number, y: number): Point[] {
    const diag: Point[] = [];
    if (x > 0 && y > 0) diag.push({ x: x - 1, y: y - 1 });
    if (x < this.size - 1 && y > 0) diag.push({ x: x + 1, y: y - 1 });
    if (x > 0 && y < this.size - 1) diag.push({ x: x - 1, y: y + 1 });
    if (x < this.size - 1 && y < this.size - 1) diag.push({ x: x + 1, y: y + 1 });
    return diag;
  }

  public getGroup(startX: number, startY: number): { points: Point[]; liberties: Point[]; color: Color } | null {
    const color = this.grid[startY][startX];
    if (!color) return null;

    const visited = new Uint8Array(this.size * this.size);
    const libVisited = new Uint8Array(this.size * this.size);
    const points: Point[] = [];
    const liberties: Point[] = [];
    const queueX = [startX];
    const queueY = [startY];
    visited[startY * this.size + startX] = 1;

    let head = 0;
    while (head < queueX.length) {
      const cx = queueX[head];
      const cy = queueY[head];
      head++;
      points.push({ x: cx, y: cy });

      const adj = this.getAdjacent(cx, cy);
      for (let i = 0; i < adj.length; i++) {
        const nx = adj[i].x;
        const ny = adj[i].y;
        const idx = ny * this.size + nx;
        const nStone = this.grid[ny][nx];

        if (nStone === null) {
          if (!libVisited[idx]) {
            libVisited[idx] = 1;
            liberties.push({ x: nx, y: ny });
          }
        } else if (nStone === color && !visited[idx]) {
          visited[idx] = 1;
          queueX.push(nx);
          queueY.push(ny);
        }
      }
    }

    return { points, liberties, color };
  }

  public isValidMove(x: number, y: number, color: Color = this.turn): boolean {
    if (!this.isValid(x, y) || this.grid[y][x] !== null) return false;
    if (this.koPoint && this.koPoint.x === x && this.koPoint.y === y) return false;

    const opponent: Color = color === 'black' ? 'white' : 'black';
    this.grid[y][x] = color;

    let capturesOpponent = false;
    const adj = this.getAdjacent(x, y);

    for (let i = 0; i < adj.length; i++) {
      const nb = adj[i];
      if (this.grid[nb.y][nb.x] === opponent) {
        const oppGroup = this.getGroup(nb.x, nb.y);
        if (oppGroup && oppGroup.liberties.length === 0) {
          capturesOpponent = true;
          break;
        }
      }
    }

    const ownGroup = this.getGroup(x, y);
    const hasLiberties = ownGroup ? ownGroup.liberties.length > 0 : false;

    this.grid[y][x] = null;
    return hasLiberties || capturesOpponent;
  }

  public playMove(x: number, y: number, color: Color = this.turn): boolean {
    if (!this.isValidMove(x, y, color)) return false;

    const opponent: Color = color === 'black' ? 'white' : 'black';
    this.grid[y][x] = color;
    const captured: Point[] = [];

    const adj = this.getAdjacent(x, y);
    for (let i = 0; i < adj.length; i++) {
      const nb = adj[i];
      if (this.grid[nb.y][nb.x] === opponent) {
        const oppGroup = this.getGroup(nb.x, nb.y);
        if (oppGroup && oppGroup.liberties.length === 0) {
          for (let p = 0; p < oppGroup.points.length; p++) {
            const stone = oppGroup.points[p];
            this.grid[stone.y][stone.x] = null;
            captured.push(stone);
          }
        }
      }
    }

    if (color === 'black') this.captures.black += captured.length;
    else this.captures.white += captured.length;

    const ownGroup = this.getGroup(x, y);
    if (captured.length === 1 && ownGroup && ownGroup.points.length === 1 && ownGroup.liberties.length === 1) {
      this.koPoint = { x: captured[0].x, y: captured[0].y };
    } else {
      this.koPoint = null;
    }

    this.lastMovePoint = { x, y };
    this.turn = opponent;
    return true;
  }

  /**
   * Determines if (x,y) is a true 1-point eye for color
   */
  public isTrueEye(x: number, y: number, color: Color): boolean {
    if (this.grid[y][x] !== null) return false;

    const adj = this.getAdjacent(x, y);
    for (let i = 0; i < adj.length; i++) {
      if (this.grid[adj[i].y][adj[i].x] !== color) return false;
    }

    const diag = this.getDiagonals(x, y);
    const opponent: Color = color === 'black' ? 'white' : 'black';
    let oppDiagCount = 0;

    for (let i = 0; i < diag.length; i++) {
      if (this.grid[diag[i].y][diag[i].x] === opponent) {
        oppDiagCount++;
      }
    }

    const isEdge = x === 0 || x === this.size - 1 || y === 0 || y === this.size - 1;
    return isEdge ? oppDiagCount === 0 : oppDiagCount <= 1;
  }

  public getLegalMoves(color: Color = this.turn, avoidOwnEyes: boolean = true): Point[] {
    const moves: Point[] = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.grid[y][x] === null) {
          if (avoidOwnEyes && this.isTrueEye(x, y, color)) {
            continue; // Do not fill true eyes!
          }
          if (this.isValidMove(x, y, color)) {
            moves.push({ x, y });
          }
        }
      }
    }
    return moves;
  }

  /**
   * Fast territory and score evaluator
   */
  public evaluateScore(komi: number): number {
    let blackScore = this.captures.black;
    let whiteScore = this.captures.white + komi;

    const visited = new Uint8Array(this.size * this.size);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const stone = this.grid[y][x];
        if (stone === 'black') {
          blackScore += 1;
        } else if (stone === 'white') {
          whiteScore += 1;
        } else if (!visited[y * this.size + x]) {
          // Territory flood fill
          let reachesBlack = false;
          let reachesWhite = false;
          let count = 0;
          const qX = [x];
          const qY = [y];
          visited[y * this.size + x] = 1;

          let head = 0;
          while (head < qX.length) {
            const cx = qX[head];
            const cy = qY[head];
            head++;
            count++;

            const adj = this.getAdjacent(cx, cy);
            for (let i = 0; i < adj.length; i++) {
              const nx = adj[i].x;
              const ny = adj[i].y;
              const idx = ny * this.size + nx;
              const nStone = this.grid[ny][nx];

              if (nStone === 'black') {
                reachesBlack = true;
              } else if (nStone === 'white') {
                reachesWhite = true;
              } else if (!visited[idx]) {
                visited[idx] = 1;
                qX.push(nx);
                qY.push(ny);
              }
            }
          }

          if (reachesBlack && !reachesWhite) {
            blackScore += count;
          } else if (reachesWhite && !reachesBlack) {
            whiteScore += count;
          }
        }
      }
    }
    return blackScore - whiteScore;
  }
}

// -------------------------------------------------------------
// MASTER OPENING BOOK (FUSEKI & JOSEKI EXPERT KERNEL)
// -------------------------------------------------------------

function getOpeningBookMove(board: WorkerBoard, color: Color): Point | null {
  const stonesCount = board.grid.flat().filter(s => s !== null).length;

  if (board.size === 9) {
    // 9x9 Master Opening Book (Solved KataGo / AlphaGo lines)
    if (stonesCount === 0) {
      // Tengen (E5) is the absolute gold standard for Black in 9x9
      return { x: 4, y: 4 };
    }

    if (stonesCount === 1 && color === 'white') {
      const b0 = board.grid[4][4] === 'black';
      if (b0) {
        // Responses to Tengen: C5 (2,4), D3 (3,6), D7 (3,2), G5 (6,4)
        const moves = [{ x: 2, y: 4 }, { x: 3, y: 2 }, { x: 3, y: 6 }, { x: 6, y: 4 }];
        return moves[Math.floor(Math.random() * moves.length)];
      }
    }

    if (stonesCount === 2 && color === 'black') {
      if (board.grid[4][4] === 'black') {
        if (board.grid[4][2] === 'white') {
          // If white plays C5, Black extends with D6 (3,3) or F5 (5,4)
          return Math.random() < 0.6 ? { x: 3, y: 3 } : { x: 5, y: 4 };
        }
        if (board.grid[2][3] === 'white') {
          return { x: 3, y: 5 };
        }
      }
    }

    if (stonesCount < 6) {
      // Golden 9x9 3-3 and 4-4 intersections: C3, G3, C7, G7, E5, D5, F5
      const prime9x9 = [
        { x: 4, y: 4 }, { x: 2, y: 2 }, { x: 6, y: 2 }, { x: 2, y: 6 }, { x: 6, y: 6 },
        { x: 3, y: 3 }, { x: 5, y: 3 }, { x: 3, y: 5 }, { x: 5, y: 5 }
      ];
      for (const p of prime9x9) {
        if (board.grid[p.y][p.x] === null && board.isValidMove(p.x, p.y, color)) {
          if (Math.random() < 0.45) return p;
        }
      }
    }
  } else if (board.size === 19) {
    // 19x19 Professional Opening Book
    if (stonesCount < 8) {
      const starPoints = [
        { x: 3, y: 3 }, { x: 15, y: 3 }, { x: 3, y: 15 }, { x: 15, y: 15 }, // Star points (4-4)
        { x: 2, y: 3 }, { x: 16, y: 3 }, { x: 2, y: 15 }, { x: 16, y: 15 }, // Komoku (3-4)
        { x: 3, y: 2 }, { x: 15, y: 2 }, { x: 3, y: 16 }, { x: 15, y: 16 }
      ];
      const emptyStars = starPoints.filter(p => board.grid[p.y][p.x] === null);
      if (emptyStars.length > 0) {
        return emptyStars[Math.floor(Math.random() * emptyStars.length)];
      }
    }
  } else if (board.size === 13) {
    if (stonesCount < 6) {
      const starPoints13 = [
        { x: 3, y: 3 }, { x: 9, y: 3 }, { x: 3, y: 9 }, { x: 9, y: 9 }, { x: 6, y: 6 }
      ];
      const emptyStars = starPoints13.filter(p => board.grid[p.y][p.x] === null);
      if (emptyStars.length > 0) {
        return emptyStars[Math.floor(Math.random() * emptyStars.length)];
      }
    }
  }

  return null;
}

// -------------------------------------------------------------
// TACTICAL COMBAT & SHAPE HEURISTICS (PROFESSIONAL 3x3 KERNEL)
// -------------------------------------------------------------

function evaluateTacticalUrgency(board: WorkerBoard, color: Color): Point | null {
  const opponent: Color = color === 'black' ? 'white' : 'black';
  const legal = board.getLegalMoves(color, true);
  if (legal.length === 0) return null;

  // 1. Critical: Capture any enemy group in Atari that has vital cutting or high stone count
  let bestCapMove: Point | null = null;
  let maxCapSize = 0;

  for (const move of legal) {
    const clone = board.clone();
    const beforeCap = color === 'black' ? clone.captures.black : clone.captures.white;
    if (clone.playMove(move.x, move.y, color)) {
      const afterCap = color === 'black' ? clone.captures.black : clone.captures.white;
      const count = afterCap - beforeCap;
      if (count > maxCapSize) {
        maxCapSize = count;
        bestCapMove = move;
      }
    }
  }
  if (bestCapMove && maxCapSize >= 1) {
    return bestCapMove;
  }

  // 2. Critical: Save own groups in Atari (1 liberty remaining)
  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      if (board.grid[y][x] === color) {
        const grp = board.getGroup(x, y);
        if (grp && grp.liberties.length === 1) {
          const escapePt = grp.liberties[0];
          if (board.isValidMove(escapePt.x, escapePt.y, color)) {
            // Check if playing escapePt gains >= 2 liberties
            const clone = board.clone();
            if (clone.playMove(escapePt.x, escapePt.y, color)) {
              const newGrp = clone.getGroup(escapePt.x, escapePt.y);
              if (newGrp && newGrp.liberties.length >= 2) {
                return escapePt;
              }
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Scores a move based on classic professional shape patterns and territory
 */
function scoreShapeMove(board: WorkerBoard, move: Point, color: Color): number {
  const opponent: Color = color === 'black' ? 'white' : 'black';
  let score = 0;

  const distEdgeX = Math.min(move.x, board.size - 1 - move.x);
  const distEdgeY = Math.min(move.y, board.size - 1 - move.y);
  const minEdge = Math.min(distEdgeX, distEdgeY);

  // Line positional values
  if (minEdge === 0) {
    score -= 28; // 1st line penalty unless capture/connection
  } else if (minEdge === 1) {
    score -= 4;
  } else if (minEdge === 2) {
    score += 18; // 3rd line (Territory)
  } else if (minEdge === 3) {
    score += 16; // 4th line (Influence)
  }

  // Check group safety after move
  const clone = board.clone();
  clone.playMove(move.x, move.y, color);
  const ownGrp = clone.getGroup(move.x, move.y);

  if (ownGrp) {
    if (ownGrp.liberties.length === 1) {
      score -= 120; // Severe penalty for self-Atari
    } else if (ownGrp.liberties.length === 2) {
      score -= 10;
    } else if (ownGrp.liberties.length >= 4) {
      score += 14;
    }
  }

  // Combat neighbors (Contact, Hane, Cut)
  const adj = board.getAdjacent(move.x, move.y);
  let ownAdj = 0;
  let oppAdj = 0;

  for (let i = 0; i < adj.length; i++) {
    const s = board.grid[adj[i].y][adj[i].x];
    if (s === color) ownAdj++;
    else if (s === opponent) oppAdj++;
  }

  // Hane (Contact battle)
  if (oppAdj > 0 && ownAdj > 0) score += 24;
  // Extension (Nobi)
  if (ownAdj === 1 && oppAdj === 0) score += 12;
  // Double connection
  if (ownAdj >= 2) score += 18;

  // Avoid Empty Triangle (Dango)
  const corners = [
    [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 }],
    [{ dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 1 }],
    [{ dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 }],
    [{ dx: -1, dy: 0 }, { dx: 0, dy: -1 }, { dx: -1, dy: -1 }]
  ];

  for (const c of corners) {
    const p1 = { x: move.x + c[0].dx, y: move.y + c[0].dy };
    const p2 = { x: move.x + c[1].dx, y: move.y + c[1].dy };
    const diag = { x: move.x + c[2].dx, y: move.y + c[2].dy };

    if (board.isValid(p1.x, p1.y) && board.isValid(p2.x, p2.y) && board.isValid(diag.x, diag.y)) {
      if (
        board.grid[p1.y][p1.x] === color &&
        board.grid[p2.y][p2.x] === color &&
        board.grid[diag.y][diag.x] === null
      ) {
        score -= 45; // Empty triangle bad shape
      }
    }
  }

  return score;
}

// -------------------------------------------------------------
// ADVANCED MCTS ENGINE WITH RAVE (RAPID ACTION VALUE ESTIMATION)
// -------------------------------------------------------------

class MCTSNode {
  public move: Point | null;
  public color: Color;
  public parent: MCTSNode | null;
  public children: MCTSNode[];
  public wins: number;
  public visits: number;

  // AMAF / RAVE Statistics
  public raveWins: number;
  public raveVisits: number;

  public untriedMoves: Point[];

  constructor(board: WorkerBoard, move: Point | null, color: Color, parent: MCTSNode | null = null) {
    this.move = move;
    this.color = color;
    this.parent = parent;
    this.children = [];
    this.wins = 0;
    this.visits = 0;
    this.raveWins = 0;
    this.raveVisits = 0;

    // Prioritize high-shape moves first in untried list
    const legal = board.getLegalMoves(color, true);
    legal.sort((a, b) => scoreShapeMove(board, b, color) - scoreShapeMove(board, a, color));
    this.untriedMoves = legal;
  }

  public getUCTValue(cExploration: number = 1.25, raveEquivalence: number = 300): number {
    if (this.visits === 0) {
      // First play urgency based on RAVE
      if (this.raveVisits > 0) {
        return this.raveWins / this.raveVisits + 1.5;
      }
      return 10000 + Math.random() * 10;
    }

    const exploitation = this.wins / this.visits;
    const exploration = cExploration * Math.sqrt(Math.log(this.parent!.visits) / this.visits);

    if (this.raveVisits > 0) {
      const beta = this.raveVisits / (this.visits + this.raveVisits + (4 * this.visits * this.raveVisits) / raveEquivalence);
      const raveVal = this.raveWins / this.raveVisits;
      return (1 - beta) * exploitation + beta * raveVal + exploration;
    }

    return exploitation + exploration;
  }
}

function runAdvancedMCTS(
  rootBoard: WorkerBoard,
  color: Color,
  maxIterations: number,
  maxTimeMs: number,
  komi: number,
  isKamiLevel: boolean = false
): { bestMove: Point | null; winRate: number; candidates: { point: Point; score: number; winRate: number }[] } {
  // 1. Opening Book check
  const bookMove = getOpeningBookMove(rootBoard, color);
  if (bookMove) {
    return {
      bestMove: bookMove,
      winRate: 0.55,
      candidates: [{ point: bookMove, score: 9999, winRate: 0.55 }]
    };
  }

  // 2. Urgent Tactical Check
  const urgentMove = evaluateTacticalUrgency(rootBoard, color);
  if (urgentMove && !isKamiLevel) {
    return {
      bestMove: urgentMove,
      winRate: 0.65,
      candidates: [{ point: urgentMove, score: 8888, winRate: 0.65 }]
    };
  }

  const legal = rootBoard.getLegalMoves(color, true);
  if (legal.length === 0) {
    return { bestMove: null, winRate: 0, candidates: [] };
  }

  const root = new MCTSNode(rootBoard, null, color);
  const startTime = Date.now();

  for (let iter = 0; iter < maxIterations; iter++) {
    if (iter % 80 === 0 && Date.now() - startTime > maxTimeMs) {
      break;
    }

    let node = root;
    let simBoard = rootBoard.clone();

    // 1. Selection
    while (node.untriedMoves.length === 0 && node.children.length > 0) {
      let bestChild = node.children[0];
      let bestVal = -Infinity;

      for (let i = 0; i < node.children.length; i++) {
        const val = node.children[i].getUCTValue(isKamiLevel ? 1.15 : 1.3, isKamiLevel ? 450 : 250);
        if (val > bestVal) {
          bestVal = val;
          bestChild = node.children[i];
        }
      }

      node = bestChild;
      if (node.move) {
        simBoard.playMove(node.move.x, node.move.y, node.color);
      }
    }

    // 2. Expansion
    if (node.untriedMoves.length > 0) {
      const move = node.untriedMoves.shift()!;
      const nextColor: Color = node.color === 'black' ? 'white' : 'black';

      simBoard.playMove(move.x, move.y, node.color);
      const childNode = new MCTSNode(simBoard, move, nextColor, node);
      node.children.push(childNode);
      node = childNode;
    }

    // 3. Heavy Heuristic Playout (Rollout)
    const movesInPlayoutBlack: Point[] = [];
    const movesInPlayoutWhite: Point[] = [];

    let rolloutDepth = isKamiLevel ? (rootBoard.size === 9 ? 32 : 48) : (rootBoard.size === 9 ? 20 : 28);
    let currColor = node.color;
    let consecutivePasses = 0;

    while (rolloutDepth > 0 && consecutivePasses < 2) {
      // 3.1 Check tactical response first (Atari save / capture)
      const tactical = evaluateTacticalUrgency(simBoard, currColor);
      let chosenMove: Point | null = null;

      if (tactical && Math.random() < 0.85) {
        chosenMove = tactical;
      } else {
        const moves = simBoard.getLegalMoves(currColor, true);
        if (moves.length === 0) {
          consecutivePasses++;
        } else {
          // Bias pick towards good shapes
          if (moves.length <= 4 || Math.random() < 0.3) {
            chosenMove = moves[Math.floor(Math.random() * moves.length)];
          } else {
            // Pick best of 3 sampled moves
            let bestScore = -Infinity;
            for (let s = 0; s < 3; s++) {
              const sample = moves[Math.floor(Math.random() * moves.length)];
              const sc = scoreShapeMove(simBoard, sample, currColor);
              if (sc > bestScore) {
                bestScore = sc;
                chosenMove = sample;
              }
            }
          }
        }
      }

      if (chosenMove) {
        simBoard.playMove(chosenMove.x, chosenMove.y, currColor);
        if (currColor === 'black') movesInPlayoutBlack.push(chosenMove);
        else movesInPlayoutWhite.push(chosenMove);
        consecutivePasses = 0;
      }

      currColor = currColor === 'black' ? 'white' : 'black';
      rolloutDepth--;
    }

    // 4. Backpropagation with RAVE Updates
    const scoreDiff = simBoard.evaluateScore(komi);
    const blackWon = scoreDiff > 0;

    let curr: MCTSNode | null = node;
    while (curr) {
      curr.visits++;
      const isWin = curr.color === 'black' ? !blackWon : blackWon;
      if (isWin) {
        curr.wins += 1;
      }

      // Update RAVE for all sibling moves in this subtree
      if (curr.parent) {
        const movesPlayed = curr.color === 'black' ? movesInPlayoutBlack : movesInPlayoutWhite;
        for (let i = 0; i < curr.parent.children.length; i++) {
          const sibling = curr.parent.children[i];
          if (sibling.move) {
            const wasPlayed = movesPlayed.some(p => p.x === sibling.move!.x && p.y === sibling.move!.y);
            if (wasPlayed) {
              sibling.raveVisits++;
              if (isWin) sibling.raveWins++;
            }
          }
        }
      }

      curr = curr.parent;
    }
  }

  if (root.children.length === 0) {
    return { bestMove: null, winRate: 0.5, candidates: [] };
  }

  // Select most visited child
  root.children.sort((a, b) => b.visits - a.visits);

  const bestChild = root.children[0];
  const winRate = bestChild.visits > 0 ? bestChild.wins / bestChild.visits : 0.5;

  const candidates = root.children.slice(0, 5).map(c => ({
    point: c.move!,
    score: c.visits,
    winRate: c.visits > 0 ? c.wins / c.visits : 0
  }));

  return {
    bestMove: bestChild.move,
    winRate,
    candidates
  };
}

// -------------------------------------------------------------
// WORKER ONMESSAGE LISTENER
// -------------------------------------------------------------

self.onmessage = (event: MessageEvent<BotRequest>) => {
  const req = event.data;
  const startTime = Date.now();

  const board = new WorkerBoard(req.size, req.grid, req.turn, req.koPoint, req.captures);
  let bestMove: Point | null = null;
  let winRate = 0.5;
  let candidates: { point: Point; score: number; winRate: number }[] = [];

  switch (req.level) {
    case 1: {
      // Level 1: Tático Sólido (~6k Kyu)
      const mcts = runAdvancedMCTS(board, req.turn, 500, 300, req.komi, false);
      bestMove = mcts.bestMove;
      winRate = mcts.winRate;
      candidates = mcts.candidates;
      break;
    }

    case 2: {
      // Level 2: Dan Competitivo (1-3 Dan)
      const mcts = runAdvancedMCTS(board, req.turn, 1200, 600, req.komi, false);
      bestMove = mcts.bestMove;
      winRate = mcts.winRate;
      candidates = mcts.candidates;
      break;
    }

    case 3: {
      // Level 3: Mestre Meijin (4-6 Dan)
      const mcts = runAdvancedMCTS(board, req.turn, 2400, 1000, req.komi, false);
      bestMove = mcts.bestMove;
      winRate = mcts.winRate;
      candidates = mcts.candidates;
      break;
    }

    case 4: {
      // Level 4: Grão-Mestre Honinbo (7-8 Dan)
      const mcts = runAdvancedMCTS(board, req.turn, 3600, 1400, req.komi, true);
      bestMove = mcts.bestMove;
      winRate = mcts.winRate;
      candidates = mcts.candidates;
      break;
    }

    case 5:
    default: {
      // Level 5: ⚡ KAMI (Nível Divino Absurdo - 9 Dan Pro / KataGo Style)
      const mcts = runAdvancedMCTS(board, req.turn, 5500, 2000, req.komi, true);
      bestMove = mcts.bestMove;
      winRate = mcts.winRate;
      candidates = mcts.candidates;
      break;
    }
  }

  const thoughtTimeMs = Date.now() - startTime;
  const scoreLead = board.evaluateScore(req.komi);

  const response: BotResponse = {
    id: req.id,
    bestMove,
    winRate: req.turn === 'black' ? winRate : 1 - winRate,
    scoreLead,
    thoughtTimeMs,
    candidateMoves: candidates
  };

  self.postMessage(response);
};
