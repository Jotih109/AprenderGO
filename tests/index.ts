import { report } from './harness';
import { runBoardTests } from './board.test';
import { runScoringTests } from './scoring.test';
import { runSgfTests } from './sgf.test';
import { runEngineTests } from './engine.test';
import { runInsightTests } from './insights.test';
import { runSummaryTests } from './summary.test';

console.log('\nGoBoard');
runBoardTests();

console.log('\nGoScoring');
runScoringTests();

console.log('\nSgfParser');
runSgfTests();

console.log('\nMoveInsights (explicações da revisão)');
runInsightTests();

console.log('\nReviewSummary (resumo textual do sensei)');
runSummaryTests();

console.log('\nSearch engine');
runEngineTests();

process.exit(report());
