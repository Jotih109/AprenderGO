import {
  BoardSize,
  Color,
  GameTextSummary,
  MoveClassificationType,
  MoveEvaluation,
  PlayerTextSummary,
  StudyTopic,
  SummaryPointItem
} from '../types/go';
import { CONCEPTS } from '../data/concepts';

export interface ReviewSummaryInput {
  size: BoardSize;
  totalMoves: number;
  blackAccuracyPct: number;
  whiteAccuracyPct: number;
  evaluations: MoveEvaluation[];
  stats: {
    black: Record<MoveClassificationType, number>;
    white: Record<MoveClassificationType, number>;
  };
  turningPoints: { moveNumber: number; description: string; impact: string }[];
  studyPlan: { black: StudyTopic[]; white: StudyTopic[] };
}

export class ReviewSummaryGenerator {
  public static generate(input: ReviewSummaryInput): GameTextSummary {
    const narrative = this.buildMatchNarrative(input);
    const blackSummary = this.buildPlayerSummary('black', input);
    const whiteSummary = this.buildPlayerSummary('white', input);
    const plainText = this.buildPlainText(input, narrative, blackSummary, whiteSummary);

    return {
      narrative,
      black: blackSummary,
      white: whiteSummary,
      plainText
    };
  }

  private static buildMatchNarrative(input: ReviewSummaryInput): string {
    const { size, totalMoves, blackAccuracyPct, whiteAccuracyPct, turningPoints, evaluations } = input;
    const sizeName = size === 9 ? '9x9 (rápido e altamente tático)' : size === 13 ? '13x13 (médio)' : '19x19 (oficial)';
    
    // Overall match tone
    const accDiff = Math.abs(blackAccuracyPct - whiteAccuracyPct);
    const leader = blackAccuracyPct > whiteAccuracyPct ? 'Pretas' : whiteAccuracyPct > blackAccuracyPct ? 'Brancas' : 'Ambos os lados';
    
    let pacing = '';
    if (totalMoves <= (size === 9 ? 25 : size === 13 ? 45 : 70)) {
      pacing = `A partida foi curta e decidida rapidamente (${totalMoves} lances), caracterizada por um confronto direto e decisivo.`;
    } else if (totalMoves >= (size === 9 ? 60 : size === 13 ? 100 : 180)) {
      pacing = `Foi uma batalha longa e disputada (${totalMoves} lances), onde cada detalhe de território e fim de jogo foi disputado ponto a ponto.`;
    } else {
      pacing = `A partida teve um ritmo equilibrado ao longo de ${totalMoves} lances no tabuleiro ${sizeName}.`;
    }

    let balance = '';
    if (accDiff <= 5) {
      balance = `O nível técnico foi muito parelho (${blackAccuracyPct}% Pretas vs ${whiteAccuracyPct}% Brancas), com pequenas nuances táticas fazendo a diferença.`;
    } else if (accDiff <= 15) {
      balance = `${leader} demonstraram maior consistência geral (${Math.max(blackAccuracyPct, whiteAccuracyPct)}% contra ${Math.min(blackAccuracyPct, whiteAccuracyPct)}%), aproveitando melhor as oportunidades.`;
    } else {
      balance = `${leader} exerceram forte domínio posicional com precisão de ${Math.max(blackAccuracyPct, whiteAccuracyPct)}%, punindo os deslizes do adversário (${Math.min(blackAccuracyPct, whiteAccuracyPct)}%).`;
    }

    let turnSummary = '';
    if (turningPoints.length > 0) {
      const topTurns = turningPoints.slice(0, 2).map(tp => `lance ${tp.moveNumber}`).join(' e ');
      turnSummary = ` Os momentos mais críticos e reviravoltas ocorreram por volta do ${topTurns}.`;
    } else {
      turnSummary = ' A partida fluiu de forma estável, sem grandes oscilações bruscas no controle do tabuleiro.';
    }

    const lastEval = evaluations[evaluations.length - 1];
    let endNote = '';
    if (lastEval?.labelPt === 'Desistência') {
      endNote = ' O confronto foi encerrado por desistência antes da contagem final de território.';
    }

    return `${pacing} ${balance}${turnSummary}${endNote}`;
  }

