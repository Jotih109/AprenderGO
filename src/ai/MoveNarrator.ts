import { BoardSize, Color, Move, Point } from '../types/go';
import { GoBoard } from '../core/GoBoard';
import { GoScoring } from '../core/GoScoring';
import { InfluenceMap } from '../core/InfluenceMap';
import { ConceptId } from '../data/concepts';
import { MoveInsights } from './MoveInsights';

/**
 * What kind of move this is, decided from the board rather than from the win
 * rate. The observer mode names the kind out loud, because "this is a cut" is
 * the part a learner can carry to their own games — the percentage is not.
 */
export type MoveArchetype =
  | 'desistencia'
  | 'passe'
  | 'captura'
  | 'salvamento'
  | 'vida'
  | 'atari-duplo'
  | 'corte'
  | 'atari'
  | 'conexao'
  | 'invasao'
  | 'reducao'
  | 'fecho-canto'
  | 'abordagem'
  | 'ocupacao-canto'
  | 'extensao'
  | 'tenuki'
  | 'fim-de-jogo'
  | 'solido';

export type GamePhase = 'abertura' | 'meio-jogo' | 'final';

export interface NarratedAlternative {
  point: Point;
  coord: string;
  /** What the alternative would have done, verified by playing it on a copy. */
  note: string;
}

export interface MoveCommentary {
  moveNumber: number;
  color: Color;
  /** "D4", or "passou" / "desistiu". */
  coord: string;
  phase: GamePhase;
  archetype: MoveArchetype;
  /** Two or three words naming the move: "Corte", "Fecho de canto". */
  headline: string;
  /** Why *this* point, *now* — built from counts measured on this position. */
  why: string;
  /** The transferable lesson: when a move of this kind is the right call. */
  when: string;
  concept: ConceptId;
  /** Points worth looking at while reading, highlighted on the board. */
  highlights: Point[];
  alternatives: NarratedAlternative[];
  /** Board lead in points for the side that just moved. Null without a search. */
  leadForMover: number | null;
  /** Win rate for the side that just moved, 0..1. Null without a search. */
  confidenceForMover: number | null;
}

/** The parts of a BotResponse the narrator can use. */
export interface NarratorSearchInfo {
  /** Win rate from the BLACK perspective, 0..1. */
  winRate: number;
  /** Area lead for BLACK, komi included. */
  scoreLead: number;
  candidateMoves?: { point: Point; score: number; winRate: number }[];
}

const COLUMN_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

