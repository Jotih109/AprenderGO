import { BoardSize, Color, Move, Point } from '../types/go';
import { GoBoard } from '../core/GoBoard';
import { ConceptId } from '../data/concepts';

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'good';

export interface MoveInsight {
  id: string;
  severity: InsightSeverity;
  concept: ConceptId;
  /** Short headline, e.g. "Você ignorou um atari". */
  title: string;
  /** Concrete detail with real counts and coordinates from this position. */
  detail: string;
  /** Board points worth looking at, for highlighting. */
  points?: Point[];
}

/** Facts gathered from the position *before* the move is played. */
export interface PreMoveFacts {
  color: Color;
  point: Point | null;
  ownAtari: { size: number; liberty: Point | null; sample: Point }[];
  oppAtari: { size: number; sample: Point }[];
  adjacentOwnGroups: number;
  adjacentOppGroups: number;
  /** All four orthogonal neighbours are our own stones. */
  isOwnEye: boolean;
  /** The point sits in a small empty area bordered only by our stones. */
  ownTerritorySize: number;
}

const COLUMN_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

function coord(pt: Point, size: BoardSize): string {
  return `${COLUMN_LETTERS[pt.x] ?? '?'}${size - pt.y}`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** A stable key for a group, so the same group can be recognised after a move. */
function groupKey(board: GoBoard, pt: Point): string {
  const grp = board.getGroup(pt.x, pt.y);
  if (!grp) return '';
  let minIdx = Infinity;
  let best = pt;
  for (const p of grp.points) {
    const idx = p.y * board.size + p.x;
    if (idx < minIdx) {
      minIdx = idx;
      best = p;
    }
  }
  return `${best.x},${best.y}`;
}

function atariGroups(board: GoBoard, color: Color): { size: number; liberty: Point | null; sample: Point }[] {
  const out: { size: number; liberty: Point | null; sample: Point }[] = [];
  for (const grp of board.getAllGroups()) {
    if (grp.color !== color || grp.liberties.size !== 1) continue;
    const libKey = [...grp.liberties][0];
    const comma = libKey.indexOf(',');
    out.push({
      size: grp.points.length,
      liberty: { x: Number(libKey.slice(0, comma)), y: Number(libKey.slice(comma + 1)) },
      sample: grp.points[0]
    });
  }
  return out;
}

/** Distinct neighbouring groups of the given colour around a point. */
function distinctNeighbourGroups(board: GoBoard, pt: Point, color: Color): number {
  const seen = new Set<string>();
  for (const n of board.getAdjacent(pt.x, pt.y)) {
    if (board.grid[n.y][n.x] !== color) continue;
    seen.add(groupKey(board, n));
  }
  return seen.size;
}

/**
 * Size of the empty area containing `pt`, but only when that area is bordered
 * exclusively by `color`. Returns 0 when the area touches the opponent, which
 * means it is not settled territory yet.
 */
function ownTerritoryArea(board: GoBoard, pt: Point, color: Color): number {
  const opponent: Color = color === 'black' ? 'white' : 'black';
  const size = board.size;
  const seen = new Uint8Array(size * size);
  const stack = [pt.y * size + pt.x];
  seen[stack[0]] = 1;
  let count = 0;

  while (stack.length > 0) {
    const idx = stack.pop()!;
    const x = idx % size;
    const y = (idx - x) / size;
    count++;
    if (count > 40) return 0; // too big to call settled territory

    for (const n of board.getAdjacent(x, y)) {
      const cell = board.grid[n.y][n.x];
      if (cell === opponent) return 0; // not exclusively ours
      if (cell !== null) continue;
      const nIdx = n.y * size + n.x;
      if (!seen[nIdx]) {
        seen[nIdx] = 1;
        stack.push(nIdx);
      }
    }
  }
  return count;
}

export class MoveInsights {
  /** Reads the position before the move. Call this while the board still shows it. */
  public static capture(board: GoBoard, move: Move): PreMoveFacts {
    const color = move.color;
    const opponent: Color = color === 'black' ? 'white' : 'black';
    const isPlayed = !move.pass && !move.resign;
    const pt = isPlayed ? { x: move.x, y: move.y } : null;

    let isOwnEye = false;
    let ownTerritorySize = 0;
    let adjacentOwnGroups = 0;
    let adjacentOppGroups = 0;

    if (pt) {
      const adj = board.getAdjacent(pt.x, pt.y);
      isOwnEye = adj.length > 0 && adj.every(n => board.grid[n.y][n.x] === color);
      adjacentOwnGroups = distinctNeighbourGroups(board, pt, color);
      adjacentOppGroups = distinctNeighbourGroups(board, pt, opponent);
      ownTerritorySize = ownTerritoryArea(board, pt, color);
    }

    return {
      color,
      point: pt,
      ownAtari: atariGroups(board, color),
      oppAtari: atariGroups(board, opponent).map(g => ({ size: g.size, sample: g.sample })),
      adjacentOwnGroups,
      adjacentOppGroups,
      isOwnEye,
      ownTerritorySize
    };
  }

  /**
   * Reads the position after the move and turns the difference into plain
   * observations. Every line here is backed by something measured on the board:
   * liberty counts, group sizes, captures, distance to the edge.
   */
  public static analyze(
    boardAfter: GoBoard,
    pre: PreMoveFacts,
    move: Move,
    moveNumber: number,
    size: BoardSize,
    capturedCount: number
  ): MoveInsight[] {
    const insights: MoveInsight[] = [];
    const color = pre.color;
    const opponent: Color = color === 'black' ? 'white' : 'black';

    if (move.pass) {
      insights.push({
        id: 'pass',
        severity: 'info',
        concept: 'passar',
        title: 'Você passou a vez',
        detail:
          'Passar só vale a pena quando nenhum lance restante aumenta seus pontos. ' +
          'Se ainda há fronteiras abertas no tabuleiro, passar entrega lances de graça ao adversário.'
      });
      return insights;
    }
    if (move.resign || !pre.point) return insights;

    const pt = pre.point;
    const where = coord(pt, size);
    const edgeDist = Math.min(Math.min(pt.x, size - 1 - pt.x), Math.min(pt.y, size - 1 - pt.y));
    const openingLimit = size === 9 ? 10 : size === 13 ? 18 : 24;
    const isOpening = moveNumber <= openingLimit;

    // ---- Captures ----
    if (capturedCount > 0) {
      insights.push({
        id: 'capture',
        severity: 'good',
        concept: 'captura',
        title: `Você capturou ${capturedCount} ${plural(capturedCount, 'pedra', 'pedras')}`,
        detail:
          `As pedras adversárias ficaram sem liberdades e saíram do tabuleiro. ` +
          `Cada uma vale 1 ponto no final, e o espaço aberto costuma virar território seu.`
      });
    }

    // ---- Did the move rescue a group that was in atari? ----
    const rescued = pre.ownAtari.find(g => g.liberty && g.liberty.x === pt.x && g.liberty.y === pt.y);
    const playedGroup = boardAfter.getGroup(pt.x, pt.y);
    const playedLiberties = playedGroup ? playedGroup.liberties.size : 0;
    const playedSize = playedGroup ? playedGroup.points.length : 1;

    if (rescued && playedLiberties >= 2) {
      insights.push({
        id: 'saved-group',
        severity: 'good',
        concept: 'atari',
        title: `Você salvou ${rescued.size} ${plural(rescued.size, 'pedra', 'pedras')} do atari`,
        detail:
          `Esse grupo estava com 1 liberdade só. Jogando em ${where} ele passou a ter ${playedLiberties} liberdades ` +
          `e saiu do perigo imediato.`,
        points: [pt]
      });
    }

    // ---- Self-atari ----
    if (playedLiberties === 1 && capturedCount === 0) {
      insights.push({
        id: 'self-atari',
        severity: 'critical',
        concept: 'auto-atari',
        title: 'Auto-atari: você entregou pedras',
        detail:
          `Depois de ${where}, esse grupo de ${playedSize} ${plural(playedSize, 'pedra ficou', 'pedras ficaram')} ` +
          `com apenas 1 liberdade. O adversário pode capturar tudo no próximo lance, de graça.`,
        points: [pt]
      });
    } else if (playedLiberties === 2 && playedSize >= 3) {
      insights.push({
        id: 'low-liberties',
        severity: 'warning',
        concept: 'grupo-fraco',
        title: 'Grupo ficou apertado',
        detail:
          `Seu grupo de ${playedSize} pedras tem só 2 liberdades. Dois lances do adversário bastam para capturá-lo, ` +
          `então ele vai precisar de atenção em breve.`,
        points: [pt]
      });
    }

    // ---- Own groups that were already in atari and still are ----
    const playedGroupPoints = new Set(
      (playedGroup?.points ?? []).map(p => `${p.x},${p.y}`)
    );

    const stillInAtari = atariGroups(boardAfter, color).filter(g => {
      const grpNow = boardAfter.getGroup(g.sample.x, g.sample.y);
      if (!grpNow) return false;
      // The group just played is already reported above as self-atari.
      if (playedLiberties === 1 && playedGroupPoints.has(`${g.sample.x},${g.sample.y}`)) return false;
      // Only count groups that were in danger before this move too, so this
      // reports "you ignored it", not "you just created it".
      return pre.ownAtari.some(before =>
        grpNow.points.some(p => p.x === before.sample.x && p.y === before.sample.y)
      );
    });

    const biggestIgnored = stillInAtari.sort((a, b) => b.size - a.size)[0];
    if (biggestIgnored && capturedCount === 0) {
      insights.push({
        id: 'atari-ignored',
        severity: biggestIgnored.size >= 2 ? 'critical' : 'warning',
        concept: 'atari',
        title: `${biggestIgnored.size} ${plural(biggestIgnored.size, 'pedra sua continua', 'pedras suas continuam')} em atari`,
        detail:
          `Esse grupo já estava com 1 liberdade antes do seu lance e continua assim. ` +
          `O adversário pode capturá-lo agora jogando em ${biggestIgnored.liberty ? coord(biggestIgnored.liberty, size) : 'na última liberdade'}. ` +
          `Quando um grupo seu está em atari, quase sempre é urgente resolver isso primeiro.`,
        points: biggestIgnored.liberty ? [biggestIgnored.liberty] : undefined
      });
    }

    // ---- Putting the opponent in atari ----
    const oppAtariAfter = atariGroups(boardAfter, opponent);
    const newOppAtari = oppAtariAfter.filter(
      g => !pre.oppAtari.some(before => before.sample.x === g.sample.x && before.sample.y === g.sample.y)
    );
    if (newOppAtari.length > 0 && capturedCount === 0) {
      const total = newOppAtari.reduce((a, g) => a + g.size, 0);
      insights.push({
        id: 'gives-atari',
        severity: 'good',
        concept: 'atari',
        title:
          newOppAtari.length >= 2
            ? `Atari duplo em ${newOppAtari.length} grupos`
            : `Você colocou ${total} ${plural(total, 'pedra', 'pedras')} em atari`,
        detail:
          newOppAtari.length >= 2
            ? `Dois grupos adversários ficaram com 1 liberdade ao mesmo tempo. Ele só consegue salvar um deles.`
            : `Esse grupo adversário ficou com 1 liberdade. Se ele não reagir, você captura no próximo lance.`
      });
    }

    // ---- Connecting and cutting ----
    if (pre.adjacentOwnGroups >= 2) {
      insights.push({
        id: 'connects',
        severity: 'good',
        concept: 'conexao',
        title: `Você conectou ${pre.adjacentOwnGroups} grupos`,
        detail:
          `Grupos ligados somam liberdades e precisam de dois olhos no total, em vez de dois cada um. ` +
          `Conectar deixa suas pedras bem mais difíceis de atacar.`
      });
    }
    if (pre.adjacentOppGroups >= 2) {
      insights.push({
        id: 'cut',
        severity: 'good',
        concept: 'corte',
        title: 'Corte: você separou o adversário',
        detail:
          `${where} fica entre ${pre.adjacentOppGroups} grupos adversários que se ligariam por aqui. ` +
          `Separados, cada um precisa se defender sozinho.`
      });
    }

    // ---- Wasting a move inside your own area ----
    if (pre.isOwnEye) {
      insights.push({
        id: 'filled-own-eye',
        severity: 'critical',
        concept: 'olho',
        title: 'Você preencheu o próprio olho',
        detail:
          `${where} estava cercado só por pedras suas — era um olho. Preencher um olho destrói a segurança do grupo ` +
          `e ainda gasta um ponto do seu território.`,
        points: [pt]
      });
    } else if (pre.ownTerritorySize > 0 && !isOpening) {
      insights.push({
        id: 'own-territory',
        severity: 'warning',
        concept: 'territorio',
        title: 'Lance dentro do seu próprio território',
        detail:
          `${where} estava numa área de ${pre.ownTerritorySize} ${plural(pre.ownTerritorySize, 'ponto', 'pontos')} ` +
          `cercada só por pedras suas — já era seu. Colocar uma pedra ali ocupa um ponto que você já ia contar.`,
        points: [pt]
      });
    }

    // ---- Where on the board ----
    if (isOpening) {
      if (edgeDist === 0) {
        insights.push({
          id: 'first-line-early',
          severity: 'warning',
          concept: 'primeira-linha',
          title: 'Primeira linha cedo demais',
          detail:
            `${where} está na borda. Pedras na borda cercam muito pouco espaço, porque só têm um lado útil. ` +
            `No começo do jogo, a 3ª e a 4ª linha valem bem mais.`,
          points: [pt]
        });
      } else if (edgeDist === 1) {
        insights.push({
          id: 'second-line-early',
          severity: 'info',
          concept: 'terceira-linha',
          title: 'Segunda linha é baixa para esta fase',
          detail:
            `${where} está na 2ª linha. Ela é útil no fim da partida, mas no começo faz pouco território. ` +
            `Uma linha acima já rende bem mais.`,
          points: [pt]
        });
      } else if ((edgeDist === 2 || edgeDist === 3) && moveNumber <= 4) {
        insights.push({
          id: 'good-line',
          severity: 'good',
          concept: 'terceira-linha',
          title: `Boa altura: ${edgeDist + 1}ª linha`,
          detail:
            edgeDist === 2
              ? 'A 3ª linha é a altura clássica para fechar território na lateral com segurança.'
              : 'A 4ª linha cerca menos território direto, mas domina o centro e ajuda nas lutas.'
        });
      }

      // A corner point is close to an edge on both axes. Using half the board
      // as the threshold made every third-line move on 9x9 look like a corner.
      const cornerBand = Math.floor((size - 1) / 3);
      const inCorner =
        Math.min(pt.x, size - 1 - pt.x) <= cornerBand && Math.min(pt.y, size - 1 - pt.y) <= cornerBand;
      if (moveNumber <= 6 && inCorner && edgeDist >= 2 && edgeDist <= 3) {
        insights.push({
          id: 'corner-opening',
          severity: 'good',
          concept: 'cantos-primeiro',
          title: 'Abertura no canto',
          detail:
            'O canto usa duas bordas como parede, então cercar território ali custa poucas pedras. ' +
            'É por isso que as partidas começam pelos cantos.'
        });
      }
    }

    // ---- Shape ----
    if (this.makesEmptyTriangle(boardAfter, pt, color)) {
      insights.push({
        id: 'empty-triangle',
        severity: 'info',
        concept: 'triangulo-vazio',
        title: 'Triângulo vazio',
        detail:
          'Suas pedras formaram um L com o ponto da diagonal vazio. Essa forma gasta três pedras e mesmo assim ' +
          'tem poucas liberdades — quase sempre existe uma conexão melhor por perto.',
        points: [pt]
      });
    }

    return insights;
  }

  private static makesEmptyTriangle(board: GoBoard, pt: Point, color: Color): boolean {
    const corners = [
      [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 }],
      [{ dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 1 }],
      [{ dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 }],
      [{ dx: -1, dy: 0 }, { dx: 0, dy: -1 }, { dx: -1, dy: -1 }]
    ];
    for (const c of corners) {
      const p1 = { x: pt.x + c[0].dx, y: pt.y + c[0].dy };
      const p2 = { x: pt.x + c[1].dx, y: pt.y + c[1].dy };
      const diag = { x: pt.x + c[2].dx, y: pt.y + c[2].dy };
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

  /**
   * One short sentence saying what a suggested move would have achieved.
   * Built by actually playing it on a copy of the position, so the claim is
   * checked rather than guessed.
   */
  public static describeCandidate(board: GoBoard, point: Point, color: Color, size: BoardSize): string {
    const trial = board.clone();
    const pre = this.capture(trial, { x: point.x, y: point.y, color });
    const res = trial.playMove(point.x, point.y, color);
    if (!res.success) return `Jogar em ${coord(point, size)}`;

    const captured = res.move?.captured?.length ?? 0;
    if (captured > 0) return `captura ${captured} ${plural(captured, 'pedra', 'pedras')}`;

    const rescued = pre.ownAtari.find(g => g.liberty && g.liberty.x === point.x && g.liberty.y === point.y);
    if (rescued) return `salva ${rescued.size} ${plural(rescued.size, 'pedra', 'pedras')} em atari`;

    const oppAtariAfter = atariGroups(trial, color === 'black' ? 'white' : 'black');
    const newAtari = oppAtariAfter.filter(
      g => !pre.oppAtari.some(b => b.sample.x === g.sample.x && b.sample.y === g.sample.y)
    );
    if (newAtari.length >= 2) return 'faz atari duplo';
    if (newAtari.length === 1) return `põe ${newAtari[0].size} ${plural(newAtari[0].size, 'pedra', 'pedras')} em atari`;

    if (pre.adjacentOppGroups >= 2) return 'corta os grupos adversários';
    if (pre.adjacentOwnGroups >= 2) return 'conecta seus grupos';

    const edgeDist = Math.min(
      Math.min(point.x, size - 1 - point.x),
      Math.min(point.y, size - 1 - point.y)
    );
    // Specific first, generic last.
    if (edgeDist === 2) return 'fecha território na 3ª linha';
    if (edgeDist === 3) return 'ganha influência na 4ª linha';
    if (edgeDist >= 4) return 'domina o centro';
    if (edgeDist === 1) return 'garante a base na 2ª linha';

    const grp = trial.getGroup(point.x, point.y);
    if (grp && grp.liberties.size >= 4) return 'ocupa um ponto seguro';
    return 'expande sua posição';
  }
}
