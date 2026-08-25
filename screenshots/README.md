# 📸 Galeria de Telas & Apresentação para Portfólio — Go Master

Esta pasta contém capturas de tela em altíssima resolução (**Retina 4K / 1920x1080 @ 2x**) de todas as principais funcionalidades e interfaces do **Go Master**, prontas para serem utilizadas em seu portfólio (Behance, GitHub, LinkedIn, site pessoal ou case study de frontend/IA).

---

## 🌟 Resumo do Projeto para Portfólio

> **Go Master (Pro Baduk / Weiqi)** é uma plataforma web completa e moderna para o jogo milenar de Go, desenvolvida com TypeScript, HTML5 Canvas e Web Workers. Possui motor de Inteligência Artificial próprio com **MCTS (Monte Carlo Tree Search) + RAVE**, módulo de **análise pós-jogo didática em português**, treinador de **Tsumego (puzzles)**, explorador de **Joseki (aberturas)**, suporte completo ao padrão **SGF** e múltiplos temas visuais.

### 🛠️ Stack Tecnológica & Diferenciais Técnicos:
- **Frontend / UI**: TypeScript, HTML5 Canvas 2D otimizado com renderização subpixel e texturas dinâmicas, CSS3 Moderno (Glassmorphism, Variáveis CSS, Transições fluidas).
- **Inteligência Artificial (IA)**: MCTS com RAVE, heurísticas locais MoGo e políticas de simulação executadas em **Web Workers** em thread paralela para não travar a UI a 60 FPS.
- **Estruturas de Dados**: *Union-Find* (Disjoint-Set) com arrays tipados para rastreamento de grupos de pedras e contagem de liberdades em $O(1)$.
- **Análise Pós-Jogo & Modo Aprendiz**: Algoritmo que traduz variações matemáticas de win rate em explicações didáticas em linguagem natural e plano de estudo personalizado.

---

## 🖼️ Índice e Descrição dos Prints

| # | Arquivo | Descrição da Funcionalidade / Tela |
|---|---|---|
| **01** | `01_partida_19x19_kaya.png` | **Tabuleiro Oficial 19x19 (Kaya Tradicional)**: Visão geral da tela principal, acabamento em madeira kaya, relógios Byo-yomi, placar de prisioneiros e atalhos rápidos. |
| **02** | `02_modal_nova_partida.png` | **Configurações de Partida**: Modal intuitivo com modos PvE (vs IA), PvP (Local) e EvE (Bot vs Bot), 5 níveis de IA (até KAMI 9-Dan), tamanhos (9x9, 13x13, 19x19), handicap e relógios (Byo-yomi, Fischer, Absoluto). |
| **03** | `03_modal_biblioteca_sgf.png` | **Biblioteca de Partidas Gravadas**: Seleção de partidas históricas e gravadas da pasta Revisão com metadados detalhados (jogadores, data, resultado e descrição). |
| **04** | `04_partida_em_andamento_9x9.png` | **Partida em Andamento (9x9)**: Demonstração de jogo ativo com pedras pretas e brancas, capturas, marcação do último lance jogado e histórico lateral. |
| **05** | `05_mapa_influencia_territorio.png` | **Heatmap de Influência Territorial**: Visualização em tempo real das zonas de influência e território controlado por cada jogador no tabuleiro. |
| **06** | `06_analise_pos_jogo_completa.png` | **Revisão Pós-Jogo Completa (Sensei IA)**: Gráfico interativo de probabilidade de vitória (Win Rate Timeline), pontuação de precisão dos jogadores e breakdown de lances. |
| **07** | `07_analise_detalhe_lance_aprendiz.png` | **Análise Didática & Modo Aprendiz**: Explicabilidade de IA em português ("custou ~4 pontos", motivos táticos), sugestões de jogadas com setas no tabuleiro e plano de estudos. |
| **08** | `08_tsumego_selecao_problemas.png` | **Seleção de Puzzles de Tsumego**: Modal com problemas clássicos de vida e morte categorizados por nível (Iniciante, Intermediário, Avançado). |
| **09** | `09_tsumego_resolvendo_puzzle.png` | **Treinador de Tsumego Interativo**: Tabuleiro focado no canto com instruções táticas e feedback interativo de acerto/erro. |
| **10** | `10_dicionario_joseki_aberturas.png` | **Explorador de Joseki**: Dicionário interativo de sequências canônicas de abertura nos cantos, com variações e comentários conceituais. |
| **11** | `11_glossario_conceitos_didatico.png` | **Glossário de Conceitos**: Guia ilustrado com os 14 conceitos fundamentais do Go (Liberdades, Atari, Olhos, Ko, Sente/Gote, Tenuki, etc.). |
| **12** | `12_modal_regras_e_guia.png` | **Guia Completo de Regras**: Tutorial completo e acessível ensinando as regras oficiais e a filosofia do Go para novos jogadores. |
| **13** | `13_modal_contagem_pontos_final.png` | **Contagem de Pontos Final (Scoring)**: Relatório de fim de jogo com contagem automatizada de território cercado, capturas e compensação de Komi. |
| **14** | `14_modal_colar_sgf.png` | **Importador de SGF**: Suporte ao formato universal Smart Game Format (SGF) permitindo importar partidas de plataformas como OGS, Fox, Tygem e KGS. |
| **15** | `15_tema_estudio_noturno_dark.png` | **Tema Estúdio Noturno (Dark Mode)**: Tema escuro elegante com pedras de ardósia e concha, ideal para conforto visual. |
| **16** | `16_tema_cyber_baduk_neon.png` | **Tema Cyber Baduk (Neon / High-Tech)**: Tema futurista com iluminação neon ciano/magenta e estética sci-fi. |
| **17** | `17_tema_papel_washi.png` | **Tema Papel Washi**: Estética minimalista tradicional japonesa inspirada no papel artesanal Washi. |

---

## 💡 Dicas para apresentar no seu Portfólio

1. **Imagem de Capa / Hero**: Utilize a captura `06_analise_pos_jogo_completa.png` ou `01_partida_19x19_kaya.png` como imagem principal do projeto.
2. **Carrossel de Features**: Crie um carrossel demonstrando:
   - Partida Ativa (`04`) + Mapa de Influência (`05`)
   - Análise Pós-Jogo (`06`) + Insights Didáticos (`07`)
   - Treinamento (`08`, `09`, `10`)
   - Customização de Temas (`15`, `16`, `17`)
3. **Foco na Experiência do Usuário**: Destaque como o "Modo Aprendiz" traduz métricas estatísticas densas da IA em termos práticos e compreensíveis para humanos.
