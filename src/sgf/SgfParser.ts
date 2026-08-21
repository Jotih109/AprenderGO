import { BoardSize, Color, Move, Point, RuleSet } from '../types/go';
import { GoBoard } from '../core/GoBoard';

export interface ParsedSgf {
  size: BoardSize;
  komi: number;
  handicap: number;
  ruleSet: RuleSet;
  blackPlayer: string;
  whitePlayer: string;
  date: string;
  result?: string;
  initialBlackStones: Point[];
  initialWhiteStones: Point[];
  moves: Move[];
}

export class SgfParser {
  private static charToCoord(char: string): number {
    return char.charCodeAt(0) - 97; // 'a' -> 0, 'b' -> 1, ...
  }

  private static coordToChar(coord: number): string {
    return String.fromCharCode(97 + coord);
  }

  public static pointToSgfCoord(pt: Point): string {
    return `${this.coordToChar(pt.x)}${this.coordToChar(pt.y)}`;
  }

  public static sgfCoordToPoint(sgfCoord: string): Point | null {
    if (!sgfCoord || sgfCoord.length < 2) return null;
    const x = this.charToCoord(sgfCoord[0]);
    const y = this.charToCoord(sgfCoord[1]);
    return { x, y };
  }

  /**
   * Parses an SGF string into game properties and moves list.
   */
  public static parse(sgfContent: string): ParsedSgf {
    const clean = sgfContent.trim();
    let size: BoardSize = 19;
    let komi = 6.5;
    let handicap = 0;
    let ruleSet: RuleSet = 'japanese';
    let blackPlayer = 'Pretas';
    let whitePlayer = 'Brancas';
    let date = new Date().toISOString().split('T')[0];
    let result = '';

    const initialBlackStones: Point[] = [];
    const initialWhiteStones: Point[] = [];
    const moves: Move[] = [];

    let blackRank = '';
    let whiteRank = '';

    // Parse root properties
    const szMatch = clean.match(/SZ\[(\d+)\]/i);
    if (szMatch) {
      const parsedSz = parseInt(szMatch[1], 10);
      if (parsedSz === 9 || parsedSz === 13 || parsedSz === 19) {
        size = parsedSz;
      }
    }

    const kmMatch = clean.match(/KM\[([\d.]+)\]/i);
    if (kmMatch) komi = parseFloat(kmMatch[1]);

    const haMatch = clean.match(/HA\[(\d+)\]/i);
    if (haMatch) handicap = parseInt(haMatch[1], 10);

    const pbMatch = clean.match(/PB\[([^\]]*)\]/i);
    if (pbMatch) blackPlayer = pbMatch[1];

