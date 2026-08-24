import { BoardSize, Color, Move, Point, StoneState } from '../types/go';

export interface Group {
  points: Point[];
  liberties: Set<string>;
  color: Color;
}

interface BoardSnapshot {
  grid: StoneState[][];
  turn: Color;
  captures: { black: number; white: number };
  lastMove: Move | null;
  koPoint: Point | null;
  consecutivePasses: number;
  isGameOver: boolean;
  hash: number;
}

/**
 * Zobrist keys per board size, used for positional superko detection.
 * Generated from a fixed seed so a position always hashes the same way.
 */
const ZOBRIST_CACHE = new Map<number, Int32Array>();

function getZobrist(size: number): Int32Array {
  let keys = ZOBRIST_CACHE.get(size);
  if (keys) return keys;

  const total = size * size;
  keys = new Int32Array(total * 2);
  let state = (0x1f123bb5 ^ size) | 0;
  for (let i = 0; i < keys.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    keys[i] = state;
  }
  ZOBRIST_CACHE.set(size, keys);
  return keys;
}

export class GoBoard {
  public size: BoardSize;
  public grid: StoneState[][];
  public turn: Color;
  public captures: { black: number; white: number };
  public consecutivePasses: number;
  public history: BoardSnapshot[];
  public movesList: Move[];
  public lastMove: Move | null;
  public koPoint: Point | null;
  public isGameOver: boolean;

  /** Stones placed before the first move (handicap, or AB/AW from an SGF). */
  public setupStones: { x: number; y: number; color: Color }[];

  private zobrist: Int32Array;
  /** Zobrist hash of the current position, for superko. */
  public hash: number;
  /** Every position that has already occurred, keyed by hash. */
  private seenPositions: Set<number>;

  constructor(size: BoardSize = 19) {
    this.size = size;
    this.zobrist = getZobrist(size);
    this.grid = GoBoard.emptyGrid(size);
    this.turn = 'black';
    this.captures = { black: 0, white: 0 };
    this.consecutivePasses = 0;
    this.history = [];
    this.movesList = [];
    this.lastMove = null;
    this.koPoint = null;
    this.isGameOver = false;
    this.setupStones = [];
    this.hash = 0;
    this.seenPositions = new Set([0]);
  }

  private static emptyGrid(size: number): StoneState[][] {
    return Array.from({ length: size }, () => Array(size).fill(null) as StoneState[]);
  }

  private zobristKey(x: number, y: number, color: Color): number {
    return this.zobrist[(color === 'black' ? 0 : 1) * this.size * this.size + y * this.size + x];
  }

  public clone(): GoBoard {
    const copy = new GoBoard(this.size);
    for (let y = 0; y < this.size; y++) {
      copy.grid[y] = [...this.grid[y]];
    }
    copy.turn = this.turn;
    copy.captures = { ...this.captures };
    copy.consecutivePasses = this.consecutivePasses;
    copy.lastMove = this.lastMove ? { ...this.lastMove } : null;
    copy.koPoint = this.koPoint ? { ...this.koPoint } : null;
    copy.isGameOver = this.isGameOver;
    copy.movesList = this.movesList.map(m => ({ ...m }));
    copy.setupStones = this.setupStones.map(s => ({ ...s }));
    copy.hash = this.hash;
    copy.seenPositions = new Set(this.seenPositions);
    return copy;
  }

  public reset(size: BoardSize = this.size): void {
    this.size = size;
    this.zobrist = getZobrist(size);
    this.grid = GoBoard.emptyGrid(size);
    this.turn = 'black';
    this.captures = { black: 0, white: 0 };
    this.consecutivePasses = 0;
    this.history = [];
    this.movesList = [];
    this.lastMove = null;
    this.koPoint = null;
    this.isGameOver = false;
    this.setupStones = [];
    this.hash = 0;
    this.seenPositions = new Set([0]);
  }

  public get(x: number, y: number): StoneState {
    return this.isValidCoord(x, y) ? this.grid[y][x] : null;
  }

  public isValidCoord(x: number, y: number): boolean {
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

  /**
   * Places stones directly, outside the move sequence. Used for handicap and
   * for the AB/AW setup properties of an imported SGF, so a game can be
   * replayed exactly without those stones counting as moves.
   */
  public placeSetupStones(stones: { x: number; y: number; color: Color }[], turn?: Color): void {
    for (const s of stones) {
      if (!this.isValidCoord(s.x, s.y)) continue;
      const existing = this.grid[s.y][s.x];
      if (existing) this.hash ^= this.zobristKey(s.x, s.y, existing);
      this.grid[s.y][s.x] = s.color;
      this.hash ^= this.zobristKey(s.x, s.y, s.color);
      this.setupStones.push({ ...s });
    }
    if (turn) this.turn = turn;
    this.seenPositions = new Set([this.hash]);
  }

  public getGroup(startX: number, startY: number): Group | null {
    const color = this.get(startX, startY);
    if (!color) return null;

    const size = this.size;
    const visited = new Uint8Array(size * size);
    const points: Point[] = [];
    const liberties = new Set<string>();
    // A stack with an index beats Array.shift(), which is O(n) per call and
    // made this quadratic on large groups.
    const stack: number[] = [startY * size + startX];
    visited[startY * size + startX] = 1;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % size;
      const y = (idx - x) / size;
      points.push({ x, y });

      for (const next of this.getAdjacent(x, y)) {
        const nIdx = next.y * size + next.x;
        const nextColor = this.grid[next.y][next.x];
        if (nextColor === null) {
          liberties.add(`${next.x},${next.y}`);
        } else if (nextColor === color && !visited[nIdx]) {
          visited[nIdx] = 1;
          stack.push(nIdx);
        }
      }
    }

    return { points, liberties, color };
  }

