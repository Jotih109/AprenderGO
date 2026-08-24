import { BoardSize, Color, Point, StoneState } from '../types/go';

// -------------------------------------------------------------
// MESSAGE CONTRACT BETWEEN MAIN THREAD AND WEB WORKER
// -------------------------------------------------------------

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
  /** True when the previous move was a pass, so the engine may close out a won game. */
  opponentPassed?: boolean;
  /** Overrides the level default thinking time. Used by the post-game reviewer. */
  timeBudgetMs?: number;
  /** Deterministic seed: the same seed and position always produce the same move. */
  seed?: number;
}

export interface BotResponse {
  id: number;
  bestMove: Point | null; // null means PASS
  /** Win rate of the recommended move, 0..1, always from the BLACK perspective. */
  winRate: number;
  /**
   * Value of the position itself: the visit-weighted average over all root
   * moves, again from the BLACK perspective.
   *
   * `winRate` is the value of the *best* child, which is the maximum of a set
   * of noisy estimates and therefore biased upward. Comparing two positions
   * with it makes every move look like a loss — measured at -11 percentage
   * points on average over real games. The weighted average carries the same
   * optimism on both sides of a comparison, so the bias cancels, which is what
   * the post-game reviewer needs.
   */
  positionWinRate: number;
  scoreLead: number; // Tromp-Taylor area lead for Black, komi included
  thoughtTimeMs: number;
  playouts: number;
  candidateMoves?: { point: Point; score: number; winRate: number }[];
}

// -------------------------------------------------------------
// DETERMINISTIC RNG (xorshift32, several times faster than Math.random)
// -------------------------------------------------------------

let rngState = 0x9e3779b9;

function seedRng(seed: number): void {
  rngState = (seed | 0) || 0x9e3779b9;
}

function rnd(): number {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  rngState |= 0;
  return (rngState >>> 0) / 4294967296;
}

/** Uniform integer in the range [0, n). */
function rndInt(n: number): number {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  rngState |= 0;
  return (rngState >>> 0) % n;
}

// -------------------------------------------------------------
// PRECOMPUTED TOPOLOGY (FLAT TYPED ARRAYS, SHARED PER BOARD SIZE)
// -------------------------------------------------------------

export interface Topology {
  size: number;
  total: number;
  /** Four orthogonal neighbours per point, padded with -1, stride 4. */
  adj: Int32Array;
  adjN: Uint8Array;
  /** Four diagonal neighbours per point, padded with -1, stride 4. */
  diag: Int32Array;
  diagN: Uint8Array;
  /** Distance to the nearest edge; 0 means the first line. */
  distEdge: Uint8Array;
  isStar: Uint8Array;
  /** Zobrist keys indexed as colorSlot * total + idx. */
  zobrist: Int32Array;
}

const TOPOLOGY_CACHE = new Map<number, Topology>();

function getTopology(size: number): Topology {
  const cached = TOPOLOGY_CACHE.get(size);
  if (cached) return cached;

  const total = size * size;
  const adj = new Int32Array(total * 4).fill(-1);
  const adjN = new Uint8Array(total);
  const diag = new Int32Array(total * 4).fill(-1);
  const diagN = new Uint8Array(total);
  const distEdge = new Uint8Array(total);
  const isStar = new Uint8Array(total);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      distEdge[idx] = Math.min(Math.min(x, size - 1 - x), Math.min(y, size - 1 - y));

      let a = 0;
      if (y > 0) adj[idx * 4 + a++] = idx - size;
      if (y < size - 1) adj[idx * 4 + a++] = idx + size;
      if (x > 0) adj[idx * 4 + a++] = idx - 1;
      if (x < size - 1) adj[idx * 4 + a++] = idx + 1;
      adjN[idx] = a;

      let d = 0;
      if (x > 0 && y > 0) diag[idx * 4 + d++] = idx - size - 1;
      if (x < size - 1 && y > 0) diag[idx * 4 + d++] = idx - size + 1;
      if (x > 0 && y < size - 1) diag[idx * 4 + d++] = idx + size - 1;
      if (x < size - 1 && y < size - 1) diag[idx * 4 + d++] = idx + size + 1;
      diagN[idx] = d;
    }
  }

  const starCoords = size === 19 ? [3, 9, 15] : size === 13 ? [3, 6, 9] : size === 9 ? [2, 4, 6] : [];
  for (const cy of starCoords) {
    for (const cx of starCoords) {
      if (size !== 19) {
        // Smaller boards only mark the four corners plus tengen.
        const mid = starCoords[1];
        const isCenter = cy === mid && cx === mid;
        const isCorner = cy !== mid && cx !== mid;
        if (!isCenter && !isCorner) continue;
      }
      isStar[cy * size + cx] = 1;
    }
  }

  // Zobrist keys from a fixed seed so hashes stay reproducible across runs.
  const savedState = rngState;
  seedRng(0x5deece66 ^ size);
  const zobrist = new Int32Array(total * 2);
  for (let i = 0; i < zobrist.length; i++) {
    zobrist[i] = (rnd() * 0x100000000) | 0;
  }
  rngState = savedState;

  const topo: Topology = { size, total, adj, adjN, diag, diagN, distEdge, isStar, zobrist };
  TOPOLOGY_CACHE.set(size, topo);
  return topo;
}

// -------------------------------------------------------------
// ZERO-ALLOCATION FLAT BOARD
// -------------------------------------------------------------

const EMPTY = 0;
const BLACK = 1;
const WHITE = -1;

/**
 * Scratch buffers shared by every board of a given size. Every routine that
 * touches them runs to completion before another can start, so sharing is safe
 * and it removes all per-simulation allocation. The previous engine allocated
 * several full-board typed arrays per liberty count, which is why it managed
 * only a handful of playouts per move.
 */
interface Scratch {
  visited: Int32Array;
  visitedGen: number;
  libSeen: Int32Array;
  libSeenGen: number;
  stack: Int32Array;
  groupBuf: Int32Array;
  libBuf: Int32Array;
  scoreSeen: Int32Array;
  scoreSeenGen: number;
  out: Int32Array;
  capBuf: Int32Array;
}

const SCRATCH_CACHE = new Map<number, Scratch>();

function getScratch(total: number): Scratch {
  let s = SCRATCH_CACHE.get(total);
  if (!s) {
    s = {
      visited: new Int32Array(total),
      visitedGen: 0,
      libSeen: new Int32Array(total),
      libSeenGen: 0,
      stack: new Int32Array(total),
      groupBuf: new Int32Array(total),
      libBuf: new Int32Array(total),
      scoreSeen: new Int32Array(total),
      scoreSeenGen: 0,
      out: new Int32Array(4),
      capBuf: new Int32Array(4)
    };
    SCRATCH_CACHE.set(total, s);
  }
  return s;
}

export class FastBoard {
  public size: number;
  public total: number;
  public grid: Int8Array;
  public turnColor: number;
  public koIdx: number;
  public capturesBlack: number;
  public capturesWhite: number;
  public lastMoveIdx: number;
  public passCount: number;
  public hash: number;
  public stoneCount: number;

  public topo: Topology;
  private scratch: Scratch;

  /** Dense list of empty intersections plus a reverse index for O(1) removal. */
  private empties: Int32Array;
  private emptyPos: Int32Array;
  public emptyCount: number;

