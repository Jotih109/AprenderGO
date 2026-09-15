import { GoBoard } from '../src/core/GoBoard';
import { MoveNarrator, MoveArchetype } from '../src/ai/MoveNarrator';
import { BoardSize, Color, Move } from '../src/types/go';
import { CONCEPTS } from '../src/data/concepts';
import { check, equal, suite } from './harness';
import { place } from './board.test';

/**
 * Plays one move on a diagram and returns the commentary.
 *
 * The narrator needs both positions, so the "before" board is cloned before the
 * move lands — exactly what the observer mode does at run time.
 */
function narrate(
  diagram: string,
  x: number,
  y: number,
  color: Color,
  moveNumber = 40,
  size: BoardSize = 9
) {
  const board = new GoBoard(size);
  place(board, diagram, color);

  const before = board.clone();
  const res = board.playMove(x, y, color);
  if (!res.success) throw new Error(`move rejected: ${res.reason}`);
  const move: Move = res.move ?? { x, y, color };

  return MoveNarrator.narrate(before, board, move, moveNumber, null);
}

const EMPTY9 = `
  .........
  .........
  .........
  .........
  .........
  .........
  .........
  .........
  .........`;

export function runNarratorTests(): void {
  suite('capture is named and counted', () => {
    // Three white stones on the top edge, their last liberty at F9.
    const c = narrate(
      `
      .XOOO....
      ..XXX....
      .........
      .........
      .........
      .........
      .........
      .........
      .........`,
      5, 0, 'black'
    );
    equal('archetype', c.archetype, 'captura' as MoveArchetype);
    check('headline counts the stones', c.headline.includes('3 pedras'), c.headline);
    check('why names the point', c.why.includes('F9'), c.why);
    check('when explains the trade-off', c.when.length > 60);
  });

  suite('escaping atari reports the new liberty count', () => {
    // A single black stone at B8 in atari; C8 is its last liberty.
    const c = narrate(
      `
      .O.......
      OX.......
      .O.......
      .........
      .........
      .........
      .........
      .........
      .........`,
      2, 1, 'black'
    );
    equal('archetype', c.archetype, 'salvamento' as MoveArchetype);
    check('why mentions atari', c.why.includes('atari'), c.why);
    check('why quotes a liberty count', /\d+ liberdades/.test(c.why), c.why);
  });

  suite('atari on one group, and double atari on two', () => {
    const single = narrate(
      `
      .........
      ..XOX....
      .........
      .........
      .........
      .........
      .........
      .........
      .........`,
      3, 2, 'black'
    );
    equal('single atari', single.archetype, 'atari' as MoveArchetype);
    check('names the group size', single.headline.includes('1 pedra'), single.headline);

    // One black stone takes the second-to-last liberty of two white stones at
    // once: C8 and E8 are both left with a single liberty.
    const double = narrate(
      `
      ..X.X....
      .XO.OX...
      .........
      .........
      .........
      .........
      .........
      .........
      .........`,
      3, 1, 'black'
    );
    equal('double atari', double.archetype, 'atari-duplo' as MoveArchetype);
    check('counts both groups', double.why.includes('2 grupos'), double.why);
  });

  suite('cut is only claimed while the groups stay apart', () => {
    // D8 touches two separate white stones, C8 and E8.
    const c = narrate(
      `
      ..X.X....
      ..O.O....
      ..X.X....
      .........
      .........
      .........
      .........
      .........
      .........`,
      3, 1, 'black'
    );
    check('cut or atari, never a connection', c.archetype === 'corte' || c.archetype === 'atari-duplo', c.archetype);
    check('concept is a real glossary entry', CONCEPTS[c.concept] !== undefined, c.concept);
  });

  suite('connection joins two of our own groups', () => {
    const c = narrate(
      `
      .........
      .X.X.....
      .........
      .........
      .........
      .........
      .........
      .........
      .........`,
      2, 1, 'black'
    );
    equal('archetype', c.archetype, 'conexao' as MoveArchetype);
    check('why counts the groups', c.why.includes('2 grupos'), c.why);
  });

  suite('opening moves in the corner are named by their shape', () => {
    // 19x19, where the corner vocabulary is unambiguous: D16 is the 4-4 point.
    const NL = String.fromCharCode(10);
    const EMPTY19 = Array(19).fill('.'.repeat(19)).join(NL);
    const withStone = (x: number, y: number, ch: string) => {
      const rows = Array(19).fill('.'.repeat(19));
      rows[y] = rows[y].substring(0, x) + ch + rows[y].substring(x + 1);
      return rows.join(NL);
    };

    const occupy = narrate(EMPTY19, 3, 3, 'black', 1, 19);
    equal('empty corner', occupy.archetype, 'ocupacao-canto' as MoveArchetype);
    equal('teaches corners first', occupy.concept, 'cantos-primeiro');

    const approach = narrate(withStone(3, 3, 'O'), 5, 2, 'black', 3, 19);
    equal('opponent stone alone in the corner', approach.archetype, 'abordagem' as MoveArchetype);

    const enclose = narrate(withStone(3, 3, 'X'), 5, 2, 'black', 3, 19);
    equal('our own stone in the corner', enclose.archetype, 'fecho-canto' as MoveArchetype);
  });

  suite('the centre point is not mistaken for a corner', () => {
    // Tengen on a 9x9 sits exactly as far from the corner as the corner region
    // used to reach, which made the very first move of a game read as a corner
    // occupation.
    const c = narrate(EMPTY9, 4, 4, 'black', 1);
    check('not a corner archetype', !c.archetype.includes('canto'), c.archetype);
    check('why does not claim a corner', !c.why.includes('canto'), c.why);
  });

  suite('a side move in the opening is not called a corner enclosure', () => {
    // Black already holds the top-left corner; G9-ish is far from any corner on
    // 19x19, so the corner branch must not claim it.
    const c = narrate(
      `
      ...................
      ...X...............
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................`,
      9, 3, 'black', 5, 19
    );
    check('not a corner archetype', !c.archetype.includes('canto'), c.archetype);
  });

  suite('extension keeps its distance from the stone it extends from', () => {
    const c = narrate(
      `
      ...................
      ...................
      ...................
      ...X.......X.......
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................
      ...................`,
      7, 3, 'black', 30, 19
    );
    equal('archetype', c.archetype, 'extensao' as MoveArchetype);
    check('why gives the gap', /\d+ casas/.test(c.why), c.why);
  });

  suite('tenuki is reported when the move is far from the last one', () => {
    const board = new GoBoard(19);
    board.playMove(3, 3, 'black');
    board.playMove(15, 15, 'white');
    board.playMove(3, 15, 'black');
    // White answers in the opposite corner, far from Black's last stone.
    const before = board.clone();
    const res = board.playMove(15, 3, 'white');
    const c = MoveNarrator.narrate(before, board, res.move!, 4, null);
    check(
      'far-away reply is a corner move or tenuki, not a local answer',
      c.archetype === 'ocupacao-canto' || c.archetype === 'tenuki' || c.archetype === 'abordagem',
      c.archetype
    );
  });

  suite('pass and resign have their own commentary', () => {
    const board = new GoBoard(9);
    const passMove = board.pass('black');
    const passC = MoveNarrator.narrate(board.clone(), board, passMove, 60, null);
    equal('pass archetype', passC.archetype, 'passe' as MoveArchetype);
    equal('pass coord', passC.coord, 'passou');
    equal('pass concept', passC.concept, 'passar');

    const board2 = new GoBoard(9);
    const resignMove = board2.resign('white');
    const resignC = MoveNarrator.narrate(board2.clone(), board2, resignMove, 60, null);
    equal('resign archetype', resignC.archetype, 'desistencia' as MoveArchetype);
  });

  suite('the score line follows the side that moved', () => {
    const board = new GoBoard(9);
    const before = board.clone();
    const res = board.playMove(4, 4, 'white');
    // scoreLead and winRate always arrive from Black's point of view.
    const c = MoveNarrator.narrate(before, board, res.move!, 2, {
      winRate: 0.4,
      scoreLead: -6
    });
    equal('lead is flipped for White', c.leadForMover, 6);
    check('confidence is flipped for White', Math.abs((c.confidenceForMover ?? 0) - 0.6) < 1e-9);

    const board2 = new GoBoard(9);
    const before2 = board2.clone();
    const res2 = board2.playMove(4, 4, 'black');
    const c2 = MoveNarrator.narrate(before2, board2, res2.move!, 1, {
      winRate: 0.4,
      scoreLead: -6
    });
    equal('lead is kept for Black', c2.leadForMover, -6);
  });

  suite('every commentary is complete and points at a real concept', () => {
    // Walk a whole self-played game and check the invariants on every move.
    const board = new GoBoard(9);
    const script: [number, number][] = [
      [2, 2], [6, 6], [6, 2], [2, 6], [4, 4], [4, 2],
      [3, 3], [5, 5], [1, 4], [7, 4], [4, 6], [4, 1]
    ];

    let n = 0;
    for (const [x, y] of script) {
      const color: Color = n % 2 === 0 ? 'black' : 'white';
      const before = board.clone();
      const res = board.playMove(x, y, color);
      if (!res.success) continue;
      n++;
      const c = MoveNarrator.narrate(before, board, res.move!, n, null);

      check(`move ${n}: has a headline`, c.headline.trim().length > 0);
      check(`move ${n}: says why`, c.why.trim().length > 20, c.why);
      check(`move ${n}: says when`, c.when.trim().length > 40, c.when);
      check(`move ${n}: concept exists`, CONCEPTS[c.concept] !== undefined, c.concept);
      check(`move ${n}: highlights the played point`,
        c.highlights.some(p => p.x === x && p.y === y),
        JSON.stringify(c.highlights));
      check(`move ${n}: coordinate is well formed`, /^[A-T]\d+$/.test(c.coord), c.coord);
    }
    equal('every scripted move was played', n, script.length);
  });

  suite('alternatives come from the search and skip the played move', () => {
    const board = new GoBoard(9);
    const before = board.clone();
    const res = board.playMove(4, 4, 'black');
    const c = MoveNarrator.narrate(before, board, res.move!, 1, {
      winRate: 0.5,
      scoreLead: 0,
      candidateMoves: [
        { point: { x: 4, y: 4 }, score: 0.9, winRate: 0.55 },
        { point: { x: 2, y: 2 }, score: 0.8, winRate: 0.53 },
        { point: { x: 6, y: 6 }, score: 0.7, winRate: 0.52 }
      ]
    });
    equal('played move dropped', c.alternatives.length, 2);
    equal('first alternative', c.alternatives[0].coord, 'C7');
    check('alternatives are described', c.alternatives.every(a => a.note.length > 3),
      JSON.stringify(c.alternatives));
  });
}