function coordOf(pt: Point, size: BoardSize): string {
  return `${COLUMN_LETTERS[pt.x] ?? '?'}${size - pt.y}`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function stones(n: number): string {
  return `${n} ${plural(n, 'pedra', 'pedras')}`;
}

function other(color: Color): Color {
  return color === 'black' ? 'white' : 'black';
}

function sideName(color: Color): string {
  return color === 'black' ? 'as pretas' : 'as brancas';
}

function sideNameCap(color: Color): string {
  return color === 'black' ? 'As pretas' : 'As brancas';
}

/** "pretas" / "brancas", for agreeing with a plural noun like "pedras". */
function stonesAdj(color: Color): string {
  return color === 'black' ? 'pretas' : 'brancas';
}

/** "preto" / "branco", for agreeing with a masculine noun like "grupo". */
function groupAdj(color: Color): string {
  return color === 'black' ? 'preto' : 'branco';
}

/** "preta" / "branca", for agreeing with a feminine noun like "pedra". */
function stoneAdj(color: Color): string {
  return color === 'black' ? 'preta' : 'branca';
}

/** Chebyshev distance: on a goban "three spaces away" reads diagonally too. */
function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** 1 for the edge line, 3 for the third line, and so on. */
function lineNumber(pt: Point, size: number): number {
  return Math.min(Math.min(pt.x, size - 1 - pt.x), Math.min(pt.y, size - 1 - pt.y)) + 1;
}

/** Distance to the closest stone of a colour, or Infinity when there are none. */
function distanceToNearestStone(board: GoBoard, pt: Point, color: Color): number {
  let best = Infinity;
  for (let y = 0; y < board.size; y++) {
    const row = board.grid[y];
    for (let x = 0; x < board.size; x++) {
      if (row[x] !== color) continue;
      const d = chebyshev(pt, { x, y });
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Liberties of a group that are surrounded on all four sides by that group's
 * own colour. This is the cheap eye test every Go program starts with: it can
 * be fooled by false eyes, so the commentary only ever calls it "espaços
 * cercados" and leaves the word "vivo" to Benson's algorithm.
 */
function surroundedLiberties(board: GoBoard, pt: Point, color: Color): number {
  const grp = board.getGroup(pt.x, pt.y);
  if (!grp) return 0;
  let count = 0;
  for (const key of grp.liberties) {
    const comma = key.indexOf(',');
    const lx = Number(key.slice(0, comma));
    const ly = Number(key.slice(comma + 1));
    const adj = board.getAdjacent(lx, ly);
    if (adj.length > 0 && adj.every(n => board.grid[n.y][n.x] === color)) count++;
  }
  return count;
}

/** Which quadrant of the board a point sits in, used for corner reasoning. */
function cornerOf(pt: Point, size: number): Point {
  return {
    x: pt.x < size / 2 ? 0 : size - 1,
    y: pt.y < size / 2 ? 0 : size - 1
  };
}

/**
 * How far from the corner still counts as "in the corner".
 *
 * Has to stop short of the middle: with a reach of 4 on a 9x9, the centre point
 * itself came out 4 away from the corner and tengen was announced as a corner
 * occupation.
 */
function cornerReach(size: number): number {
  return size === 9 ? 3 : size === 13 ? 4 : 5;
}

/** True when the point itself sits in one of the four corner regions. */
function isCornerArea(pt: Point, size: number): boolean {
  return chebyshev(pt, cornerOf(pt, size)) <= cornerReach(size);
}

/** Stones of a colour within a given distance of a point. */
function countStonesWithin(board: GoBoard, pt: Point, color: Color, reach: number): number {
  let count = 0;
  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      if (board.grid[y][x] !== color) continue;
      if (chebyshev(pt, { x, y }) <= reach) count++;
    }
  }
  return count;
}

/** Stones of a colour inside the corner region the point belongs to. */
function stonesInCorner(board: GoBoard, pt: Point, color: Color): number {
  const size = board.size;
  const reach = cornerReach(size);
  const corner = cornerOf(pt, size);
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (board.grid[y][x] !== color) continue;
      if (chebyshev({ x, y }, corner) <= reach) count++;
    }
  }
  return count;
}

/** Moves after which the opening is over, scaled to the board. */
function openingLimit(size: BoardSize): number {
  return size === 9 ? 10 : size === 13 ? 18 : 24;
}