  // -------------------------------------------------------
  // GROUP INDEX (union-find with pseudo-liberties)
  //
  // Pseudo-liberties count every (stone, adjacent empty point) incidence, so a
  // shared liberty is counted once per stone touching it. Keeping the count,
  // the sum of liberty indices and the sum of their squares makes "is this
  // group in atari" and "where is its last liberty" exact O(1) tests, by
  // Cauchy-Schwarz: sum^2 == count * sumOfSquares exactly when every
  // pseudo-liberty points at the same intersection. This is what turns the
  // playout policy from O(group size) per candidate move into O(1).
  // -------------------------------------------------------
  private ufParent: Int32Array;
  private gSize: Int32Array;
  private pLibs: Int32Array;
  private libSum: Int32Array;
  private libSumSq: Int32Array;
  /** Circular linked list of the stones in a group, spliced in O(1) on union. */
  private nextStone: Int32Array;

  constructor(size: number) {
    this.size = size;
    this.total = size * size;
    this.topo = getTopology(size);
    this.scratch = getScratch(this.total);
    this.grid = new Int8Array(this.total);
    this.empties = new Int32Array(this.total);
    this.emptyPos = new Int32Array(this.total);
    this.ufParent = new Int32Array(this.total);
    this.gSize = new Int32Array(this.total);
    this.pLibs = new Int32Array(this.total);
    this.libSum = new Int32Array(this.total);
    this.libSumSq = new Int32Array(this.total);
    this.nextStone = new Int32Array(this.total);
    this.turnColor = BLACK;
    this.koIdx = -1;
    this.capturesBlack = 0;
    this.capturesWhite = 0;
    this.lastMoveIdx = -1;
    this.passCount = 0;
    this.hash = 0;
    this.stoneCount = 0;
    this.emptyCount = 0;
    this.rebuildState();
  }

  /** Rebuilds the empty list and the whole group index from `grid`. */
  private rebuildState(): void {
    const total = this.total;
    this.emptyCount = 0;
    for (let i = 0; i < total; i++) {
      if (this.grid[i] === EMPTY) {
        this.emptyPos[i] = this.emptyCount;
        this.empties[this.emptyCount++] = i;
      } else {
        this.emptyPos[i] = -1;
      }
      this.ufParent[i] = i;
      this.nextStone[i] = i;
      this.gSize[i] = 1;
      this.pLibs[i] = 0;
      this.libSum[i] = 0;
      this.libSumSq[i] = 0;
    }
    this.stoneCount = total - this.emptyCount;

    const adj = this.topo.adj;
    const adjN = this.topo.adjN;

    // Merge adjacent same-colour stones while all liberty counters are zero.
    for (let i = 0; i < total; i++) {
      const v = this.grid[i];
      if (v === EMPTY) continue;
      const base = i * 4;
      const n = adjN[i];
      for (let k = 0; k < n; k++) {
        const nIdx = adj[base + k];
        if (this.grid[nIdx] === v) this.unite(i, nIdx);
      }
    }

    // Then accumulate one pseudo-liberty per (stone, empty neighbour) pair.
    for (let i = 0; i < total; i++) {
      if (this.grid[i] === EMPTY) continue;
      const root = this.find(i);
      const base = i * 4;
      const n = adjN[i];
      for (let k = 0; k < n; k++) {
        const nIdx = adj[base + k];
        if (this.grid[nIdx] === EMPTY) this.addLiberty(root, nIdx);
      }
    }
  }

  private find(i: number): number {
    const p = this.ufParent;
    let root = i;
    while (p[root] !== root) root = p[root];
    // Path halving keeps the structure flat without a second pass.
    while (p[i] !== root) {
      const next = p[i];
      p[i] = root;
      i = next;
    }
    return root;
  }

  private addLiberty(root: number, p: number): void {
    this.pLibs[root]++;
    this.libSum[root] += p;
    this.libSumSq[root] += p * p;
  }

  private removeLiberty(root: number, p: number): void {
    this.pLibs[root]--;
    this.libSum[root] -= p;
    this.libSumSq[root] -= p * p;
  }

  /** Merges the two groups, returning the surviving root. */
  private unite(a: number, b: number): number {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return ra;
    if (this.gSize[ra] < this.gSize[rb]) {
      const t = ra;
      ra = rb;
      rb = t;
    }
    this.ufParent[rb] = ra;
    this.gSize[ra] += this.gSize[rb];
    this.pLibs[ra] += this.pLibs[rb];
    this.libSum[ra] += this.libSum[rb];
    this.libSumSq[ra] += this.libSumSq[rb];
    // Splice the two circular member lists together.
    const t = this.nextStone[ra];
    this.nextStone[ra] = this.nextStone[rb];
    this.nextStone[rb] = t;
    return ra;
  }

  /** O(1) atari test for the group containing `stoneIdx`. */
  public isGroupInAtari(stoneIdx: number): boolean {
    const r = this.find(stoneIdx);
    const n = this.pLibs[r];
    if (n === 0) return false; // already captured, not in atari
    const s = this.libSum[r];
    return s * s === n * this.libSumSq[r];
  }

  /** The single remaining liberty of a group in atari, or -1. */
  public groupAtariLiberty(stoneIdx: number): number {
    const r = this.find(stoneIdx);
    const n = this.pLibs[r];
    if (n === 0) return -1;
    const s = this.libSum[r];
    if (s * s !== n * this.libSumSq[r]) return -1;
    return s / n;
  }

  /** O(1) stone count of the group containing `stoneIdx`. */
  public groupStones(stoneIdx: number): number {
    if (this.grid[stoneIdx] === EMPTY) return 0;
    return this.gSize[this.find(stoneIdx)];
  }

  private removeEmpty(idx: number): void {
    const pos = this.emptyPos[idx];
    if (pos < 0) return;
    const last = this.empties[--this.emptyCount];
    this.empties[pos] = last;
    this.emptyPos[last] = pos;
    this.emptyPos[idx] = -1;
  }

  private addEmpty(idx: number): void {
    if (this.emptyPos[idx] >= 0) return;
    this.emptyPos[idx] = this.emptyCount;
    this.empties[this.emptyCount++] = idx;
  }

  /** Copies another board state without allocating. Topology stays shared. */
  public copyFrom(other: FastBoard): void {
    this.grid.set(other.grid);
    this.empties.set(other.empties);
    this.emptyPos.set(other.emptyPos);
    this.ufParent.set(other.ufParent);
    this.gSize.set(other.gSize);
    this.pLibs.set(other.pLibs);
    this.libSum.set(other.libSum);
    this.libSumSq.set(other.libSumSq);
    this.nextStone.set(other.nextStone);
    this.emptyCount = other.emptyCount;
    this.stoneCount = other.stoneCount;
    this.turnColor = other.turnColor;
    this.koIdx = other.koIdx;
    this.capturesBlack = other.capturesBlack;
    this.capturesWhite = other.capturesWhite;
    this.lastMoveIdx = other.lastMoveIdx;
    this.passCount = other.passCount;
    this.hash = other.hash;
  }

