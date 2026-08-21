import { BoardSize, Color, GameReviewReport, Move, MoveClassificationType, MoveEvaluation, Point, AlternativeMove } from '../types/go';
import { GoBoard } from '../core/GoBoard';
import { BotManager } from './BotManager';

export class GameReviewer {
  public static coordToString(x: number, y: number, size: BoardSize): string {
    const letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
    return `${letters[x]}${size - y}`;
  }

  /**
   * Detects if placing a stone creates an empty triangle (Dango / bad shape)
   */
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

      if (board.isValidCoord(p1.x, p1.y) && board.isValidCoord(p2.x, p2.y) && board.isValidCoord(diag.x, diag.y)) {
        if (
          board.grid[p1.y][p1.x] === color &&
          board.grid[p2.y][p2.x] === color &&
          board.grid[diag.y][diag.x] === null
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Finds any group currently in Atari (only 1 liberty)
   */
  private static findAtariGroups(board: GoBoard, color: Color): Point[] {
    const visited = new Set<string>();
    const atariStones: Point[] = [];

    for (let y = 0; y < board.size; y++) {
      for (let x = 0; x < board.size; x++) {
        if (board.grid[y][x] === color && !visited.has(`${x},${y}`)) {
          const grp = board.getGroup(x, y);
          if (grp) {
            for (const pt of grp.points) {
              visited.add(`${pt.x},${pt.y}`);
            }
            if (grp.liberties.size === 1) {
              atariStones.push({ x, y });
            }
          }
        }
      }
    }
    return atariStones;
  }

  /**
   * Performs an asynchronous post-game review of the match with progress reporting.
   */
  public static async analyzeGame(
    initialSize: BoardSize,
    handicap: number,
    komi: number,
    moves: Move[],
    botManager: BotManager,
    onProgress?: (current: number, total: number) => void
  ): Promise<GameReviewReport> {
    const totalMoves = moves.length;
    const evaluations: MoveEvaluation[] = [];

    const stats = {
      black: { brilliant: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
      white: { brilliant: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
    };

    const turningPoints: { moveNumber: number; description: string; impact: string }[] = [];

    // Replay board from scratch step-by-step
    const board = new GoBoard(initialSize);
    if (handicap >= 2) {
      board.setHandicap(handicap);
    }

    let blackWinRates: number[] = [];

    for (let i = 0; i < totalMoves; i++) {
      const move = moves[i];
      const moveNum = i + 1;
      const turnColor = move.color;
      const opponentColor: Color = turnColor === 'black' ? 'white' : 'black';

      if (onProgress) {
        onProgress(moveNum, totalMoves);
      }

      // Check board state BEFORE move
      const ownAtariBefore = this.findAtariGroups(board, turnColor);
      const oppAtariBefore = this.findAtariGroups(board, opponentColor);

      // 1. Evaluate position before move
      const beforeAnalysis = await botManager.analyzePosition(board, turnColor, komi);
      const winRateBefore = beforeAnalysis.winRate; // Perspective of turnColor (0..1)
      const bestMoveBefore = beforeAnalysis.bestMove;

      // 2. Play move
      let capturedCount = 0;
      if (move.pass) {
        board.pass(turnColor);
      } else if (move.resign) {
        board.resign(turnColor);
      } else {
        const res = board.playMove(move.x, move.y, turnColor);
        if (res.move?.captured) {
          capturedCount = res.move.captured.length;
        }
      }

      // Check board state AFTER move
      const ownGroupAfter = !move.pass && !move.resign ? board.getGroup(move.x, move.y) : null;
      const isSelfAtari = ownGroupAfter && ownGroupAfter.liberties.size === 1;
      const isBadShape = !move.pass && !move.resign && this.createsEmptyTriangle(board, move.x, move.y, turnColor);
      const isFirstLine = !move.pass && !move.resign && (move.x === 0 || move.x === initialSize - 1 || move.y === 0 || move.y === initialSize - 1);

      // 3. Evaluate position after move (from perspective of opponent)
      const afterAnalysis = await botManager.analyzePosition(board, board.turn, komi);
      // WinRate after for current player is 1 - opponent win rate
      const winRateAfter = 1 - afterAnalysis.winRate;
      const delta = winRateAfter - winRateBefore;

      // Track Black perspective win rate for graph
      const blackPerspectiveWR = turnColor === 'black' ? winRateAfter : 1 - winRateAfter;
      blackWinRates.push(blackPerspectiveWR);

      // 4. Classify move quality
      let classification: MoveClassificationType = 'best';
      let badgeSymbol = '🟢';
      let badgeColor = '#10b981';
      let labelPt = 'Melhor Jogada';
      let explanation = '';

      const moveStr = move.pass ? 'Passou a vez' : move.resign ? 'Desistiu' : this.coordToString(move.x, move.y, initialSize);
      const bestStr = bestMoveBefore ? this.coordToString(bestMoveBefore.x, bestMoveBefore.y, initialSize) : 'Passar';

      // Specific pedagogical reasons
      let tacticalReason = '';
      if (capturedCount > 0) {
        tacticalReason = `Capturou ${capturedCount} pedra(s) do oponente. `;
      } else if (isSelfAtari) {
        tacticalReason = `Colocou o próprio grupo em auto-Atari (1 liberdade restante). `;
      } else if (ownAtariBefore.length > 0 && (!bestMoveBefore || move.x !== bestMoveBefore.x || move.y !== bestMoveBefore.y)) {
        tacticalReason = `Ignorou o perigo de pedras próprias em Atari. `;
      } else if (isBadShape) {
        tacticalReason = `Formou um Triângulo Vazio (Dango), forma vulnerável e ineficiente. `;
      } else if (isFirstLine && i < (initialSize === 9 ? 12 : 28)) {
        tacticalReason = `Jogada na 1ª linha prematura, perdendo tempo de expansão central. `;
      }

      if (delta <= -0.20 || (isSelfAtari && delta <= -0.12)) {
        // Blunder (Very bad move -> ☠️)
        classification = 'blunder';
        badgeSymbol = '☠️';
        badgeColor = '#ef4444';
        labelPt = 'Erro Crítico (Blunder)';
        explanation = `Perda severa de ${(Math.abs(delta) * 100).toFixed(1)}% na probabilidade de vitória. ${tacticalReason}O lance ${moveStr} colocou pedras vitais em risco ou perdeu o controle da luta. A jogada ideal indicada pela IA era ${bestStr}.`;

        turningPoints.push({
          moveNumber: moveNum,
          description: `${turnColor === 'black' ? 'Pretas' : 'Brancas'} cometeram um erro crítico jogando ${moveStr}.`,
          impact: `${(delta * 100).toFixed(1)}%`
        });
      } else if (delta <= -0.09) {
        classification = 'mistake';
        badgeSymbol = '🟠';
        badgeColor = '#f97316';
        labelPt = 'Erro Tático';
        explanation = `Perda de iniciativa (-${(Math.abs(delta) * 100).toFixed(1)}%). ${tacticalReason}O lance ${moveStr} foi passivo ou perdeu oportunidade no canto/borda. Melhor alternativa recomendada: ${bestStr}.`;
      } else if (delta <= -0.04) {
        classification = 'inaccuracy';
        badgeSymbol = '🟡';
        badgeColor = '#eab308';
        labelPt = 'Imprecisão';
        explanation = `Imprecisão de ritmo (-${(Math.abs(delta) * 100).toFixed(1)}%). ${tacticalReason}${moveStr} não aproveita todo o potencial da posição. Sugestão: ${bestStr}.`;
      } else if (delta >= 0.10 && winRateBefore < 0.48) {
        classification = 'brilliant';
        badgeSymbol = '🌟';
        badgeColor = '#a855f7';
        labelPt = 'Jogada Brilhante';
        explanation = `Excelente jogada tática (+${(delta * 100).toFixed(1)}%)! Encontrou um Tesuji decisivo em ${moveStr} revertendo a pressão da partida.`;

        turningPoints.push({
          moveNumber: moveNum,
          description: `${turnColor === 'black' ? 'Pretas' : 'Brancas'} encontraram uma jogada brilhante em ${moveStr}!`,
          impact: `+${(delta * 100).toFixed(1)}%`
        });
      } else if (delta >= -0.02) {
        classification = 'best';
        badgeSymbol = '🟢';
        badgeColor = '#10b981';
        labelPt = 'Melhor Jogada';
        explanation = `Jogada precisa e ideal (${moveStr}), alinhada com a recomendação da IA. Mantém boa forma e pressão.`;
      } else {
        classification = 'good';
        badgeSymbol = '🔵';
        badgeColor = '#3b82f6';
        labelPt = 'Boa Jogada';
        explanation = `Jogada sólida em ${moveStr} que mantém o equilíbrio e protege o grupo.`;
      }

      stats[turnColor][classification]++;

      // 5. Generate Alternatives
      const alternatives: AlternativeMove[] = [];
      if (bestMoveBefore && (!move.x || bestMoveBefore.x !== move.x || bestMoveBefore.y !== move.y)) {
        alternatives.push({
          point: bestMoveBefore,
          winRate: winRateBefore,
          scoreLead: beforeAnalysis.scoreLead,
          description: `Melhor sugestão da IA: ${this.coordToString(bestMoveBefore.x, bestMoveBefore.y, initialSize)} (taxa de vitória estimada: ${(winRateBefore * 100).toFixed(1)}%)`
        });
      }

      if (beforeAnalysis.candidateMoves) {
        for (const cand of beforeAnalysis.candidateMoves.slice(0, 3)) {
          if (!bestMoveBefore || cand.point.x !== bestMoveBefore.x || cand.point.y !== bestMoveBefore.y) {
            alternatives.push({
              point: cand.point,
              winRate: cand.winRate,
              scoreLead: 0,
              description: `Variação alternativa em ${this.coordToString(cand.point.x, cand.point.y, initialSize)} (${(cand.winRate * 100).toFixed(1)}%)`
            });
          }
        }
      }

      evaluations.push({
        moveNumber: moveNum,
        color: turnColor,
        playedMove: move.pass || move.resign ? null : { x: move.x, y: move.y },
        winRateBefore,
        winRateAfter,
        winRateDelta: delta,
        classification,
        badgeSymbol,
        badgeColor,
        labelPt,
        explanation,
        bestMove: bestMoveBefore,
        alternatives,
        blackWinRateHistory: blackPerspectiveWR
      });
    }

    // Calculate accuracy percentage
    const calcAccuracy = (color: Color): number => {
      const colEvals = evaluations.filter(e => e.color === color);
      if (colEvals.length === 0) return 100;

      let scoreSum = 0;
      for (const e of colEvals) {
        const d = Math.min(0, e.winRateDelta);
        const moveScore = 100 * Math.exp(-2.2 * Math.abs(d));
        scoreSum += moveScore;
      }
      return Math.round(scoreSum / colEvals.length);
    };

    const blackAccuracyPct = calcAccuracy('black');
    const whiteAccuracyPct = calcAccuracy('white');

    return {
      totalMoves,
      blackAccuracyPct,
      whiteAccuracyPct,
      evaluations,
      stats,
      turningPoints
    };
  }
}