export class MoveNarrator {
  /**
   * Turns one move into a piece of commentary: what kind of move it is, why it
   * was played here and now, and when a move of that kind is right in general.
   *
   * Every number quoted in the text is read off the two positions handed in, so
   * "o grupo de 3 pedras ficou com 2 liberdades" is checked, not guessed. The
   * search result only ever contributes the alternatives and the score line.
   */
  public static narrate(
    before: GoBoard,
    after: GoBoard,
    move: Move,
    moveNumber: number,
    search: NarratorSearchInfo | null
  ): MoveCommentary {
    const size = before.size;
    const color = move.color;
    const opponent = other(color);

    const leadForMover = search
      ? (color === 'black' ? search.scoreLead : -search.scoreLead)
      : null;
    const confidenceForMover = search
      ? (color === 'black' ? search.winRate : 1 - search.winRate)
      : null;

    const base = {
      moveNumber,
      color,
      leadForMover,
      confidenceForMover,
      alternatives: [] as NarratedAlternative[]
    };

    if (move.resign) {
      return {
        ...base,
        coord: 'desistiu',
        phase: 'final',
        archetype: 'desistencia',
        headline: 'Desistência',
        why: `${sideNameCap(color)} desistiram: a busca não encontrou mais nenhuma sequência que virasse a partida.`,
        when: 'Desistir cedo é comum entre jogadores fortes quando a diferença passa do que um erro do adversário conseguiria devolver. Enquanto você está aprendendo, jogue até o fim — o final de jogo é onde mais se ganha pontos de graça.',
        concept: 'territorio',
        highlights: []
      };
    }

    if (move.pass) {
      return {
        ...base,
        coord: 'passou',
        phase: 'final',
        archetype: 'passe',
        headline: 'Passe',
        why: `${sideNameCap(color)} passaram: para a busca, nenhum lance restante no tabuleiro vale mais do que zero ponto.`,
        when: 'Passe só quando todas as fronteiras estiverem fechadas e cada lance restante for dentro do seu próprio território — preencher o que já é seu custa um ponto. Duas passadas seguidas encerram a partida e abrem a contagem.',
        concept: 'passar',
        highlights: []
      };
    }

    const pt: Point = { x: move.x, y: move.y };
    const coord = coordOf(pt, size);
    const pre = MoveInsights.capture(before, move);
    const captured = move.captured?.length ?? 0;
    const line = lineNumber(pt, size);
    const phase = this.phaseOf(before, moveNumber, size);

    const group = after.getGroup(pt.x, pt.y);
    const groupSize = group?.points.length ?? 1;
    const liberties = group?.liberties.size ?? 0;

    const alternatives = this.buildAlternatives(before, pt, color, size, search);
    const detail = this.classify({
      before, after, pt, coord, color, opponent, size, line, phase,
      pre, captured, groupSize, liberties, moveNumber
    });

    return { ...base, coord, phase, alternatives, ...detail };
  }

  /**
   * Opening is a move count; endgame is measured, not counted. Once the
   * influence map has almost no undecided ground left, the big moves are gone
   * however many stones have been played.
   */
  private static phaseOf(board: GoBoard, moveNumber: number, size: BoardSize): GamePhase {
    if (moveNumber <= openingLimit(size)) return 'abertura';
    const total = size * size;
    const { neutralEstimate } = InfluenceMap.calculate(board);
    return neutralEstimate <= total * 0.12 ? 'final' : 'meio-jogo';
  }

  /** The engine's runners-up, each described by actually playing it. */
  private static buildAlternatives(
    before: GoBoard,
    played: Point,
    color: Color,
    size: BoardSize,
    search: NarratorSearchInfo | null
  ): NarratedAlternative[] {
    if (!search?.candidateMoves?.length) return [];
    return search.candidateMoves
      .filter(c => c.point.x !== played.x || c.point.y !== played.y)
      .slice(0, 3)
      .map(c => ({
        point: c.point,
        coord: coordOf(c.point, size),
        note: MoveInsights.describeCandidate(before, c.point, color, size)
      }));
  }

