import { SgfParser } from '../src/sgf/SgfParser';
import { GoBoard } from '../src/core/GoBoard';
import { check, equal, suite } from './harness';

export function runSgfTests(): void {
  suite('setup stones for both colours are read', () => {
    const p = SgfParser.parse('(;GM[1]SZ[19]AB[dd][pp]AW[dp][pd];B[qq];W[cc])');
    equal('AB stones', p.initialBlackStones.length, 2);
    equal('AW stones', p.initialWhiteStones.length, 2);
    equal('moves', p.moves.length, 2);
    check('coordinates decode correctly', p.initialWhiteStones[0].x === 3 && p.initialWhiteStones[0].y === 15);
  });

  suite('escaped brackets inside comments', () => {
    // The value contains \] and \[, which a naive regex would truncate at.
    const sgf = '(;SZ[9];B[cc]C[he said \\]bracket\\[ ok];W[dd]C[second])';
    const p = SgfParser.parse(sgf);
    equal('the whole comment survives', p.moves[0].comment, 'he said ]bracket[ ok');
    equal('parsing continues afterwards', p.moves.length, 2);
    equal('the next comment is intact', p.moves[1].comment, 'second');
  });

  suite('variations collapse to the main line', () => {
    const p = SgfParser.parse('(;SZ[9];B[aa];W[bb](;B[cc];W[dd])(;B[ee];W[ff]))');
    equal('only the first branch is followed', p.moves.length, 4);
    check('the main line is the first branch', p.moves[2].x === 2 && p.moves[2].y === 2);
    equal('skipped variations are reported', p.variationsSkipped, 1);
  });

  suite('komi, ranks and rules', () => {
    const p = SgfParser.parse('(;SZ[19]KM[-5.5]RU[Chinese]BR[4k]WR[2d];B[dd])');
    equal('negative komi', p.komi, -5.5);
    equal('chinese rules detected', p.ruleSet, 'chinese' as const);
    equal('black rank', p.blackRank, '4k');
    equal('white rank', p.whiteRank, '2d');

    const q = SgfParser.parse('(;SZ[19];B[dd])');
    equal('default komi', q.komi, 6.5);
    equal('default rules', q.ruleSet, 'japanese' as const);
  });

  suite('passes in both notations', () => {
    const p = SgfParser.parse('(;SZ[9];B[];W[tt];B[cc])');
    check('an empty value is a pass', p.moves[0].pass === true);
    check('tt is a pass on small boards', p.moves[1].pass === true);
    check('a normal move follows', p.moves[2].pass === undefined);
  });

  suite('who plays first', () => {
    const handicap = SgfParser.parse('(;SZ[19]HA[4]AB[dd][pd][dp][pp])');
    equal('handicap gives white the first move', handicap.firstPlayer, 'white' as const);
    equal('handicap count', handicap.handicap, 4);

    const explicit = SgfParser.parse('(;SZ[19]PL[W];W[dd])');
    equal('PL is respected', explicit.firstPlayer, 'white' as const);

    const plain = SgfParser.parse('(;SZ[19];B[dd])');
    equal('black starts by default', plain.firstPlayer, 'black' as const);
  });

  suite('whitespace and newlines inside the file', () => {
    const p = SgfParser.parse('(;SZ[9]\n PB[Jogador Um]\n PW[prokyu]\n ;B[cc]\n;W[dd])');
    equal('player names survive', p.blackPlayer, 'Jogador Um');
    equal('moves survive', p.moves.length, 2);
  });

  suite('malformed input is rejected rather than guessed at', () => {
    let threw = false;
    try {
      SgfParser.parse('not an sgf at all');
    } catch {
      threw = true;
    }
    check('garbage throws', threw);
  });

  suite('generate then parse round-trips', () => {
    const b = new GoBoard(9);
    b.setHandicap(2);
    b.playMove(4, 4, 'white');
    b.playMove(2, 4, 'black');
    b.pass('white');

    const sgf = SgfParser.generate(b, 'Preta', 'Branca', 0.5, 'chinese', 'B+2.5');
    const p = SgfParser.parse(sgf);

    equal('size round-trips', p.size, 9);
    equal('komi round-trips', p.komi, 0.5);
    equal('rules round-trip', p.ruleSet, 'chinese' as const);
    equal('handicap stones round-trip', p.initialBlackStones.length, 2);
    equal('move count round-trips', p.moves.length, 3);
    equal('result round-trips', p.result, 'B+2.5');
    check('the pass survives', p.moves[2].pass === true);
  });

  suite('comments with brackets round-trip through generate', () => {
    const b = new GoBoard(9);
    b.playMove(2, 2, 'black');
    b.movesList[0].comment = 'tricky ] comment \\ here';
    const sgf = SgfParser.generate(b);
    const p = SgfParser.parse(sgf);
    equal('the comment is preserved exactly', p.moves[0].comment, 'tricky ] comment \\ here');
  });
}
