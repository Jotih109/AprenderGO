export type Color = 'black' | 'white';
export type Point = { x: number; y: number };
export type BoardSize = 19 | 13 | 9;

export type StoneState = Color | null;

export interface Move {
  x: number;
  y: number;
  color: Color;
  pass?: boolean;
  resign?: boolean;
  captured?: Point[];
  comment?: string;
  moveNumber?: number;
}

export type GameMode = 'pvp' | 'pve' | 'eve' | 'tsumego' | 'joseki' | 'review';

export type RuleSet = 'japanese' | 'chinese';

export type BoardTheme = 'kaya' | 'dark' | 'cyber' | 'washi';

export interface TerritoryScore {
  blackTerritory: number;
  whiteTerritory: number;
  blackCaptures: number;
  whiteCaptures: number;
  komi: number;
  blackStonesOnBoard?: number;
  whiteStonesOnBoard?: number;
  blackTotal: number;
  whiteTotal: number;
  winner: Color | 'draw';
  margin: number;
  territoryMap: ('black' | 'white' | 'dame' | null)[][];
}

export interface TsumegoProblem {
  id: string;
  title: string;
  difficulty: 'Iniciante' | 'Intermediário' | 'Avançado';
  playerColor: Color;
  description: string;
  size: BoardSize;
  initialStones: { x: number; y: number; color: Color }[];
  solutionTree: TsumegoNode;
  hint: string;
}

export interface TsumegoNode {
  x: number;
  y: number;
  color: Color;
  response?: TsumegoNode;
  isCorrect?: boolean;
  message?: string;
  alternatives?: TsumegoNode[];
}

export interface JosekiNode {
  name: string;
  category: 'Estrela 4-4' | 'Komoku 3-4' | 'San-San 3-3';
  description: string;
  moves: { x: number; y: number; color: Color; note?: string }[];
}

// -------------------------------------------------------------
// POST-GAME REVIEW & ANALYSIS TYPES
// -------------------------------------------------------------

export type MoveClassificationType =
  | 'brilliant'  // 🌟 Brilhante
  | 'best'       // 🟢 Melhor Jogada
  | 'good'       // 🔵 Boa Jogada
  | 'inaccuracy' // 🟡 Imprecisão
  | 'mistake'    // 🟠 Erro
  | 'blunder';   // ☠️ Erro Crítico / Muito Ruim

export interface AlternativeMove {
  point: Point;
  winRate: number; // Win-rate if this alternative was played
  scoreLead: number;
  description: string;
}

export interface MoveEvaluation {
  moveNumber: number;
  color: Color;
  playedMove: Point | null; // null if pass
  winRateBefore: number; // 0..1 (from perspective of current player)
  winRateAfter: number;  // 0..1 (from perspective of current player)
  winRateDelta: number;  // After - Before (negative is loss)
  classification: MoveClassificationType;
  badgeSymbol: string;
  badgeColor: string;
  labelPt: string;
  explanation: string;
  bestMove: Point | null;
  alternatives: AlternativeMove[];
  blackWinRateHistory: number; // 0..1 for global chart (Black perspective)
}

export interface GameReviewReport {
  totalMoves: number;
  blackAccuracyPct: number;
  whiteAccuracyPct: number;
  evaluations: MoveEvaluation[];
  stats: {
    black: Record<MoveClassificationType, number>;
    white: Record<MoveClassificationType, number>;
  };
  turningPoints: { moveNumber: number; description: string; impact: string }[];
}