  /**
   * Picks the single archetype that best describes the move.
   *
   * Order is deliberate: the most concrete thing that happened wins. A move
   * that captures *and* connects is a capture — that is what a person watching
   * actually sees — and the connection would only muddy the lesson.
   */
  private static classify(ctx: {
    before: GoBoard;
    after: GoBoard;
    pt: Point;
    coord: string;
    color: Color;
    opponent: Color;
    size: BoardSize;
    line: number;
    phase: GamePhase;
    pre: ReturnType<typeof MoveInsights.capture>;
    captured: number;
    groupSize: number;
    liberties: number;
    moveNumber: number;
  }): Pick<MoveCommentary, 'archetype' | 'headline' | 'why' | 'when' | 'concept' | 'highlights'> {
    const { before, after, pt, coord, color, opponent, size, line, phase, pre, captured, groupSize, liberties } = ctx;

    // ---- Capture -------------------------------------------------------
    if (captured > 0) {
      return {
        archetype: 'captura',
        headline: `Captura de ${stones(captured)}`,
        why:
          `${stones(captured)} ${stonesAdj(opponent)} estavam com uma liberdade só. ` +
          `${sideNameCap(color)} fecharam a última em ${coord} e elas saíram do tabuleiro: ` +
          `${captured} ${plural(captured, 'ponto', 'pontos')} de prisioneiro, mais o espaço que elas ocupavam.`,
        when:
          'Capture quando as pedras presas forem grandes ou estiverem cortando você. ' +
          'Se forem uma ou duas pedras que não separam nada, muitas vezes vale mais um ponto grande em outro canto — ' +
          'capturar cedo demais é lance pequeno, e a captura continua lá esperando.',
        concept: 'captura',
        highlights: [pt]
      };
    }

    // ---- Escaping atari ------------------------------------------------
    const rescued = pre.ownAtari.find(g => g.liberty && g.liberty.x === pt.x && g.liberty.y === pt.y);
    if (rescued && liberties >= 2) {
      return {
        archetype: 'salvamento',
        headline: 'Fuga do atari',
        why:
          `O grupo ${groupAdj(color)} de ${stones(rescued.size)} estava em atari — uma liberdade só, capturável no lance seguinte. ` +
          `Estendendo em ${coord} ele vira um grupo de ${stones(groupSize)} com ${liberties} liberdades e sai do perigo imediato.`,
        when:
          'Antes de fugir, conte as liberdades que você terá depois do lance. ' +
          'Com duas, o adversário continua perseguindo e você só adiciona pedras à conta. ' +
          'Fuja quando a fuga te conecta a um grupo forte ou te leva para espaço aberto; ' +
          'senão, sacrifique as pedras e use a vez num ponto maior.',
        concept: 'liberdade',
        highlights: [pt, rescued.sample]
      };
    }

    // ---- Second eye: unconditional life --------------------------------
    const aliveAfter = GoScoring.bensonPassAlive(after, color);
    const aliveBefore = GoScoring.bensonPassAlive(before, color);
    if (aliveAfter.has(`${pt.x},${pt.y}`) && !aliveBefore.has(`${pt.x},${pt.y}`)) {
      const eyes = surroundedLiberties(after, pt, color);
      return {
        archetype: 'vida',
        headline: 'Grupo vivo',
        why:
          `Com ${coord} o grupo de ${stones(groupSize)} passa a ter ${eyes} espaços cercados separados. ` +
          'Pelo critério de Benson ele está vivo incondicionalmente: não existe sequência do adversário que o capture, ' +
          'nem que as pretas e as brancas joguem só ali até o fim.',
        when:
          'Faça o segundo olho quando o grupo já está cercado e ainda tem só um. ' +
          'Um grupo vivo pode ser esquecido pelo resto da partida — é isso que liberta sua vez para os pontos grandes. ' +
          'Um grupo com um olho só continua sendo alvo, e defender alvo custa lance atrás de lance.',
        concept: 'olho',
        highlights: [pt]
      };
    }

    // ---- Atari against the opponent ------------------------------------
    const oppAtariAfter = MoveInsights.atariGroups(after, opponent);
    const freshAtari = oppAtariAfter.filter(
      g => !pre.oppAtari.some(b => b.sample.x === g.sample.x && b.sample.y === g.sample.y)
    );
    if (freshAtari.length >= 2) {
      const total = freshAtari.reduce((sum, g) => sum + g.size, 0);
      return {
        archetype: 'atari-duplo',
        headline: 'Atari duplo',
        why:
          `${coord} deixa ${freshAtari.length} grupos ${groupAdj(opponent)}s ` +
          `com uma liberdade ao mesmo tempo (${stones(total)} no total). ` +
          'O adversário só consegue salvar um deles; o outro vai ser capturado.',
        when:
          'Procure atari duplo quando dois grupos adversários estiverem frouxos perto um do outro. ' +
          'É o tipo de lance que ganha material sem precisar ler uma sequência longa: ' +
          'como só existe uma vez por turno, ele não tem defesa.',
        concept: 'atari',
        highlights: [pt, ...freshAtari.map(g => g.sample)]
      };
    }

    // ---- Cut -----------------------------------------------------------
    if (pre.adjacentOppGroups >= 2 && this.stillSeparated(after, pt, opponent)) {
      return {
        archetype: 'corte',
        headline: 'Corte',
        why:
          `Em ${coord} encostam ${pre.adjacentOppGroups} grupos ${groupAdj(opponent)}s diferentes. ` +
          'A pedra entra exatamente no ponto que os ligaria e eles seguem separados — ' +
          'agora cada um precisa cuidar da própria vida.',
        when:
          'Corte quando os dois pedaços ficarem fracos ao mesmo tempo: é aí que você ataca um e lucra no outro. ' +
          'Se um dos lados já tem dois olhos, o corte não ameaça nada e só gasta sua vez. ' +
          'Antes de cortar, olhe se a sua própria pedra de corte tem para onde correr.',
        concept: 'corte',
        highlights: [pt]
      };
    }

    // ---- Simple atari --------------------------------------------------
    if (freshAtari.length === 1) {
      const g = freshAtari[0];
      return {
        archetype: 'atari',
        headline: `Atari em ${stones(g.size)}`,
        why:
          `${coord} tira a penúltima liberdade do grupo ${groupAdj(opponent)} de ${stones(g.size)}. ` +
          'Ele fica com uma liberdade: ou foge, ou é capturado no próximo lance.',
        when:
          'Atari é ameaça, não ganho — o adversário ainda joga. ' +
          'Vale quando a captura de fato resolve alguma coisa (pedras que cortam, ou um muro virado para o seu lado) ' +
          'ou quando você aproveita a resposta forçada para ganhar um lance em outro lugar. ' +
          'Atari por atari só entrega pedras e fecha as suas próprias liberdades.',
        concept: 'atari',
        highlights: [pt, g.sample]
      };
    }

    // ---- Connection ----------------------------------------------------
    if (pre.adjacentOwnGroups >= 2) {
      return {
        archetype: 'conexao',
        headline: 'Conexão',
        why:
          `${coord} junta ${pre.adjacentOwnGroups} grupos ${groupAdj(color)}s num só, ` +
          `de ${stones(groupSize)} e ${liberties} liberdades. O ponto de corte que o adversário tinha ali deixa de existir.`,
        when:
          'Conectar vale quando pelo menos um dos dois lados ainda não está vivo: o grupo maior tem mais liberdades e mais espaço para fazer olhos. ' +
          'Se os dois já estão vivos, conectar é lance pequeno — o tabuleiro tem coisa maior. ' +
          'Repare que conectar também é defesa: tira do adversário o corte que ele estava guardando.',
        concept: 'conexao',
        highlights: [pt]
      };
    }

    // ---- Invasion and reduction ----------------------------------------
    const territorial = this.territorialRole(before, pt, color, opponent, phase);
    if (territorial === 'invasao') {
      const distOwn = distanceToNearestStone(before, pt, color);
      return {
        archetype: 'invasao',
        headline: 'Invasão',
        why:
          `${coord} cai dentro da zona que o mapa de influência dava ${opponent === 'black' ? 'às pretas' : 'às brancas'}, ` +
          `a ${distOwn} ${plural(distOwn, 'casa', 'casas')} da pedra ${stoneAdj(color)} mais próxima. ` +
          'A pedra entra sozinha e vai ter de fazer vida ali dentro, ou fugir para fora.',
        when:
          'Invada quando estiver atrás no placar e a área do adversário ainda tiver espaço aberto para fazer dois olhos. ' +
          'Se você já está na frente, invadir é arriscar sem precisar — reduza por fora. ' +
          'A pergunta antes de invadir é sempre a mesma: essa pedra vive aí dentro, ou vai virar presente?',
        concept: 'territorio',
        highlights: [pt]
      };
    }
    if (territorial === 'reducao') {
      return {
        archetype: 'reducao',
        headline: 'Redução',
        why:
          `${coord} raspa a borda da área ${stoneAdj(opponent)} pela ${line}ª linha, ` +
          'apoiada nas pedras que já estavam por perto. Tira pontos do adversário sem entrar num lugar onde a pedra ficaria sem vida.',
        when:
          'Reduza quando você está na frente: você diminui o território do adversário sem correr o risco de perder um grupo dentro dele. ' +
          'É a escolha segura. Invadir é a escolha de quem está atrás e precisa de mais do que alguns pontos.',
        concept: 'territorio',
        highlights: [pt]
      };
    }

    // ---- Opening shapes -------------------------------------------------
    if (phase === 'abertura' && isCornerArea(pt, size)) {
      const ownNear = stonesInCorner(before, pt, color);
      const oppNear = stonesInCorner(before, pt, opponent);

      if (ownNear === 0 && oppNear === 0) {
        return {
          archetype: 'ocupacao-canto',
          headline: 'Ocupação de canto',
          why:
            `${coord} ocupa um canto ainda vazio, na ${line}ª linha. ` +
            'No canto o território é cercado por dois lados pela própria borda — é onde a mesma pedra rende mais pontos.',
          when:
            'Cantos primeiro, depois as laterais, o centro por último. ' +
            'Cercar dez pontos no canto custa umas seis pedras; no centro custa mais que o dobro. ' +
            'Enquanto houver canto vazio, ele é o maior lance do tabuleiro.',
          concept: 'cantos-primeiro',
          highlights: [pt]
        };
      }
      if (oppNear > 0 && ownNear === 0) {
        return {
          archetype: 'abordagem',
          headline: 'Abordagem de canto',
          why:
            `Há ${stones(oppNear)} ${stonesAdj(opponent)} nesse canto e nenhuma ${stoneAdj(color)}. ` +
            `${coord} se aproxima pela ${line}ª linha para impedir que o canto vire território fechado do adversário.`,
          when:
            'Aborde antes que o adversário feche o canto: depois do fecho, entrar ali fica caro ou impossível. ' +
            'A abordagem também é lance de desenvolvimento — ela costuma trabalhar junto com as suas pedras da lateral mais próxima.',
          concept: 'cantos-primeiro',
          highlights: [pt]
        };
      }
      if (ownNear > 0) {
        return {
          archetype: 'fecho-canto',
          headline: 'Fecho de canto',
          why:
            `${coord} completa o canto onde ${sideName(color)} já tinham ${stones(ownNear)}, pela ${line}ª linha. ` +
            'Com as duas pedras trabalhando juntas, o canto passa a ser território quase certo.',
          when:
            'Feche o canto quando ele ainda estiver aberto e valer mais que os outros pontos grandes do tabuleiro. ' +
            'O fecho é lance duplo: garante pontos e ao mesmo tempo deixa suas pedras fortes para brigar na lateral.',
          concept: 'territorio',
          highlights: [pt]
        };
      }
    }

    // ---- Extension along a side -----------------------------------------
    const extension = this.findExtension(before, pt, color);
    if (extension && line >= 3 && line <= 4) {
      return {
        archetype: 'extensao',
        headline: 'Extensão na lateral',
        why:
          `${coord} se estende a ${extension.gap} ${plural(extension.gap, 'casa', 'casas')} de ${coordOf(extension.from, size)}, ` +
          `na mesma ${extension.axis === 'row' ? 'linha' : 'coluna'} e na ${line}ª linha. ` +
          'As duas pedras ficam longe o bastante para cercar espaço e perto o bastante para se socorrerem.',
        when:
          'Estenda para transformar uma pedra solta numa base com espaço para dois olhos. ' +
          'A regra prática é a altura mais um: da terceira linha, três casas; da quarta, quatro. ' +
          'Mais perto é lance lento, mais longe o adversário entra no meio e separa as duas.',
        concept: 'territorio',
        highlights: [pt, extension.from]
      };
    }

    // ---- Tenuki: playing away from the local exchange --------------------
    const last = before.lastMove;
    if (last && !last.pass && !last.resign) {
      const away = chebyshev(pt, { x: last.x, y: last.y });
      if (away >= (size === 9 ? 4 : 6)) {
        return {
          archetype: 'tenuki',
          headline: 'Tenuki (mudança de área)',
          why:
            `Em vez de responder perto de ${coordOf({ x: last.x, y: last.y }, size)}, ` +
            `${sideName(color)} jogam a ${away} casas dali, em ${coord}. ` +
            'Para a busca, o lance local valia menos que este ponto novo.',
          when:
            'Tenuki é a habilidade de largar uma briga que já rendeu o que tinha para render. ' +
            'Só não responda quando o lance local for pequeno e o seu grupo ali não puder morrer. ' +
            'Um bom hábito: antes de responder por reflexo, pergunte quanto vale o lance local em pontos.',
          concept: 'territorio',
          highlights: [pt, { x: last.x, y: last.y }]
        };
      }
    }

    // ---- Endgame boundary play -------------------------------------------
    if (phase === 'final') {
      return {
        archetype: 'fim-de-jogo',
        headline: 'Fim de jogo',
        why:
          `Com o tabuleiro praticamente dividido, ${coord} fecha fronteira pela ${line}ª linha. ` +
          'Lances assim valem poucos pontos cada, mas é a soma deles que decide partidas apertadas.',
        when:
          'No fim de jogo, jogue primeiro os lances que também obrigam o adversário a responder (sente): você mantém a vez e emenda um no outro. ' +
          'Deixe para o fim os que entregam a vez. Contar quanto vale cada fronteira é o que separa quem ganha por meio ponto de quem perde.',
        concept: 'territorio',
        highlights: [pt]
      };
    }

    // ---- Fallback: describe the shape --------------------------------------
    const byLine: Record<number, { headline: string; why: string; when: string; concept: ConceptId }> = {
      1: {
        headline: 'Lance na 1ª linha',
        why: `${coord} fica na primeira linha, colada na borda.`,
        when: 'Primeira linha é a linha da derrota no meio do jogo: ela quase não cerca território e não dá influência nenhuma. Só vale no fim de jogo, ou quando é o único ponto que dá vida ao grupo.',
        concept: 'primeira-linha'
      },
      2: {
        headline: 'Base na 2ª linha',
        why: `${coord} garante espaço para os olhos na segunda linha, com ${liberties} liberdades.`,
        when: 'Segunda linha é a linha da sobrevivência: pouco território, mas é dela que sai a base para fazer dois olhos. Jogue aí quando o grupo estiver cercado e precisando de vida.',
        concept: 'olho'
      },
      3: {
        headline: 'Território na 3ª linha',
        why: `${coord} fica na terceira linha, onde o território é cercado com segurança.`,
        when: 'Terceira linha é a linha do território. Use quando quiser pontos garantidos na lateral, ou quando o adversário já tiver força voltada para o centro.',
        concept: 'terceira-linha'
      },
      4: {
        headline: 'Influência na 4ª linha',
        why: `${coord} fica na quarta linha, virada para o centro.`,
        when: 'Quarta linha é a linha da influência: rende pouco território direto, mas suas pedras passam a mandar no centro. Use quando pretende atacar, e não só contar pontos.',
        concept: 'terceira-linha'
      }
    };

    const shape = byLine[line] ?? {
      headline: 'Lance no centro',
      why: `${coord} fica no centro do tabuleiro, com ${liberties} liberdades.`,
      when: 'O centro é a última área a valer pontos, porque cercar ali custa muitas pedras. Vale quando a disputa é de influência e não de território, ou quando o centro já está quase fechado pelos seus muros.',
      concept: 'territorio'
    };

    return {
      archetype: 'solido',
      headline: shape.headline,
      why: `${shape.why} O grupo fica com ${stones(groupSize)} e ${liberties} liberdades.`,
      when: shape.when,
      concept: shape.concept,
      highlights: [pt]
    };
  }