  /**
   * Validates a move under the rules used by the app: no suicide, no simple ko,
   * and no positional superko (repeating any earlier whole-board position).
   */
  public isValidMove(x: number, y: number, color: Color = this.turn): { valid: boolean; reason?: string } {
    if (this.isGameOver) return { valid: false, reason: 'O jogo já acabou.' };
    if (!this.isValidCoord(x, y)) return { valid: false, reason: 'Posição fora do tabuleiro.' };
    if (this.grid[y][x] !== null) return { valid: false, reason: 'Posição já ocupada.' };

    if (this.koPoint && this.koPoint.x === x && this.koPoint.y === y) {
      return { valid: false, reason: 'Regra do Ko: repetição imediata de posição proibida.' };
    }

    const sim = this.simulate(x, y, color);
    if (!sim.legal) {
      return { valid: false, reason: 'Suicídio proibido: jogada sem liberdades.' };
    }
    if (this.seenPositions.has(sim.hash)) {
      return { valid: false, reason: 'Superko: essa posição já ocorreu na partida.' };
    }

    return { valid: true };
  }

  /**
   * Applies a move to a scratch copy of the grid and reports the result,
   * without touching the real board state.
   */
  private simulate(
    x: number,
    y: number,
    color: Color
  ): { legal: boolean; hash: number; captured: Point[] } {
    const opponent: Color = color === 'black' ? 'white' : 'black';
    const captured: Point[] = [];

    const original = this.grid[y][x];
    this.grid[y][x] = color;
    let hash = this.hash ^ this.zobristKey(x, y, color);

    const seenGroup = new Set<string>();
    for (const n of this.getAdjacent(x, y)) {
      if (this.grid[n.y][n.x] !== opponent) continue;
      const key = `${n.x},${n.y}`;
      if (seenGroup.has(key)) continue;
      const group = this.getGroup(n.x, n.y);
      if (!group) continue;
      for (const pt of group.points) seenGroup.add(`${pt.x},${pt.y}`);
      if (group.liberties.size === 0) captured.push(...group.points);
    }

    // Remove captures before measuring the played stone's own liberties.
    for (const pt of captured) this.grid[pt.y][pt.x] = null;

    const own = this.getGroup(x, y);
    const legal = own !== null && own.liberties.size > 0;

    for (const pt of captured) {
      this.grid[pt.y][pt.x] = opponent;
      hash ^= this.zobristKey(pt.x, pt.y, opponent);
    }
    this.grid[y][x] = original;

    return { legal, hash, captured };
  }

  public playMove(x: number, y: number, color: Color = this.turn): { success: boolean; move?: Move; reason?: string } {
    const check = this.isValidMove(x, y, color);
    if (!check.valid) return { success: false, reason: check.reason };

    this.saveState();

    const opponent: Color = color === 'black' ? 'white' : 'black';
    this.grid[y][x] = color;
    this.hash ^= this.zobristKey(x, y, color);

    const captured: Point[] = [];
    const visitedGroups = new Set<string>();

    for (const n of this.getAdjacent(x, y)) {
      if (this.grid[n.y][n.x] !== opponent) continue;
      const key = `${n.x},${n.y}`;
      if (visitedGroups.has(key)) continue;

      const group = this.getGroup(n.x, n.y);
      if (!group) continue;
      for (const pt of group.points) visitedGroups.add(`${pt.x},${pt.y}`);
      if (group.liberties.size > 0) continue;

      for (const stone of group.points) {
        this.grid[stone.y][stone.x] = null;
        this.hash ^= this.zobristKey(stone.x, stone.y, opponent);
        captured.push(stone);
      }
    }

    if (color === 'black') this.captures.black += captured.length;
    else this.captures.white += captured.length;

    // Simple ko: a single stone captured by a lone stone left with one liberty.
    const ownGroup = this.getGroup(x, y);
    if (captured.length === 1 && ownGroup && ownGroup.points.length === 1 && ownGroup.liberties.size === 1) {
      this.koPoint = { x: captured[0].x, y: captured[0].y };
    } else {
      this.koPoint = null;
    }

    this.seenPositions.add(this.hash);

    const moveObj: Move = { x, y, color, captured, moveNumber: this.movesList.length + 1 };
    this.lastMove = moveObj;
    this.movesList.push(moveObj);
    this.consecutivePasses = 0;
    this.turn = opponent;

    return { success: true, move: moveObj };
  }