  public loadFromState(
    grid2D: StoneState[][],
    turn: Color,
    koPoint: Point | null,
    captures: { black: number; white: number }
  ): void {
    const size = this.size;
    this.hash = 0;
    for (let y = 0; y < size; y++) {
      const row = grid2D[y];
      for (let x = 0; x < size; x++) {
        const s = row[x];
        const idx = y * size + x;
        const v = s === 'black' ? BLACK : s === 'white' ? WHITE : EMPTY;
        this.grid[idx] = v;
        if (v !== EMPTY) this.hash ^= this.topo.zobrist[(v === BLACK ? 0 : 1) * this.total + idx];
      }
    }
    this.turnColor = turn === 'black' ? BLACK : WHITE;
    this.koIdx = koPoint ? koPoint.y * size + koPoint.x : -1;
    this.capturesBlack = captures.black;
    this.capturesWhite = captures.white;
    this.lastMoveIdx = -1;
    this.passCount = 0;
    this.rebuildState();
  }

  // ---------------------------------------------------------
  // GROUPS AND LIBERTIES (mark-stamped flood fill, no allocation)
  // ---------------------------------------------------------

  /**
   * Collects the stones and liberties of a group into the supplied buffers.
   * Returns the stone count; the liberty count is written into out[0].
   */
  public collectGroup(startIdx: number, groupBuf: Int32Array, libBuf: Int32Array, out: Int32Array): number {
    const color = this.grid[startIdx];
    if (color === EMPTY) {
      out[0] = 0;
      return 0;
    }

    const sc = this.scratch;
    const visited = sc.visited;
    const libSeen = sc.libSeen;
    const vGen = ++sc.visitedGen;
    const lGen = ++sc.libSeenGen;
    const stack = sc.stack;
    const adj = this.topo.adj;
    const adjN = this.topo.adjN;
    const grid = this.grid;

    let sp = 0;
    let members = 0;
    let libs = 0;

    stack[sp++] = startIdx;
    visited[startIdx] = vGen;

    while (sp > 0) {
      const curr = stack[--sp];
      groupBuf[members++] = curr;

      const base = curr * 4;
      const n = adjN[curr];
      for (let i = 0; i < n; i++) {
        const nIdx = adj[base + i];
        const nVal = grid[nIdx];
        if (nVal === EMPTY) {
          if (libSeen[nIdx] !== lGen) {
            libSeen[nIdx] = lGen;
            libBuf[libs++] = nIdx;
          }
        } else if (nVal === color && visited[nIdx] !== vGen) {
          visited[nIdx] = vGen;
          stack[sp++] = nIdx;
        }
      }
    }

    out[0] = libs;
    return members;
  }

  /** Liberty count of the group containing startIdx, stopping early at `cap`. */
  public countLiberties(startIdx: number, cap: number = Infinity): number {
    const color = this.grid[startIdx];
    if (color === EMPTY) return 0;

    const sc = this.scratch;
    const visited = sc.visited;
    const libSeen = sc.libSeen;
    const vGen = ++sc.visitedGen;
    const lGen = ++sc.libSeenGen;
    const stack = sc.stack;
    const adj = this.topo.adj;
    const adjN = this.topo.adjN;
    const grid = this.grid;

    let sp = 0;
    let libs = 0;
    stack[sp++] = startIdx;
    visited[startIdx] = vGen;

    while (sp > 0) {
      const curr = stack[--sp];
      const base = curr * 4;
      const n = adjN[curr];
      for (let i = 0; i < n; i++) {
        const nIdx = adj[base + i];
        const nVal = grid[nIdx];
        if (nVal === EMPTY) {
          if (libSeen[nIdx] !== lGen) {
            libSeen[nIdx] = lGen;
            if (++libs >= cap) return libs;
          }
        } else if (nVal === color && visited[nIdx] !== vGen) {
          visited[nIdx] = vGen;
          stack[sp++] = nIdx;
        }
      }
    }
    return libs;
  }

  /** For a group in atari, returns its single liberty; -1 when it has 0 or 2+. */
  public atariLiberty(startIdx: number): number {
    const color = this.grid[startIdx];
    if (color === EMPTY) return -1;

    const sc = this.scratch;
    const visited = sc.visited;
    const vGen = ++sc.visitedGen;
    const stack = sc.stack;
    const adj = this.topo.adj;
    const adjN = this.topo.adjN;
    const grid = this.grid;

    let sp = 0;
    let lib = -1;
    stack[sp++] = startIdx;
    visited[startIdx] = vGen;

    while (sp > 0) {
      const curr = stack[--sp];
      const base = curr * 4;
      const n = adjN[curr];
      for (let i = 0; i < n; i++) {
        const nIdx = adj[base + i];
        const nVal = grid[nIdx];
        if (nVal === EMPTY) {
          if (lib === -1) lib = nIdx;
          else if (lib !== nIdx) return -1; // two or more liberties
        } else if (nVal === color && visited[nIdx] !== vGen) {
          visited[nIdx] = vGen;
          stack[sp++] = nIdx;
        }
      }
    }
    return lib;
  }

  /** Group size, stopping early once `cap` stones have been counted. */
  public groupSize(startIdx: number, cap: number = Infinity): number {
    const color = this.grid[startIdx];
    if (color === EMPTY) return 0;

    const sc = this.scratch;
    const visited = sc.visited;
    const vGen = ++sc.visitedGen;
    const stack = sc.stack;
    const adj = this.topo.adj;
    const adjN = this.topo.adjN;
    const grid = this.grid;

    let sp = 0;
    let count = 0;
    stack[sp++] = startIdx;
    visited[startIdx] = vGen;

    while (sp > 0) {
      const curr = stack[--sp];
      if (++count >= cap) return count;
      const base = curr * 4;
      const n = adjN[curr];
      for (let i = 0; i < n; i++) {
        const nIdx = adj[base + i];
        if (grid[nIdx] === color && visited[nIdx] !== vGen) {
          visited[nIdx] = vGen;
          stack[sp++] = nIdx;
        }
      }
    }
    return count;
  }

