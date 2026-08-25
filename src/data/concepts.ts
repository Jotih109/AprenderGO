/**
 * Glossary of Go concepts, written for someone who has never played.
 *
 * Every insight the reviewer produces points at one of these, so a learner
 * builds up a vocabulary of named ideas instead of a list of percentages.
 */

export type ConceptId =
  | 'liberdade'
  | 'atari'
  | 'captura'
  | 'auto-atari'
  | 'olho'
  | 'conexao'
  | 'corte'
  | 'primeira-linha'
  | 'terceira-linha'
  | 'cantos-primeiro'
  | 'triangulo-vazio'
  | 'grupo-fraco'
  | 'territorio'
  | 'passar';

export interface Concept {
  id: ConceptId;
  /** Short name shown on the chip. */
  name: string;
  /** One line, shown as a tooltip. */
  short: string;
  /** Two to four sentences, shown in the glossary. */
  explanation: string;
  /** What to actually do about it in a game. */
  practice: string;
}

export const CONCEPTS: Record<ConceptId, Concept> = {
  liberdade: {
    id: 'liberdade',
    name: 'Liberdade',
    short: 'Os espaços vazios grudados na sua pedra.',
    explanation:
      'Liberdade é cada ponto vazio ligado diretamente a uma pedra (acima, abaixo, à esquerda ou à direita — diagonais não contam). ' +
      'Pedras da mesma cor encostadas formam um grupo e dividem as liberdades entre si. ' +
      'Quando um grupo fica sem nenhuma liberdade, ele é capturado e sai do tabuleiro.',
    practice:
      'Antes de jogar, conte as liberdades dos seus grupos mais apertados. Grupo com 1 ou 2 liberdades está em perigo.'
  },
  atari: {
    id: 'atari',
    name: 'Atari',
    short: 'Grupo com só 1 liberdade — pode ser capturado no próximo lance.',
    explanation:
      'Atari é o aviso de que um grupo está a uma jogada de ser capturado, porque só resta uma liberdade. ' +
      'Quem está em atari geralmente tem duas saídas: fugir (jogar na última liberdade para ganhar mais espaço) ' +
      'ou capturar antes as pedras que estão ameaçando.',
    practice:
      'Sempre que o adversário jogar perto, confira se algum grupo seu ficou com 1 liberdade. Ignorar um atari é a forma mais comum de perder pedras.'
  },
  captura: {
    id: 'captura',
    name: 'Captura',
    short: 'Tirar a última liberdade de um grupo adversário.',
    explanation:
      'Ao preencher a última liberdade de um grupo inimigo, todas as pedras dele saem do tabuleiro e viram seus prisioneiros. ' +
      'Cada prisioneiro vale 1 ponto no final, e o espaço que sobra normalmente vira território seu.',
    practice: 'Capturar é bom, mas nem sempre é o maior lance. Um canto vazio costuma valer mais que 2 pedras.'
  },
  'auto-atari': {
    id: 'auto-atari',
    name: 'Auto-atari',
    short: 'Você mesmo deixou seu grupo com 1 liberdade.',
    explanation:
      'Auto-atari é jogar uma pedra que deixa o próprio grupo com apenas uma liberdade, entregando a captura de graça. ' +
      'Quase sempre é um erro: você perde as pedras e ainda ajuda o adversário a fechar território.',
    practice: 'Antes de colocar a pedra, imagine ela já no tabuleiro e conte as liberdades do grupo que ela vai formar.'
  },
  olho: {
    id: 'olho',
    name: 'Olho e vida',
    short: 'Dois olhos separados deixam o grupo vivo para sempre.',
    explanation:
      'Olho é um espaço vazio cercado pelas suas próprias pedras. Um grupo com dois olhos separados nunca pode ser capturado, ' +
      'porque o adversário teria que preencher os dois ao mesmo tempo — e preencher o último seria suicídio, o que é proibido. ' +
      'É assim que um grupo fica definitivamente vivo.',
    practice: 'Grupo cercado sem espaço para dois olhos está morto. Ou faça dois olhos, ou fuja para o centro antes de ser fechado.'
  },
  conexao: {
    id: 'conexao',
    name: 'Conexão',
    short: 'Juntar grupos: um grupo grande é mais forte que dois pequenos.',
    explanation:
      'Grupos conectados somam as liberdades e passam a viver juntos. Dois grupos separados precisam cada um dos seus dois olhos; ' +
      'conectados, precisam de dois no total. Por isso conectar costuma ser mais seguro do que parece.',
    practice: 'Se o adversário puder cortar entre suas pedras, conectar antes costuma valer o lance.'
  },
  corte: {
    id: 'corte',
    name: 'Corte',
    short: 'Separar dois grupos adversários para atacar os dois.',
    explanation:
      'Cortar é jogar no ponto que impede duas pedras adversárias de se ligarem. Depois do corte, cada pedaço precisa se defender sozinho, ' +
      'e é aí que aparecem as capturas. Cortar é o ataque mais direto do Go.',
    practice: 'Procure pontos onde duas pedras inimigas quase se tocam, mas não estão de fato ligadas.'
  },
  'primeira-linha': {
    id: 'primeira-linha',
    name: 'Primeira linha',
    short: 'A borda faz pouquíssimo território no começo do jogo.',
    explanation:
      'Pedras na linha da borda quase não cercam espaço: elas só têm um lado útil. Existe um ditado antigo no Go — ' +
      '"a primeira linha é a linha da derrota". No fim da partida jogar ali é normal, mas no começo é desperdiçar um lance.',
    practice: 'No começo prefira a 3ª e a 4ª linha. Deixe a borda para o final, quando o território já está definido.'
  },
  'terceira-linha': {
    id: 'terceira-linha',
    name: '3ª e 4ª linha',
    short: 'A altura certa: 3ª faz território, 4ª faz influência.',
    explanation:
      'A 3ª linha é a altura ideal para fechar território na lateral com segurança. A 4ª linha cerca menos território direto, ' +
      'mas domina o centro e ajuda em lutas futuras. As duas são boas; a 1ª e a 2ª são baixas demais no início.',
    practice: 'Na abertura, mire a 3ª ou a 4ª linha. É a diferença entre um lance eficiente e um lance desperdiçado.'
  },
  'cantos-primeiro': {
    id: 'cantos-primeiro',
    name: 'Cantos primeiro',
    short: 'Canto, depois lateral, depois centro.',
    explanation:
      'Cercar território no canto usa duas bordas como parede, então custa poucas pedras. Na lateral você usa uma borda. ' +
      'No centro não há parede nenhuma e o mesmo território custa o dobro de pedras. Por isso as partidas começam nos cantos.',
    practice: 'Comece pelos quatro cantos. Só depois que eles estiverem ocupados vale a pena olhar para as laterais.'
  },
  'triangulo-vazio': {
    id: 'triangulo-vazio',
    name: 'Triângulo vazio',
    short: 'Três pedras em L com o canto vazio: forma ineficiente.',
    explanation:
      'O triângulo vazio é o clássico exemplo de forma ruim: três pedras suas em L, com o ponto da diagonal vazio. ' +
      'Essa formação usa três pedras e mesmo assim tem poucas liberdades. Quase sempre existe um lance melhor ali perto.',
    practice: 'Se sua jogada formar esse L, pare e procure outra. Costuma haver uma conexão mais eficiente.'
  },
  'grupo-fraco': {
    id: 'grupo-fraco',
    name: 'Grupo fraco',
    short: 'Poucas liberdades e sem olhos: precisa de atenção.',
    explanation:
      'Um grupo com duas ou três liberdades, cercado e sem espaço para olhos, é um grupo fraco. ' +
      'Ele costuma ser o alvo do adversário: cada lance de ataque contra ele ganha território de graça em outro lugar.',
    practice: 'Reforce grupos fracos antes de partir para novos territórios. Perder um grupo grande decide a partida.'
  },
  territorio: {
    id: 'territorio',
    name: 'Território',
    short: 'Espaço vazio cercado só por você — é o que conta pontos.',
    explanation:
      'Território é cada ponto vazio cercado exclusivamente pelas suas pedras. No fim, ganha quem tiver mais território ' +
      'somado aos prisioneiros. Jogar uma pedra dentro do seu próprio território não ganha nada — pelo contrário, ' +
      'ocupa um ponto que já era seu e diminui sua pontuação.',
    practice: 'Não preencha o que já é seu. Enquanto houver fronteiras em aberto, jogue nelas.'
  },
  passar: {
    id: 'passar',
    name: 'Passar',
    short: 'Quando não há mais lance que valha pontos.',
    explanation:
      'Passar significa abrir mão da vez. Quando os dois jogadores passam seguido, a partida acaba e a contagem começa. ' +
      'Passar cedo demais entrega lances de graça; passar na hora certa evita estragar seu próprio território.',
    practice: 'Só passe quando todo lance disponível reduzir seus pontos em vez de aumentar.'
  }
};

export const CONCEPT_ORDER: ConceptId[] = [
  'liberdade',
  'atari',
  'captura',
  'auto-atari',
  'olho',
  'conexao',
  'corte',
  'grupo-fraco',
  'cantos-primeiro',
  'terceira-linha',
  'primeira-linha',
  'triangulo-vazio',
  'territorio',
  'passar'
];
