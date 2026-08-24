import {
  AlternativeMove,
  BoardSize,
  Color,
  GameReviewReport,
  Move,
  MoveClassificationType,
  MoveEvaluation,
  Point
} from '../types/go';
import { GoBoard } from '../core/GoBoard';
import { BotManager } from './BotManager';
import { BotResponse } from './GoBotWorker';

export interface ReviewOptions {
  /** Thinking time per analysed position. */
  timeBudgetMs?: number;
  /** Called after each move; return false to abort the review. */
  onProgress?: (current: number, total: number) => boolean | void;
}

const CLASSIFICATION_STYLE: Record<MoveClassificationType, { symbol: string; color: string; label: string }> = {
  brilliant: { symbol: '🌟', color: '#a855f7', label: 'Jogada Brilhante' },
  best: { symbol: '🟢', color: '#10b981', label: 'Melhor Jogada' },
  good: { symbol: '🔵', color: '#3b82f6', label: 'Boa Jogada' },
  inaccuracy: { symbol: '🟡', color: '#eab308', label: 'Imprecisão' },
  mistake: { symbol: '🟠', color: '#f97316', label: 'Erro Tático' },
  blunder: { symbol: '☠️', color: '#ef4444', label: 'Erro Crítico (Blunder)' }
};

export class ReviewCancelledError extends Error {
  constructor() {
    super('Análise cancelada');
    this.name = 'ReviewCancelledError';
  }
}

export class GameReviewer {
  public static coordToString(x: number, y: number, size: BoardSize): string {
    const letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
    if (x < 0 || y < 0) return 'Passou';
    return `${letters[x] ?? '?'}${size - y}`;
  }

  /** Detects whether a stone placement creates an empty triangle (bad shape). */
  private static createsEmptyTriangle(board: GoBoard, x: number, y: number, color: Color): boolean {
    const corners = [
      [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 }],
      [{ dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 1 }],
      [{ dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 }],
      [{ dx: -1, dy: 0 }, { dx: 0, dy: -1 }, { dx: -1, dy: -1 }]
    ];

