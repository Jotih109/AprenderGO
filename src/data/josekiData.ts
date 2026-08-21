import { JosekiNode } from '../types/go';

export const JOSEKI_PATTERNS: JosekiNode[] = [
  {
    name: 'Invasão 3-3 Direta (Padrão IA Moderno)',
    category: 'Estrela 4-4',
    description: 'A inovação revolucionária popularizada pela IA. As Brancas invadem o canto imediatamente e estabilizam um grupo vivo enquanto as Pretas constroem forte influência externa.',
    moves: [
      { x: 3, y: 3, color: 'black', note: 'Pretas ocupam a Estrela (Hoshi D4).' },
      { x: 2, y: 2, color: 'white', note: 'Brancas invadem direto no San-San C3.' },
      { x: 3, y: 2, color: 'black', note: 'Pretas bloqueiam pelo lado mais amplo (D3).' },
      { x: 2, y: 3, color: 'white', note: 'Brancas rastejam na segunda linha (C4).' },
      { x: 1, y: 3, color: 'black', note: 'Pretas jogam o Hane crítico na cabeça (B4).' },
      { x: 2, y: 4, color: 'white', note: 'Brancas dão o contra-Hane (C5).' },
      { x: 1, y: 4, color: 'black', note: 'Pretas estendem solidamente (B5).' },
      { x: 3, y: 4, color: 'white', note: 'Brancas conectam a forma sólida (D5).' },
      { x: 0, y: 4, color: 'black', note: 'Pretas capturam a pedra do corte e selam o muro exterior (A5).' }
    ]
  },
  {
    name: 'Aproximação do Cavaleiro (Keima Kakari Clássico)',
    category: 'Estrela 4-4',
    description: 'O Joseki mais jogado na história do Go. Equilíbrio harmonioso entre território de canto para as Pretas e base estável para as Brancas.',
    moves: [
      { x: 3, y: 3, color: 'black', note: 'Pretas ocupam a Estrela (D4).' },
      { x: 5, y: 2, color: 'white', note: 'Brancas aproximam pelo Cavaleiro Baixo (F3).' },
      { x: 3, y: 2, color: 'black', note: 'Pretas respondem com Tsuke ou Kosumi de defesa (D3).' },
      { x: 5, y: 3, color: 'white', note: 'Brancas estendem na 4ª linha criando base (F4).' },
      { x: 2, y: 1, color: 'black', note: 'Pretas fecham o canto com segurança (C2).' },
      { x: 9, y: 2, color: 'white', note: 'Brancas completam a extensão de dois espaços na lateral (J3).' }
    ]
  },
  {
    name: 'Komoku 3-4: Defesa com Salto de Um Espaço',
    category: 'Komoku 3-4',
    description: 'Abertura voltada para território sólido e controle do canto inferior.',
    moves: [
      { x: 2, y: 3, color: 'black', note: 'Pretas abrem no Komoku (C4).' },
      { x: 4, y: 4, color: 'white', note: 'Brancas jogam aproximação alta (E5).' },
      { x: 2, y: 5, color: 'black', note: 'Pretas defendem o território com Ikken-tobi (C6).' },
      { x: 6, y: 4, color: 'white', note: 'Brancas estendem com estabilidade (G5).' }
    ]
  },
  {
    name: 'Pinça de Um Espaço (Ikken Hasami)',
    category: 'Estrela 4-4',
    description: 'Uma resposta agressiva das Pretas para disputar a iniciativa e contra-atacar a aproximação das Brancas.',
    moves: [
      { x: 3, y: 3, color: 'black', note: 'Pretas no Hoshi (D4).' },
      { x: 5, y: 2, color: 'white', note: 'Brancas aproximam em F3.' },
      { x: 7, y: 2, color: 'black', note: 'Pretas realizam a pinça de um espaço em H3!' },
      { x: 2, y: 2, color: 'white', note: 'Brancas buscam vida no canto em C3 (San-San).' },
      { x: 3, y: 2, color: 'black', note: 'Pretas bloqueiam em D3.' },
      { x: 2, y: 3, color: 'white', note: 'Brancas avançam para C4.' }
    ]
  }
];
