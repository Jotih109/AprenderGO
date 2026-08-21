
import { BoardSize, Color, Move, Point, StoneState } from '../types/go';

export class GoBoard {
  public size: BoardSize;
  public grid: StoneState[][];
  public turn: Color;
  public captures: { black: number; white: number };
  public consecutivePasses: number;
  public history: {
    grid: StoneState[][];
    turn: Color;
    captures: { black: number; white: number };
    lastMove: Move | null;
    koPoint: Point | null;
  }[];
  public movesList: Move[];
  public lastMove: Move | null;
  public koPoint: Point | null;
  public isGameOver: boolean;

  constructor(size: BoardSize = 19) {
    this.size = size;
    this.grid = Array.from({ length: size }, () => Array(size).fill(null));
    this.turn = 'black';
    this.captures = { black: 0, white: 0 };
    this.consecutivePasses = 0;
    this.history = [];
    this.movesList = [];
    this.lastMove = null;
    this.koPoint = null;
    this.isGameOver = false;
  }

  public clone(): GoBoard {
    const copy = new GoBoard(this.size);
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        copy.grid[y][x] = this.grid[y][x];
      }
    }
    copy.turn = this.turn;
    copy.captures = { ...this.captures };
    copy.consecutivePasses = this.consecutivePasses;
    copy.lastMove = this.lastMove ? { ...this.lastMove } : null;
    copy.koPoint = this.koPoint ? { ...this.koPoint } : null;
    copy.isGameOver = this.isGameOver;
    return copy;
  }

  public reset(size: BoardSize = this.size): void {
    this.size = size;
    this.grid = Array.from({ length: size }, () => Array(size).fill(null));
    this.turn = 'black';
    this.captures = { black: 0, white: 0 };
    this.consecutivePasses = 0;
    this.history = [];
    this.movesList = [];
    this.lastMove = null;
    this.koPoint = null;
    this.isGameOver = false;
  }

  public get(x: number, y: number): StoneState {
    if (this.isValidCoord(x, y)) {
      return this.grid[y][x];
    }
    return null;
  }

  public isValidCoord(x: number, y: number): boolean {
    return x >= 0 && x < this.size && y >= 0 && y < this.size;
  }

  public getAdjacent(x: number, y: number): Point[] {
    const adj: Point[] = [];
    const dirs = [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 }
    ];
    for (const d of dirs) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (this.isValidCoord(nx, ny)) {
        adj.push({ x: nx, y: ny });
      }
    }
    return adj;
  }

  public getGroup(startX: number, startY: number): { points: Point[]; liberties: Set<string>; color: Color } | null {
    const color = this.get(startX, startY);
    if (!color) return null;

    const visited = new Set<string>();
    const points: Point[] = [];
    const liberties = new Set<string>();
    const queue: Point[] = [{ x: startX, y: startY }];
    visited.add(`${startX},${startY}`);

    while (queue.length > 0) {
      const p = queue.shift()!;
      points.push(p);

      const adj = this.getAdjacent(p.x, p.y);
      for (const next of adj) {
        const key = `${next.x},${next.y}`;
        const nextColor = this.get(next.x, next.y);

        if (nextColor === null) {
          liberties.add(key);
        } else if (nextColor === color && !visited.has(key)) {
          visited.add(key);
          queue.push(next);
        }
      }
    }

    return { points, liberties, color };
  }

  public isValidMove(x: number, y: number, color: Color = this.turn): { valid: boolean; reason?: string } {
    if (this.isGameOver) {
      return { valid: false, reason: 'O jogo já acabou.' };
    }

    if (!this.isValidCoord(x, y)) {
      return { valid: false, reason: 'Posição fora do tabuleiro.' };
    }

    if (this.grid[y][x] !== null) {
      return { valid: false, reason: 'Posição já ocupada.' };
    }

    // Check Ko
    if (this.koPoint && this.koPoint.x === x && this.koPoint.y === y) {
      return { valid: false, reason: 'Regra do Ko: repetição imediata de posição proibida.' };
    }

    // Simulate placing the stone
    const opponentColor: Color = color === 'black' ? 'white' : 'black';
    const adj = this.getAdjacent(x, y);

    let wouldCapture = false;
    const capturedStones: Point[] = [];

    // Temporarily place stone
    this.grid[y][x] = color;

    // Check if any opponent neighbor loses its last liberty
    const checkedOpponentGroups = new Set<string>();
    for (const neighbor of adj) {
      if (this.grid[neighbor.y][neighbor.x] === opponentColor) {
        const group = this.getGroup(neighbor.x, neighbor.y);
        if (group && group.liberties.size === 0) {
          const groupKey = `${group.points[0].x},${group.points[0].y}`;
          if (!checkedOpponentGroups.has(groupKey)) {
            checkedOpponentGroups.add(groupKey);
            wouldCapture = true;
            capturedStones.push(...group.points);
          }
        }
      }
    }

    // Check own liberties
    const ownGroup = this.getGroup(x, y);
    const hasLiberties = ownGroup ? ownGroup.liberties.size > 0 : false;

    // Undo temporary move
    this.grid[y][x] = null;

    if (!hasLiberties && !wouldCapture) {
      return { valid: false, reason: 'Suicídio proibido: jogada sem liberdades.' };
    }

    return { valid: true };
  }

  public playMove(x: number, y: number, color: Color = this.turn): { success: boolean; move?: Move; reason?: string } {
    const check = this.isValidMove(x, y, color);
    if (!check.valid) {
      return { success: false, reason: check.reason };
    }

    // Save state to history before changing
    this.saveState();

    const opponentColor: Color = color === 'black' ? 'white' : 'black';
    this.grid[y][x] = color;
    const captured: Point[] = [];

    // Check opponent groups around the move
    const adj = this.getAdjacent(x, y);
    const visitedGroups = new Set<string>();

    for (const neighbor of adj) {
      if (this.grid[neighbor.y][neighbor.x] === opponentColor) {
        const group = this.getGroup(neighbor.x, neighbor.y);
        if (group && group.liberties.size === 0) {
          const repKey = `${group.points[0].x},${group.points[0].y}`;
          if (!visitedGroups.has(repKey)) {
            visitedGroups.add(repKey);
            for (const stone of group.points) {
              this.grid[stone.y][stone.x] = null;
              captured.push(stone);
            }
          }
        }
      }
    }

    // Update captures
    if (color === 'black') {
      this.captures.black += captured.length;
    } else {
      this.captures.white += captured.length;
    }

    // Check for Ko condition
    // Ko happens when: 1 stone captured, played stone has 1 liberty and own group size is 1
    const ownGroup = this.getGroup(x, y);
    if (captured.length === 1 && ownGroup && ownGroup.points.length === 1 && ownGroup.liberties.size === 1) {
      this.koPoint = { x: captured[0].x, y: captured[0].y };
    } else {
      this.koPoint = null;
    }

    const moveObj: Move = {
      x,
      y,
      color,
      captured,
      moveNumber: this.movesList.length + 1
    };

    this.lastMove = moveObj;
    this.movesList.push(moveObj);
    this.consecutivePasses = 0;
    this.turn = opponentColor;

    return { success: true, move: moveObj };
  }

  public pass(color: Color = this.turn): Move {
    this.saveState();
    this.koPoint = null;
    this.consecutivePasses++;

    const moveObj: Move = {
      x: -1,
      y: -1,
      color,
      pass: true,
      moveNumber: this.movesList.length + 1
    };

    this.lastMove = moveObj;
    this.movesList.push(moveObj);
    this.turn = color === 'black' ? 'white' : 'black';

    if (this.consecutivePasses >= 2) {
      this.isGameOver = true;
    }

    return moveObj;
  }

  public resign(color: Color = this.turn): Move {
    this.saveState();
    const moveObj: Move = {
      x: -1,
      y: -1,
      color,
      resign: true,
      moveNumber: this.movesList.length + 1
    };

    this.lastMove = moveObj;
    this.movesList.push(moveObj);
    this.isGameOver = true;
    return moveObj;
  }

  public undo(): boolean {
    if (this.history.length === 0) return false;

    const prevState = this.history.pop()!;
    this.grid = prevState.grid.map(row => [...row]);
    this.turn = prevState.turn;
    this.captures = { ...prevState.captures };
    this.lastMove = prevState.lastMove ? { ...prevState.lastMove } : null;
    this.koPoint = prevState.koPoint ? { ...prevState.koPoint } : null;
    this.consecutivePasses = 0;
    this.isGameOver = false;
    this.movesList.pop();

    return true;
  }

  private saveState(): void {
    this.history.push({
      grid: this.grid.map(row => [...row]),
      turn: this.turn,
      captures: { ...this.captures },
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      koPoint: this.koPoint ? { ...this.koPoint } : null
    });
  }

  public setHandicap(numStones: number): void {
    if (numStones < 2 || numStones > 9) return;
    this.reset(this.size);

    const hoshiMap: Record<BoardSize, Point[]> = {
      19: [
        { x: 3, y: 3 }, { x: 15, y: 15 }, { x: 15, y: 3 }, { x: 3, y: 15 }, // 4 corners
        { x: 9, y: 9 }, // tengen
        { x: 3, y: 9 }, { x: 15, y: 9 }, // sides
        { x: 9, y: 3 }, { x: 9, y: 15 }  // sides
      ],
      13: [
        { x: 3, y: 3 }, { x: 9, y: 9 }, { x: 9, y: 3 }, { x: 3, y: 9 },
        { x: 6, y: 6 },
        { x: 3, y: 6 }, { x: 9, y: 6 },
        { x: 6, y: 3 }, { x: 6, y: 9 }
      ],
      9: [
        { x: 2, y: 2 }, { x: 6, y: 6 }, { x: 6, y: 2 }, { x: 2, y: 6 },
        { x: 4, y: 4 },
        { x: 2, y: 4 }, { x: 6, y: 4 },
        { x: 4, y: 2 }, { x: 4, y: 6 }
      ]
    };

    const points = hoshiMap[this.size] || [];
    let selectedPoints: Point[] = [];

    switch (numStones) {
      case 2:
        selectedPoints = [points[1], points[2]]; // top-right, bottom-left
        break;
      case 3:
        selectedPoints = [points[1], points[2], points[0]];
        break;
      case 4:
        selectedPoints = [points[0], points[1], points[2], points[3]];
        break;
      case 5:
        selectedPoints = [points[0], points[1], points[2], points[3], points[4]];
        break;
      case 6:
        selectedPoints = [points[0], points[1], points[2], points[3], points[5], points[6]];
        break;
      case 7:
        selectedPoints = [points[0], points[1], points[2], points[3], points[4], points[5], points[6]];
        break;
      case 8:
        selectedPoints = [points[0], points[1], points[2], points[3], points[5], points[6], points[7], points[8]];
        break;
      case 9:
        selectedPoints = points.slice(0, 9);
        break;
    }

    for (const pt of selectedPoints) {
      this.grid[pt.y][pt.x] = 'black';
    }

    // When handicap is used, White plays first
    this.turn = 'white';
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

  public getAllGroups(): { points: Point[]; liberties: Set<string>; color: Color }[] {
    const groups: { points: Point[]; liberties: Set<string>; color: Color }[] = [];
    const visited = new Set<string>();

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const key = `${x},${y}`;
        if (this.grid[y][x] !== null && !visited.has(key)) {
          const grp = this.getGroup(x, y);
          if (grp) {
            for (const pt of grp.points) {
              visited.add(`${pt.x},${pt.y}`);
            }
            groups.push(grp);
          }
        }
      }
    }
    return groups;
  }

  public getHoshiPoints(): Point[] {
    if (this.size === 19) {
      const coords = [3, 9, 15];
      const pts: Point[] = [];
      for (const y of coords) {
        for (const x of coords) {
          pts.push({ x, y });
        }
      }
      return pts;
    } else if (this.size === 13) {
      return [
        { x: 3, y: 3 }, { x: 9, y: 3 }, { x: 6, y: 6 },
        { x: 3, y: 9 }, { x: 9, y: 9 }
      ];
    } else if (this.size === 9) {
      return [
        { x: 2, y: 2 }, { x: 6, y: 2 }, { x: 4, y: 4 },
        { x: 2, y: 6 }, { x: 6, y: 6 }
      ];
    }
    return [];
  }
}