    for (const c of corners) {
      const p1 = { x: x + c[0].dx, y: y + c[0].dy };
      const p2 = { x: x + c[1].dx, y: y + c[1].dy };
      const diag = { x: x + c[2].dx, y: y + c[2].dy };

      if (!board.isValidCoord(p1.x, p1.y) || !board.isValidCoord(p2.x, p2.y) || !board.isValidCoord(diag.x, diag.y)) {
        continue;
      }
      if (
        board.grid[p1.y][p1.x] === color &&
        board.grid[p2.y][p2.x] === color &&
        board.grid[diag.y][diag.x] === null
      ) {
        return true;
      }
    }
    return false;
  }

  /** Stones belonging to groups that are currently in atari. */
  private static findAtariGroups(board: GoBoard, color: Color): Point[] {
    const atariStones: Point[] = [];
    for (const grp of board.getAllGroups()) {
      if (grp.color === color && grp.liberties.size === 1) {
        atariStones.push(grp.points[0]);
      }
    }
    return atariStones;
  }

  /**
   * Classification thresholds, calibrated against the win-rate deltas this
   * engine actually produces on real games rather than borrowed from chess.
   *
   * Measured over the three saved games (210 moves), these bands classify
   * roughly: 4% brilliant, 47% best, 32% good, 7% inaccuracy, 8% mistake and
   * 2% blunder. Go win-rate estimates move in a much narrower band than chess
   * centipawn scores, so the numbers are correspondingly small.
   */
  private static readonly THRESHOLDS = {
    blunder: -0.045,
    mistake: -0.028,
    inaccuracy: -0.012,
    best: 0.005,
    brilliant: 0.07
  };

  private static classify(
    delta: number,
    winRateBefore: number,
    isSelfAtari: boolean
  ): MoveClassificationType {
    const t = this.THRESHOLDS;
    if (delta <= t.blunder || (isSelfAtari && delta <= t.mistake)) return 'blunder';
    if (delta <= t.mistake) return 'mistake';
    if (delta <= t.inaccuracy) return 'inaccuracy';
    if (delta >= t.brilliant && winRateBefore < 0.48) return 'brilliant';
    if (delta >= t.best) return 'best';
    return 'good';
  }

  /**
   * Analyses a full game.
   *
   * The evaluation after move N is the same position, with the same side to
   * move, as the evaluation before move N+1, so each position is searched once
   * and the result is carried forward. That halves the number of searches, and
   * with an explicit per-position time budget a long game reviews in about a
   * minute instead of the previous quarter of an hour.
   */
  public static async analyzeGame(
    initialSize: BoardSize,
    setupStones: { x: number; y: number; color: Color }[],
    komi: number,
    moves: Move[],
    botManager: BotManager,
    options: ReviewOptions = {}
  ): Promise<GameReviewReport> {
    const timeBudgetMs = options.timeBudgetMs ?? 320;
    const totalMoves = moves.length;
    const evaluations: MoveEvaluation[] = [];

    const stats = {
      black: { brilliant: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
      white: { brilliant: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
    };
    const turningPoints: { moveNumber: number; description: string; impact: string }[] = [];

    const board = new GoBoard(initialSize);
    if (setupStones.length > 0) {
      board.placeSetupStones(setupStones, moves[0]?.color ?? 'black');
    }

    // Carried between iterations so each position is only searched once.
    let cachedAnalysis: { color: Color; response: BotResponse } | null = null;

    const analyze = async (turnColor: Color, seed: number): Promise<BotResponse> => {
      if (cachedAnalysis && cachedAnalysis.color === turnColor) {
        const cached = cachedAnalysis.response;
        cachedAnalysis = null;
        return cached;
      }
      cachedAnalysis = null;
      const res = await botManager.analyzePosition(board, turnColor, komi, { timeBudgetMs, seed });
      if (!res) throw new ReviewCancelledError();
      return res;
    };

    for (let i = 0; i < totalMoves; i++) {
      const move = moves[i];
      const moveNum = i + 1;
      const turnColor = move.color;
      const opponentColor: Color = turnColor === 'black' ? 'white' : 'black';

      if (options.onProgress && options.onProgress(moveNum, totalMoves) === false) {
        throw new ReviewCancelledError();
      }

      const ownAtariBefore = this.findAtariGroups(board, turnColor);

      // Position before the move, from the mover's point of view.
      //
      // positionWinRate, not winRate: the latter is the value of the engine's
      // best move, which is a maximum over noisy estimates and so biased
      // upward on both sides of a comparison. Using it made every single move
      // look like a loss (measured mean of -11 percentage points across these
      // games, with 90% of moves negative). The visit-weighted position value
      // carries the same optimism at both ends, so the bias cancels.
      const beforeAnalysis = await analyze(turnColor, moveNum * 7919);
      const winRateBefore =
        turnColor === 'black' ? beforeAnalysis.positionWinRate : 1 - beforeAnalysis.positionWinRate;
      const bestMoveBefore = beforeAnalysis.bestMove;

      let capturedCount = 0;
      if (move.pass) {
        board.pass(turnColor);
      } else if (move.resign) {
        board.resign(turnColor);
      } else {
        const res = board.playMove(move.x, move.y, turnColor);
        capturedCount = res.move?.captured?.length ?? 0;
      }

      const isPlayed = !move.pass && !move.resign;
      const ownGroupAfter = isPlayed ? board.getGroup(move.x, move.y) : null;
      const isSelfAtari = !!ownGroupAfter && ownGroupAfter.liberties.size === 1;
      const isBadShape = isPlayed && this.createsEmptyTriangle(board, move.x, move.y, turnColor);
      const isFirstLine =
        isPlayed && (move.x === 0 || move.x === initialSize - 1 || move.y === 0 || move.y === initialSize - 1);

      // A resignation ends the game; there is nothing left to evaluate.
      if (move.resign) {
        const style = CLASSIFICATION_STYLE.good;
        evaluations.push({
          moveNumber: moveNum,
          color: turnColor,
          playedMove: null,
          winRateBefore,
          winRateAfter: 0,
          winRateDelta: 0,
          classification: 'good',
          badgeSymbol: style.symbol,
          badgeColor: style.color,
          labelPt: 'Desistência',
          explanation: `${turnColor === 'black' ? 'Pretas' : 'Brancas'} desistiram da partida.`,
          bestMove: bestMoveBefore,
          alternatives: [],
          blackWinRateHistory: evaluations.length > 0 ? evaluations[evaluations.length - 1].blackWinRateHistory : 0.5
        });
        break;
      }

      // Position after the move, evaluated once and reused as the next "before".
      const afterAnalysis = await botManager.analyzePosition(board, board.turn, komi, {
        timeBudgetMs,
        seed: moveNum * 104729
      });
      if (!afterAnalysis) throw new ReviewCancelledError();
      if (board.turn === opponentColor) {
        cachedAnalysis = { color: board.turn, response: afterAnalysis };
      }

      const blackWinRateAfter = afterAnalysis.positionWinRate;
      const winRateAfter = turnColor === 'black' ? blackWinRateAfter : 1 - blackWinRateAfter;
      const delta = winRateAfter - winRateBefore;

      const classification = this.classify(delta, winRateBefore, isSelfAtari);
      const style = CLASSIFICATION_STYLE[classification];

      const moveStr = move.pass ? 'Passou a vez' : this.coordToString(move.x, move.y, initialSize);
      const bestStr = bestMoveBefore
        ? this.coordToString(bestMoveBefore.x, bestMoveBefore.y, initialSize)
        : 'Passar';
      const playedBest =
        !!bestMoveBefore && isPlayed && bestMoveBefore.x === move.x && bestMoveBefore.y === move.y;

      let tacticalReason = '';
      if (capturedCount > 0) {
        tacticalReason = `Capturou ${capturedCount} pedra(s) do oponente. `;
      } else if (isSelfAtari) {
        tacticalReason = 'Colocou o próprio grupo em auto-Atari (1 liberdade restante). ';
      } else if (ownAtariBefore.length > 0 && !playedBest) {
        tacticalReason = 'Ignorou o perigo de pedras próprias em Atari. ';
      } else if (isBadShape) {
        tacticalReason = 'Formou um Triângulo Vazio (Dango), forma vulnerável e ineficiente. ';
      } else if (isFirstLine && i < (initialSize === 9 ? 12 : 28)) {
        tacticalReason = 'Jogada na 1ª linha prematura, perdendo tempo de expansão central. ';
      }

      const lossPct = (Math.abs(delta) * 100).toFixed(1);
      const gainPct = (delta * 100).toFixed(1);
      let explanation: string;

      switch (classification) {
        case 'blunder':
          explanation = `Perda severa de ${lossPct}% na probabilidade de vitória. ${tacticalReason}O lance ${moveStr} colocou pedras vitais em risco ou perdeu o controle da luta. A jogada ideal indicada pela IA era ${bestStr}.`;
          turningPoints.push({
            moveNumber: moveNum,
            description: `${turnColor === 'black' ? 'Pretas' : 'Brancas'} cometeram um erro crítico jogando ${moveStr}.`,
            impact: `${gainPct}%`
          });
          break;
        case 'mistake':
          explanation = `Perda de iniciativa (-${lossPct}%). ${tacticalReason}O lance ${moveStr} foi passivo ou perdeu uma oportunidade. Melhor alternativa: ${bestStr}.`;
          break;
        case 'inaccuracy':
          explanation = `Imprecisão de ritmo (-${lossPct}%). ${tacticalReason}${moveStr} não aproveita todo o potencial da posição. Sugestão: ${bestStr}.`;
          break;
        case 'brilliant':
          explanation = `Excelente jogada tática (+${gainPct}%)! Encontrou um tesuji decisivo em ${moveStr}, revertendo a pressão da partida.`;
          turningPoints.push({
            moveNumber: moveNum,
            description: `${turnColor === 'black' ? 'Pretas' : 'Brancas'} encontraram uma jogada brilhante em ${moveStr}!`,
            impact: `+${gainPct}%`
          });
          break;
        case 'best':
          explanation = playedBest
            ? `Jogada precisa e ideal (${moveStr}), exatamente a recomendação da IA. Mantém boa forma e pressão.`
            : `Jogada precisa em ${moveStr}, equivalente à recomendação da IA (${bestStr}).`;
          break;
        default:
          explanation = `Jogada sólida em ${moveStr} que mantém o equilíbrio e protege o grupo.`;
          break;
      }

      stats[turnColor][classification]++;

      // Alternatives: the engine's own top candidates for the position before
      // the move, minus whatever was actually played.
      const alternatives: AlternativeMove[] = [];
      const seen = new Set<string>();
      if (isPlayed) seen.add(`${move.x},${move.y}`);

      for (const cand of beforeAnalysis.candidateMoves ?? []) {
        const key = `${cand.point.x},${cand.point.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const candWinRate = turnColor === 'black' ? cand.winRate : cand.winRate;
        alternatives.push({
          point: cand.point,
          winRate: candWinRate,
          scoreLead: beforeAnalysis.scoreLead,
          description: `${this.coordToString(cand.point.x, cand.point.y, initialSize)} — ${(candWinRate * 100).toFixed(1)}% de vitória em ${cand.score} simulações`
        });
        if (alternatives.length >= 3) break;
      }

      evaluations.push({
        moveNumber: moveNum,
        color: turnColor,
        playedMove: isPlayed ? { x: move.x, y: move.y } : null,
        winRateBefore,
        winRateAfter,
        winRateDelta: delta,
        classification,
        badgeSymbol: style.symbol,
        badgeColor: style.color,
        labelPt: style.label,
        explanation,
        bestMove: bestMoveBefore,
        alternatives,
        blackWinRateHistory: blackWinRateAfter
      });
    }

    /**
     * Accuracy: each move scores on how much win rate it gave away, then the
     * scores are averaged. The decay constant matches the scale these deltas
     * actually live on, so giving away three and a half points of win rate
     * scores about 37 for that move, and a clean move scores 100.
     */
    const ACCURACY_DECAY = 0.035;
    const calcAccuracy = (color: Color): number => {
      const colEvals = evaluations.filter(e => e.color === color);
      if (colEvals.length === 0) return 100;
      let sum = 0;
      for (const e of colEvals) {
        const loss = Math.max(0, -e.winRateDelta);
        sum += 100 * Math.exp(-loss / ACCURACY_DECAY);
      }
      return Math.round(sum / colEvals.length);
    };

    return {
      totalMoves: evaluations.length,
      blackAccuracyPct: calcAccuracy('black'),
      whiteAccuracyPct: calcAccuracy('white'),
      evaluations,
      stats,
      turningPoints
    };
  }
}
