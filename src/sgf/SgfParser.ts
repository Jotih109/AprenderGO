import { BoardSize, Color, Move, Point, RuleSet } from '../types/go';
import { GoBoard } from '../core/GoBoard';

export interface ParsedSgf {
  size: BoardSize;
  komi: number;
  handicap: number;
  ruleSet: RuleSet;
  blackPlayer: string;
  whitePlayer: string;
  blackRank: string;
  whiteRank: string;
  date: string;
  result: string;
  initialBlackStones: Point[];
  initialWhiteStones: Point[];
  moves: Move[];
  /** Colour to play first, honouring PL and handicap. */
  firstPlayer: Color;
  /** How many variations were found and skipped, so the UI can mention it. */
  variationsSkipped: number;
}

/** One SGF node: property identifier to the list of its values. */
type SgfNode = Map<string, string[]>;

interface SgfTree {
  nodes: SgfNode[];
  children: SgfTree[];
}

export class SgfParser {
  private static charToCoord(char: string): number {
    const code = char.charCodeAt(0);
    // SGF uses a-z for 0-25 and A-Z for 26-51 on very large boards.
    if (code >= 97 && code <= 122) return code - 97;
    if (code >= 65 && code <= 90) return code - 65 + 26;
    return -1;
  }

  private static coordToChar(coord: number): string {
    return coord < 26 ? String.fromCharCode(97 + coord) : String.fromCharCode(65 + coord - 26);
  }

  public static pointToSgfCoord(pt: Point): string {
    return `${this.coordToChar(pt.x)}${this.coordToChar(pt.y)}`;
  }

  public static sgfCoordToPoint(sgfCoord: string): Point | null {
    if (!sgfCoord || sgfCoord.length < 2) return null;
    const x = this.charToCoord(sgfCoord[0]);
    const y = this.charToCoord(sgfCoord[1]);
    if (x < 0 || y < 0) return null;
    return { x, y };
  }

  // -----------------------------------------------------------
  // TOKENIZER
  // -----------------------------------------------------------

  /**
   * Recursive-descent reader for the SGF grammar. It understands escaped
   * characters inside values, multi-value properties such as AB[aa][bb], and
   * nested variations, none of which a regular expression handles reliably.
   */
  private static parseTree(text: string): SgfTree[] {
    let pos = 0;

    const skipWhitespace = (): void => {
      while (pos < text.length && /\s/.test(text[pos])) pos++;
    };

    const readValue = (): string => {
      // Caller has consumed the opening bracket.
      let out = '';
      while (pos < text.length) {
        const ch = text[pos];
        if (ch === '\\') {
          // A backslash escapes the next character; a backslash-newline is a
          // soft line break and disappears entirely.
          pos++;
          if (pos < text.length) {
            if (text[pos] === '\n') pos++;
            else out += text[pos++];
          }
          continue;
        }
        if (ch === ']') {
          pos++;
          return out;
        }
        out += ch;
        pos++;
      }
      return out;
    };

    const readNode = (): SgfNode => {
      const node: SgfNode = new Map();
      for (;;) {
        skipWhitespace();
        // A property identifier is a run of uppercase letters.
        let ident = '';
        while (pos < text.length && /[A-Za-z]/.test(text[pos])) ident += text[pos++];
        if (!ident) break;

        const key = ident.toUpperCase();
        const values: string[] = [];
        for (;;) {
          skipWhitespace();
          if (text[pos] !== '[') break;
          pos++;
          values.push(readValue());
        }
        if (values.length === 0) break; // malformed identifier without a value
        const existing = node.get(key);
        if (existing) existing.push(...values);
        else node.set(key, values);
      }
      return node;
    };

    const readTree = (): SgfTree => {
      const tree: SgfTree = { nodes: [], children: [] };
      pos++; // consume '('
      for (;;) {
        skipWhitespace();
        if (pos >= text.length) break;
        const ch = text[pos];
        if (ch === ';') {
          pos++;
          tree.nodes.push(readNode());
        } else if (ch === '(') {
          tree.children.push(readTree());
        } else if (ch === ')') {
          pos++;
          break;
        } else {
          pos++; // skip stray characters rather than aborting the whole file
        }
      }
      return tree;
    };

    const trees: SgfTree[] = [];
    while (pos < text.length) {
      skipWhitespace();
      if (text[pos] === '(') trees.push(readTree());
      else pos++;
    }
    return trees;
  }

