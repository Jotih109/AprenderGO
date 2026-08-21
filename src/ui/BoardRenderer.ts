import { BoardSize, BoardTheme, Color, Point, StoneState, AlternativeMove } from '../types/go';
import { GoBoard } from '../core/GoBoard';

export interface RenderOptions {
  theme: BoardTheme;
  showCoordinates: boolean;
  showMoveNumbers: boolean;
  showInfluenceMap: boolean;
  influenceMatrix?: number[][];
  influenceOwnership?: ('black' | 'white' | 'neutral')[][];
  hoverPoint: Point | null;
  currentTurn: Color;
  lastMove: Point | null;
  aiHint: { point: Point; score?: number; winRate?: number } | null;
  deadStones?: Set<string>;
  territoryMap?: ('black' | 'white' | 'dame' | null)[][];
  isScoringPhase?: boolean;
  // Review Overlays
  reviewBadge?: { point: Point; symbol: string; color: string } | null;
  reviewAlternatives?: AlternativeMove[];
  variationGhostMoves?: { point: Point; color: Color; step: number }[];
}

export class BoardRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = 600;
  private height: number = 600;
  private dpr: number = 1;

  // Board layout metrics
  public padding: number = 36;
  public cellSize: number = 30;
  public boardSize: BoardSize = 19;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Cannot get 2D context');
    this.ctx = context;
    this.dpr = window.devicePixelRatio || 1;
  }

  public resize(width: number, height: number, boardSize: BoardSize = 19): void {
    this.width = width;
    this.height = height;
    this.boardSize = boardSize;
    this.dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    // Recalculate cell metrics
    const minDim = Math.min(width, height);
    this.padding = Math.max(24, Math.floor(minDim * 0.055));
    const playableArea = minDim - this.padding * 2;
    this.cellSize = playableArea / (this.boardSize - 1);
  }

  public screenToBoard(screenX: number, screenY: number): Point | null {
    const rect = this.canvas.getBoundingClientRect();
    const offsetX = (this.width - (this.padding * 2 + (this.boardSize - 1) * this.cellSize)) / 2;
    const offsetY = (this.height - (this.padding * 2 + (this.boardSize - 1) * this.cellSize)) / 2;

    const canvasX = screenX - rect.left;
    const canvasY = screenY - rect.top;

    const boardStartX = offsetX + this.padding;
    const boardStartY = offsetY + this.padding;

    const rawX = (canvasX - boardStartX) / this.cellSize;
    const rawY = (canvasY - boardStartY) / this.cellSize;

    const gridX = Math.round(rawX);
    const gridY = Math.round(rawY);

    if (
      gridX >= 0 &&
      gridX < this.boardSize &&
      gridY >= 0 &&
      gridY < this.boardSize &&
      Math.hypot(rawX - gridX, rawY - gridY) <= 0.48
    ) {
      return { x: gridX, y: gridY };
    }
    return null;
  }

  public render(board: GoBoard, options: RenderOptions): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    const offsetX = (this.width - (this.padding * 2 + (this.boardSize - 1) * this.cellSize)) / 2;
    const offsetY = (this.height - (this.padding * 2 + (this.boardSize - 1) * this.cellSize)) / 2;

    // 1. Render Board Background & Wood Grain
    this.drawBoardBackground(options.theme);

    // 2. Render Coordinates
    if (options.showCoordinates) {
      this.drawCoordinates(options.theme, offsetX, offsetY);
    }

    // 3. Render Grid Lines and Hoshi Star Points
    this.drawGridAndHoshi(board, options.theme, offsetX, offsetY);

    // 4. Render Influence & Territory Heatmap Overlay (if active)
    if (options.showInfluenceMap && options.influenceMatrix) {
      this.drawInfluenceHeatmap(options.influenceMatrix, offsetX, offsetY);
    }

    // 5. Render Territory Scoring Markers (if in scoring phase)
    if (options.isScoringPhase && options.territoryMap) {
      this.drawTerritoryMarkers(options.territoryMap, offsetX, offsetY);
    }

    // 6. Render Stones
    this.drawStones(board, options, offsetX, offsetY);

    // 7. Render Review Badges (e.g. ☠️, 🌟, 🟢 on the reviewed move)
    if (options.reviewBadge) {
      this.drawReviewBadge(options.reviewBadge, offsetX, offsetY);
    }

    // 8. Render Review Alternative Suggestions
    if (options.reviewAlternatives && options.reviewAlternatives.length > 0) {
      this.drawReviewAlternatives(options.reviewAlternatives, offsetX, offsetY);
    }

    // 9. Render Variation Preview Ghost Moves
    if (options.variationGhostMoves && options.variationGhostMoves.length > 0) {
      this.drawVariationGhostMoves(options.variationGhostMoves, offsetX, offsetY);
    }

    // 10. Render AI Hint
    if (options.aiHint) {
      this.drawAiHint(options.aiHint, offsetX, offsetY);
    }

    // 11. Render Hover Ghost Stone
    if (options.hoverPoint && !board.isGameOver && !options.isScoringPhase) {
      this.drawGhostStone(board, options.hoverPoint, options.currentTurn, offsetX, offsetY);
    }

    ctx.restore();
  }

  private drawBoardBackground(theme: BoardTheme): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    if (theme === 'kaya') {
      const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w * 0.7);
      grad.addColorStop(0, '#e8b872');
      grad.addColorStop(0.6, '#dc9e4f');
      grad.addColorStop(1, '#c88636');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.strokeStyle = 'rgba(160, 95, 20, 0.08)';
      ctx.lineWidth = 1.2;
      for (let y = 0; y < h; y += 4) {
        ctx.beginPath();
        ctx.moveTo(0, y + Math.sin(y * 0.05) * 2);
        ctx.bezierCurveTo(
          w * 0.3,
          y + Math.sin(y * 0.04) * 5,
          w * 0.7,
          y - Math.sin(y * 0.03) * 4,
          w,
          y + Math.sin(y * 0.06) * 3
        );
        ctx.stroke();
      }
      ctx.restore();

      ctx.strokeStyle = 'rgba(70, 35, 5, 0.4)';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, w - 4, h - 4);
    } else if (theme === 'dark') {
      const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w * 0.8);
      grad.addColorStop(0, '#24272e');
      grad.addColorStop(0.7, '#181a20');
      grad.addColorStop(1, '#0f1115');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, w - 4, h - 4);
    } else if (theme === 'cyber') {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#090d16');
      grad.addColorStop(0.5, '#050811');
      grad.addColorStop(1, '#03050a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
      ctx.lineWidth = 3;
      ctx.strokeRect(3, 3, w - 6, h - 6);
    } else {
      const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w * 0.75);
      grad.addColorStop(0, '#fbf8f1');
      grad.addColorStop(1, '#ece5d6');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(100, 90, 75, 0.2)';
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, w - 4, h - 4);
    }
  }

  private drawCoordinates(theme: BoardTheme, offsetX: number, offsetY: number): void {
    const ctx = this.ctx;
    const size = this.boardSize;
    const startX = offsetX + this.padding;
    const startY = offsetY + this.padding;

    ctx.save();
    ctx.font = `600 ${Math.max(10, Math.floor(this.cellSize * 0.36))}px 'Inter', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (theme === 'kaya') ctx.fillStyle = 'rgba(80, 45, 10, 0.75)';
    else if (theme === 'dark') ctx.fillStyle = 'rgba(180, 190, 210, 0.65)';
    else if (theme === 'cyber') ctx.fillStyle = 'rgba(0, 240, 255, 0.7)';
    else ctx.fillStyle = 'rgba(90, 80, 70, 0.75)';

    const letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
    for (let x = 0; x < size; x++) {
      const char = letters[x] || '';
      const posX = startX + x * this.cellSize;
      ctx.fillText(char, posX, startY - this.cellSize * 0.65);
      ctx.fillText(char, posX, startY + (size - 1) * this.cellSize + this.cellSize * 0.65);
    }

    for (let y = 0; y < size; y++) {
      const numStr = (size - y).toString();
      const posY = startY + y * this.cellSize;
      ctx.fillText(numStr, startX - this.cellSize * 0.65, posY);
      ctx.fillText(numStr, startX + (size - 1) * this.cellSize + this.cellSize * 0.65, posY);
    }

    ctx.restore();
  }

  private drawGridAndHoshi(board: GoBoard, theme: BoardTheme, offsetX: number, offsetY: number): void {
    const ctx = this.ctx;
    const size = this.boardSize;
    const startX = offsetX + this.padding;
    const startY = offsetY + this.padding;
    const endX = startX + (size - 1) * this.cellSize;
    const endY = startY + (size - 1) * this.cellSize;

    ctx.save();
    ctx.lineWidth = 1.1;

    if (theme === 'kaya') ctx.strokeStyle = '#3d250d';
    else if (theme === 'dark') ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    else if (theme === 'cyber') ctx.strokeStyle = 'rgba(0, 220, 255, 0.4)';
    else ctx.strokeStyle = '#2b261f';

    for (let i = 0; i < size; i++) {
      const pos = startX + i * this.cellSize;
      ctx.beginPath();
      ctx.moveTo(pos, startY);
      ctx.lineTo(pos, endY);
      ctx.stroke();

      const hPos = startY + i * this.cellSize;
      ctx.beginPath();
      ctx.moveTo(startX, hPos);
      ctx.lineTo(endX, hPos);
      ctx.stroke();
    }

    const hoshiPts = board.getHoshiPoints();
    const hoshiRadius = Math.max(2.2, this.cellSize * 0.09);

    if (theme === 'kaya') ctx.fillStyle = '#2c1b0c';
    else if (theme === 'dark') ctx.fillStyle = '#e2e8f0';
    else if (theme === 'cyber') ctx.fillStyle = '#00f0ff';
    else ctx.fillStyle = '#1a1612';

    for (const pt of hoshiPts) {
      const px = startX + pt.x * this.cellSize;
      const py = startY + pt.y * this.cellSize;

      ctx.beginPath();
      ctx.arc(px, py, hoshiRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawStones(board: GoBoard, options: RenderOptions, offsetX: number, offsetY: number): void {
    const size = this.boardSize;
    const startX = offsetX + this.padding;
    const startY = offsetY + this.padding;
    const stoneRadius = this.cellSize * 0.47;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const stone = board.grid[y][x];
        if (!stone) continue;

        const px = startX + x * this.cellSize;
        const py = startY + y * this.cellSize;
        const key = `${x},${y}`;
        const isDead = options.deadStones?.has(key);

        this.drawSingleStone(px, py, stoneRadius, stone, options.theme, isDead);

        if (options.lastMove && options.lastMove.x === x && options.lastMove.y === y) {
          this.drawLastMoveMarker(px, py, stoneRadius, stone, options.theme);
        }

        if (isDead) {
          this.drawDeadStoneMarker(px, py, stoneRadius);
        }
      }
    }

    if (options.showMoveNumbers) {
      this.drawMoveNumbers(board, startX, startY, stoneRadius);
    }
  }

  private drawSingleStone(
    px: number,
    py: number,
    radius: number,
    color: Color,
    theme: BoardTheme,
    isDimmed: boolean = false
  ): void {
    const ctx = this.ctx;
    ctx.save();

    if (isDimmed) {
      ctx.globalAlpha = 0.38;
    }

    ctx.beginPath();
    ctx.arc(px + radius * 0.12, py + radius * 0.15, radius * 0.96, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);

    if (color === 'black') {
      if (theme === 'cyber') {
        const grad = ctx.createRadialGradient(
          px - radius * 0.3,
          py - radius * 0.35,
          radius * 0.05,
          px,
          py,
          radius
        );
        grad.addColorStop(0, '#334155');
        grad.addColorStop(0.5, '#0f172a');
        grad.addColorStop(0.95, '#020617');
        grad.addColorStop(1, '#00f0ff');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        const grad = ctx.createRadialGradient(
          px - radius * 0.32,
          py - radius * 0.35,
          radius * 0.08,
          px,
          py,
          radius
        );
        grad.addColorStop(0, '#4a4d53');
        grad.addColorStop(0.3, '#2a2c30');
        grad.addColorStop(0.8, '#141518');
        grad.addColorStop(1, '#090a0c');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(
          px - radius * 0.28,
          py - radius * 0.3,
          radius * 0.26,
          radius * 0.16,
          -Math.PI / 4,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.fill();
      }
    } else {
      if (theme === 'cyber') {
        const grad = ctx.createRadialGradient(
          px - radius * 0.3,
          py - radius * 0.35,
          radius * 0.05,
          px,
          py,
          radius
        );
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.7, '#e0f2fe');
        grad.addColorStop(1, '#38bdf8');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        const grad = ctx.createRadialGradient(
          px - radius * 0.35,
          py - radius * 0.35,
          radius * 0.1,
          px,
          py,
          radius
        );
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.5, '#f4f4f6');
        grad.addColorStop(0.85, '#e2e3e7');
        grad.addColorStop(1, '#c0c2c8');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(180, 180, 190, 0.18)';
        ctx.lineWidth = 0.8;
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath();
          ctx.arc(px + i * 4, py + radius * 1.5, radius * 1.6, -Math.PI * 0.8, -Math.PI * 0.2);
          ctx.stroke();
        }
        ctx.restore();

        ctx.beginPath();
        ctx.ellipse(
          px - radius * 0.25,
          py - radius * 0.28,
          radius * 0.3,
          radius * 0.18,
          -Math.PI / 4,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawLastMoveMarker(px: number, py: number, radius: number, color: Color, theme: BoardTheme): void {
    const ctx = this.ctx;
    ctx.save();
    const ringRadius = radius * 0.44;
    ctx.beginPath();
    ctx.arc(px, py, ringRadius, 0, Math.PI * 2);

    if (theme === 'cyber') {
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2.5;
    } else {
      ctx.strokeStyle = color === 'black' ? '#ffffff' : '#1e293b';
      ctx.lineWidth = 2.2;
    }

    ctx.stroke();
    ctx.restore();
  }

  private drawMoveNumbers(board: GoBoard, startX: number, startY: number, radius: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.max(9, Math.floor(radius * 0.72))}px 'Inter', sans-serif`;

    const lastMovesMap = new Map<string, number>();
    board.movesList.forEach((m, idx) => {
      if (!m.pass && !m.resign && m.x >= 0 && m.y >= 0) {
        lastMovesMap.set(`${m.x},${m.y}`, idx + 1);
      }
    });

    for (const [key, moveNum] of lastMovesMap.entries()) {
      const [x, y] = key.split(',').map(Number);
      const stone = board.grid[y][x];
      if (stone) {
        const px = startX + x * this.cellSize;
        const py = startY + y * this.cellSize;
        ctx.fillStyle = stone === 'black' ? '#ffffff' : '#0f172a';
        ctx.fillText(moveNum.toString(), px, py);
      }
    }

    ctx.restore();
  }

  private drawGhostStone(board: GoBoard, pt: Point, turn: Color, offsetX: number, offsetY: number): void {
    const ctx = this.ctx;
    const startX = offsetX + this.padding;
    const startY = offsetY + this.padding;
    const px = startX + pt.x * this.cellSize;
    const py = startY + pt.y * this.cellSize;
    const radius = this.cellSize * 0.46;

    const isValid = board.isValidMove(pt.x, pt.y, turn).valid;

    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);

    if (isValid) {
      ctx.fillStyle = turn === 'black' ? 'rgba(15, 23, 42, 0.45)' : 'rgba(255, 255, 255, 0.65)';
      ctx.fill();
      ctx.strokeStyle = turn === 'black' ? 'rgba(255, 255, 255, 0.4)' : 'rgba(15, 23, 42, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px - radius * 0.4, py - radius * 0.4);
      ctx.lineTo(px + radius * 0.4, py + radius * 0.4);
      ctx.moveTo(px + radius * 0.4, py - radius * 0.4);
      ctx.lineTo(px - radius * 0.4, py + radius * 0.4);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawInfluenceHeatmap(matrix: number[][], offsetX: number, offsetY: number): void {
    const ctx = this.ctx;
    const size = this.boardSize;
    const startX = offsetX + this.padding;
    const startY = offsetY + this.padding;

    ctx.save();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const val = matrix[y][x];
        const absVal = Math.abs(val);
        if (absVal < 0.1) continue;

        const px = startX + x * this.cellSize;
        const py = startY + y * this.cellSize;
        const r = this.cellSize * 0.38 * Math.min(1.0, absVal * 1.3);

        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);

        if (val > 0) {
          ctx.fillStyle = `rgba(15, 23, 42, ${Math.min(0.55, absVal * 0.6)})`;
        } else {
          ctx.fillStyle = `rgba(59, 130, 246, ${Math.min(0.55, absVal * 0.6)})`;
        }
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawTerritoryMarkers(
    territoryMap: ('black' | 'white' | 'dame' | null)[][],
    offsetX: number,
    offsetY: number
  ): void {
    const ctx = this.ctx;
    const size = this.boardSize;
    const startX = offsetX + this.padding;
    const startY = offsetY + this.padding;
    const squareSize = this.cellSize * 0.28;

    ctx.save();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const owner = territoryMap[y][x];
        if (!owner || owner === 'dame') continue;

        const px = startX + x * this.cellSize;
        const py = startY + y * this.cellSize;

        ctx.beginPath();
        ctx.rect(px - squareSize / 2, py - squareSize / 2, squareSize, squareSize);

        if (owner === 'black') {
          ctx.fillStyle = '#0f172a';
          ctx.strokeStyle = '#ffffff';
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#0f172a';
        }

        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawDeadStoneMarker(px: number, py: number, radius: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;

    const crossSize = radius * 0.5;
    ctx.beginPath();
    ctx.moveTo(px - crossSize, py - crossSize);
    ctx.lineTo(px + crossSize, py + crossSize);
    ctx.moveTo(px + crossSize, py - crossSize);
    ctx.lineTo(px - crossSize, py + crossSize);
    ctx.stroke();

    ctx.restore();
  }

  private drawAiHint(
    hint: { point: Point; winRate?: number; score?: number },
    offsetX: number,
    offsetY: number
  ): void {
    const ctx = this.ctx;
    const startX = offsetX + this.padding;
    const startY = offsetY + this.padding;
    const px = startX + hint.point.x * this.cellSize;
    const py = startY + hint.point.y * this.cellSize;
    const radius = this.cellSize * 0.44;

    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(px, py, radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (hint.winRate !== undefined) {
      const pct = Math.round(hint.winRate * 100);
      ctx.font = `bold 10px 'Inter', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const tagWidth = 32;
      const tagHeight = 16;
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.roundRect(px - tagWidth / 2, py - radius - 18, tagWidth, tagHeight, 4);
      ctx.fill();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`${pct}%`, px, py - radius - 10);
    }

    ctx.restore();
  }

  // -------------------------------------------------------------
  // POST-GAME REVIEW OVERLAYS
  // -------------------------------------------------------------

  private drawReviewBadge(badge: { point: Point; symbol: string; color: string }, offsetX: number, offsetY: number): void {
    const ctx = this.ctx;
    const startX = offsetX + this.padding;
    const startY = offsetY + this.padding;
    const px = startX + badge.point.x * this.cellSize;
    const py = startY + badge.point.y * this.cellSize;
    const radius = this.cellSize * 0.46;

    ctx.save();
    // Highlight glow ring around the move stone
    ctx.beginPath();
    ctx.arc(px, py, radius + 3, 0, Math.PI * 2);
    ctx.strokeStyle = badge.color;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Floating Badge Tag above the stone
    const badgeSize = Math.max(22, this.cellSize * 0.7);
    const bx = px + radius * 0.6;
    const by = py - radius * 0.6;

    ctx.beginPath();
    ctx.arc(bx, by, badgeSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = badge.color;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = `${Math.floor(badgeSize * 0.65)}px 'Inter', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badge.symbol, bx, by);

    ctx.restore();
  }

  private drawReviewAlternatives(alternatives: AlternativeMove[], offsetX: number, offsetY: number): void {
    const ctx = this.ctx;
    const startX = offsetX + this.padding;
    const startY = offsetY + this.padding;
    const labels = ['A', 'B', 'C'];

    ctx.save();
    alternatives.slice(0, 3).forEach((alt, idx) => {
      const px = startX + alt.point.x * this.cellSize;
      const py = startY + alt.point.y * this.cellSize;
      const radius = this.cellSize * 0.44;

      // Dashed circle around recommended spot
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Badge letter
      ctx.beginPath();
      ctx.arc(px, py, radius * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(16, 185, 129, 0.88)';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(10, Math.floor(radius * 0.65))}px 'Inter', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[idx], px, py);
    });
    ctx.restore();
  }

  private drawVariationGhostMoves(ghostMoves: { point: Point; color: Color; step: number }[], offsetX: number, offsetY: number): void {
    const ctx = this.ctx;
    const startX = offsetX + this.padding;
    const startY = offsetY + this.padding;
    const radius = this.cellSize * 0.46;

    ctx.save();
    ghostMoves.forEach((gm) => {
      const px = startX + gm.point.x * this.cellSize;
      const py = startY + gm.point.y * this.cellSize;

      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);

      if (gm.color === 'black') {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#0f172a';
      }

      ctx.font = `bold ${Math.max(10, Math.floor(radius * 0.7))}px 'Inter', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(gm.step.toString(), px, py);
      ctx.restore();
    });
    ctx.restore();
  }
}