  /** Number of empty points orthogonally adjacent to `idx`. */
  public emptyNeighbours(idx: number): number {
    const adj = this.topo.adj;
    const base = idx * 4;
    const n = this.topo.adjN[idx];
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (this.grid[adj[base + i]] === EMPTY) count++;
    }
    return count;
  }

  // ---------------------------------------------------------
  // LEGALITY AND MOVE APPLICATION
  // ---------------------------------------------------------

  /**
   * Legality with no flood fill in the common case: an adjacent empty point, or
   * a friendly group with a spare liberty, already proves the move is legal.
   */
  public isLegal(idx: number, color: number): boolean {
    if (this.grid[idx] !== EMPTY) return false;
    if (this.koIdx === idx) return false;

    const adj = this.topo.adj;
    const base = idx * 4;
    const n = this.topo.adjN[idx];
    const opponent = -color;

    for (let i = 0; i < n; i++) {
      const nIdx = adj[base + i];
      const v = this.grid[nIdx];
      if (v === EMPTY) return true; // the new stone keeps that liberty
      if (v === color) {
        // A friendly group that is not in atari has another liberty besides
        // this point, which the merged group inherits.
        if (!this.isGroupInAtari(nIdx)) return true;
      } else if (this.isGroupInAtari(nIdx)) {
        // This point is the enemy group's last liberty, so the move captures.
        return true;
      }
    }

    void opponent;
    return false;
  }

  /** True when the point is a real eye for `color`. Playouts never fill these. */
  public isTrueEye(idx: number, color: number): boolean {
    if (this.grid[idx] !== EMPTY) return false;

    const adj = this.topo.adj;
    const base = idx * 4;
    const n = this.topo.adjN[idx];
    for (let i = 0; i < n; i++) {
      if (this.grid[adj[base + i]] !== color) return false;
    }

    const diag = this.topo.diag;
    const dn = this.topo.diagN[idx];
    const opponent = -color;
    let hostile = 0;
    for (let i = 0; i < dn; i++) {
      if (this.grid[diag[base + i]] === opponent) hostile++;
    }
    // On an edge or in a corner a single hostile diagonal already breaks the eye.
    return dn < 4 ? hostile === 0 : hostile <= 1;
  }

  /** Plays a move already known to be legal. Returns the number of captures. */
  public playLegal(idx: number, color: number): number {
    const opponent = -color;
    const sc = this.scratch;
    const zob = this.topo.zobrist;
    const total = this.total;
    const colorSlot = color === BLACK ? 0 : 1;
    const oppSlot = color === BLACK ? 1 : 0;
    const adj = this.topo.adj;
    const adjN = this.topo.adjN;
    const base = idx * 4;
    const n = adjN[idx];

    // 1. This point stops being a liberty of every neighbouring group. One
    //    incidence is removed per adjacent stone, which is exactly how
    //    pseudo-liberties are counted.
    for (let i = 0; i < n; i++) {
      const nIdx = adj[base + i];
      if (this.grid[nIdx] !== EMPTY) this.removeLiberty(this.find(nIdx), idx);
    }

    // 2. Place the stone as a fresh single-stone group.
    this.grid[idx] = color;
    this.removeEmpty(idx);
    this.stoneCount++;
    this.hash ^= zob[colorSlot * total + idx];

    this.ufParent[idx] = idx;
    this.nextStone[idx] = idx;
    this.gSize[idx] = 1;
    this.pLibs[idx] = 0;
    this.libSum[idx] = 0;
    this.libSumSq[idx] = 0;
    for (let i = 0; i < n; i++) {
      const nIdx = adj[base + i];
      if (this.grid[nIdx] === EMPTY) this.addLiberty(idx, nIdx);
    }

    // 3. Merge with friendly neighbours.
    for (let i = 0; i < n; i++) {
      const nIdx = adj[base + i];
      if (this.grid[nIdx] === color) this.unite(idx, nIdx);
    }

    // 4. Capture every adjacent enemy group left without a liberty.
    let captured = 0;
    let lastCaptured = -1;

    for (let i = 0; i < n; i++) {
      const nIdx = adj[base + i];
      if (this.grid[nIdx] !== opponent) continue;
      const root = this.find(nIdx);
      if (this.pLibs[root] !== 0) continue;

      // Collect the members first: their points only become liberties of the
      // surrounding groups once every stone has actually been lifted.
      let members = 0;
      let s = root;
      do {
        sc.groupBuf[members++] = s;
        s = this.nextStone[s];
      } while (s !== root);

      for (let p = 0; p < members; p++) {
        const cap = sc.groupBuf[p];
        this.grid[cap] = EMPTY;
        this.addEmpty(cap);
        this.stoneCount--;
        this.hash ^= zob[oppSlot * total + cap];
        captured++;
        lastCaptured = cap;
      }

      for (let p = 0; p < members; p++) {
        const cap = sc.groupBuf[p];
        const cbase = cap * 4;
        const cn = adjN[cap];
        for (let k = 0; k < cn; k++) {
          const m = adj[cbase + k];
          if (this.grid[m] !== EMPTY) this.addLiberty(this.find(m), cap);
        }
      }
    }

    if (color === BLACK) this.capturesBlack += captured;
    else this.capturesWhite += captured;

    // Simple ko: exactly one stone captured by a lone stone left with one liberty.
    if (captured === 1 && this.gSize[this.find(idx)] === 1 && this.isGroupInAtari(idx)) {
      this.koIdx = lastCaptured;
    } else {
      this.koIdx = -1;
    }

    this.lastMoveIdx = idx;
    this.turnColor = opponent;
    this.passCount = 0;
    return captured;
  }

  public playMove(idx: number, color: number = this.turnColor): boolean {
    if (!this.isLegal(idx, color)) return false;
    this.playLegal(idx, color);
    return true;
  }

  public pass(color: number = this.turnColor): void {
    this.koIdx = -1;
    this.lastMoveIdx = -1;
    this.turnColor = -color;
    this.passCount++;
  }

  /**
   * Liberties the merged group would have if `color` played at `idx`, without
   * mutating the board. Points freed by captures count as liberties.
   */
  public libertiesAfter(idx: number, color: number): number {
    const adj = this.topo.adj;
    const adjN = this.topo.adjN;
    const base = idx * 4;
    const n = adjN[idx];
    const sc = this.scratch;
    const opponent = -color;
    const grid = this.grid;

    // Phase 1: capture points. countLiberties bumps the mark generations, so
    // this has to finish before the marked walk in phase 2 starts.
    let capCount = 0;
    for (let i = 0; i < n; i++) {
      const nIdx = adj[base + i];
      if (grid[nIdx] === opponent && this.countLiberties(nIdx, 2) === 1) {
        sc.capBuf[capCount++] = nIdx;
      }
    }

    // Phase 2: walk the merged friendly group with fresh generations.
    const libSeen = sc.libSeen;
    const lGen = ++sc.libSeenGen;
    const visited = sc.visited;
    const vGen = ++sc.visitedGen;
    const stack = sc.stack;

    let libs = 0;
    for (let k = 0; k < capCount; k++) {
      const cap = sc.capBuf[k];
      if (libSeen[cap] !== lGen) {
        libSeen[cap] = lGen;
        libs++;
      }
    }

    let sp = 0;
    visited[idx] = vGen;
    stack[sp++] = idx;

    while (sp > 0) {
      const curr = stack[--sp];
      const cbase = curr * 4;
      const cn = adjN[curr];
      for (let i = 0; i < cn; i++) {
        const nIdx = adj[cbase + i];
        if (nIdx === idx) continue;
        const v = grid[nIdx];
        if (v === EMPTY) {
          if (libSeen[nIdx] !== lGen) {
            libSeen[nIdx] = lGen;
            libs++;
          }
        } else if (v === color && visited[nIdx] !== vGen) {
          visited[nIdx] = vGen;
          stack[sp++] = nIdx;
        }
      }
    }

    return libs;
  }

  /**
   * True when the move leaves the resulting group with at most one liberty.
   *
   * Computed by combining the pseudo-liberty triples of the merged groups, so
   * it costs a handful of array reads instead of a flood fill. Any move that
   * captures is treated as safe, which is what a playout policy wants.
   */
  public isSelfAtari(idx: number, color: number): boolean {
    const adj = this.topo.adj;
    const base = idx * 4;
    const n = this.topo.adjN[idx];
    const opponent = -color;

    let emptyN = 0;
    for (let i = 0; i < n; i++) {
      if (this.grid[adj[base + i]] === EMPTY) emptyN++;
    }
    // Two free neighbours already guarantee two liberties.
    if (emptyN >= 2) return false;

    // Start from the liberties the new stone brings by itself.
    let count = 0;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const nIdx = adj[base + i];
      if (this.grid[nIdx] === EMPTY) {
        count++;
        sum += nIdx;
        sumSq += nIdx * nIdx;
      }
    }

    // Fold in each friendly group exactly once, then drop the incidences that
    // pointed at this very intersection (one per adjacent friendly stone).
    let r0 = -1;
    let r1 = -1;
    let r2 = -1;
    for (let i = 0; i < n; i++) {
      const nIdx = adj[base + i];
      const v = this.grid[nIdx];
      if (v === opponent) {
        if (this.isGroupInAtari(nIdx)) return false; // the move captures
        continue;
      }
      if (v !== color) continue;

      const r = this.find(nIdx);
      if (r !== r0 && r !== r1 && r !== r2) {
        if (r0 === -1) r0 = r;
        else if (r1 === -1) r1 = r;
        else r2 = r;
        count += this.pLibs[r];
        sum += this.libSum[r];
        sumSq += this.libSumSq[r];
      }
      count--;
      sum -= idx;
      sumSq -= idx * idx;
    }

    if (count === 0) return true; // no liberties at all
    return sum * sum === count * sumSq; // every pseudo-liberty is the same point
  }

  public emptyAt(pos: number): number {
    return this.empties[pos];
  }

  // ---------------------------------------------------------
  // SCORING (Tromp-Taylor area, allocation free)
  // ---------------------------------------------------------

  /** Area score from the Black perspective with komi already subtracted. */
  public areaScore(komi: number): number {
    const sc = this.scratch;
    const seen = sc.scoreSeen;
    const gen = ++sc.scoreSeenGen;
    const stack = sc.stack;
    const adj = this.topo.adj;
    const adjN = this.topo.adjN;
    const grid = this.grid;

    let black = 0;
    let white = komi;

    for (let i = 0; i < this.total; i++) {
      const v = grid[i];
      if (v === BLACK) {
        black++;
        continue;
      }
      if (v === WHITE) {
        white++;
        continue;
      }
      if (seen[i] === gen) continue;

      let sp = 0;
      let count = 0;
      let reachBlack = false;
      let reachWhite = false;
      stack[sp++] = i;
      seen[i] = gen;

      while (sp > 0) {
        const curr = stack[--sp];
        count++;
        const base = curr * 4;
        const n = adjN[curr];
        for (let k = 0; k < n; k++) {
          const nIdx = adj[base + k];
          const nv = grid[nIdx];
          if (nv === BLACK) reachBlack = true;
          else if (nv === WHITE) reachWhite = true;
          else if (seen[nIdx] !== gen) {
            seen[nIdx] = gen;
            stack[sp++] = nIdx;
          }
        }
      }

      if (reachBlack && !reachWhite) black += count;
      else if (reachWhite && !reachBlack) white += count;
    }

    return black - white;
  }
}

