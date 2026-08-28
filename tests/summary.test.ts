import { check, suite } from './harness';
import { ReviewSummaryGenerator } from '../src/ai/ReviewSummary';
import { MoveEvaluation } from '../src/types/go';

export function runSummaryTests(): void {
  suite('generates rich narrative and player strengths for high accuracy game', () => {
    const evals: MoveEvaluation[] = [
      {
        moveNumber: 1,
        color: 'black',
        playedMove: { x: 2, y: 2 },
        winRateBefore: 0.5,
        winRateAfter: 0.52,
        winRateDelta: 0.02,
        classification: 'best',
        badgeSymbol: '🟢',
        badgeColor: '#10b981',
        labelPt: 'Melhor',
        explanation: 'Boa jogada',
        bestMove: { x: 2, y: 2 },
        alternatives: [],
        blackWinRateHistory: 0.52,
        insights: [
          {
            id: 'corner-opening',
            severity: 'good',
            concept: 'cantos-primeiro',
            title: 'Abertura no canto',
            detail: 'Canto usa duas bordas como parede'
          }
        ],
        pointsLost: 0
      },
      {
        moveNumber: 2,
        color: 'white',
        playedMove: { x: 6, y: 6 },
        winRateBefore: 0.48,
        winRateAfter: 0.5,
        winRateDelta: 0.02,
        classification: 'best',
        badgeSymbol: '🟢',
        badgeColor: '#10b981',
        labelPt: 'Melhor',
        explanation: 'Boa jogada',
        bestMove: { x: 6, y: 6 },
        alternatives: [],
        blackWinRateHistory: 0.5,
        insights: [
          {
            id: 'corner-opening',
            severity: 'good',
            concept: 'cantos-primeiro',
            title: 'Abertura no canto',
            detail: 'Canto usa duas bordas como parede'
          }
        ],
        pointsLost: 0
      },
      {
        moveNumber: 3,
        color: 'black',
        playedMove: { x: 4, y: 4 },
        winRateBefore: 0.5,
        winRateAfter: 0.58,
        winRateDelta: 0.08,
        classification: 'brilliant',
        badgeSymbol: '🌟',
        badgeColor: '#a855f7',
        labelPt: 'Brilhante',
        explanation: 'Jogada brilhante',
        bestMove: { x: 4, y: 4 },
        alternatives: [],
        blackWinRateHistory: 0.58,
        insights: [
          {
            id: 'gives-atari',
            severity: 'good',
            concept: 'atari',
            title: 'Você colocou 1 pedra em atari',
            detail: 'Grupo adversário ficou com 1 liberdade'
          }
        ],
        pointsLost: 0
      }
    ];

    const res = ReviewSummaryGenerator.generate({
      size: 9,
      totalMoves: evals.length,
      blackAccuracyPct: 95,
      whiteAccuracyPct: 90,
      evaluations: evals,
      stats: {
        black: { brilliant: 1, best: 1, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
        white: { brilliant: 0, best: 1, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
      },
      turningPoints: [{ moveNumber: 3, description: 'Brilhante', impact: '+8%' }],
      studyPlan: { black: [], white: [] }
    });

    check('narrative is generated', res.narrative.length > 20);
    check('black headline is positive', res.black.headline.includes('Atuação'));
    check('black has strengths', res.black.strengths.length > 0);
    check('brilliant moves listed in strengths', res.black.strengths.some(s => s.title.includes('Brilhantes')));
    check('plainText contains title', res.plainText.includes('GO MASTER - RELATÓRIO DO SENSEI'));
    check('plainText contains Black section', res.plainText.includes('⚫ PRETAS'));
    check('plainText contains White section', res.plainText.includes('⚪ BRANCAS'));
  });

  suite('identifies blunders, self-atari, and weakness items', () => {
    const evals: MoveEvaluation[] = [
      {
        moveNumber: 1,
        color: 'black',
        playedMove: { x: 0, y: 0 },
        winRateBefore: 0.5,
        winRateAfter: 0.2,
        winRateDelta: -0.3,
        classification: 'blunder',
        badgeSymbol: '☠️',
        badgeColor: '#ef4444',
        labelPt: 'Erro Crítico',
        explanation: 'Erro grave',
        bestMove: { x: 2, y: 2 },
        alternatives: [],
        blackWinRateHistory: 0.2,
        insights: [
          {
            id: 'self-atari',
            severity: 'critical',
            concept: 'auto-atari',
            title: 'Auto-atari: você entregou pedras',
            detail: 'Grupo ficou com 1 liberdade'
          },
          {
            id: 'first-line-early',
            severity: 'warning',
            concept: 'primeira-linha',
            title: 'Primeira linha cedo demais',
            detail: 'Na borda'
          }
        ],
        pointsLost: 15
      }
    ];

    const res = ReviewSummaryGenerator.generate({
      size: 9,
      totalMoves: 1,
      blackAccuracyPct: 40,
      whiteAccuracyPct: 100,
      evaluations: evals,
      stats: {
        black: { brilliant: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 1 },
        white: { brilliant: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
      },
      turningPoints: [{ moveNumber: 1, description: 'Erro crítico', impact: '-30%' }],
      studyPlan: {
        black: [{ concept: 'auto-atari', occurrences: 1, moveNumbers: [1] }],
        white: []
      }
    });

    check('black has weaknesses identified', res.black.weaknesses.length >= 2);
    check('blunder weakness flagged', res.black.weaknesses.some(w => w.title.includes('Blunders')));
    check('self-atari weakness flagged', res.black.weaknesses.some(w => w.title.includes('Auto-Atari')));
    check('recommendations present', res.black.recommendations.length > 0);
  });
}

