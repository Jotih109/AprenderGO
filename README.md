# Go Master

Jogo de Go (Weiqi / Baduk) completo em português, rodando inteiramente no
navegador — sem servidor, sem conta, sem nenhuma requisição externa. A IA, as
regras, a análise e o material de estudo cabem todos num único arquivo HTML de
85 KB comprimidos.

Foi feito para **aprender**, não só para jogar: a IA explica o que ela faria e
por quê, a revisão traduz cada erro em linguagem de tabuleiro (e não em
porcentagem) e há um modo em que duas IAs jogam entre si comentando lance a
lance.

---

## Índice

- [Como jogar](#como-jogar)
- [No celular](#no-celular)
- [Publicar de graça](#publicar-de-graça)
- [Os cinco modos](#os-cinco-modos)
  - [🎮 Partida](#-partida)
  - [👁 Observar](#-observar)
  - [📊 Revisão Pós-Jogo](#-revisão-pós-jogo)
  - [🧩 Tsumego](#-tsumego)
  - [📖 Joseki](#-joseki)
  - [📜 Regras & Guia](#-regras--guia)
- [Recursos que valem em todos os modos](#recursos-que-valem-em-todos-os-modos)
- [Atalhos de teclado](#atalhos-de-teclado)
- [Scripts](#scripts)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Como as coisas funcionam por dentro](#como-as-coisas-funcionam-por-dentro)
- [Limitações conhecidas](#limitações-conhecidas)

---

## Como jogar

**No computador, mais simples:** dê dois cliques em `JOGAR.bat`. Ele instala as
dependências na primeira vez, sobe o servidor e abre o jogo no navegador.

**Ou pela linha de comando:**

```bash
npm install
npm run dev      # http://localhost:3000
```

`npm run build` gera `dist/`, e `dist/index.html` é o jogo inteiro num único
arquivo — HTML, CSS, JavaScript e a IA. Dá para abrir esse arquivo direto do
disco, mas aí a IA roda na mesma thread da interface (workers em `blob:` são
bloqueados na origem `file://`); servido por HTTP ela vai para um Web Worker e
a interface não trava enquanto a busca pensa.

## No celular

O jogo foi feito para caber na tela de um telefone: o tabuleiro fica logo abaixo
do cabeçalho, as barras de botões rolam ou quebram em linhas, e os painéis
laterais viram duas abas que trocam com um toque — "Partida" e "Histórico" numa
partida, "Relatório" e "Análise" na revisão, "Exibição" e "Comentário" no modo
observador.

Para colocar pedras, o toque é em **dois passos**: o primeiro marca o ponto e
mostra uma pedra fantasma — dá para arrastar o dedo até acertar a interseção —
e o segundo toque no mesmo ponto (ou o botão **✓ Confirmar**) é que joga. Num
19x19 de 370px cada interseção tem uns 17px, então confirmar evita a jogada
errada que não dá para desfazer contra o relógio.

Pelo navegador do celular, "Adicionar à tela de início" instala o jogo como app:
ele abre em tela cheia, sem barra de endereço, e funciona sem internet depois de
carregado uma vez.

## Publicar de graça

O site é estático e cabe numa única requisição, então qualquer hospedagem
gratuita serve:

| Onde | Como |
| --- | --- |
| **GitHub Pages** | Já vem configurado: `.github/workflows/deploy.yml` roda os testes e publica a cada push na `main`. Basta ligar Pages com origem "GitHub Actions" nas configurações do repositório. |
| **Netlify / Cloudflare Pages** | Comando de build `npm run build`, pasta de publicação `dist`. O arquivo `public/_headers` já cuida do cache. |
| **Netlify Drop / Surge** | Rode `npm run build` e arraste a pasta `dist`. |

---

## Os cinco modos

### 🎮 Partida

Jogar de verdade, com relógio e contagem no fim.

| | |
| --- | --- |
| **Adversários** | Você contra a IA, duas pessoas no mesmo computador, ou IA contra IA |
| **Tabuleiros** | 9x9, 13x13 e 19x19 |
| **Níveis da IA** | 5, do nível 1 (que erra de propósito) ao 5 (o mais forte) |
| **Handicap** | De 2 a 9 pedras, com o komi ajustado automaticamente para 0,5 |
| **Sua cor** | Pretas, brancas ou sorteio |

**Relógios.** Quatro modos: byo-yomi tradicional (10 min + 3 períodos de 30s),
Fischer (5 min com 5s de incremento aplicado a cada lance), absoluto (15 min
diretos) e casual sem limite. O relógio é movido por tempo de parede, não por
contagem de ticks, então uma aba em segundo plano ou um quadro lento não fazem
ele derivar.

**Durante a partida** você tem desfazer, passar, desistir, dica da IA (ela
calcula e marca o ponto que jogaria), mapa de influência, números nas pedras e
coordenadas.

**No fim**, as duas passadas seguidas abrem a contagem interativa: as pedras
mortas são detectadas sozinhas, você pode clicar em qualquer grupo para
marcar ou desmarcar, e o placar recalcula na hora — território, prisioneiros,
komi e total por cor. Dali dá para ir direto para a análise da partida.

### 👁 Observar

Duas instâncias da IA jogam entre si e **cada lance vem com o motivo**. É o modo
para aprender vendo.

Para cada lance o comentário traz:

- **O tipo do lance.** Corte, fuga de atari, atari duplo, conexão, captura,
  grupo vivo, invasão, redução, fecho de canto, abordagem, ocupação de canto,
  extensão na lateral, tenuki, fim de jogo — 18 arquétipos ao todo.
- **Por que aqui, agora.** Só sobre esta posição, com os números lidos do próprio
  tabuleiro: *"F6 tira a penúltima liberdade do grupo branco de 1 pedra. Ele
  fica com uma liberdade: ou foge, ou é capturado no próximo lance."*
- **Quando jogar assim.** A lição que você leva para as suas partidas:
  *"Atari é ameaça, não ganho. Vale quando a captura de fato resolve alguma
  coisa… Atari por atari só entrega pedras e fecha as suas próprias
  liberdades."*
- **As alternativas que a busca considerou**, marcadas com A/B/C no tabuleiro e
  descritas pelo que fariam ("captura 3 pedras", "corta os grupos adversários").
- **O conceito de Go** que o lance ensina, num chip que abre o glossário.
- **Um anel âmbar** nos pontos que o texto está citando, para o olho ir direto
  ao lugar certo.

**Controles.** Pausar e continuar, avançar um lance por vez, e a lista de lances
comentados ao lado: clicar em qualquer um volta o tabuleiro àquela posição e
mostra o comentário de novo. Nos ajustes você escolhe tabuleiro (9/13/19), força
das IAs (nível 3, 4 ou 5) e a pausa de leitura entre os lances — de 4 segundos a
passo a passo.

> O nível 5 é o teto **deste** motor. É forte, mas não é uma rede neural do tipo
> KataGo — veja [Limitações conhecidas](#limitações-conhecidas).

### 📊 Revisão Pós-Jogo

A IA analisa a partida inteira e explica o que aconteceu, lance a lance.

**Cada lance recebe uma classificação** — 🌟 Brilhante, 🟢 Melhor, 🔵 Boa,
🟡 Imprecisão, 🟠 Erro, ☠️ Erro Crítico — com os limiares calibrados contra as
variações que este motor produz de fato, e não copiados do xadrez.

**Mas a nota é a parte menos interessante.** Junto vêm:

- **Observações em linguagem de tabuleiro**: *"você ignorou um atari de 2
  pedras, o adversário captura jogando em C9"*. Cada uma marcada com o conceito
  de Go que ensina, e o conceito abre o glossário.
- **O que a IA jogaria no lugar**, com a descrição do que cada alternativa faria.
- **Gráfico de probabilidade de vitória** ao longo da partida, com os erros
  críticos marcados — clique no gráfico para pular para o lance.
- **Relatório do sensei** em três abas: visão geral da partida, pontos fortes e
  fracos das pretas, e das brancas.
- **Plano de estudo**: o que você mais errou, ordenado por frequência, com os
  números dos lances para revisitar.

**Modo Aprendiz** (ligado por padrão) troca porcentagens por pontos no tabuleiro
("custou ~4 pontos") e descreve as sugestões da IA pelo que elas fazem, em vez
de "58,2% em 316 simulações". Quem quiser os números crus é só desligar.

**Duas ferramentas de treino:**

- **Testar Variações** — jogue livremente a partir de qualquer lance da partida,
  sem alterar o original.
- **Treinar Este Erro** — o tabuleiro volta ao lance ruim e desafia você a
  encontrar sozinho o que a IA jogaria.

**Navegação rápida:** ⏮ ⏭ lance a lance, auto-reprodução, e pular direto para o
próximo erro crítico.

**De onde vêm as partidas:** da partida que você acabou de jogar, de um arquivo
`.sgf` do seu computador, de código SGF colado (OGS, KGS, Fox…), ou da
biblioteca com três partidas reais já incluídas.

### 🧩 Tsumego

Cinco problemas de vida e morte, do básico ao avançado. Cada um traz uma dica
para quando você travar, e a solução é uma **árvore**: o adversário responde de
verdade, então errar o segundo lance também é errar o problema.

1. O Básico dos Dois Olhos — iniciante
2. Tesuji do Snapback (Oi-otoshi) — iniciante
3. A Rede Tática (Geta) — iniciante
4. O Ninho do Grou (Tsuru no Sugomori) — intermediário
5. Sob as Pedras (Ishi-no-Shita) — avançado

### 📖 Joseki

Quatro sequências de canto navegáveis lance a lance. Cada jogada vem com a sua
própria nota — *"Pretas jogam o Hane crítico na cabeça (B4)"* — em vez de uma
explicação única no fim:

- Invasão 3-3 Direta (padrão da IA moderna)
- Aproximação do Cavaleiro (Keima Kakari clássico)
- Komoku 3-4: Defesa com Salto de Um Espaço
- Pinça de Um Espaço (Ikken Hasami)

### 📜 Regras & Guia

Guia completo das regras num diálogo: objetivo, liberdades e captura, proibição
do suicídio, regra do ko e o conceito de dois olhos.

---

## Recursos que valem em todos os modos

**Glossário de 14 conceitos** — liberdade, atari, captura, auto-atari, olho e
vida, conexão, corte, primeira linha, 3ª e 4ª linha, cantos primeiro, triângulo
vazio, grupo fraco, território e passar. Cada um com a explicação e o que fazer
na prática. Abre a partir de qualquer chip de conceito na revisão ou no modo
observador.

**Quatro temas de tabuleiro** — 🪵 Kaya Tradicional, 🌑 Estúdio Noturno,
⚡ Cyber Baduk e 📜 Papel Washi.

**Mapa de influência** — estimativa de território em tempo real, desenhada como
mapa de calor sobre o tabuleiro (tecla `T`).

**Coordenadas e números de lance** — ligáveis e desligáveis a qualquer momento.

**SGF completo** — importar arquivo, colar código, exportar a partida atual, e
exportar o tabuleiro como imagem PNG em alta resolução. O parser entende
variações (achatadas para a linha principal), komi, ranks, regras, passes nas
duas notações e comentários com colchetes.

**Efeitos sonoros** — som de pedra, captura e passe, com um botão para silenciar.

**Suas preferências ficam salvas** — tema, som, coordenadas, números, nível da
IA, tamanho do tabuleiro, tipo de relógio, Modo Aprendiz e os ajustes do modo
observador voltam como você deixou.

---

## Atalhos de teclado

| Tecla | Partida | Revisão | Observar |
| --- | --- | --- | --- |
| `Espaço` | Passar a vez | — | Pausar / continuar |
| `←` `→` | Lance anterior / próximo | Lance anterior / próximo | Comentário anterior / próximo |
| `Home` / `End` | Início / fim da partida | Início / fim | Primeiro / último comentário |
| `U` ou `Ctrl+Z` | Desfazer | — | — |
| `H` | Dica da IA | — | — |
| `T` | Mapa de influência | Mapa de influência | Mapa de influência |
| `B` | — | Pular para o próximo erro crítico | — |
| `S` | — | Ligar/desligar Testar Variações | — |
| `Esc` | Fecha o diálogo aberto | Fecha o diálogo aberto | Fecha o diálogo aberto |

---

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento com recarga automática |
| `npm run build` | Verifica os tipos e gera `dist/` (página única + ícones + manifesto) |
| `npm test` | Suíte de testes: regras, pontuação, SGF, explicações e motor de busca |
| `npm run typecheck` | Só a checagem de tipos |
| `npm run check` | `typecheck` + `test` |

São 318 asserções, sem framework externo: o `tests/harness.ts` tem 42 linhas.

---

## Estrutura do projeto

```
src/
  ai/
    GoBotWorker.ts    Motor de busca (MCTS + RAVE) que roda no Web Worker
    BotManager.ts     Ponte entre a interface e o worker, com cancelamento
    GameReviewer.ts   Análise pós-jogo, classificação de lances e plano de estudo
    MoveInsights.ts   Explicações didáticas derivadas do tabuleiro
    MoveNarrator.ts   Comentário do observador: tipo do lance, porquê e quando
    ReviewSummary.ts  Relatório textual do sensei, por partida e por cor
  core/
    GoBoard.ts        Regras: capturas, suicídio, ko, superko posicional
    GoScoring.ts      Contagem de território e vida incondicional (Benson)
    InfluenceMap.ts   Estimativa de território em tempo real
  audio/SoundEffects.ts  Sons sintetizados na hora, sem arquivos de áudio
  sgf/SgfParser.ts    Leitura e escrita de SGF
  ui/
    App.ts            Estado da aplicação e ligação com o DOM
    BoardRenderer.ts  Desenho do tabuleiro em canvas
  data/               Tsumegos, josekis, partidas de exemplo e glossário
  styles/main.css     Estilos, com o bloco responsivo no fim do arquivo
public/               Copiado para dist/ como está: ícones, manifesto, _headers
tests/                Testes, sem framework externo
```

---

## Como as coisas funcionam por dentro

### O motor de busca

A busca é um MCTS com RAVE e uma política de simulação local no estilo MoGo.
O tabuleiro interno usa arrays tipados e um índice de grupos com *union-find* e
*pseudo-liberdades*, o que torna as perguntas mais frequentes da busca — "este
lance é legal?", "este grupo está em atari?", "onde está a última liberdade
dele?" — operações de tempo constante em vez de varreduras do grupo inteiro.

Na prática, em 19x19 com 4 segundos de reflexão, o nível 5 executa cerca de
17 mil simulações por lance. Os níveis se diferenciam pelo número de simulações,
pela profundidade da leitura de escadas e por quanta aleatoriedade entra na
escolha final, de modo que o nível 1 erra de propósito em vez de apenas pensar
menos.

A avaliação de posição usada pela revisão é a média ponderada por visitas de
todos os lances da raiz, e não o valor do melhor lance. O valor do melhor lance
é o máximo de várias estimativas ruidosas e por isso é enviesado para cima nas
duas pontas de uma comparação: usá-lo fazia *todo* lance parecer um erro.

### O comentário do modo observador

O comentário não sai do resultado da busca: ele sai da diferença entre a posição
antes e depois do lance. O narrador compara as duas, escolhe **um** arquétipo
(o mais concreto vence — um lance que captura *e* conecta é uma captura) e
escreve duas frases separadas de propósito:

- **Por que aqui, agora** fala só desta posição, e cada número que aparece foi
  medido: contagem de liberdades, tamanho dos grupos, quantos grupos distintos
  encostam no ponto, distância até a borda, distância até o último lance.
- **Quando jogar assim** é fixo por arquétipo — é a regra geral que aquele tipo
  de lance ensina, escrita para valer em qualquer partida.

Dois casos merecem nota. "Vivo" só é dito quando o algoritmo de Benson confirma
vida incondicional; a contagem barata de olhos, que se engana com olhos falsos,
aparece no texto como "espaços cercados". E o placar em pontos fica escondido
até o fim de jogo: a pontuação por área entrega todo ponto vazio a quem o
alcança sozinho, então num tabuleiro com duas pedras ela diz "Pretas +75,5" —
verdade pela regra e inútil como placar. Até lá, quem responde é a chance de
vitória da busca.

### As explicações da revisão

As frases que a revisão mostra não são texto genérico escolhido pela nota do
lance. Cada uma sai de um fato medido nas posições antes e depois da jogada:
contagem de liberdades, tamanho dos grupos, capturas, quantos grupos distintos
encostam no ponto, distância até a borda. Se a revisão diz "2 pedras suas
continuam em atari" é porque existe um grupo de exatamente 2 pedras com
exatamente 1 liberdade, e o ponto citado é essa liberdade.

O mesmo vale para as sugestões da IA: a descrição de cada alternativa é obtida
jogando o lance numa cópia da posição e olhando o que mudou, então "captura 3
pedras" foi verificado, não estimado.

### Velocidade

A página inteira é uma requisição só. Não há fontes externas, CDN nem analytics:
num 4G lento (1,6 Mbps, 150ms de latência) com a CPU quatro vezes mais devagar,
a primeira pintura acontece em torno de 560ms. O tabuleiro é desenhado em canvas
com a madeira, a grade e as coordenadas pré-renderizadas numa camada que só é
repintada quando o tamanho muda, e as pedras são sprites reaproveitados.

---

## Limitações conhecidas

- **A força da IA.** Os rótulos do seletor de nível ("9 Dan Pro", "KAMI") são
  enfeite. O nível 5 é o teto deste motor MCTS e joga bem, mas está longe de uma
  rede neural moderna tipo KataGo ou Leela Zero. Para estudo é mais que
  suficiente; para medir a sua força real, não sirva de régua.
- **Contagem de pontos.** O `GoScoring.ts` implementa as regras japonesa e
  chinesa, mas só a japonesa está acessível — não há seletor na interface.
- **Sair do modo Observador perde a exibição.** O tabuleiro é compartilhado
  entre os modos, então voltar para a aba começa uma partida nova em vez de
  mostrar comentário antigo sobre uma posição que mudou.
- **Uma exibição 19x19 no nível 5 é longa.** São uns 250 lances a 4 segundos de
  reflexão cada, mais a pausa de leitura — perto de 20 minutos. O padrão 13x13 e
  o controle de ritmo existem para isso.
- **Abrir o arquivo direto do disco degrada a IA.** Sem um servidor HTTP o Web
  Worker não carrega e a busca roda na mesma thread da interface, que congela
  enquanto pensa.