// -------------------------------------------------------------
// LADDER (SHICHO) READER
// -------------------------------------------------------------

/** One pooled board per recursion level, so ladder reading never allocates. */
const LADDER_POOL: FastBoard[] = [];

function ladderBoard(depth: number, size: number): FastBoard {
  let b = LADDER_POOL[depth];
  if (!b || b.size !== size) {
    b = new FastBoard(size);
    LADDER_POOL[depth] = b;
  }
  return b;
}

/** True when playing at `idx` would capture some adjacent enemy group. */
function capturesSomething(board: FastBoard, idx: number, color: number): boolean {
  const adj = board.topo.adj;
  const base = idx * 4;
  const n = board.topo.adjN[idx];
  const opponent = -color;
  for (let i = 0; i < n; i++) {
    const nIdx = adj[base + i];
    if (board.grid[nIdx] === opponent && board.isGroupInAtari(nIdx)) return true;
  }
  return false;
}

/**
 * True when the defender group at `stoneIdx` can be run down in a ladder.
 * Only groups already down to one or two liberties are worth reading.
 */
function isLadderCaptured(board: FastBoard, stoneIdx: number, defender: number, depth: number): boolean {
  if (depth <= 0) return false;
  if (board.grid[stoneIdx] !== defender) return false;

  const libs = board.countLiberties(stoneIdx, 3);
  if (libs === 0) return true;
  if (libs >= 3) return false;
  if (libs === 1) return true;

  const attacker = -defender;
  const work = ladderBoard(depth, board.size);

  // Snapshot the two liberties before any board mutation invalidates them.
  const sc = getScratch(board.total);
  board.collectGroup(stoneIdx, sc.groupBuf, sc.libBuf, sc.out);
  const libCount = sc.out[0];
  const libA = sc.libBuf[0];
  const libB = libCount > 1 ? sc.libBuf[1] : -1;
  const attackPoints = libB >= 0 ? [libA, libB] : [libA];

  for (const attackIdx of attackPoints) {
    work.copyFrom(board);
    if (!work.isLegal(attackIdx, attacker)) continue;
    if (work.isSelfAtari(attackIdx, attacker)) continue; // the attacker would die first
    work.playLegal(attackIdx, attacker);

    if (work.grid[stoneIdx] !== defender) return true; // captured outright

    const escape = work.groupAtariLiberty(stoneIdx);
    if (escape === -1) continue; // still has room, the attack failed
    if (capturesSomething(work, escape, defender)) continue; // snap-back escape
    if (!work.isLegal(escape, defender)) return true; // cannot even extend

    work.playLegal(escape, defender);
    const escapeLibs = work.countLiberties(stoneIdx, 4);
    if (escapeLibs >= 3) continue; // escaped into the open
    if (isLadderCaptured(work, stoneIdx, defender, depth - 1)) return true;
  }

  return false;
}

// -------------------------------------------------------------
// MOVE PRIORS (cheap shape heuristics, no board mutation)
// -------------------------------------------------------------

const PRIOR_ILLEGAL = -1000;

/**
 * Heuristic score for a candidate move. Everything here is close to O(1) with
 * respect to the board: no clones, only a few capped liberty counts.
 * `ladderDepth > 0` enables ladder reading, which is only affordable at the root.
 */