  private static buildPlayerSummary(color: Color, input: ReviewSummaryInput): PlayerTextSummary {
    const { evaluations, stats, studyPlan } = input;
    const colEvals = evaluations.filter(e => e.color === color);
    const colStats = stats[color];
    const acc = color === 'black' ? input.blackAccuracyPct : input.whiteAccuracyPct;

    // 1. Headline
    let headline = '';
    if (acc >= 90) {
      headline = 'Atuação Excepcional: precisão magistral e domínio consistente!';
    } else if (acc >= 80) {
      headline = 'Excelente partida: jogo sólido com boa visão posicional e poucos erros.';
    } else if (acc >= 70) {
      headline = 'Bom desempenho tático: ideias claras no tabuleiro, mas com espaço para maior consistência.';
    } else if (acc >= 55) {
      headline = 'Partida combativa: boas iniciativas, mas erros táticos pontuais custaram territórios.';
    } else {
      headline = 'Fase de aprendizado: foco essencial na leitura de liberdades e sobrevivência de grupos.';
    }

    // 2. Strengths (Pontos Fortes / O que fez de bom)
    const strengths: SummaryPointItem[] = [];

    // Accuracy / Best moves
    const goodTotal = colStats.brilliant + colStats.best + colStats.good;
    const goodPct = colEvals.length > 0 ? Math.round((goodTotal / colEvals.length) * 100) : 0;
    if (goodPct >= 60 || colStats.best >= 5) {
      strengths.push({
        title: 'Alta Taxa de Acerto e Solidez',
        detail: `${goodPct}% dos lances (${goodTotal} de ${colEvals.length}) foram classificados como ideais ou sólidos pela IA Sensei.`,
        severity: 'good'
      });
    }

    // Brilliant moves
    const brilliantMoves = colEvals.filter(e => e.classification === 'brilliant');
    if (brilliantMoves.length > 0) {
      const movesStr = brilliantMoves.map(e => `lance ${e.moveNumber}`).join(', ');
      strengths.push({
        title: 'Visão Tática e Lances Brilhantes',
        detail: `Encontrou ${brilliantMoves.length === 1 ? 'um lance brilhante' : `${brilliantMoves.length} lances brilhantes`} (${movesStr}) que criaram pressão decisiva.`,
        moveNumbers: brilliantMoves.map(e => e.moveNumber),
        severity: 'good'
      });
    }

    // Saved groups / atari defense
    const savedMoves = colEvals.filter(e => e.insights.some(i => i.id === 'saved-group'));
    if (savedMoves.length > 0) {
      const movesStr = savedMoves.map(e => `lance ${e.moveNumber}`).join(', ');
      strengths.push({
        title: 'Defesa e Resgate de Grupos em Perigo',
        detail: `Identificou a urgência e salvou pedras sob perigo imediato de atari (${movesStr}).`,
        moveNumbers: savedMoves.map(e => e.moveNumber),
        severity: 'good'
      });
    }

    // Good shapes & connections
    const connectMoves = colEvals.filter(e => e.insights.some(i => i.id === 'connects'));
    if (connectMoves.length > 0) {
      strengths.push({
        title: 'Conexões Seguras e Estrutura',
        detail: `Manteve pedras interligadas eficientemente, aumentando liberdades e protegendo fronteiras.`,
        moveNumbers: connectMoves.map(e => e.moveNumber),
        severity: 'good'
      });
    }

    // Cuts & Offensive Pressure
    const cutMoves = colEvals.filter(e => e.insights.some(i => i.id === 'cut' || i.id === 'gives-atari'));
    if (cutMoves.length > 0) {
      strengths.push({
        title: 'Iniciativa e Pressão no Adversário',
        detail: `Separou grupos inimigos ou aplicou ataris táticos, forçando o oponente a se defender.`,
        moveNumbers: cutMoves.map(e => e.moveNumber),
        severity: 'good'
      });
    }

    // Proper opening principles
    const openingGood = colEvals.filter(e => e.insights.some(i => i.id === 'corner-opening' || i.id === 'good-line'));
    if (openingGood.length > 0) {
      strengths.push({
        title: 'Abertura Consciente (Cantos e 3ª/4ª Linhas)',
        detail: `Construiu a base nos cantos e laterais respeitando as alturas ideais de território e influência.`,
        moveNumbers: openingGood.map(e => e.moveNumber),
        severity: 'good'
      });
    }

    // Fallback if list is too short
    if (strengths.length === 0) {
      strengths.push({
        title: 'Postura Ativa na Partida',
        detail: 'Manteve a luta ativa e procurou ocupar pontos no tabuleiro com determinação.',
        severity: 'good'
      });
    }

    // 3. Weaknesses (Pontos Fracos / O que tem que melhorar)
    const weaknesses: SummaryPointItem[] = [];

    // Blunders / Critical mistakes
    const blunders = colEvals.filter(e => e.classification === 'blunder');
    if (blunders.length > 0) {
      const movesStr = blunders.slice(0, 4).map(e => `lance ${e.moveNumber}`).join(', ');
      const totalLost = blunders.reduce((sum, e) => sum + e.pointsLost, 0);
      weaknesses.push({
        title: 'Deslizes Críticos (Blunders)',
        detail: `Cometeu ${blunders.length} ${blunders.length === 1 ? 'erro crítico' : 'erros críticos'} (${movesStr}) que custaram cerca de ${Math.round(totalLost)} pontos na partida.`,
        moveNumbers: blunders.map(e => e.moveNumber),
        severity: 'critical'
      });
    }

    // Self-atari
    const selfAtari = colEvals.filter(e => e.insights.some(i => i.id === 'self-atari'));
    if (selfAtari.length > 0) {
      const movesStr = selfAtari.map(e => `lance ${e.moveNumber}`).join(', ');
      weaknesses.push({
        title: 'Auto-Atari (Entrega de Pedras)',
        detail: `Colocou o próprio grupo com apenas 1 liberdade de graça (${movesStr}). Antes de jogar, conte sempre as saídas restantes do grupo.`,
        moveNumbers: selfAtari.map(e => e.moveNumber),
        severity: 'critical'
      });
    }

    // Ignored Atari
    const ignoredAtari = colEvals.filter(e => e.insights.some(i => i.id === 'atari-ignored'));
    if (ignoredAtari.length > 0) {
      const movesStr = ignoredAtari.slice(0, 4).map(e => `lance ${e.moveNumber}`).join(', ');
      weaknesses.push({
        title: 'Perigo Ignorado (Pedras em Atari)',
        detail: `Deixou pedras próprias em perigo de captura sem resposta imediata (${movesStr}). Salvar um grupo em perigo geralmente tem prioridade máxima.`,
        moveNumbers: ignoredAtari.map(e => e.moveNumber),
        severity: 'warning'
      });
    }

    // Empty Triangles (Dango)
    const emptyTriangles = colEvals.filter(e => e.insights.some(i => i.id === 'empty-triangle'));
    if (emptyTriangles.length > 0) {
      const movesStr = emptyTriangles.slice(0, 4).map(e => `lance ${e.moveNumber}`).join(', ');
      weaknesses.push({
        title: 'Triângulo Vazio (Forma Ineficiente)',
        detail: `Formou formato de L sem pedra na diagonal (${movesStr}). Essa forma gasta 3 pedras para poucas liberdades e pouca eficiência.`,
        moveNumbers: emptyTriangles.map(e => e.moveNumber),
        severity: 'warning'
      });
    }

    // Premature 1st line plays
    const firstLineEarly = colEvals.filter(e => e.insights.some(i => i.id === 'first-line-early'));
    if (firstLineEarly.length > 0) {
      const movesStr = firstLineEarly.slice(0, 3).map(e => `lance ${e.moveNumber}`).join(', ');
      weaknesses.push({
        title: 'Jogadas na 1ª Linha Cedo Demais',
        detail: `Lances na borda extrema (${movesStr}) cercam muito pouco território na abertura. Prefira a 3ª e 4ª linha.`,
        moveNumbers: firstLineEarly.map(e => e.moveNumber),
        severity: 'warning'
      });
    }

    // Filled own eye or own settled territory
    const selfWaste = colEvals.filter(e => e.insights.some(i => i.id === 'filled-own-eye' || i.id === 'own-territory'));
    if (selfWaste.length > 0) {
      const movesStr = selfWaste.slice(0, 3).map(e => `lance ${e.moveNumber}`).join(', ');
      weaknesses.push({
        title: 'Desperdício em Território Próprio',
        detail: `Jogou dentro do próprio território já seguro ou fechou um olho vital (${movesStr}), reduzindo a própria pontuação.`,
        moveNumbers: selfWaste.map(e => e.moveNumber),
        severity: 'warning'
      });
    }

    // Mistakes & Inaccuracies if no specific pattern was found
    if (weaknesses.length === 0 && (colStats.mistake > 0 || colStats.inaccuracy > 0)) {
      const mistakes = colEvals.filter(e => e.classification === 'mistake' || e.classification === 'inaccuracy');
      const movesStr = mistakes.slice(0, 3).map(e => `lance ${e.moveNumber}`).join(', ');
      weaknesses.push({
        title: 'Pequenas Perdas de Ritmo (Sente)',
        detail: `Alguns lances (${movesStr}) foram um pouco passivos e cederam a iniciativa para o adversário.`,
        moveNumbers: mistakes.map(e => e.moveNumber),
        severity: 'info'
      });
    }

    if (weaknesses.length === 0) {
      weaknesses.push({
        title: 'Nenhum Erro Grave Identificado',
        detail: 'Partida extremamente limpa! Continue mantendo essa concentração nos próximos desafios.',
        severity: 'good'
      });
    }

    // 4. Practical Sensei Recommendations (Conselhos do Sensei)
    const recommendations: SummaryPointItem[] = [];
    const playerTopics = studyPlan[color];

    if (playerTopics && playerTopics.length > 0) {
      for (const topic of playerTopics.slice(0, 3)) {
        const concept = CONCEPTS[topic.concept];
        if (concept) {
          recommendations.push({
            title: `Treinar: ${concept.name}`,
            detail: `${concept.short} 👉 Dica prática: ${concept.practice}`,
            moveNumbers: topic.moveNumbers,
            severity: 'info'
          });
        }
      }
    }

    // General Sensei tips based on accuracy level
    if (acc < 70) {
      recommendations.push({
        title: 'Regra de Ouro: Checar Liberdades Antes de Clicar',
        detail: 'Antes de cada lance, faça a verificação em duas etapas: "Meu grupo tem pelo menos 2 liberdades?" e "O grupo do adversário pode ser capturado?".',
        severity: 'info'
      });
    } else if (acc < 85) {
      recommendations.push({
        title: 'Manter a Iniciativa (Sente)',
        detail: 'Procure sempre lances que ameacem território ou grupos do adversário, forçando-o a responder em vez de você jogar apenas na defesa.',
        severity: 'info'
      });
    } else {
      recommendations.push({
        title: 'Refinar o Yose (Fim de Jogo)',
        detail: 'Em partidas de alto nível, os pontos na 2ª e 1ª linha decidem quem vence. Conte os valores de cada fronteira antes de passar.',
        severity: 'info'
      });
    }

    return {
      headline,
      strengths,
      weaknesses,
      recommendations
    };
  }