    const pwMatch = clean.match(/PW\[([^\]]*)\]/i);
    if (pwMatch) whitePlayer = pwMatch[1];

    const brMatch = clean.match(/BR\[([^\]]*)\]/i);
    if (brMatch) blackRank = brMatch[1];

    const wrMatch = clean.match(/WR\[([^\]]*)\]/i);
    if (wrMatch) whiteRank = wrMatch[1];

    const dtMatch = clean.match(/DT\[([^\]]*)\]/i);
    if (dtMatch) date = dtMatch[1];

    const reMatch = clean.match(/RE\[([^\]]*)\]/i);
    if (reMatch) result = reMatch[1];

    const ruMatch = clean.match(/RU\[([^\]]*)\]/i);
    if (ruMatch && ruMatch[1].toLowerCase().includes('chinese')) {
      ruleSet = 'chinese';
    }

    // Initial Handicap Stones (AB / AW)
    const abMatches = clean.matchAll(/AB(?:\[([a-z]{2})\])+/gi);
    for (const m of abMatches) {
      const coords = m[0].match(/\[([a-z]{2})\]/gi) || [];
      for (const c of coords) {
        const pt = this.sgfCoordToPoint(c.slice(1, 3).toLowerCase());
        if (pt) initialBlackStones.push(pt);
      }
    }

    // Parse moves by splitting nodes or using regex that tolerates sub-properties
    const nodeRegex = /;(?=[BW]\[)/gi;
    const rawNodes = clean.split(nodeRegex);

    for (const node of rawNodes) {
      const moveMatch = node.match(/^([BW])\[([a-z]{0,2})\]/i);
      if (!moveMatch) continue;

      const color: Color = moveMatch[1].toUpperCase() === 'B' ? 'black' : 'white';
      const coordStr = moveMatch[2];

      const commentMatch = node.match(/C\[([^\]]*)\]/i);
      const comment = commentMatch ? commentMatch[1] : undefined;

      if (!coordStr || coordStr.length === 0 || (coordStr.toLowerCase() === 'tt' && size <= 19)) {
        // Pass
        moves.push({
          x: -1,
          y: -1,
          color,
          pass: true,
          comment
        });
      } else {
        const pt = this.sgfCoordToPoint(coordStr.toLowerCase());
        if (pt && pt.x < size && pt.y < size) {
          moves.push({
            x: pt.x,
            y: pt.y,
            color,
            comment
          });
        }
      }
    }

    // Fallback regex if split didn't catch all moves (e.g. compact format)
    if (moves.length === 0) {
      const fallbackRegex = /;([BW])\[([a-z]{0,2})\]/gi;
      let fMatch: RegExpExecArray | null;
      while ((fMatch = fallbackRegex.exec(clean)) !== null) {
        const color: Color = fMatch[1].toUpperCase() === 'B' ? 'black' : 'white';
        const coordStr = fMatch[2];
        if (!coordStr || coordStr.length === 0 || (coordStr.toLowerCase() === 'tt' && size <= 19)) {
          moves.push({ x: -1, y: -1, color, pass: true });
        } else {
          const pt = this.sgfCoordToPoint(coordStr.toLowerCase());
          if (pt && pt.x < size && pt.y < size) {
            moves.push({ x: pt.x, y: pt.y, color });
          }
        }
      }
    }

    return {
      size,
      komi,
      handicap,
      ruleSet,
      blackPlayer,
      whitePlayer,
      date,
      result,
      initialBlackStones,
      initialWhiteStones,
      moves
    };
  }

  /**
   * Generates a complete standard SGF string from game state.
   */
  public static generate(
    board: GoBoard,
    blackPlayer: string = 'Humano',
    whitePlayer: string = 'IA Mestre',
    komi: number = 6.5,
    ruleSet: RuleSet = 'japanese',
    result: string = ''
  ): string {
    const today = new Date().toISOString().split('T')[0];
    let sgf = `(;GM[1]FF[4]CA[UTF-8]AP[GoMaster:1.0]\n`;
    sgf += `SZ[${board.size}]KM[${komi}]RU[${ruleSet === 'japanese' ? 'Japanese' : 'Chinese'}]\n`;
    sgf += `PB[${blackPlayer}]PW[${whitePlayer}]DT[${today}]`;
    if (result) sgf += `RE[${result}]`;
    sgf += `\n`;

    // Write moves
    for (const move of board.movesList) {
      const colChar = move.color === 'black' ? 'B' : 'W';
      if (move.pass) {
        sgf += `;${colChar}[]`;
      } else if (move.resign) {
        // Resignation usually written in RE
      } else {
        const coord = this.pointToSgfCoord({ x: move.x, y: move.y });
        sgf += `;${colChar}[${coord}]`;
      }
      if (move.comment) {
        sgf += `C[${move.comment.replace(/\]/g, '\\]')}]`;
      }
      sgf += '\n';
    }

    sgf += ')';
    return sgf;
  }

  /**
   * Triggers a browser file download of the SGF.
   */
  public static downloadSgf(content: string, filename: string = 'partida_go.sgf'): void {
    const blob = new Blob([content], { type: 'application/x-go-sgf;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