function movePrior(board: FastBoard, idx: number, color: number, ladderDepth: number): number {
  const topo = board.topo;
  const size = board.size;
  let score = 0;

  // 1. Line placement. The third and fourth lines are the efficient ones.
  const edge = topo.distEdge[idx];
  if (edge === 0) score -= 30;
  else if (edge === 1) score -= 4;
  else if (edge === 2) score += 24;
  else if (edge === 3) score += 20;
  else score += 12;

  if (topo.isStar[idx]) score += 14;

  // 2. Local context.
  const adj = topo.adj;
  const base = idx * 4;
  const n = topo.adjN[idx];
  let ownAdj = 0;
  let oppAdj = 0;
  let capturesHere = 0;
  let savesGroup = 0;
  let saveAnchor = -1;

  for (let i = 0; i < n; i++) {
    const nIdx = adj[base + i];
    const v = board.grid[nIdx];
    if (v === EMPTY) continue;
    if (v === color) {
      ownAdj++;
      if (board.isGroupInAtari(nIdx)) {
        const gs = Math.min(8, board.groupStones(nIdx));
        if (gs > savesGroup) {
          savesGroup = gs;
          saveAnchor = nIdx;
        }
      }
    } else {
      oppAdj++;
      if (board.isGroupInAtari(nIdx)) capturesHere += Math.min(12, board.groupStones(nIdx));
    }
  }

  // 3. Captures and rescues dominate every shape consideration.
  if (capturesHere > 0) score += 70 + capturesHere * 14;

  if (savesGroup > 0) {
    let worthSaving = true;
    if (ladderDepth > 0 && savesGroup <= 6) {
      // Do not reward running out of a ladder that cannot be won.
      const work = ladderBoard(ladderDepth + 1, board.size);
      work.copyFrom(board);
      if (work.isLegal(idx, color)) {
        work.playLegal(idx, color);
        if (isLadderCaptured(work, idx, color, ladderDepth)) worthSaving = false;
      }
    }
    if (worthSaving) score += 45 + savesGroup * 10;
    else score -= 60;
  }
  void saveAnchor;

  // 4. Self-atari is almost always a blunder.
  const libsAfter = board.libertiesAfter(idx, color);
  if (libsAfter <= 1 && capturesHere === 0) return PRIOR_ILLEGAL;
  if (libsAfter === 2) score -= 12;
  else if (libsAfter >= 4) score += 14;

  // 5. Contact fighting shapes.
  if (ownAdj >= 1 && oppAdj >= 1) score += 26; // hane or contact
  else if (ownAdj === 1 && oppAdj === 0) score += 12; // solid extension
  if (ownAdj >= 3) score -= 18; // over-concentrated
  if (oppAdj >= 2) score += 16; // pressing two enemy stones

  // 6. Empty triangle, the classic bad shape.
  const diag = topo.diag;
  const dn = topo.diagN[idx];
  let ownDiag = 0;
  for (let i = 0; i < dn; i++) {
    const dIdx = diag[base + i];
    const dv = board.grid[dIdx];
    if (dv === color) ownDiag++;
    if (dv !== EMPTY) continue;
    const dx = (dIdx % size) - (idx % size);
    const dy = (dIdx - idx - dx) / size;
    if (board.grid[idx + dx] === color && board.grid[idx + dy * size] === color) {
      score -= 40;
    }
  }

  // 7. A diagonal friend plus an orthogonal friend is a solid connection.
  if (ownDiag >= 1 && ownAdj >= 1) score += 10;

  // 8. Openings belong in the corners, not in contact fights.
  if (board.stoneCount < size) {
    if (edge >= 2 && edge <= 3) score += 18;
    if (ownAdj + oppAdj > 0) score -= 22;
  }

  // 9. Stay near the action once a fight is running.
  const last = board.lastMoveIdx;
  if (last >= 0) {
    const dist = Math.max(
      Math.abs((last % size) - (idx % size)),
      Math.abs(Math.floor(last / size) - Math.floor(idx / size))
    );
    if (dist <= 3) score += 16 - dist * 4;
  }

  return score;
}

// -------------------------------------------------------------
// ROLLOUT POLICY (local answers first, then a random legal move)
// -------------------------------------------------------------

/**
 * Only looks at the eight points around the last move, the way MoGo-style
 * playout policies do. This keeps a rollout step close to O(1) instead of
 * scanning the whole board, which is the difference between a handful of
 * playouts and tens of thousands per second.
 */
function localReply(board: FastBoard, color: number): number {
  const last = board.lastMoveIdx;
  if (last < 0) return -1;

  const topo = board.topo;
  const opponent = -color;
  const base = last * 4;
  const n = topo.adjN[last];
  let best = -1;
  let bestScore = 0;

  // 1. Capture an adjacent enemy group that is in atari.
  //    A stone with two free neighbours cannot be in atari, which skips the
  //    group walk for the overwhelming majority of points.
  for (let i = 0; i < n; i++) {
    const nIdx = topo.adj[base + i];
    if (board.grid[nIdx] !== opponent) continue;
    const lib = board.groupAtariLiberty(nIdx);
    if (lib < 0 || !board.isLegal(lib, color)) continue;
    const gain = 40 + Math.min(10, board.groupStones(nIdx)) * 8;
    if (gain > bestScore) {
      bestScore = gain;
      best = lib;
    }
  }

  // 2. The last move may have put one of our own groups in atari: run away.
  if (best === -1) {
    for (let i = 0; i < n; i++) {
      const nIdx = topo.adj[base + i];
      if (board.grid[nIdx] !== color) continue;
      const lib = board.groupAtariLiberty(nIdx);
      if (lib < 0 || !board.isLegal(lib, color)) continue;
      if (board.isSelfAtari(lib, color)) continue; // running is hopeless
      const gain = 30 + Math.min(10, board.groupStones(nIdx)) * 6;
      if (gain > bestScore) {
        bestScore = gain;
        best = lib;
      }
    }
  }

  // 3. Otherwise try a contact play beside the last stone.
  if (best === -1) {
    const dn = topo.diagN[last];
    const candidates = n + dn;
    if (candidates > 0) {
      const pick = rndInt(candidates);
      const idx = pick < n ? topo.adj[base + pick] : topo.diag[base + (pick - n)];
      if (
        board.grid[idx] === EMPTY &&
        !board.isTrueEye(idx, color) &&
        board.isLegal(idx, color) &&
        !board.isSelfAtari(idx, color)
      ) {
        best = idx;
      }
    }
  }

  return best;
}

/** Random legal non-eye move, sampled from the dense empty-point list. */
function randomPlayoutMove(board: FastBoard, color: number): number {
  const count = board.emptyCount;
  if (count === 0) return -1;

  const start = rndInt(count);
  for (let step = 0; step < count; step++) {
    let pos = start + step;
    if (pos >= count) pos -= count;
    const idx = board.emptyAt(pos);
    if (board.isTrueEye(idx, color)) continue;
    if (!board.isLegal(idx, color)) continue;
    if (board.isSelfAtari(idx, color)) continue;
    return idx;
  }
  return -1;
}

// -------------------------------------------------------------
// MCTS WITH RAVE
// -------------------------------------------------------------

class Node {
  public moveIdx: number; // -1 marks a pass or the root
  /** Colour to move at this node. */
  public color: number;
  public parent: Node | null;
  public children: Node[] | null;
  public wins: number;
  public visits: number;
  public raveWins: number;
  public raveVisits: number;
  public prior: number;
  /** Candidates not yet expanded, ordered so pop() takes the best one. */
  public untried: Int32Array | null;
  public untriedCount: number;

  constructor(moveIdx: number, color: number, parent: Node | null, prior: number) {
    this.moveIdx = moveIdx;
    this.color = color;
    this.parent = parent;
    this.children = null;
    this.wins = 0;
    this.visits = 0;
    this.raveWins = 0;
    this.raveVisits = 0;
    this.prior = prior;
    this.untried = null;
    this.untriedCount = 0;
  }
}

const MAX_CANDIDATES = 48;
/** A node only grows children once it has been visited this often. */
const EXPAND_THRESHOLD = 6;

const EMPTY_CANDIDATES = new Int32Array(0);

/**
 * Builds the ordered candidate list for a node: legal non-eye moves sorted by
 * prior, capped so the tree stays narrow enough to also get deep.
 */
function buildCandidates(board: FastBoard, color: number, node: Node, limit: number, ladderDepth: number): void {
  const moves: number[] = [];
  const scores: number[] = [];

  for (let pos = 0; pos < board.emptyCount; pos++) {
    const idx = board.emptyAt(pos);
    if (board.isTrueEye(idx, color)) continue;
    if (!board.isLegal(idx, color)) continue;
    const prior = movePrior(board, idx, color, ladderDepth);
    if (prior <= PRIOR_ILLEGAL) continue; // pure self-atari
    moves.push(idx);
    scores.push(prior);
  }

  if (moves.length === 0) {
    node.untried = EMPTY_CANDIDATES;
    node.untriedCount = 0;
    return;
  }

  const order = moves.map((_, i) => i);
  order.sort((a, b) => scores[a] - scores[b]); // ascending, best last

  const keep = Math.min(order.length, limit);
  const arr = new Int32Array(keep);
  for (let i = 0; i < keep; i++) {
    arr[i] = moves[order[order.length - keep + i]];
  }
  node.untried = arr;
  node.untriedCount = keep;
}