  private static buildPlainText(
    input: ReviewSummaryInput,
    narrative: string,
    black: PlayerTextSummary,
    white: PlayerTextSummary
  ): string {
    const { totalMoves, blackAccuracyPct, whiteAccuracyPct, size } = input;
    const lines: string[] = [];

    lines.push('=====================================================');
    lines.push(`  🥋 GO MASTER - RELATÓRIO DO SENSEI (REVISÃO PÓS-JOGO)`);
    lines.push('=====================================================');
    lines.push(`Tabuleiro: ${size}x${size} | Total de Lances: ${totalMoves}`);
    lines.push(`Precisão Global: ⚫ Pretas: ${blackAccuracyPct}% | ⚪ Brancas: ${whiteAccuracyPct}%`);
    lines.push('');
    lines.push('📖 RESUMO GERAL DA PARTIDA');
    lines.push('-----------------------------------------------------');
    lines.push(narrative);
    lines.push('');

    // Pretas
    lines.push('=====================================================');
    lines.push(`⚫ PRETAS (Precisão: ${blackAccuracyPct}%)`);
    lines.push(`Veredito: ${black.headline}`);
    lines.push('-----------------------------------------------------');
    lines.push('🌟 O QUE FEZ DE BOM (PONTOS FORTES):');
    for (const item of black.strengths) {
      const moves = item.moveNumbers && item.moveNumbers.length > 0 ? ` [Lances: ${item.moveNumbers.slice(0, 5).join(', ')}]` : '';
      lines.push(`  • ${item.title}: ${item.detail}${moves}`);
    }
    lines.push('');
    lines.push('⚠️ O QUE TEM QUE MELHORAR (PONTOS FRACOS):');
    for (const item of black.weaknesses) {
      const moves = item.moveNumbers && item.moveNumbers.length > 0 ? ` [Lances: ${item.moveNumbers.slice(0, 5).join(', ')}]` : '';
      lines.push(`  • ${item.title}: ${item.detail}${moves}`);
    }
    lines.push('');
    lines.push('💡 CONSELHOS E PLANO DE TREINO DO SENSEI:');
    for (const item of black.recommendations) {
      lines.push(`  👉 ${item.title} - ${item.detail}`);
    }
    lines.push('');

    // Brancas
    lines.push('=====================================================');
    lines.push(`⚪ BRANCAS (Precisão: ${whiteAccuracyPct}%)`);
    lines.push(`Veredito: ${white.headline}`);
    lines.push('-----------------------------------------------------');
    lines.push('🌟 O QUE FEZ DE BOM (PONTOS FORTES):');
    for (const item of white.strengths) {
      const moves = item.moveNumbers && item.moveNumbers.length > 0 ? ` [Lances: ${item.moveNumbers.slice(0, 5).join(', ')}]` : '';
      lines.push(`  • ${item.title}: ${item.detail}${moves}`);
    }
    lines.push('');
    lines.push('⚠️ O QUE TEM QUE MELHORAR (PONTOS FRACOS):');
    for (const item of white.weaknesses) {
      const moves = item.moveNumbers && item.moveNumbers.length > 0 ? ` [Lances: ${item.moveNumbers.slice(0, 5).join(', ')}]` : '';
      lines.push(`  • ${item.title}: ${item.detail}${moves}`);
    }
    lines.push('');
    lines.push('💡 CONSELHOS E PLANO DE TREINO DO SENSEI:');
    for (const item of white.recommendations) {
      lines.push(`  👉 ${item.title} - ${item.detail}`);
    }
    lines.push('');
    lines.push('=====================================================');

    return lines.join('\n');
  }
}
