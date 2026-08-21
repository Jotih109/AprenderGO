import { TsumegoProblem } from '../types/go';

export const TSUMEGO_PROBLEMS: TsumegoProblem[] = [
  {
    id: 'tsumego-1',
    title: '1. O Básico dos Dois Olhos',
    difficulty: 'Iniciante',
    playerColor: 'black',
    description: 'Pretas jogam e vivem. Encontre o ponto vital que cria dois olhos incondicionais.',
    hint: 'Divida o espaço interno em dois aposentos separados.',
    size: 9,
    initialStones: [
      // White boundary enclosing black in top-left corner
      { x: 0, y: 3, color: 'white' },
      { x: 1, y: 3, color: 'white' },
      { x: 2, y: 3, color: 'white' },
      { x: 3, y: 2, color: 'white' },
      { x: 3, y: 1, color: 'white' },
      { x: 3, y: 0, color: 'white' },
      // Black living frame
      { x: 0, y: 2, color: 'black' },
      { x: 1, y: 2, color: 'black' },
      { x: 2, y: 2, color: 'black' },
      { x: 2, y: 1, color: 'black' },
      { x: 2, y: 0, color: 'black' },
      { x: 0, y: 1, color: 'black' }
    ],
    solutionTree: {
      x: 1,
      y: 0,
      color: 'black',
      isCorrect: true,
      message: 'Perfeito! Jogar em (1,0) divide o espaço em dois olhos independentes em (0,0) e (1,1).'
    }
  },
  {
    id: 'tsumego-2',
    title: '2. Tesuji do Snapback (Oi-otoshi)',
    difficulty: 'Iniciante',
    playerColor: 'black',
    description: 'Pretas jogam para capturar o grupo branco sacrificando uma única pedra propositalmente.',
    hint: 'Coloque uma pedra diretamente na boca do tigre para criar uma captura de retorno.',
    size: 9,
    initialStones: [
      { x: 1, y: 0, color: 'white' },
      { x: 2, y: 0, color: 'white' },
      { x: 3, y: 0, color: 'black' },
      { x: 0, y: 1, color: 'white' },
      { x: 2, y: 1, color: 'white' },
      { x: 3, y: 1, color: 'black' },
      { x: 0, y: 2, color: 'black' },
      { x: 1, y: 2, color: 'black' },
      { x: 2, y: 2, color: 'black' }
    ],
    solutionTree: {
      x: 1,
      y: 1,
      color: 'black',
      isCorrect: true,
      message: 'Excelente! O sacrifício em (1,1) é o clássico Snapback. Mesmo se as Brancas capturarem a pedra em (1,1), as Pretas capturam todas as 4 pedras no lance seguinte!'
    }
  },
  {
    id: 'tsumego-3',
    title: '3. A Rede Tática (Geta)',
    difficulty: 'Iniciante',
    playerColor: 'black',
    description: 'Capture a pedra branca de corte sem permitir que ela escape pelo centro.',
    hint: 'Não dê atari direto; envolva a pedra à distância.',
    size: 9,
    initialStones: [
      { x: 3, y: 3, color: 'black' },
      { x: 4, y: 2, color: 'black' },
      { x: 4, y: 3, color: 'white' },
      { x: 5, y: 4, color: 'black' }
    ],
    solutionTree: {
      x: 5,
      y: 2,
      color: 'black',
      isCorrect: true,
      message: 'Muito bem! A jogada em Geta (Rede) prende a pedra branca indefesa, bloqueando qualquer rota de fuga.'
    }
  },
  {
    id: 'tsumego-4',
    title: '4. O Ninho do Grou (Tsuru no Sugomori)',
    difficulty: 'Intermediário',
    playerColor: 'black',
    description: 'Tesuji famoso para capturar duas pedras brancas no canto.',
    hint: 'Corte a conexão branca e aperte suas liberdades.',
    size: 9,
    initialStones: [
      { x: 0, y: 0, color: 'black' },
      { x: 1, y: 0, color: 'white' },
      { x: 2, y: 0, color: 'white' },
      { x: 3, y: 0, color: 'black' },
      { x: 0, y: 1, color: 'black' },
      { x: 1, y: 1, color: 'white' },
      { x: 3, y: 1, color: 'black' },
      { x: 0, y: 2, color: 'black' },
      { x: 1, y: 2, color: 'black' },
      { x: 2, y: 2, color: 'black' }
    ],
    solutionTree: {
      x: 2,
      y: 1,
      color: 'black',
      isCorrect: true,
      message: 'Brilhante! "O Ninho do Grou". As pedras brancas não têm como responder sem serem capturadas.'
    }
  },
  {
    id: 'tsumego-5',
    title: '5. Sob as Pedras (Ishi-no-Shita)',
    difficulty: 'Avançado',
    playerColor: 'black',
    description: 'Pretas jogam para revidar após a perda de pedras no canto.',
    hint: 'Permita que o grupo de 4 pedras seja capturado para depois contra-atacar no espaço vazio que surge.',
    size: 9,
    initialStones: [
      { x: 0, y: 0, color: 'black' },
      { x: 1, y: 0, color: 'black' },
      { x: 0, y: 1, color: 'black' },
      { x: 1, y: 1, color: 'black' },
      { x: 2, y: 0, color: 'white' },
      { x: 2, y: 1, color: 'white' },
      { x: 2, y: 2, color: 'white' },
      { x: 1, y: 2, color: 'white' },
      { x: 0, y: 2, color: 'white' }
    ],
    solutionTree: {
      x: 0,
      y: 3,
      color: 'black',
      isCorrect: true,
      message: 'Magnífico! Jogada de nível Dan. Uma demonstração pura do poder do Ishi-no-Shita (jogar sob as pedras recém-capturadas).'
    }
  }
];