interface SearchResult {
  bestMoveIdx: number; // -1 means pass
  winRate: number; // best move value, for the player to move at the root
  positionWinRate: number; // visit-weighted value, for the player to move
  playouts: number;
  candidates: { point: Point; score: number; winRate: number }[];
}

interface SearchConfig {
  maxPlayouts: number;
  maxTimeMs: number;
  cPuct: number;
  raveWeight: number;
  rolloutCap: number;
  candidateLimit: number;
  /** 0 always picks the most visited move; higher values add level noise. */
  temperature: number;
  komi: number;
  allowPass: boolean;
  ladderDepth: number;
}

function selectChild(node: Node, cPuct: number, raveWeight: number, logParentVisits: number): Node {
  const children = node.children!;
  let best = children[0];
  let bestVal = -Infinity;

  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    let value: number;

    if (c.visits === 0) {
      // First-play urgency seeded by RAVE and by the shape prior.
      const raveVal = c.raveVisits > 0 ? c.raveWins / c.raveVisits : 0.45;
      value = raveVal + 1.1 + Math.max(0, c.prior) / 400;
    } else {
      const exploit = c.wins / c.visits;
      const explore = cPuct * Math.sqrt(logParentVisits / c.visits);
      const priorBonus = Math.max(0, c.prior) / (60 * (1 + c.visits));

      if (c.raveVisits > 0) {
        const beta = c.raveVisits / (c.visits + c.raveVisits + (4 * c.visits * c.raveVisits) / raveWeight);
        value = (1 - beta) * exploit + beta * (c.raveWins / c.raveVisits) + explore + priorBonus;
      } else {
        value = exploit + explore + priorBonus;
      }
    }

    if (value > bestVal) {
      bestVal = value;
      best = c;
    }
  }

  return best;
}

function runSearch(rootBoard: FastBoard, color: number, cfg: SearchConfig): SearchResult {
  const size = rootBoard.size;
  const root = new Node(-1, color, null, 0);
  buildCandidates(rootBoard, color, root, cfg.candidateLimit, cfg.ladderDepth);

  if (root.untriedCount === 0) {
    return { bestMoveIdx: -1, winRate: 0.5, positionWinRate: 0.5, playouts: 0, candidates: [] };
  }

  const simBoard = new FastBoard(size);
  const deadline = Date.now() + cfg.maxTimeMs;

  // RAVE bookkeeping: which points each colour played during a simulation.
  const playedBlack = new Int32Array(rootBoard.total);
  const playedWhite = new Int32Array(rootBoard.total);
  let gen = 0;

  let playouts = 0;

  for (; playouts < cfg.maxPlayouts; playouts++) {
    if ((playouts & 31) === 0 && Date.now() >= deadline) break;

    simBoard.copyFrom(rootBoard);
    let node = root;
    gen++;

    // 1. Selection, growing the tree lazily once a node proves popular.
    for (;;) {
      if (node.untried === null && node.visits >= EXPAND_THRESHOLD) {
        buildCandidates(simBoard, node.color, node, cfg.candidateLimit, 0);
      }

      if (node.untriedCount > 0) break; // expand here

      const kids = node.children;
      if (kids === null || kids.length === 0) break; // rollout from this leaf

      node = selectChild(node, cfg.cPuct, cfg.raveWeight, Math.log(Math.max(2, node.visits)));
      const mover = -node.color;
      if (node.moveIdx >= 0) {
        if (!simBoard.playMove(node.moveIdx, mover)) break;
        if (mover === BLACK) playedBlack[node.moveIdx] = gen;
        else playedWhite[node.moveIdx] = gen;
      } else {
        simBoard.pass(mover);
      }
    }

    // 2. Expansion.
    if (node.untriedCount > 0) {
      const moveIdx = node.untried![--node.untriedCount];
      if (simBoard.isLegal(moveIdx, node.color)) {
        const prior = movePrior(simBoard, moveIdx, node.color, 0);
        simBoard.playLegal(moveIdx, node.color);
        if (node.color === BLACK) playedBlack[moveIdx] = gen;
        else playedWhite[moveIdx] = gen;

        const child = new Node(moveIdx, -node.color, node, prior);
        if (node.children === null) node.children = [];
        node.children.push(child);
        node = child;
      }
    }

    // 3. Rollout, recording each colour's points for RAVE.
    let passes = simBoard.passCount;
    for (let m = 0; m < cfg.rolloutCap && passes < 2; m++) {
      const c = simBoard.turnColor;
      let mv = -1;
      if (rnd() < 0.85) mv = localReply(simBoard, c);
      if (mv === -1) mv = randomPlayoutMove(simBoard, c);

      if (mv === -1) {
        simBoard.pass(c);
        passes++;
      } else {
        simBoard.playLegal(mv, c);
        passes = 0;
        if (c === BLACK) playedBlack[mv] = gen;
        else playedWhite[mv] = gen;
      }
    }

    const blackWon = simBoard.areaScore(cfg.komi) > 0;

    // 4. Backpropagation. A node stores the win rate of the player that moved
    //    into it, which is the opposite of the colour to move at that node.
    let curr: Node | null = node;
    while (curr !== null) {
      curr.visits++;
      const moverIsBlack = curr.color !== BLACK;
      if (moverIsBlack === blackWon) curr.wins++;

      const parent: Node | null = curr.parent;
      if (parent !== null && parent.children !== null) {
        const siblingMoverIsBlack = parent.color === BLACK;
        const played = siblingMoverIsBlack ? playedBlack : playedWhite;
        const siblingWon = siblingMoverIsBlack === blackWon;
        const kids = parent.children;
        for (let i = 0; i < kids.length; i++) {
          const sib = kids[i];
          if (sib.moveIdx >= 0 && played[sib.moveIdx] === gen) {
            sib.raveVisits++;
            if (siblingWon) sib.raveWins++;
          }
        }
      }

      curr = parent;
    }
  }

  const children = root.children;
  if (!children || children.length === 0) {
    return { bestMoveIdx: -1, winRate: 0.5, positionWinRate: 0.5, playouts, candidates: [] };
  }

  // Every child stores wins for the player who moved into it, which at the root
  // is the player to move, so this average is already in the right perspective.
  let weightedWins = 0;
  let weightedVisits = 0;
  for (const c of children) {
    weightedWins += c.wins;
    weightedVisits += c.visits;
  }
  const positionWinRate = weightedVisits > 0 ? weightedWins / weightedVisits : 0.5;

  children.sort((a, b) => {
    if (b.visits !== a.visits) return b.visits - a.visits;
    return b.wins / Math.max(1, b.visits) - a.wins / Math.max(1, a.visits);
  });

  let chosen = children[0];

  // Weaker levels pick from among the top moves instead of always the best.
  if (cfg.temperature > 0 && children.length > 1) {
    const poolSize = Math.min(children.length, 1 + Math.round(cfg.temperature * 6));
    const pool = children.slice(0, poolSize);
    const invT = 1 / Math.max(0.15, cfg.temperature);
    let totalWeight = 0;
    const weights = pool.map(c => {
      const w = Math.pow(Math.max(1, c.visits), invT);
      totalWeight += w;
      return w;
    });
    let pick = rnd() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        chosen = pool[i];
        break;
      }
    }
  }

  const winRate = chosen.visits > 0 ? chosen.wins / chosen.visits : 0.5;

  const candidates = children.slice(0, 6).map(c => ({
    point: { x: c.moveIdx % size, y: Math.floor(c.moveIdx / size) },
    score: c.visits,
    winRate: c.visits > 0 ? c.wins / c.visits : 0
  }));

  // When the opponent has passed and we are already ahead on the board, pass
  // back rather than filling our own area and handing points away.
  let bestMoveIdx = chosen.moveIdx;
  if (cfg.allowPass) {
    const passScore = rootBoard.areaScore(cfg.komi);
    const aheadByPassing = color === BLACK ? passScore > 0 : passScore < 0;
    if (aheadByPassing) bestMoveIdx = -1;
  }

  return { bestMoveIdx, winRate, positionWinRate, playouts, candidates };
}