  /** Flattens the main line: this tree's nodes, then its first child's, and so on. */
  private static mainLine(tree: SgfTree): { nodes: SgfNode[]; variationsSkipped: number } {
    const nodes: SgfNode[] = [];
    let variationsSkipped = 0;
    let current: SgfTree | undefined = tree;

    while (current) {
      nodes.push(...current.nodes);
      variationsSkipped += Math.max(0, current.children.length - 1);
      current = current.children[0];
    }

    return { nodes, variationsSkipped };
  }

  private static firstValue(node: SgfNode, key: string): string | undefined {
    const v = node.get(key);
    return v && v.length > 0 ? v[0] : undefined;
  }

  // -----------------------------------------------------------
  // PARSE
  // -----------------------------------------------------------

  public static parse(sgfContent: string): ParsedSgf {
    const trees = this.parseTree(sgfContent);
    if (trees.length === 0) {
      throw new Error('SGF inválido: nenhuma árvore de jogo encontrada.');
    }

    const { nodes, variationsSkipped } = this.mainLine(trees[0]);
    if (nodes.length === 0) {
      throw new Error('SGF inválido: nenhum nó de jogo encontrado.');
    }

    const root = nodes[0];

    let size: BoardSize = 19;
    const szRaw = this.firstValue(root, 'SZ');
    if (szRaw) {
      // SZ can be "19" or "19:19" for rectangular boards.
      const parsed = parseInt(szRaw.split(':')[0], 10);
      if (parsed === 9 || parsed === 13 || parsed === 19) size = parsed;
    }

    const kmRaw = this.firstValue(root, 'KM');
    const komi = kmRaw !== undefined && kmRaw !== '' && !Number.isNaN(parseFloat(kmRaw)) ? parseFloat(kmRaw) : 6.5;

    const haRaw = this.firstValue(root, 'HA');
    const handicap = haRaw ? parseInt(haRaw, 10) || 0 : 0;

    const ruRaw = (this.firstValue(root, 'RU') || '').toLowerCase();
    const ruleSet: RuleSet = ruRaw.includes('chinese') || ruRaw.includes('aga') || ruRaw.includes('tromp')
      ? 'chinese'
      : 'japanese';

    const blackPlayer = this.firstValue(root, 'PB') || 'Pretas';
    const whitePlayer = this.firstValue(root, 'PW') || 'Brancas';
    const blackRank = this.firstValue(root, 'BR') || '';
    const whiteRank = this.firstValue(root, 'WR') || '';
    const date = this.firstValue(root, 'DT') || new Date().toISOString().split('T')[0];
    const result = this.firstValue(root, 'RE') || '';

    const initialBlackStones: Point[] = [];
    const initialWhiteStones: Point[] = [];
    const moves: Move[] = [];

    const inBounds = (pt: Point): boolean => pt.x >= 0 && pt.x < size && pt.y >= 0 && pt.y < size;

    // Setup properties can appear in any node, not only the root.
    const collectSetup = (node: SgfNode, key: string, into: Point[]): void => {
      const values = node.get(key);
      if (!values) return;
      for (const raw of values) {
        const pt = this.sgfCoordToPoint(raw);
        if (pt && inBounds(pt)) into.push(pt);
      }
    };

    for (const node of nodes) {
      collectSetup(node, 'AB', initialBlackStones);
      collectSetup(node, 'AW', initialWhiteStones);

      const comment = this.firstValue(node, 'C');

      for (const key of ['B', 'W'] as const) {
        const values = node.get(key);
        if (!values) continue;
        const color: Color = key === 'B' ? 'black' : 'white';
        const raw = values[0];

        // An empty value, or "tt" on boards up to 19x19, means a pass.
        if (!raw || raw.length < 2 || (raw.toLowerCase() === 'tt' && size <= 19)) {
          moves.push({ x: -1, y: -1, color, pass: true, comment });
          continue;
        }

        const pt = this.sgfCoordToPoint(raw);
        if (pt && inBounds(pt)) {
          moves.push({ x: pt.x, y: pt.y, color, comment });
        }
      }
    }

    // PL wins over the handicap default, which in turn wins over "Black first".
    let firstPlayer: Color = 'black';
    const plRaw = (this.firstValue(root, 'PL') || '').trim().toUpperCase();
    if (plRaw === 'W') firstPlayer = 'white';
    else if (plRaw === 'B') firstPlayer = 'black';
    else if (handicap >= 2 || initialBlackStones.length >= 2) firstPlayer = 'white';

    // The first recorded move is the most reliable signal of all.
    if (moves.length > 0) firstPlayer = moves[0].color;

    return {
      size,
      komi,
      handicap: handicap || (initialBlackStones.length >= 2 ? initialBlackStones.length : 0),
      ruleSet,
      blackPlayer,
      whitePlayer,
      blackRank,
      whiteRank,
      date,
      result,
      initialBlackStones,
      initialWhiteStones,
      moves,
      firstPlayer,
      variationsSkipped
    };
  }

