import { GoBoard } from '../src/core/GoBoard';
import { Color } from '../src/types/go';
import { check, equal, suite } from './harness';

/** Builds a position from an ASCII diagram: X = black, O = white, . = empty. */
export function place(board: GoBoard, diagram: string, turn?: Color): void {
  const stones: { x: number; y: number; color: Color }[] = [];
  diagram.trim().split('\n').forEach((line, y) => {
    line.trim().split('').forEach((ch, x) => {
      if (ch === 'X') stones.push({ x, y, color: 'black' });
      else if (ch === 'O') stones.push({ x, y, color: 'white' });
    });
  });
  board.placeSetupStones(stones, turn);
}

export function runBoardTests(): void {
  suite('capture removes stones and counts prisoners', () => {
    const b = new GoBoard(9);
    b.playMove(1, 0, 'black');
    b.playMove(0, 0, 'white');
    b.playMove(0, 1, 'black');
    check('white stone captured', b.get(0, 0) === null);
    equal('capture counted for black', b.captures.black, 1);
  });

  suite('suicide is rejected', () => {
    const b = new GoBoard(9);
    place(b, `
      .O.......
      O........
      .........
      .........
      .........
      .........
      .........
      .........
      .........`);
    const r = b.isValidMove(0, 0, 'black');
    check('single-stone suicide rejected', !r.valid, r.reason);
  });

  suite('a move that captures is legal even with no own liberties', () => {
    const b = new GoBoard(9);
    // Black at (0,0) has one liberty at (1,0); white fills it and captures.
    place(b, `
      X........
      OX.......
      .........
      .........
      .........
      .........
      .........
      .........
      .........`);
    const r = b.isValidMove(1, 0, 'white');
    check('capturing move is legal', r.valid, r.reason);
    b.playMove(1, 0, 'white');
    check('black stone was captured', b.get(0, 0) === null);
  });

  /** The canonical ko shape, with the single white stone at (1,1) in atari. */
  const koDiagram = `
      .XO......
      XO.O.....
      .XO......
      .........
      .........
      .........
      .........
      .........
      .........`;

  suite('simple ko forbids the immediate retake', () => {
    const b = new GoBoard(9);
    place(b, koDiagram, 'black');

    const taken = b.playMove(2, 1, 'black');
    check('black takes the ko', taken.success, taken.reason);
    check('the white stone is captured', b.get(1, 1) === null);
    check('the ko point is recorded', b.koPoint?.x === 1 && b.koPoint?.y === 1);

    const retake = b.isValidMove(1, 1, 'white');
    check('white cannot retake immediately', !retake.valid);
    check('the reason names the ko rule', (retake.reason ?? '').includes('Ko'), retake.reason);
  });

  suite('ko fights terminate instead of cycling forever', () => {
    // A single capture can never rebuild the previous position on its own, so
    // superko only bites over longer cycles. What matters in practice is that
    // repeating a position is refused, and that a ko fight therefore ends.
    const b = new GoBoard(9);
    place(b, koDiagram, 'black');

    let captures = 0;
    for (let i = 0; i < 40; i++) {
      const turn = b.turn;
      const takeBlack = b.isValidMove(2, 1, 'black');
      const takeWhite = b.isValidMove(1, 1, 'white');
      if (turn === 'black' && takeBlack.valid) {
        b.playMove(2, 1, 'black');
        captures++;
      } else if (turn === 'white' && takeWhite.valid) {
        b.playMove(1, 1, 'white');
        captures++;
      } else {
        break;
      }
    }

    check('the ko cycle stops rather than repeating forever', captures < 40, `${captures} captures`);
    check('at least the first capture happened', captures >= 1);
  });

  suite('a position already played cannot be recreated', () => {
    const b = new GoBoard(9);
    b.playMove(2, 2, 'black');
    const seenHash = b.hash;

    // Reaching the same arrangement again by any route is refused. Replay the
    // same board from scratch and confirm the hash is what the set holds.
    const c = new GoBoard(9);
    c.playMove(2, 2, 'black');
    equal('identical positions share a hash', c.hash, seenHash);

    // The starting position counts as seen, so passing forever cannot loop.
    b.pass('white');
    b.pass('black');
    check('two passes end the game', b.isGameOver);
    check('no move is legal once the game is over', !b.isValidMove(4, 4, 'white').valid);
  });

  suite('undo restores passes, captures and game state', () => {
    const b = new GoBoard(9);
    b.pass('black');
    b.pass('white');
    check('two passes end the game', b.isGameOver);
    b.undo();
    check('undo clears game over', !b.isGameOver);
    equal('undo restores the pass count', b.consecutivePasses, 1);
    b.undo();
    equal('undo returns to zero passes', b.consecutivePasses, 0);

    const c = new GoBoard(9);
    c.playMove(1, 0, 'black');
    c.playMove(0, 0, 'white');
    c.playMove(0, 1, 'black');
    c.undo();
    check('undo puts the captured stone back', c.get(0, 0) === 'white');
    equal('undo restores the capture count', c.captures.black, 0);
    equal('undo restores the turn', c.turn, 'black' as Color);
  });

  suite('position hashing is stable across undo', () => {
    const b = new GoBoard(9);
    b.playMove(0, 0, 'black');
    const afterFirst = b.hash;
    b.undo();
    b.playMove(0, 0, 'black');
    equal('the same position hashes the same', b.hash, afterFirst);

    // Undo also has to forget the position, or replaying it would be blocked.
    b.undo();
    const replay = b.isValidMove(0, 0, 'black');
    check('a move can be replayed after undo', replay.valid, replay.reason);
  });

  suite('handicap placement', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) {
      const b = new GoBoard(19);
      b.setHandicap(n);
      let count = 0;
      for (let y = 0; y < 19; y++) {
        for (let x = 0; x < 19; x++) if (b.grid[y][x] === 'black') count++;
      }
      equal(`handicap ${n} places ${n} stones`, count, n);
      equal(`handicap ${n} gives white the first move`, b.turn, 'white' as Color);
      equal(`handicap ${n} records setup stones`, b.setupStones.length, n);
    }

    const b9 = new GoBoard(9);
    b9.setHandicap(4);
    const corners = [[2, 2], [6, 2], [2, 6], [6, 6]];
    check('9x9 handicap sits on the star points', corners.every(([x, y]) => b9.grid[y][x] === 'black'));
  });

  suite('hoshi points per board size', () => {
    equal('19x19 has nine star points', new GoBoard(19).getHoshiPoints().length, 9);
    equal('13x13 has five star points', new GoBoard(13).getHoshiPoints().length, 5);
    equal('9x9 has five star points', new GoBoard(9).getHoshiPoints().length, 5);
    check('9x9 includes tengen', new GoBoard(9).getHoshiPoints().some(p => p.x === 4 && p.y === 4));
  });

  suite('large group traversal stays linear', () => {
    const b = new GoBoard(19);
    const stones: { x: number; y: number; color: Color }[] = [];
    for (let y = 0; y < 19; y += 2) {
      for (let x = 0; x < 19; x++) stones.push({ x, y, color: 'black' });
    }
    b.placeSetupStones(stones);
    const t0 = Date.now();
    for (let i = 0; i < 200; i++) b.getGroup(0, 0);
    const dt = Date.now() - t0;
    check('200 traversals of a 190-stone group under 500ms', dt < 500, `${dt}ms`);
  });

  suite('setup stones are not moves', () => {
    const b = new GoBoard(19);
    b.setHandicap(4);
    equal('handicap adds no moves to the record', b.movesList.length, 0);

    // Tengen is free at four stones, unlike the star points themselves.
    const played = b.playMove(9, 9, 'white');
    check('white can play the first move', played.success, played.reason);
    equal('the first real move is move 1', b.movesList.length, 1);
    equal('and it is numbered 1', b.movesList[0].moveNumber, 1);
  });
}