// -------------------------------------------------------------
// OPENING BOOK
// -------------------------------------------------------------

/**
 * Deliberately small: it only fires while the board is nearly empty, so the
 * search itself decides everything that actually matters.
 */
function openingMove(board: FastBoard): number {
  const size = board.size;
  const stones = board.stoneCount;

  if (size === 9) {
    if (stones === 0) return 4 * 9 + 4; // tengen
    if (stones === 1 && board.grid[4 * 9 + 4] !== EMPTY) {
      const replies = [2 * 9 + 2, 2 * 9 + 6, 6 * 9 + 2, 6 * 9 + 6];
      return replies[rndInt(replies.length)];
    }
    return -1;
  }

  const cornerBudget = size === 19 ? 4 : 3;
  if (stones >= cornerBudget) return -1;

  const mid = (size - 1) / 2;
  const corners: number[] = [];
  for (let i = 0; i < board.total; i++) {
    if (!board.topo.isStar[i] || board.grid[i] !== EMPTY) continue;
    const x = i % size;
    const y = Math.floor(i / size);
    if (x === mid || y === mid) continue;
    corners.push(i);
  }
  if (corners.length === 0) return -1;

  // Prefer the corner furthest from every stone already on the board.
  let best = corners[0];
  let bestDist = -1;
  for (const c of corners) {
    const cx = c % size;
    const cy = Math.floor(c / size);
    let minDist = Infinity;
    for (let i = 0; i < board.total; i++) {
      if (board.grid[i] === EMPTY) continue;
      const d = Math.abs((i % size) - cx) + Math.abs(Math.floor(i / size) - cy);
      if (d < minDist) minDist = d;
    }
    if (minDist > bestDist) {
      bestDist = minDist;
      best = c;
    }
  }
  return best;
}

// -------------------------------------------------------------
// LEVEL CONFIGURATION
// -------------------------------------------------------------

interface LevelConfig {
  playouts: number;
  timeMs: number;
  temperature: number;
  candidateLimit: number;
  cPuct: number;
  raveWeight: number;
  ladderDepth: number;
}

function levelConfig(level: number): LevelConfig {
  switch (level) {
    case 1:
      return { playouts: 1200, timeMs: 400, temperature: 0.9, candidateLimit: 18, cPuct: 1.4, raveWeight: 200, ladderDepth: 0 };
    case 2:
      return { playouts: 5000, timeMs: 900, temperature: 0.45, candidateLimit: 26, cPuct: 1.3, raveWeight: 250, ladderDepth: 12 };
    case 3:
      return { playouts: 15000, timeMs: 1600, temperature: 0.2, candidateLimit: 34, cPuct: 1.2, raveWeight: 300, ladderDepth: 20 };
    case 4:
      return { playouts: 40000, timeMs: 2600, temperature: 0.06, candidateLimit: 42, cPuct: 1.1, raveWeight: 350, ladderDepth: 28 };
    case 5:
    default:
      return { playouts: 150000, timeMs: 4000, temperature: 0, candidateLimit: MAX_CANDIDATES, cPuct: 1.0, raveWeight: 400, ladderDepth: 36 };
  }
}

// -------------------------------------------------------------
// PUBLIC ENGINE API
// -------------------------------------------------------------

export function processBotRequest(req: BotRequest): BotResponse {
  const startTime = Date.now();
  seedRng(req.seed ?? ((req.id * 2654435761) ^ 0x9e3779b9));

  const board = new FastBoard(req.size);
  board.loadFromState(req.grid, req.turn, req.koPoint, req.captures);

  const color = req.turn === 'black' ? BLACK : WHITE;
  const cfg = levelConfig(req.level);
  const timeMs = req.timeBudgetMs !== undefined ? Math.max(30, req.timeBudgetMs) : cfg.timeMs;
  // Rollouts have to be able to reach the end of the game for scoring to mean
  // anything, with headroom for captures and refills.
  const rolloutCap = Math.round(board.total * 1.7);

  let bestMovePoint: Point | null = null;
  let winRateForMover = 0.5;
  let positionValueForMover = 0.5;
  let playouts = 0;
  let candidates: { point: Point; score: number; winRate: number }[] = [];

  // Only the lower levels lean on the book; strong levels always search.
  const book = req.level >= 4 ? -1 : openingMove(board);
  if (book >= 0 && board.isLegal(book, color)) {
    bestMovePoint = { x: book % board.size, y: Math.floor(book / board.size) };
    winRateForMover = 0.55;
    positionValueForMover = 0.5;
    candidates = [{ point: bestMovePoint, score: 1, winRate: 0.55 }];
  } else {
    const result = runSearch(board, color, {
      maxPlayouts: cfg.playouts,
      maxTimeMs: timeMs,
      cPuct: cfg.cPuct,
      raveWeight: cfg.raveWeight,
      rolloutCap,
      candidateLimit: cfg.candidateLimit,
      temperature: cfg.temperature,
      komi: req.komi,
      allowPass: req.opponentPassed === true,
      ladderDepth: cfg.ladderDepth
    });

    playouts = result.playouts;
    winRateForMover = result.winRate;
    positionValueForMover = result.positionWinRate;
    candidates = result.candidates;
    if (result.bestMoveIdx >= 0) {
      bestMovePoint = { x: result.bestMoveIdx % board.size, y: Math.floor(result.bestMoveIdx / board.size) };
    }
  }

  return {
    id: req.id,
    bestMove: bestMovePoint,
    winRate: color === BLACK ? winRateForMover : 1 - winRateForMover,
    positionWinRate: color === BLACK ? positionValueForMover : 1 - positionValueForMover,
    scoreLead: board.areaScore(req.komi),
    thoughtTimeMs: Date.now() - startTime,
    playouts,
    candidateMoves: candidates
  };
}

// -------------------------------------------------------------
// WORKER ENTRY POINT
// -------------------------------------------------------------

if (typeof self !== 'undefined' && typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function') {
  self.onmessage = (event: MessageEvent<BotRequest>) => {
    try {
      self.postMessage(processBotRequest(event.data));
    } catch (err) {
      // Never leave the main thread waiting on a request that threw.
      console.error('Bot worker failed:', err);
      self.postMessage({
        id: event.data?.id ?? -1,
        bestMove: null,
        winRate: 0.5,
        positionWinRate: 0.5,
        scoreLead: 0,
        thoughtTimeMs: 0,
        playouts: 0,
        candidateMoves: []
      } as BotResponse);
    }
  };
}