  // -----------------------------------------------------------
  // GENERATE
  // -----------------------------------------------------------

  /** Escapes a text value for an SGF property. */
  private static escapeText(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
  }

  public static generate(
    board: GoBoard,
    blackPlayer: string = 'Humano',
    whitePlayer: string = 'IA Mestre',
    komi: number = 6.5,
    ruleSet: RuleSet = 'japanese',
    result: string = ''
  ): string {
    const today = new Date().toISOString().split('T')[0];

    let sgf = '(;GM[1]FF[4]CA[UTF-8]AP[GoMaster:2.0]\n';
    sgf += `SZ[${board.size}]KM[${komi}]RU[${ruleSet === 'japanese' ? 'Japanese' : 'Chinese'}]\n`;
    sgf += `PB[${this.escapeText(blackPlayer)}]PW[${this.escapeText(whitePlayer)}]DT[${today}]`;
    if (result) sgf += `RE[${this.escapeText(result)}]`;
    sgf += '\n';

    // Handicap and any other pre-placed stones belong in the root node.
    const blackSetup = board.setupStones.filter(s => s.color === 'black');
    const whiteSetup = board.setupStones.filter(s => s.color === 'white');
    if (blackSetup.length >= 2) sgf += `HA[${blackSetup.length}]`;
    if (blackSetup.length > 0) {
      sgf += 'AB' + blackSetup.map(s => `[${this.pointToSgfCoord(s)}]`).join('');
    }
    if (whiteSetup.length > 0) {
      sgf += 'AW' + whiteSetup.map(s => `[${this.pointToSgfCoord(s)}]`).join('');
    }
    if (board.setupStones.length > 0) sgf += `PL[${board.movesList[0]?.color === 'white' ? 'W' : 'B'}]\n`;

    for (const move of board.movesList) {
      if (move.resign) continue; // resignation is recorded in RE, not as a move
      const colChar = move.color === 'black' ? 'B' : 'W';
      sgf += move.pass ? `;${colChar}[]` : `;${colChar}[${this.pointToSgfCoord({ x: move.x, y: move.y })}]`;
      if (move.comment) sgf += `C[${this.escapeText(move.comment)}]`;
      sgf += '\n';
    }

    sgf += ')';
    return sgf;
  }

  /** Triggers a browser download of an SGF file. */
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