  /**
   * The friendly stone this move extends from: same row or column, two to five
   * spaces away, with nothing but empty points in between. That gap is what
   * separates an extension from a solid connection on one side and from a
   * stone that simply landed nearby on the other.
   */
  private static findExtension(
    board: GoBoard,
    pt: Point,
    color: Color
  ): { from: Point; gap: number; axis: 'row' | 'col' } | null {
    const dirs: { dx: number; dy: number; axis: 'row' | 'col' }[] = [
      { dx: 1, dy: 0, axis: 'row' },
      { dx: -1, dy: 0, axis: 'row' },
      { dx: 0, dy: 1, axis: 'col' },
      { dx: 0, dy: -1, axis: 'col' }
    ];

    for (const d of dirs) {
      for (let gap = 2; gap <= 5; gap++) {
        const x = pt.x + d.dx * gap;
        const y = pt.y + d.dy * gap;
        if (!board.isValidCoord(x, y)) break;
        const cell = board.grid[y][x];
        if (cell === null) continue;
        // First stone met along this ray: an extension only if it is ours and
        // the whole gap behind it was empty, which the loop above guarantees.
        if (cell === color) return { from: { x, y }, gap, axis: d.axis };
        break;
      }
    }
    return null;
  }

  /**
   * True when the neighbouring opponent groups around the point are still
   * distinct after the move — which is what makes the move a cut rather than
   * just a stone placed between two ends of the same group.
   */
  private static stillSeparated(after: GoBoard, pt: Point, opponent: Color): boolean {
    const seen = new Set<string>();
    for (const n of after.getAdjacent(pt.x, pt.y)) {
      if (after.grid[n.y][n.x] !== opponent) continue;
      const grp = after.getGroup(n.x, n.y);
      if (!grp) continue;
      let minIdx = Infinity;
      let key = '';
      for (const p of grp.points) {
        const idx = p.y * after.size + p.x;
        if (idx < minIdx) {
          minIdx = idx;
          key = `${p.x},${p.y}`;
        }
      }
      seen.add(key);
    }
    return seen.size >= 2;
  }