  public pass(color: Color = this.turn): Move {
    this.saveState();
    this.koPoint = null;
    this.consecutivePasses++;

    const moveObj: Move = { x: -1, y: -1, color, pass: true, moveNumber: this.movesList.length + 1 };
    this.lastMove = moveObj;
    this.movesList.push(moveObj);
    this.turn = color === 'black' ? 'white' : 'black';

    if (this.consecutivePasses >= 2) this.isGameOver = true;
    return moveObj;
  }

  public resign(color: Color = this.turn): Move {
    this.saveState();
    const moveObj: Move = { x: -1, y: -1, color, resign: true, moveNumber: this.movesList.length + 1 };
    this.lastMove = moveObj;
    this.movesList.push(moveObj);
    this.isGameOver = true;
    return moveObj;
  }

  public undo(): boolean {
    if (this.history.length === 0) return false;

    const prev = this.history.pop()!;
    this.grid = prev.grid.map(row => [...row]);
    this.turn = prev.turn;
    this.captures = { ...prev.captures };
    this.lastMove = prev.lastMove ? { ...prev.lastMove } : null;
    this.koPoint = prev.koPoint ? { ...prev.koPoint } : null;
    this.consecutivePasses = prev.consecutivePasses;
    this.isGameOver = prev.isGameOver;
    this.hash = prev.hash;
    this.movesList.pop();

    // Rebuild the superko set: a position undone must become playable again.
    this.seenPositions = new Set([prev.hash]);
    for (const snap of this.history) this.seenPositions.add(snap.hash);

    return true;
  }

  private saveState(): void {
    this.history.push({
      grid: this.grid.map(row => [...row]),
      turn: this.turn,
      captures: { ...this.captures },
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      koPoint: this.koPoint ? { ...this.koPoint } : null,
      consecutivePasses: this.consecutivePasses,
      isGameOver: this.isGameOver,
      hash: this.hash
    });
  }

  /**
   * Standard handicap placement. The order follows the usual convention:
   * top-right and bottom-left first, then bottom-right and top-left, then the
   * side points, with tengen added for odd counts.
   */
  public setHandicap(numStones: number): void {
    if (numStones < 2 || numStones > 9) return;
    this.reset(this.size);

    const s = this.size;
    const edge = s === 19 ? 3 : s === 13 ? 3 : 2;
    const far = s - 1 - edge;
    const mid = (s - 1) / 2;

    const topRight = { x: far, y: edge };
    const bottomLeft = { x: edge, y: far };
    const topLeft = { x: edge, y: edge };
    const bottomRight = { x: far, y: far };
    const left = { x: edge, y: mid };
    const right = { x: far, y: mid };
    const top = { x: mid, y: edge };
    const bottom = { x: mid, y: far };
    const tengen = { x: mid, y: mid };

    let points: Point[];
    switch (numStones) {
      case 2: points = [topRight, bottomLeft]; break;
      case 3: points = [topRight, bottomLeft, bottomRight]; break;
      case 4: points = [topRight, bottomLeft, bottomRight, topLeft]; break;
      case 5: points = [topRight, bottomLeft, bottomRight, topLeft, tengen]; break;
      case 6: points = [topRight, bottomLeft, bottomRight, topLeft, left, right]; break;
      case 7: points = [topRight, bottomLeft, bottomRight, topLeft, left, right, tengen]; break;
      case 8: points = [topRight, bottomLeft, bottomRight, topLeft, left, right, top, bottom]; break;
      default: points = [topRight, bottomLeft, bottomRight, topLeft, left, right, top, bottom, tengen]; break;
    }

    this.placeSetupStones(
      points.map(p => ({ x: p.x, y: p.y, color: 'black' as Color })),
      'white' // White moves first in a handicap game.
    );
  }

  public getLegalMoves(color: Color = this.turn): Point[] {
    const legal: Point[] = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.grid[y][x] === null && this.isValidMove(x, y, color).valid) {
          legal.push({ x, y });
        }
      }
    }
    return legal;
  }

  public getAllGroups(): Group[] {
    const groups: Group[] = [];
    const size = this.size;
    const visited = new Uint8Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        if (this.grid[y][x] === null || visited[idx]) continue;
        const grp = this.getGroup(x, y);
        if (!grp) continue;
        for (const pt of grp.points) visited[pt.y * size + pt.x] = 1;
        groups.push(grp);
      }
    }
    return groups;
  }

  public getHoshiPoints(): Point[] {
    const s = this.size;
    const edge = s === 19 ? 3 : s === 13 ? 3 : 2;
    const mid = (s - 1) / 2;
    const far = s - 1 - edge;

    if (s === 19) {
      const coords = [edge, mid, far];
      const pts: Point[] = [];
      for (const y of coords) {
        for (const x of coords) pts.push({ x, y });
      }
      return pts;
    }

    return [
      { x: edge, y: edge },
      { x: far, y: edge },
      { x: mid, y: mid },
      { x: edge, y: far },
      { x: far, y: far }
    ];
  }
}
