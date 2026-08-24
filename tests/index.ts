import { report } from './harness';
import { runBoardTests } from './board.test';
import { runScoringTests } from './scoring.test';
import { runSgfTests } from './sgf.test';
import { runEngineTests } from './engine.test';

console.log('\nGoBoard');
runBoardTests();

console.log('\nGoScoring');
runScoringTests();

console.log('\nSgfParser');
runSgfTests();

console.log('\nSearch engine');
runEngineTests();

process.exit(report());