  /**
   * Whether the point lands inside the opponent's sphere (invasion), scrapes
   * its edge with support nearby (reduction), or neither.
   */
  private static territorialRole(
    board: GoBoard,
    pt: Point,
    color: Color,
    opponent: Color,
    phase: GamePhase
  ): 'invasao' | 'reducao' | null {
    const { ownership } = InfluenceMap.calculate(board);
    if (ownership[pt.y][pt.x] !== opponent) return null;

    const distOwn = distanceToNearestStone(board, pt, color);
    const distOpp = distanceToNearestStone(board, pt, opponent);
    // Nothing to invade before the opponent has a framework worth the name.
    if (!Number.isFinite(distOpp) || distOpp > 4) return null;

    // A single enemy stone is not a framework. Approaching a lone corner stone
    // is a kakari, and calling that an invasion teaches the wrong word — so the
    // label needs at least a pair of stones actually holding the area.
    if (countStonesWithin(board, pt, opponent, cornerReach(board.size)) < 2) return null;

    if (distOwn >= 4) return 'invasao';
    // Reduction is a move against a framework that already exists. In the
    // opening there is nothing to reduce yet, and the corner and extension
    // labels below teach the position better.
    if (phase !== 'abertura' && distOwn <= 3 && lineNumber(pt, board.size) >= 3) return 'reducao';
    return null;
  }
}
