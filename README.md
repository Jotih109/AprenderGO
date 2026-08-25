# Go Master

Jogo de Go (Weiqi / Baduk) completo em português, rodando inteiramente no navegador:
IA com busca MCTS, análise pós-jogo, problemas de Tsumego, dicionário de Joseki e
suporte a SGF.

## Como jogar

**Mais simples:** dê dois cliques em `JOGAR.bat`. Ele instala as dependências na
primeira vez, sobe o servidor e abre o jogo no navegador.

**Ou pela linha de comando:**

```bash
npm install
npm run dev      # http://localhost:3000
```

`index.html` e `JOGAR.html` são versões de arquivo único, geradas pelo build e
prontas para abrir direto. Rodando pelo servidor a IA usa um Web Worker e não
trava a interface; abrindo o arquivo direto ela roda na mesma thread.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento com recarga automática |
| `npm run build` | Verifica os tipos, gera o arquivo único e atualiza `index.html` / `JOGAR.html` |
| `npm test` | Suíte de testes (regras, pontuação, SGF e motor de busca) |
| `npm run typecheck` | Só a checagem de tipos |
| `npm run check` | `typecheck` + `test` |

## Funcionalidades

- **Partidas** contra a IA (5 níveis), contra outra pessoa no mesmo computador,
  ou IA contra IA. Tabuleiros 9x9, 13x13 e 19x19, com handicap de 2 a 9 pedras.
- **Relógios** byo-yomi, Fischer (com incremento aplicado a cada lance) e absoluto.
- **Análise pós-jogo pensada para aprender**: além de classificar cada lance,
  a revisão explica *o que aconteceu no tabuleiro* em português simples —
  "você ignorou um atari de 2 pedras, o adversário captura jogando em C9".
  Cada observação vem marcada com o conceito de Go que ela ensina, e o conceito
  abre o glossário. No fim, um **plano de estudo** lista o que você mais errou
  na partida, com os números dos lances para revisitar.
- **Modo Aprendiz** (ligado por padrão): troca porcentagens por pontos no
  tabuleiro ("custou ~4 pontos") e descreve as sugestões da IA pelo que elas
  fazem ("corta os grupos adversários"), em vez de "58,2% em 316 simulações".
  Quem quiser os números crus é só desligar.
- **Glossário** com 14 conceitos (liberdade, atari, olho, corte, cantos
  primeiro…), cada um com explicação e o que fazer na prática.
- **Modo variação** dentro da revisão: jogue livremente a partir de qualquer lance.
- **Tsumego** (vida e morte) e **dicionário de Joseki** navegável.
- **SGF**: importar arquivo, colar código, exportar a partida e exportar o
  tabuleiro como imagem.
- Quatro temas de tabuleiro, mapa de influência, coordenadas e números de lance.

## Estrutura

```
src/
  ai/
    GoBotWorker.ts    Motor de busca (MCTS + RAVE) que roda no Web Worker
    BotManager.ts     Ponte entre a interface e o worker, com cancelamento
    GameReviewer.ts   Análise pós-jogo e classificação de lances
    MoveInsights.ts   Explicações didáticas derivadas do tabuleiro
  core/
    GoBoard.ts        Regras: capturas, suicídio, ko, superko posicional
    GoScoring.ts      Contagem japonesa e chinesa, vida incondicional (Benson)
    InfluenceMap.ts   Estimativa de território em tempo real
  sgf/SgfParser.ts    Leitura e escrita de SGF
  ui/
    App.ts            Estado da aplicação e ligação com o DOM
    BoardRenderer.ts  Desenho do tabuleiro em canvas
  data/               Tsumegos, josekis, partidas de exemplo e glossário
tests/                Testes, sem framework externo
```

## Sobre o motor de busca

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

## Sobre as explicações da revisão

As frases que a revisão mostra não são texto genérico escolhido pela nota do
lance. Cada uma sai de um fato medido nas posições antes e depois da jogada:
contagem de liberdades, tamanho dos grupos, capturas, quantos grupos distintos
encostam no ponto, distância até a borda. Se a revisão diz "2 pedras suas
continuam em atari" é porque existe um grupo de exatamente 2 pedras com
exatamente 1 liberdade, e o ponto citado é essa liberdade.

O mesmo vale para as sugestões da IA: a descrição de cada alternativa é obtida
jogando o lance numa cópia da posição e olhando o que mudou, então "captura 3
pedras" foi verificado, não estimado.
