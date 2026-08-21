import { BoardSize, BoardTheme, Color, GameMode, Move, PlayerClock, Point, RuleSet, TsumegoProblem, JosekiNode, GameReviewReport, MoveEvaluation, AlternativeMove, MoveClassificationType } from '../types/go';
import { GoBoard } from '../core/GoBoard';
import { InfluenceMap } from '../core/InfluenceMap';
import { GoScoring } from '../core/GoScoring';
import { SoundEffects } from '../audio/SoundEffects';
import { BotManager } from '../ai/BotManager';
import { BoardRenderer } from './BoardRenderer';
import { GameReviewer } from '../ai/GameReviewer';
import { TSUMEGO_PROBLEMS } from '../data/tsumegoData';
import { JOSEKI_PATTERNS } from '../data/josekiData';
import { PRESET_REVIEW_GAMES, ReviewGamePreset } from '../data/reviewGamesData';
import { SgfParser } from '../sgf/SgfParser';
import confetti from 'canvas-confetti';

export class App {
  // Core components
  private board: GoBoard;
  private renderer: BoardRenderer;
  private sound: SoundEffects;
  private botManager: BotManager;

  // Settings & Modes
  private mode: GameMode = 'pve';
  private playerColor: Color = 'black';
  private botLevel: number = 3;
  private boardSize: BoardSize = 19;
  private theme: BoardTheme = 'kaya';
  private komi: number = 6.5;
  private ruleSet: RuleSet = 'japanese';
  private handicap: number = 0;

  // Visual Overlays & Toggles
  private showCoordinates: boolean = true;
  private showMoveNumbers: boolean = false;
  private showInfluenceMap: boolean = false;
  private hoverPoint: Point | null = null;
  private aiHint: { point: Point; score?: number; winRate?: number } | null = null;

  // Clocks
  private clockType: 'none' | 'byoyomi' | 'fischer' | 'absolute' = 'byoyomi';
  private blackClock: PlayerClock = { mainTimeRemaining: 600, byoyomiPeriodsRemaining: 3, byoyomiCurrentTime: 30, isInByoyomi: false };
  private whiteClock: PlayerClock = { mainTimeRemaining: 600, byoyomiPeriodsRemaining: 3, byoyomiCurrentTime: 30, isInByoyomi: false };
  private clockInterval: number | null = null;

  // Interactive Scoring Phase
  private isScoringPhase: boolean = false;
  private deadStones: Set<string> = new Set();
  private scoringResult: any = null;

  // Study Modules
  private currentTsumegoIndex: number = 0;
  private currentTsumego: TsumegoProblem | null = null;
  private tsumegoStepNode: any = null;

  private currentJoseki: JosekiNode | null = null;
  private josekiMoveIndex: number = 0;

  // Replay & Post-Game Review
  private replayIndex: number = -1; // -1 means live game
  private autoPlayTimer: number | null = null;
  private reviewReport: GameReviewReport | null = null;
  private currentReviewMoveIndex: number = 0;
  private activeAlternative: AlternativeMove | null = null;

  // Sandbox / Variation Exploration Mode in Review
  private isSandboxMode: boolean = false;
  private sandboxBoard: GoBoard | null = null;
  private sandboxMoves: { point: Point; color: Color; step: number }[] = [];

  // Interactive Challenge ("Treinar Meus Erros") Mode
  private isChallengeMode: boolean = false;
  private challengeTargetPoint: Point | null = null;

  // DOM Elements
  private canvas: HTMLCanvasElement;
  private chartCanvas: HTMLCanvasElement;
  private cardBlack: HTMLElement;
  private cardWhite: HTMLElement;
  private timerBlack: HTMLElement;
  private timerWhite: HTMLElement;
  private capturesBlack: HTMLElement;
  private capturesWhite: HTMLElement;
  private statusText: HTMLElement;
  private evalBarBlack: HTMLElement;
  private evalBlackPct: HTMLElement;
  private evalWhitePct: HTMLElement;
  private evalLead: HTMLElement;
  private estBlackPts: HTMLElement;
  private estWhitePts: HTMLElement;
  private moveHistoryList: HTMLElement;
  private moveCountBadge: HTMLElement;

  constructor() {
    this.board = new GoBoard(this.boardSize);
    this.sound = new SoundEffects();
    this.botManager = new BotManager();

    this.canvas = document.getElementById('go-board') as HTMLCanvasElement;
    this.chartCanvas = document.getElementById('winrate-chart') as HTMLCanvasElement;
    this.renderer = new BoardRenderer(this.canvas);

    // Grab UI elements
    this.cardBlack = document.getElementById('card-black')!;
    this.cardWhite = document.getElementById('card-white')!;
    this.timerBlack = document.getElementById('timer-black')!;
    this.timerWhite = document.getElementById('timer-white')!;
    this.capturesBlack = document.getElementById('captures-black')!;
    this.capturesWhite = document.getElementById('captures-white')!;
    this.statusText = document.getElementById('status-text')!;
    this.evalBarBlack = document.getElementById('eval-bar-black')!;
    this.evalBlackPct = document.getElementById('eval-black-pct')!;
    this.evalWhitePct = document.getElementById('eval-white-pct')!;
    this.evalLead = document.getElementById('eval-lead')!;
    this.estBlackPts = document.getElementById('est-black-pts')!;
    this.estWhitePts = document.getElementById('est-white-pts')!;
    this.moveHistoryList = document.getElementById('move-history-list')!;
    this.moveCountBadge = document.getElementById('move-count-badge')!;

    this.initLayout();
    this.bindEvents();
    this.resetClocks();
    this.startClockLoop();
    this.updateUI();
    this.updateBoardSize();
  }

  public updateBoardSize(newSize?: BoardSize): void {
    if (newSize) {
      this.boardSize = newSize;
    }

    const wrapper = document.querySelector('.board-container-wrapper') as HTMLElement;
    const isReview = this.mode === 'review';
    const quickBar = document.getElementById(isReview ? 'review-quick-controls' : 'board-quick-controls');
    const timelineCard = isReview ? document.getElementById('winrate-chart-card') : null;

    const timelineHeight = timelineCard && timelineCard.style.display !== 'none' ? 96 : 0;
    const quickBarHeight = quickBar && quickBar.style.display !== 'none' ? quickBar.offsetHeight + 10 : 46;
    const availableHeight = window.innerHeight - 64 - quickBarHeight - timelineHeight - 24;

    const wrapperWidth = wrapper && wrapper.clientWidth > 100 ? wrapper.clientWidth - 16 : window.innerWidth - 650;

    // Expand board to fill available space nicely
    const targetDim = Math.max(280, Math.min(wrapperWidth, availableHeight, 1080));

    this.renderer.resize(targetDim, targetDim, this.boardSize);
    if (isReview) {
      this.renderReviewState();
      this.drawWinRateChart();
    } else {
      this.render();
    }
  }

  private initLayout(): void {
    const handleResize = () => {
      this.updateBoardSize();
    };

    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 60);
  }

  private bindEvents(): void {
    // Canvas Clicks & Hovers
    this.canvas.addEventListener('mousemove', (e) => {
      const pt = this.renderer.screenToBoard(e.clientX, e.clientY);
      if (pt !== this.hoverPoint) {
        this.hoverPoint = pt;
        if (this.mode === 'review') {
          this.renderReviewState();
        } else {
          this.render();
        }
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverPoint = null;
      if (this.mode === 'review') {
        this.renderReviewState();
      } else {
        this.render();
      }
    });

    this.canvas.addEventListener('click', (e) => {
      const pt = this.renderer.screenToBoard(e.clientX, e.clientY);
      if (pt) {
        this.handleBoardClick(pt.x, pt.y);
      }
    });

    // Theme selector
    const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
    themeSelect.addEventListener('change', (e) => {
      this.theme = (e.target as HTMLSelectElement).value as BoardTheme;
      if (this.mode === 'review') {
        this.renderReviewState();
      } else {
        this.render();
      }
    });

    // Sound toggle
    const soundBtn = document.getElementById('btn-sound-toggle')!;
    soundBtn.addEventListener('click', () => {
      this.sound.enabled = !this.sound.enabled;
      document.getElementById('sound-icon')!.textContent = this.sound.enabled ? '🔊' : '🔇';
    });

    // Navigation Tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const mode = (e.currentTarget as HTMLElement).dataset.mode;
        this.handleTabSwitch(mode || 'play');
      });
    });

    // Quick Action Bar Buttons
    document.getElementById('btn-undo')!.addEventListener('click', () => this.handleUndo());
    document.getElementById('btn-pass')!.addEventListener('click', () => this.handlePass());
    document.getElementById('btn-resign')!.addEventListener('click', () => this.handleResign());
    document.getElementById('btn-hint')!.addEventListener('click', () => this.handleRequestHint());
    document.getElementById('btn-toggle-influence')!.addEventListener('click', () => {
      this.showInfluenceMap = !this.showInfluenceMap;
      const btn = document.getElementById('btn-toggle-influence')!;
      btn.classList.toggle('btn-primary', this.showInfluenceMap);
      btn.classList.toggle('btn-secondary', !this.showInfluenceMap);
      this.render();
    });
    document.getElementById('btn-toggle-numbers')!.addEventListener('click', () => {
      this.showMoveNumbers = !this.showMoveNumbers;
      if (this.mode === 'review') {
        this.renderReviewState();
      } else {
        this.render();
      }
    });
    document.getElementById('btn-toggle-coords')!.addEventListener('click', () => {
      this.showCoordinates = !this.showCoordinates;
      if (this.mode === 'review') {
        this.renderReviewState();
      } else {
        this.render();
      }
    });

    // Library Trigger Buttons
    document.getElementById('btn-open-library-quick')?.addEventListener('click', () => this.openReviewLibrary());
    document.getElementById('btn-open-library-sidebar')?.addEventListener('click', () => this.openReviewLibrary());
    document.getElementById('modal-review-library-close')?.addEventListener('click', () => {
      document.getElementById('modal-review-library')?.classList.remove('show');
    });

    // Paste SGF modal triggers
    document.getElementById('btn-paste-sgf-trigger')?.addEventListener('click', () => {
      document.getElementById('modal-paste-sgf')?.classList.add('show');
    });
    document.getElementById('btn-library-paste-trigger')?.addEventListener('click', () => {
      document.getElementById('modal-review-library')?.classList.remove('show');
      document.getElementById('modal-paste-sgf')?.classList.add('show');
    });
    document.getElementById('modal-paste-sgf-close')?.addEventListener('click', () => {
      document.getElementById('modal-paste-sgf')?.classList.remove('show');
    });
    document.getElementById('btn-cancel-paste-sgf')?.addEventListener('click', () => {
      document.getElementById('modal-paste-sgf')?.classList.remove('show');
    });
    document.getElementById('btn-submit-paste-sgf')?.addEventListener('click', () => this.handlePasteSgf());

    // Review Trigger Buttons
    document.getElementById('btn-review-trigger')!.addEventListener('click', () => this.startPostGameReview());
    document.getElementById('btn-modal-start-review')!.addEventListener('click', () => {
      document.getElementById('modal-scoring')!.classList.remove('show');
      this.startPostGameReview();
    });

    // Review Smart Navigation & Mode Buttons
    document.getElementById('btn-review-next-blunder')?.addEventListener('click', () => this.stepBlunder(1));
    document.getElementById('btn-review-prev-blunder')?.addEventListener('click', () => this.stepBlunder(-1));
    document.getElementById('btn-review-sandbox-toggle')?.addEventListener('click', () => this.toggleSandboxMode());
    document.getElementById('btn-review-challenge')?.addEventListener('click', () => this.startBlunderChallenge());
    document.getElementById('btn-review-toggle-numbers')?.addEventListener('click', () => {
      this.showMoveNumbers = !this.showMoveNumbers;
      this.renderReviewState();
    });
    document.getElementById('btn-review-toggle-coords')?.addEventListener('click', () => {
      this.showCoordinates = !this.showCoordinates;
      this.renderReviewState();
    });
    document.getElementById('btn-review-open-library')?.addEventListener('click', () => this.openReviewLibrary());

    // Replay Controls
    document.getElementById('btn-replay-start')?.addEventListener('click', () => this.jumpReplay(0));
    document.getElementById('btn-replay-prev')?.addEventListener('click', () => this.stepReplay(-1));
    document.getElementById('btn-replay-next')?.addEventListener('click', () => this.stepReplay(1));
    document.getElementById('btn-replay-end')?.addEventListener('click', () => this.jumpReplay(-1));
    document.getElementById('btn-replay-autoplay')?.addEventListener('click', () => this.toggleAutoPlay());

    // SGF & Image Export
    document.getElementById('btn-export-sgf')!.addEventListener('click', () => {
      const blackName = this.mode === 'pve' && this.playerColor === 'white' ? `Bot Nv.${this.botLevel}` : 'Humano';
      const whiteName = this.mode === 'pve' && this.playerColor === 'black' ? `Bot Nv.${this.botLevel}` : 'Humano';
      const sgf = SgfParser.generate(this.board, blackName, whiteName, this.komi, this.ruleSet);
      SgfParser.downloadSgf(sgf, `partida_go_${Date.now()}.sgf`);
    });

    const fileInput = document.getElementById('sgf-file-input') as HTMLInputElement;
    document.getElementById('btn-import-sgf-trigger')!.addEventListener('click', () => fileInput.click());
    document.getElementById('btn-library-upload-trigger')?.addEventListener('click', () => {
      document.getElementById('modal-review-library')?.classList.remove('show');
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const content = evt.target?.result as string;
          this.loadSgf(content);
          this.startPostGameReview();
        };
        reader.readAsText(file);
      }
    });

    document.getElementById('btn-export-png')!.addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = `goban_${Date.now()}.png`;
      link.href = this.canvas.toDataURL('image/png');
      link.click();
    });

    // New Game Modal Trigger & Submissions
    const newGameModal = document.getElementById('modal-new-game')!;
    document.getElementById('btn-new-game-modal')!.addEventListener('click', () => {
      newGameModal.classList.add('show');
    });

    document.getElementById('modal-new-game-close')!.addEventListener('click', () => newGameModal.classList.remove('show'));
    document.getElementById('btn-cancel-new-game')!.addEventListener('click', () => newGameModal.classList.remove('show'));

    // Segmented controls in modal
    this.bindSegmentedControl('control-game-mode', (val) => {
      const isPve = val === 'pve';
      document.getElementById('group-bot-level')!.style.display = isPve ? 'block' : 'none';
      document.getElementById('group-player-color')!.style.display = isPve ? 'block' : 'none';
    });
    this.bindSegmentedControl('control-player-color');
    this.bindSegmentedControl('control-board-size');

    document.getElementById('btn-start-new-game')!.addEventListener('click', () => {
      const modeVal = this.getSegmentedVal('control-game-mode') as GameMode;
      const colorVal = this.getSegmentedVal('control-player-color') as 'black' | 'white' | 'random';
      const sizeVal = parseInt(this.getSegmentedVal('control-board-size'), 10) as BoardSize;
      const botLevelVal = parseInt((document.getElementById('select-bot-level') as HTMLSelectElement).value, 10);
      const handicapVal = parseInt((document.getElementById('select-handicap') as HTMLSelectElement).value, 10);
      const clockTypeVal = (document.getElementById('select-clock-type') as HTMLSelectElement).value as any;

      this.mode = modeVal;
      this.boardSize = sizeVal;
      this.botLevel = botLevelVal;
      this.handicap = handicapVal;
      this.clockType = clockTypeVal;

      if (colorVal === 'random') {
        this.playerColor = Math.random() < 0.5 ? 'black' : 'white';
      } else {
        this.playerColor = colorVal as Color;
      }

      newGameModal.classList.remove('show');
      this.startNewGame();
    });

    // Scoring modal buttons
    document.getElementById('modal-scoring-close')!.addEventListener('click', () => {
      document.getElementById('modal-scoring')!.classList.remove('show');
    });
    document.getElementById('btn-scoring-review')!.addEventListener('click', () => {
      document.getElementById('modal-scoring')!.classList.remove('show');
    });
    document.getElementById('btn-scoring-new-game')!.addEventListener('click', () => {
      document.getElementById('modal-scoring')!.classList.remove('show');
      document.getElementById('modal-new-game')!.classList.add('show');
    });

    // Modal Study / Rules Close
    document.getElementById('modal-study-close')!.addEventListener('click', () => {
      document.getElementById('modal-study-list')!.classList.remove('show');
    });
    document.getElementById('modal-rules-close')!.addEventListener('click', () => {
      document.getElementById('modal-rules-guide')!.classList.remove('show');
    });
    document.getElementById('btn-close-rules')!.addEventListener('click', () => {
      document.getElementById('modal-rules-guide')!.classList.remove('show');
    });

    // Interactive Win Rate Chart click seek
    this.chartCanvas.addEventListener('click', (e) => {
      if (!this.reviewReport || this.reviewReport.evaluations.length === 0) return;
      const rect = this.chartCanvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      const targetMoveIndex = Math.round(pct * (this.reviewReport.evaluations.length - 1));
      this.selectReviewMove(targetMoveIndex);
    });

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.handlePass();
      } else if (e.code === 'KeyU' || (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        this.handleUndo();
      } else if (e.code === 'KeyH') {
        e.preventDefault();
        this.handleRequestHint();
      } else if (e.code === 'KeyT') {
        e.preventDefault();
        this.showInfluenceMap = !this.showInfluenceMap;
        this.render();
      } else if (e.code === 'KeyB') {
        e.preventDefault();
        if (this.mode === 'review') {
          this.stepBlunder(1);
        }
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        if (this.mode === 'review') {
          this.toggleSandboxMode();
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (this.mode === 'review') {
          this.stepReview(-1);
        } else {
          this.stepReplay(-1);
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (this.mode === 'review') {
          this.stepReview(1);
        } else {
          this.stepReplay(1);
        }
      }
    });
  }

  private bindSegmentedControl(containerId: string, callback?: (val: string) => void): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.querySelectorAll('.segmented-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        container.querySelectorAll('.segmented-btn').forEach(b => b.classList.remove('active'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        if (callback) callback(target.dataset.val || '');
      });
    });
  }

  private getSegmentedVal(containerId: string): string {
    const container = document.getElementById(containerId);
    const active = container?.querySelector('.segmented-btn.active') as HTMLElement;
    return active?.dataset.val || '';
  }

  // -------------------------------------------------------------
  // GAME LOGIC & TURN CYCLE
  // -------------------------------------------------------------

  public startNewGame(): void {
    this.isScoringPhase = false;
    this.deadStones.clear();
    this.scoringResult = null;
    this.aiHint = null;
    this.replayIndex = -1;
    this.reviewReport = null;
    this.activeAlternative = null;
    this.isSandboxMode = false;
    this.isChallengeMode = false;

    this.board.reset(this.boardSize);

    if (this.handicap >= 2) {
      this.board.setHandicap(this.handicap);
      this.komi = 0.5;
    } else {
      this.komi = 6.5;
    }

    this.updateBoardSize(this.boardSize);
    this.setReviewModeUI(false);
    this.resetClocks();
    this.updateUI();
    this.render();

    this.checkTriggerBotMove();
  }

  private handleBoardClick(x: number, y: number): void {
    if (this.isScoringPhase) {
      const stone = this.board.grid[y][x];
      if (stone) {
        const group = this.board.getGroup(x, y);
        if (group) {
          const key = `${x},${y}`;
          const isDead = this.deadStones.has(key);
          for (const pt of group.points) {
            const pKey = `${pt.x},${pt.y}`;
            if (isDead) this.deadStones.delete(pKey);
            else this.deadStones.add(pKey);
          }
          this.recalculateScoring();
          this.render();
        }
      }
      return;
    }

    if (this.mode === 'review') {
      if (this.isChallengeMode) {
        // Player attempting to find the best move
        if (this.challengeTargetPoint && x === this.challengeTargetPoint.x && y === this.challengeTargetPoint.y) {
          this.sound.playStoneClick();
          confetti({ particleCount: 75, spread: 70, origin: { y: 0.65 } });
          this.sound.playWinFanfare();
          this.statusText.textContent = '🎉 Excelente! Você encontrou a jogada ideal recomendada pela IA!';
          this.isChallengeMode = false;
          setTimeout(() => {
            this.selectReviewMove(this.currentReviewMoveIndex);
          }, 1800);
        } else {
          this.sound.playPass();
          this.statusText.textContent = '❌ Não é esse o ponto vital. Observe as alternativas [A], [B] e tente novamente!';
        }
        return;
      }

      if (this.isSandboxMode && this.sandboxBoard) {
        const turn = this.sandboxBoard.turn;
        const res = this.sandboxBoard.playMove(x, y, turn);
        if (res.success) {
          this.sound.playStoneClick();
          if (res.move?.captured && res.move.captured.length > 0) {
            this.sound.playCapture();
          }
          this.sandboxMoves.push({
            point: { x, y },
            color: turn,
            step: this.sandboxMoves.length + 1
          });
          this.statusText.textContent = `Variação: Lance ${this.sandboxMoves.length} jogado em ${GameReviewer.coordToString(x, y, this.boardSize)}.`;
          this.renderReviewState();
        }
        return;
      }
      return;
    }

    if (this.board.isGameOver) return;

    if (this.mode === 'tsumego') {
      this.handleTsumegoMove(x, y);
      return;
    }

    if (this.mode === 'pve') {
      if (this.board.turn !== this.playerColor) {
        return;
      }
    }

    const result = this.board.playMove(x, y, this.board.turn);
    if (result.success) {
      this.sound.playStoneClick();
      if (result.move && result.move.captured && result.move.captured.length > 0) {
        this.sound.playCapture();
      }
      this.aiHint = null;
      this.onMovePlayed();
    }
  }

  private onMovePlayed(): void {
    this.updateUI();
    this.render();

    if (this.board.consecutivePasses >= 2 || this.board.isGameOver) {
      this.enterScoringPhase();
      return;
    }

    this.checkTriggerBotMove();
  }

  private async checkTriggerBotMove(): Promise<void> {
    if (this.board.isGameOver) return;

    const isBotTurn =
      this.mode === 'eve' ||
      (this.mode === 'pve' && this.board.turn !== this.playerColor);

    if (!isBotTurn) return;

    this.statusText.textContent = `Bot (Nv. ${this.botLevel}) pensando...`;

    try {
      const botRes = await this.botManager.getMove(this.board, this.board.turn, this.botLevel, this.komi);

      if (botRes.bestMove === null) {
        this.board.pass(this.board.turn);
        this.sound.playPass();
      } else {
        const res = this.board.playMove(botRes.bestMove.x, botRes.bestMove.y, this.board.turn);
        if (res.success) {
          this.sound.playStoneClick();
          if (res.move?.captured && res.move.captured.length > 0) {
            this.sound.playCapture();
          }
        }
      }

      this.onMovePlayed();
    } catch (e) {
      console.error('Error during bot move:', e);
    }
  }

  private handlePass(): void {
    if (this.board.isGameOver) return;
    if (this.mode === 'pve' && this.board.turn !== this.playerColor) return;

    this.board.pass(this.board.turn);
    this.sound.playPass();
    this.onMovePlayed();
  }

  private handleResign(): void {
    if (this.board.isGameOver) return;
    const resigningColor = this.board.turn;
    this.board.resign(resigningColor);
    const winnerColor = resigningColor === 'black' ? 'Brancas' : 'Pretas';
    this.statusText.textContent = `${winnerColor} venceram por desistência!`;
    this.updateUI();
    this.render();
  }

  private handleUndo(): void {
    if (this.board.history.length === 0) return;

    if (this.mode === 'pve') {
      this.board.undo();
      if (this.board.turn !== this.playerColor && this.board.history.length > 0) {
        this.board.undo();
      }
    } else {
      this.board.undo();
    }

    this.isScoringPhase = false;
    this.aiHint = null;
    this.updateUI();
    this.render();
  }

  private async handleRequestHint(): Promise<void> {
    if (this.board.isGameOver) return;

    this.statusText.textContent = 'IA calculando a melhor jogada...';
    const analysis = await this.botManager.analyzePosition(this.board, this.board.turn, this.komi);

    if (analysis.bestMove) {
      this.aiHint = {
        point: analysis.bestMove,
        winRate: analysis.winRate
      };
      this.render();
      const coordStr = GameReviewer.coordToString(analysis.bestMove.x, analysis.bestMove.y, this.boardSize);
      this.statusText.textContent = `Sugestão da IA pronta: ${coordStr} (${Math.round(analysis.winRate * 100)}% de vitória)`;
    }
  }

  // -------------------------------------------------------------
  // POST-GAME REVIEW SYSTEM (GAME REVIEW & BLUNDERS)
  // -------------------------------------------------------------

  public async startPostGameReview(): Promise<void> {
    if (this.board.movesList.length === 0) {
      this.openReviewLibrary();
      return;
    }

    const progressModal = document.getElementById('modal-review-progress')!;
    const progressBar = document.getElementById('review-progress-bar')!;
    const progressText = document.getElementById('review-progress-text')!;
    progressModal.classList.add('show');

    try {
      this.reviewReport = await GameReviewer.analyzeGame(
        this.boardSize,
        this.handicap,
        this.komi,
        this.board.movesList,
        this.botManager,
        (curr, total) => {
          const pct = Math.round((curr / total) * 100);
          progressBar.style.width = `${pct}%`;
          progressText.textContent = `Analisando lance ${curr} de ${total} (${pct}%)...`;
        }
      );

      progressModal.classList.remove('show');
      this.mode = 'review';
      this.isSandboxMode = false;
      this.isChallengeMode = false;
      this.setReviewModeUI(true);
      this.populateReviewStats();
      this.drawWinRateChart();
      this.selectReviewMove(0);
    } catch (err) {
      console.error('Error during review:', err);
      progressModal.classList.remove('show');
      alert('Ocorreu um erro ao processar a análise da partida.');
    }
  }

  private setReviewModeUI(isReview: boolean): void {
    document.getElementById('live-player-cards')!.style.display = isReview ? 'none' : 'block';
    document.getElementById('review-summary-card')!.style.display = isReview ? 'block' : 'none';
    document.getElementById('live-eval-card')!.style.display = isReview ? 'none' : 'block';
    document.getElementById('territory-widget-card')!.style.display = isReview ? 'none' : 'block';
    document.getElementById('board-quick-controls')!.style.display = isReview ? 'none' : 'flex';
    document.getElementById('review-quick-controls')!.style.display = isReview ? 'flex' : 'none';
    document.getElementById('review-move-details-card')!.style.display = isReview ? 'block' : 'none';
    document.getElementById('winrate-chart-card')!.style.display = isReview ? 'flex' : 'none';

    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    if (isReview) {
      document.getElementById('tab-review')?.classList.add('active');
      this.statusText.textContent = 'Modo de Revisão Pós-Jogo Ativo. Navegue pelos lances abaixo.';
    } else {
      document.getElementById('tab-play')?.classList.add('active');
    }
    this.updateBoardSize();
  }

  private populateReviewStats(): void {
    if (!this.reviewReport) return;

    document.getElementById('review-acc-black')!.textContent = `${this.reviewReport.blackAccuracyPct}%`;
    document.getElementById('review-acc-white')!.textContent = `${this.reviewReport.whiteAccuracyPct}%`;

    const breakdownEl = document.getElementById('review-stats-breakdown')!;
    breakdownEl.innerHTML = '';

    const categories = [
      { key: 'brilliant', label: '🌟 Brilhantes', color: '#c084fc' },
      { key: 'best', label: '🟢 Melhores', color: '#10b981' },
      { key: 'good', label: '🔵 Boas', color: '#3b82f6' },
      { key: 'inaccuracy', label: '🟡 Imprecisões', color: '#eab308' },
      { key: 'mistake', label: '🟠 Erros', color: '#f97316' },
      { key: 'blunder', label: '☠️ Erros Críticos (Blunders)', color: '#ef4444' }
    ];

    categories.forEach(cat => {
      const key = cat.key as MoveClassificationType;
      const bCount = this.reviewReport!.stats.black[key] || 0;
      const wCount = this.reviewReport!.stats.white[key] || 0;

      const row = document.createElement('div');
      row.className = 'review-stat-row';
      row.innerHTML = `
        <span style="color: ${cat.color}; font-weight: 600;">${cat.label}</span>
        <span style="font-family: var(--font-mono); color: var(--text-primary);">
          ⚫ ${bCount} &nbsp;|&nbsp; ⚪ ${wCount}
        </span>
      `;
      breakdownEl.appendChild(row);
    });
  }

  private drawWinRateChart(): void {
    if (!this.reviewReport || this.reviewReport.evaluations.length === 0) return;

    const canvas = this.chartCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, width, height);

    // 50% line
    const midY = height / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    const evals = this.reviewReport.evaluations;
    const n = evals.length;
    const stepX = width / Math.max(1, n - 1);

    // Draw area fill
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < n; i++) {
      const x = i * stepX;
      const y = height * (1 - evals[i].blackWinRateHistory);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
    ctx.fill();

    // Draw win rate line
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * stepX;
      const y = height * (1 - evals[i].blackWinRateHistory);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw Special Move Dots (Blunders ☠️, Mistakes, Brilliant 🌟)
    for (let i = 0; i < n; i++) {
      const ev = evals[i];
      const x = i * stepX;
      const y = height * (1 - ev.blackWinRateHistory);

      if (ev.classification === 'blunder') {
        // ☠️ Blunder dot (Red)
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (ev.classification === 'brilliant') {
        // 🌟 Brilliant dot (Purple)
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#c084fc';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (ev.classification === 'mistake') {
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#f97316';
        ctx.fill();
      }
    }

    // Draw vertical marker for currently reviewed move
    if (this.currentReviewMoveIndex >= 0 && this.currentReviewMoveIndex < n) {
      const curX = this.currentReviewMoveIndex * stepX;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(curX, 0);
      ctx.lineTo(curX, height);
      ctx.stroke();
    }

    ctx.restore();
  }

  public selectReviewMove(index: number): void {
    if (!this.reviewReport || index < 0 || index >= this.reviewReport.evaluations.length) return;

    this.currentReviewMoveIndex = index;
    this.activeAlternative = null;
    this.isSandboxMode = false;
    this.isChallengeMode = false;

    const sandboxBtnLabel = document.getElementById('sandbox-btn-label');
    if (sandboxBtnLabel) sandboxBtnLabel.textContent = '💡 Testar Variações (E se...?)';

    const ev = this.reviewReport.evaluations[index];

    // Update details card
    const letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
    const playedCoord = ev.playedMove ? `${letters[ev.playedMove.x]}${this.boardSize - ev.playedMove.y}` : 'Passou';

    document.getElementById('review-move-title')!.textContent = `Lance ${ev.moveNumber} (${ev.color === 'black' ? 'Pretas' : 'Brancas'}): ${playedCoord}`;

    const badgeEl = document.getElementById('review-move-badge')!;
    badgeEl.className = `badge-move-eval badge-${ev.classification}`;
    badgeEl.textContent = `${ev.badgeSymbol} ${ev.labelPt}`;

    const deltaEl = document.getElementById('review-move-delta')!;
    const deltaPct = (ev.winRateDelta * 100).toFixed(1);
    deltaEl.textContent = `(${ev.winRateDelta >= 0 ? '+' : ''}${deltaPct}%)`;
    deltaEl.style.color = ev.winRateDelta < -0.1 ? '#ef4444' : ev.winRateDelta < 0 ? '#eab308' : '#10b981';

    document.getElementById('review-move-explanation')!.textContent = ev.explanation;

    // Render Alternatives
    const altList = document.getElementById('review-alternatives-list')!;
    altList.innerHTML = '';

    if (ev.alternatives.length === 0) {
      altList.innerHTML = '<span style="font-size: 12px; color: var(--text-muted);">Nenhuma alternativa relevante necessária (jogada precisa).</span>';
    } else {
      ev.alternatives.forEach((alt, idx) => {
        const altCard = document.createElement('div');
        altCard.className = 'alt-move-card';
        const labelLetter = ['A', 'B', 'C'][idx] || `${idx + 1}`;
        const altCoord = `${letters[alt.point.x]}${this.boardSize - alt.point.y}`;
        altCard.innerHTML = `
          <div>
            <strong style="color: #10b981;">[${labelLetter}] ${altCoord}</strong>
            <span style="font-size: 11px; color: var(--text-secondary); margin-left: 6px;">${alt.description}</span>
          </div>
          <span style="font-size: 11px; font-weight: 700; color: #10b981;">${(alt.winRate * 100).toFixed(1)}%</span>
        `;
        altCard.addEventListener('click', () => {
          this.activeAlternative = alt;
          this.renderReviewState();
        });
        altList.appendChild(altCard);
      });
    }

    this.drawWinRateChart();
    this.renderReviewState();
    this.updateUI();
  }

  private stepReview(delta: number): void {
    if (!this.reviewReport) return;
    const nextIdx = Math.max(0, Math.min(this.reviewReport.evaluations.length - 1, this.currentReviewMoveIndex + delta));
    this.selectReviewMove(nextIdx);
  }

  public stepBlunder(direction: 1 | -1): void {
    if (!this.reviewReport) return;
    const evals = this.reviewReport.evaluations;
    let idx = this.currentReviewMoveIndex + direction;

    while (idx >= 0 && idx < evals.length) {
      if (evals[idx].classification === 'blunder' || evals[idx].classification === 'mistake') {
        this.selectReviewMove(idx);
        return;
      }
      idx += direction;
    }

    // Wrap around
    const searchFrom = direction === 1 ? 0 : evals.length - 1;
    let wrapIdx = searchFrom;
    while (direction === 1 ? wrapIdx < this.currentReviewMoveIndex : wrapIdx > this.currentReviewMoveIndex) {
      if (evals[wrapIdx].classification === 'blunder' || evals[wrapIdx].classification === 'mistake') {
        this.selectReviewMove(wrapIdx);
        return;
      }
      wrapIdx += direction;
    }

    alert('Não há mais erros críticos ou táticos nesta direção.');
  }

  public toggleSandboxMode(): void {
    if (!this.reviewReport) return;

    this.isSandboxMode = !this.isSandboxMode;
    this.isChallengeMode = false;
    const label = document.getElementById('sandbox-btn-label');

    if (this.isSandboxMode) {
      if (label) label.textContent = '↩ Sair do Modo Variação';

      // Setup sandbox board up to current move
      this.sandboxBoard = new GoBoard(this.boardSize);
      if (this.handicap >= 2) this.sandboxBoard.setHandicap(this.handicap);
      for (let i = 0; i <= this.currentReviewMoveIndex; i++) {
        const m = this.board.movesList[i];
        if (m.pass) this.sandboxBoard.pass(m.color);
        else if (m.resign) this.sandboxBoard.resign(m.color);
        else this.sandboxBoard.playMove(m.x, m.y, m.color);
      }
      this.sandboxMoves = [];
      this.statusText.textContent = '💡 Modo Variação Ativo: Clique no tabuleiro para testar qualquer lance livremente!';
    } else {
      if (label) label.textContent = '💡 Testar Variações (E se...?)';
      this.sandboxBoard = null;
      this.sandboxMoves = [];
      this.selectReviewMove(this.currentReviewMoveIndex);
    }
    this.renderReviewState();
  }

  public startBlunderChallenge(): void {
    if (!this.reviewReport) return;

    let targetIdx = this.currentReviewMoveIndex;
    const ev = this.reviewReport.evaluations[targetIdx];

    // If current move is not a blunder, jump to first blunder
    if (ev.classification !== 'blunder' && ev.classification !== 'mistake') {
      const firstBlunderIdx = this.reviewReport.evaluations.findIndex(e => e.classification === 'blunder' || e.classification === 'mistake');
      if (firstBlunderIdx !== -1) {
        targetIdx = firstBlunderIdx;
      } else {
        alert('Nenhum erro crítico ou tático identificado para desafio.');
        return;
      }
    }

    const blunderEval = this.reviewReport.evaluations[targetIdx];
    if (!blunderEval.bestMove) {
      alert('Não há lance alternativo sugerido para esta posição.');
      return;
    }

    this.currentReviewMoveIndex = targetIdx;
    this.isChallengeMode = true;
    this.isSandboxMode = false;
    this.challengeTargetPoint = blunderEval.bestMove;

    // Show board BEFORE the blunder occurred
    this.jumpReplay(targetIdx);

    this.statusText.textContent = `🎯 Desafio: No Lance ${blunderEval.moveNumber} (${blunderEval.color === 'black' ? 'Pretas' : 'Brancas'}), encontre a jogada ideal em vez do erro!`;
    this.renderReviewState();
  }

  private renderReviewState(): void {
    if (!this.reviewReport) return;
    const ev = this.reviewReport.evaluations[this.currentReviewMoveIndex];

    const tempBoard = this.isSandboxMode && this.sandboxBoard ? this.sandboxBoard : new GoBoard(this.boardSize);

    if (!this.isSandboxMode) {
      if (this.handicap >= 2) tempBoard.setHandicap(this.handicap);
      const limit = this.isChallengeMode ? this.currentReviewMoveIndex : this.currentReviewMoveIndex + 1;
      for (let i = 0; i < limit; i++) {
        const m = this.board.movesList[i];
        if (m.pass) tempBoard.pass(m.color);
        else if (m.resign) tempBoard.resign(m.color);
        else tempBoard.playMove(m.x, m.y, m.color);
      }
    }

    const ghostMoves: { point: Point; color: Color; step: number }[] = [];
    if (this.activeAlternative && !this.isChallengeMode) {
      ghostMoves.push({
        point: this.activeAlternative.point,
        color: ev.color,
        step: 1
      });
    }

    if (this.isSandboxMode && this.sandboxMoves.length > 0) {
      this.sandboxMoves.forEach(sm => ghostMoves.push(sm));
    }

    this.renderer.render(tempBoard, {
      theme: this.theme,
      showCoordinates: this.showCoordinates,
      showMoveNumbers: this.showMoveNumbers,
      showInfluenceMap: false,
      hoverPoint: this.hoverPoint,
      currentTurn: tempBoard.turn,
      lastMove: tempBoard.lastMove ? { x: tempBoard.lastMove.x, y: tempBoard.lastMove.y } : null,
      aiHint: null,
      reviewBadge: !this.isChallengeMode && !this.isSandboxMode && ev.playedMove ? { point: ev.playedMove, symbol: ev.badgeSymbol, color: ev.badgeColor } : null,
      reviewAlternatives: !this.isChallengeMode && !this.isSandboxMode ? ev.alternatives : [],
      variationGhostMoves: ghostMoves
    });
  }

  // -------------------------------------------------------------
  // REVIEW LIBRARY (PASTA REVISÃO & SGF PRESETS)
  // -------------------------------------------------------------

  public openReviewLibrary(): void {
    const modal = document.getElementById('modal-review-library')!;
    const listEl = document.getElementById('review-library-list')!;
    listEl.innerHTML = '';

    PRESET_REVIEW_GAMES.forEach((game) => {
      const card = document.createElement('div');
      card.className = 'review-game-card';
      card.innerHTML = `
        <div class="review-game-header">
          <span class="review-game-title">${game.title}</span>
          <span class="puzzle-badge badge-easy">${game.size}x${game.size}</span>
        </div>
        <div class="review-game-meta">
          <span class="review-game-meta-badge">⚫ ${game.blackPlayer} (${game.blackRank || '?'})</span>
          <span class="review-game-meta-badge">⚪ ${game.whitePlayer} (${game.whiteRank || '?'})</span>
          <span class="review-game-meta-badge">📅 ${game.date}</span>
          <span class="review-game-meta-badge" style="color: var(--accent-gold);">${game.result}</span>
        </div>
        <div class="review-game-desc">${game.description}</div>
        <div class="review-game-actions">
          <button class="btn btn-primary btn-sm btn-analyze-preset" style="flex: 1;">⚡ Analisar com IA</button>
          <button class="btn btn-secondary btn-sm btn-open-preset">👁️ Abrir no Tabuleiro</button>
        </div>
      `;

      card.querySelector('.btn-analyze-preset')?.addEventListener('click', () => {
        modal.classList.remove('show');
        this.loadPresetGame(game, true);
      });

      card.querySelector('.btn-open-preset')?.addEventListener('click', () => {
        modal.classList.remove('show');
        this.loadPresetGame(game, false);
      });

      listEl.appendChild(card);
    });

    modal.classList.add('show');
  }

  public loadPresetGame(preset: ReviewGamePreset, autoAnalyze: boolean = true): void {
    this.loadSgf(preset.sgfContent);
    if (autoAnalyze) {
      this.startPostGameReview();
    }
  }

  public handlePasteSgf(): void {
    const textarea = document.getElementById('paste-sgf-textarea') as HTMLTextAreaElement;
    const content = textarea.value.trim();
    if (!content) {
      alert('Por favor, cole o código SGF no campo.');
      return;
    }

    document.getElementById('modal-paste-sgf')?.classList.remove('show');
    this.loadSgf(content);
    this.startPostGameReview();
  }

  // -------------------------------------------------------------
  // INTERACTIVE SCORING PHASE
  // -------------------------------------------------------------

  private enterScoringPhase(): void {
    this.isScoringPhase = true;
    this.deadStones = GoScoring.autoDetectDeadStones(this.board);
    this.recalculateScoring();

    const modal = document.getElementById('modal-scoring')!;
    modal.classList.add('show');

    if (this.scoringResult.winner === 'black') {
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
      this.sound.playWinFanfare();
    }
  }

  private recalculateScoring(): void {
    this.scoringResult = GoScoring.calculateScore(
      this.board,
      this.deadStones,
      this.ruleSet,
      this.komi
    );

    const winnerTitle = document.getElementById('scoring-winner-title')!;
    const winnerDesc = document.getElementById('scoring-winner-desc')!;
    const scoreBlackTerritory = document.getElementById('score-black-territory')!;
    const scoreWhiteTerritory = document.getElementById('score-white-territory')!;
    const scoreBlackCaptures = document.getElementById('score-black-captures')!;
    const scoreWhiteCaptures = document.getElementById('score-white-captures')!;
    const scoreKomiVal = document.getElementById('score-komi-val')!;
    const scoreBlackTotal = document.getElementById('score-black-total')!;
    const scoreWhiteTotal = document.getElementById('score-white-total')!;

    scoreBlackTerritory.textContent = this.scoringResult.blackTerritory.toString();
    scoreWhiteTerritory.textContent = this.scoringResult.whiteTerritory.toString();
    scoreBlackCaptures.textContent = this.scoringResult.blackCaptures.toString();
    scoreWhiteCaptures.textContent = this.scoringResult.whiteCaptures.toString();
    scoreKomiVal.textContent = this.komi.toFixed(1);
    scoreBlackTotal.textContent = this.scoringResult.blackTotal.toFixed(1);
    scoreWhiteTotal.textContent = this.scoringResult.whiteTotal.toFixed(1);

    if (this.scoringResult.winner === 'black') {
      winnerTitle.textContent = '⚫ Vitória das Pretas!';
      winnerDesc.textContent = `Pretas venceram por ${this.scoringResult.margin.toFixed(1)} pontos.`;
    } else if (this.scoringResult.winner === 'white') {
      winnerTitle.textContent = '⚪ Vitória das Brancas!';
      winnerDesc.textContent = `Brancas venceram por ${this.scoringResult.margin.toFixed(1)} pontos.`;
    } else {
      winnerTitle.textContent = '🤝 Empate (Jigo)!';
      winnerDesc.textContent = 'Partida terminou rigorosamente empatada.';
    }
  }

  // -------------------------------------------------------------
  // REPLAY SYSTEM
  // -------------------------------------------------------------

  private stepReplay(delta: number): void {
    if (this.mode === 'review') {
      this.stepReview(delta);
      return;
    }

    if (this.board.movesList.length === 0) return;

    if (this.replayIndex === -1) {
      this.replayIndex = this.board.movesList.length;
    }

    const nextIdx = Math.max(0, Math.min(this.board.movesList.length, this.replayIndex + delta));
    this.jumpReplay(nextIdx);
  }

  private jumpReplay(index: number): void {
    if (this.mode === 'review') {
      if (!this.reviewReport) return;
      const targetIdx = index === -1 || index >= this.board.movesList.length
        ? this.board.movesList.length - 1
        : Math.max(0, index === 0 ? 0 : index - 1);
      this.selectReviewMove(targetIdx);
      return;
    }

    if (index === -1 || index >= this.board.movesList.length) {
      this.replayIndex = -1;
      this.updateUI();
      this.render();
      return;
    }

    this.replayIndex = index;
    const tempBoard = new GoBoard(this.boardSize);
    if (this.handicap >= 2) tempBoard.setHandicap(this.handicap);

    for (let i = 0; i < index; i++) {
      const m = this.board.movesList[i];
      if (m.pass) tempBoard.pass(m.color);
      else if (m.resign) tempBoard.resign(m.color);
      else tempBoard.playMove(m.x, m.y, m.color);
    }

    this.renderer.render(tempBoard, {
      theme: this.theme,
      showCoordinates: this.showCoordinates,
      showMoveNumbers: this.showMoveNumbers,
      showInfluenceMap: false,
      hoverPoint: null,
      currentTurn: tempBoard.turn,
      lastMove: tempBoard.lastMove ? { x: tempBoard.lastMove.x, y: tempBoard.lastMove.y } : null,
      aiHint: null
    });
  }

  private toggleAutoPlay(): void {
    if (this.autoPlayTimer) {
      clearInterval(this.autoPlayTimer);
      this.autoPlayTimer = null;
      document.getElementById('btn-replay-autoplay')!.textContent = '▶';
    } else {
      if (this.replayIndex === -1) this.replayIndex = 0;
      document.getElementById('btn-replay-autoplay')!.textContent = '⏸';
      this.autoPlayTimer = window.setInterval(() => {
        if (this.replayIndex >= this.board.movesList.length) {
          this.toggleAutoPlay();
          this.jumpReplay(-1);
        } else {
          this.stepReplay(1);
        }
      }, 700);
    }
  }

  // -------------------------------------------------------------
  // STUDY MODES (TSUMEGO & JOSEKI)
  // -------------------------------------------------------------

  private handleTabSwitch(tabName: string): void {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${tabName}`)?.classList.add('active');

    const specialCard = document.getElementById('special-mode-card')!;

    if (tabName === 'play') {
      this.mode = 'pve';
      this.setReviewModeUI(false);
      specialCard.style.display = 'none';
      this.startNewGame();
    } else if (tabName === 'review') {
      if (this.board.movesList.length > 0) {
        this.startPostGameReview();
      } else {
        this.openReviewLibrary();
      }
    } else if (tabName === 'tsumego') {
      this.mode = 'tsumego';
      this.setReviewModeUI(false);
      specialCard.style.display = 'block';
      this.showTsumegoSelection();
    } else if (tabName === 'joseki') {
      this.mode = 'joseki';
      this.setReviewModeUI(false);
      specialCard.style.display = 'block';
      this.showJosekiSelection();
    } else if (tabName === 'rules') {
      document.getElementById('modal-rules-guide')!.classList.add('show');
    }
  }

  private showTsumegoSelection(): void {
    const modal = document.getElementById('modal-study-list')!;
    const header = document.getElementById('modal-study-header')!;
    const content = document.getElementById('modal-study-content')!;

    header.innerHTML = '<span>🧩</span> Problemas de Tsumego (Vida e Morte)';
    content.innerHTML = '';

    TSUMEGO_PROBLEMS.forEach((prob, idx) => {
      const item = document.createElement('div');
      item.className = `puzzle-item ${idx === this.currentTsumegoIndex ? 'active' : ''}`;
      const badgeClass = prob.difficulty === 'Iniciante' ? 'badge-easy' : prob.difficulty === 'Intermediário' ? 'badge-medium' : 'badge-hard';
      item.innerHTML = `
        <div class="puzzle-header">
          <div class="puzzle-title">${prob.title}</div>
          <span class="puzzle-badge ${badgeClass}">${prob.difficulty}</span>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary);">${prob.description}</div>
      `;
      item.addEventListener('click', () => {
        this.loadTsumego(idx);
        modal.classList.remove('show');
      });
      content.appendChild(item);
    });

    modal.classList.add('show');
  }

  private loadTsumego(index: number): void {
    this.currentTsumegoIndex = index;
    const prob = TSUMEGO_PROBLEMS[index];
    this.currentTsumego = prob;
    this.tsumegoStepNode = prob.solutionTree;

    this.boardSize = prob.size;
    this.board.reset(prob.size);

    for (const st of prob.initialStones) {
      this.board.grid[st.y][st.x] = st.color;
    }
    this.board.turn = prob.playerColor;

    this.updateBoardSize(prob.size);

    document.getElementById('special-mode-title')!.textContent = prob.title;
    document.getElementById('special-mode-body')!.innerHTML = `
      <div style="margin-bottom: 8px;"><strong>Objetivo:</strong> ${prob.description}</div>
      <div style="color: var(--accent-gold); font-size: 12px;">💡 Dica: ${prob.hint}</div>
      <button class="btn btn-secondary btn-sm" id="btn-reset-tsumego" style="margin-top: 10px; width: 100%;">Reiniciar Problema</button>
    `;

    document.getElementById('btn-reset-tsumego')?.addEventListener('click', () => {
      this.loadTsumego(index);
    });

    this.statusText.textContent = `Sua vez (${prob.playerColor === 'black' ? 'Pretas' : 'Brancas'}). Encontre o ponto vital!`;
    this.updateUI();
    this.render();
  }

  private handleTsumegoMove(x: number, y: number): void {
    if (!this.currentTsumego || !this.tsumegoStepNode) return;

    if (x === this.tsumegoStepNode.x && y === this.tsumegoStepNode.y) {
      this.board.playMove(x, y, this.currentTsumego.playerColor);
      this.sound.playStoneClick();

      if (this.tsumegoStepNode.isCorrect) {
        confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 } });
        this.sound.playWinFanfare();
        this.statusText.textContent = '🎉 ' + (this.tsumegoStepNode.message || 'Problema Resolvido com Sucesso!');
      }
    } else {
      this.sound.playPass();
      this.statusText.textContent = '❌ Jogada incorreta. Tente outro ponto vital!';
    }

    this.render();
  }

  private showJosekiSelection(): void {
    const modal = document.getElementById('modal-study-list')!;
    const header = document.getElementById('modal-study-header')!;
    const content = document.getElementById('modal-study-content')!;

    header.innerHTML = '<span>📜</span> Dicionário e Explorador de Joseki';
    content.innerHTML = '';

    JOSEKI_PATTERNS.forEach((j, idx) => {
      const item = document.createElement('div');
      item.className = 'joseki-item';
      item.innerHTML = `
        <div class="puzzle-header">
          <div class="puzzle-title">${j.name}</div>
          <span class="puzzle-badge badge-easy">${j.category}</span>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary);">${j.description}</div>
      `;
      item.addEventListener('click', () => {
        this.loadJoseki(j);
        modal.classList.remove('show');
      });
      content.appendChild(item);
    });

    modal.classList.add('show');
  }

  private loadJoseki(joseki: JosekiNode): void {
    this.currentJoseki = joseki;
    this.josekiMoveIndex = 0;
    this.boardSize = 19;
    this.board.reset(19);

    this.updateBoardSize(19);

    document.getElementById('special-mode-title')!.textContent = joseki.name;
    document.getElementById('special-mode-body')!.innerHTML = `
      <div style="margin-bottom: 8px;">${joseki.description}</div>
      <div id="joseki-note" style="color: var(--accent-gold); font-size: 12px; margin-bottom: 10px;">Clique em Próximo Lance para avançar.</div>
      <div style="display: flex; gap: 6px;">
        <button class="btn btn-secondary btn-sm" id="btn-joseki-prev" style="flex: 1;">◀ Anterior</button>
        <button class="btn btn-primary btn-sm" id="btn-joseki-next" style="flex: 1;">Próximo ▶</button>
      </div>
    `;

    document.getElementById('btn-joseki-next')?.addEventListener('click', () => this.stepJoseki(1));
    document.getElementById('btn-joseki-prev')?.addEventListener('click', () => this.stepJoseki(-1));

    this.render();
  }

  private stepJoseki(delta: number): void {
    if (!this.currentJoseki) return;
    const nextIdx = Math.max(0, Math.min(this.currentJoseki.moves.length, this.josekiMoveIndex + delta));
    this.josekiMoveIndex = nextIdx;

    this.board.reset(19);
    for (let i = 0; i < nextIdx; i++) {
      const m = this.currentJoseki.moves[i];
      this.board.playMove(m.x, m.y, m.color);
    }
    this.sound.playStoneClick();

    const noteEl = document.getElementById('joseki-note');
    if (noteEl) {
      if (nextIdx > 0 && nextIdx <= this.currentJoseki.moves.length) {
        noteEl.textContent = `Lance ${nextIdx}: ${this.currentJoseki.moves[nextIdx - 1].note || ''}`;
      } else {
        noteEl.textContent = 'Início da variação.';
      }
    }

    this.render();
  }

  // -------------------------------------------------------------
  // SGF IMPORT
  // -------------------------------------------------------------

  public loadSgf(content: string): void {
    try {
      const parsed = SgfParser.parse(content);
      this.boardSize = parsed.size;
      this.board.reset(parsed.size);
      this.komi = parsed.komi;

      for (const pt of parsed.initialBlackStones) {
        this.board.grid[pt.y][pt.x] = 'black';
      }
      for (const pt of parsed.initialWhiteStones) {
        this.board.grid[pt.y][pt.x] = 'white';
      }

      for (const m of parsed.moves) {
        if (m.pass) this.board.pass(m.color);
        else this.board.playMove(m.x, m.y, m.color);
      }

      this.updateBoardSize(parsed.size);
      this.updateUI();
      this.render();
      this.statusText.textContent = `SGF carregado com sucesso (${parsed.moves.length} lances)!`;
    } catch (e) {
      alert('Erro ao carregar o arquivo SGF.');
    }
  }

  // -------------------------------------------------------------
  // CLOCK SYSTEM
  // -------------------------------------------------------------

  private resetClocks(): void {
    const mainSeconds = this.clockType === 'fischer' ? 300 : this.clockType === 'absolute' ? 900 : 600;
    this.blackClock = {
      mainTimeRemaining: mainSeconds,
      byoyomiPeriodsRemaining: 3,
      byoyomiCurrentTime: 30,
      isInByoyomi: false
    };
    this.whiteClock = {
      mainTimeRemaining: mainSeconds,
      byoyomiPeriodsRemaining: 3,
      byoyomiCurrentTime: 30,
      isInByoyomi: false
    };
  }

  private startClockLoop(): void {
    if (this.clockInterval) clearInterval(this.clockInterval);

    this.clockInterval = window.setInterval(() => {
      if (this.board.isGameOver || this.clockType === 'none' || this.isScoringPhase || this.mode === 'review') return;

      const activeClock = this.board.turn === 'black' ? this.blackClock : this.whiteClock;

      if (!activeClock.isInByoyomi) {
        if (activeClock.mainTimeRemaining > 0) {
          activeClock.mainTimeRemaining--;
        } else {
          if (this.clockType === 'byoyomi') {
            activeClock.isInByoyomi = true;
            activeClock.byoyomiCurrentTime = 30;
          } else {
            this.handleTimeout(this.board.turn);
          }
        }
      } else {
        if (activeClock.byoyomiCurrentTime > 0) {
          activeClock.byoyomiCurrentTime--;
          if (activeClock.byoyomiCurrentTime <= 5) {
            this.sound.playTimerWarning();
          }
        } else {
          activeClock.byoyomiPeriodsRemaining--;
          if (activeClock.byoyomiPeriodsRemaining <= 0) {
            this.handleTimeout(this.board.turn);
          } else {
            activeClock.byoyomiCurrentTime = 30;
          }
        }
      }

      this.updateClockDisplays();
    }, 1000);
  }

  private handleTimeout(timedOutColor: Color): void {
    this.board.resign(timedOutColor);
    const winner = timedOutColor === 'black' ? 'Brancas' : 'Pretas';
    this.statusText.textContent = `Tempo esgotado! ${winner} venceram a partida.`;
    this.updateUI();
    this.render();
  }

  private formatTime(clock: PlayerClock): string {
    if (this.clockType === 'none') return '∞';
    if (!clock.isInByoyomi) {
      const min = Math.floor(clock.mainTimeRemaining / 60);
      const sec = clock.mainTimeRemaining % 60;
      return `${min}:${sec < 10 ? '0' : ''}${sec}`;
    } else {
      return `${clock.byoyomiCurrentTime}s (${clock.byoyomiPeriodsRemaining}x)`;
    }
  }

  private updateClockDisplays(): void {
    this.timerBlack.textContent = this.formatTime(this.blackClock);
    this.timerWhite.textContent = this.formatTime(this.whiteClock);

    this.timerBlack.classList.toggle('warning', this.blackClock.isInByoyomi && this.blackClock.byoyomiCurrentTime <= 5);
    this.timerWhite.classList.toggle('warning', this.whiteClock.isInByoyomi && this.whiteClock.byoyomiCurrentTime <= 5);
  }

  // -------------------------------------------------------------
  // UI UPDATES & RENDERING
  // -------------------------------------------------------------

  public updateUI(): void {
    const isBlackTurn = this.board.turn === 'black';
    this.cardBlack.classList.toggle('active-turn', isBlackTurn && !this.board.isGameOver);
    this.cardWhite.classList.toggle('active-turn', !isBlackTurn && !this.board.isGameOver);

    this.capturesBlack.textContent = `Prisioneiros: ${this.board.captures.black}`;
    this.capturesWhite.textContent = `Prisioneiros: ${this.board.captures.white} (+${this.komi.toFixed(1)} Komi)`;

    this.moveCountBadge.textContent = `${this.board.movesList.length} lances`;

    if (!this.board.isGameOver && this.mode !== 'review') {
      const turnLabel = isBlackTurn ? 'Pretas' : 'Brancas';
      this.statusText.textContent = `Vez das ${turnLabel} (Jogada ${this.board.movesList.length + 1})`;
    }

    const inf = InfluenceMap.calculate(this.board, 4);
    this.estBlackPts.textContent = `${inf.blackEstimate} pts`;
    this.estWhitePts.textContent = `${(inf.whiteEstimate + this.komi).toFixed(1)} pts`;

    const totalEst = inf.blackEstimate + inf.whiteEstimate + 1;
    const blackWinRatePct = Math.round(Math.max(5, Math.min(95, (inf.blackEstimate / totalEst) * 100)));
    const whiteWinRatePct = 100 - blackWinRatePct;

    this.evalBarBlack.style.width = `${blackWinRatePct}%`;
    this.evalBlackPct.textContent = `Pretas: ${blackWinRatePct}%`;
    this.evalWhitePct.textContent = `Brancas: ${whiteWinRatePct}%`;

    if (Math.abs(blackWinRatePct - 50) < 5) {
      this.evalLead.textContent = 'Equilibrado';
    } else if (blackWinRatePct > 50) {
      this.evalLead.textContent = `Pretas lideram (+${(blackWinRatePct - 50) * 0.4} pts)`;
    } else {
      this.evalLead.textContent = `Brancas lideram (+${(whiteWinRatePct - 50) * 0.4} pts)`;
    }

    this.moveHistoryList.innerHTML = '';
    this.board.movesList.forEach((m, idx) => {
      const entry = document.createElement('div');
      const isActive = this.replayIndex === idx + 1 || (this.mode === 'review' && this.currentReviewMoveIndex === idx);
      entry.className = `move-entry ${isActive ? 'active' : ''}`;
      const letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
      const coordStr = m.pass ? 'Passou' : m.resign ? 'Desistiu' : `${letters[m.x]}${this.boardSize - m.y}`;

      let evalDotHtml = '';
      if (this.mode === 'review' && this.reviewReport && this.reviewReport.evaluations[idx]) {
        const ev = this.reviewReport.evaluations[idx];
        evalDotHtml = `<span class="move-eval-dot dot-${ev.classification}" title="${ev.labelPt}"></span>`;
      }

      entry.innerHTML = `
        <div style="display: flex; align-items: center; gap: 4px;">
          <span style="color: var(--text-muted); font-size: 11px; width: 22px;">${idx + 1}.</span>
          <span style="font-size: 11px;">${m.color === 'black' ? '⚫' : '⚪'}</span>
          <strong style="color: var(--text-primary); font-size: 11px;">${coordStr}</strong>
        </div>
        ${evalDotHtml}
      `;

      entry.addEventListener('click', () => {
        if (this.mode === 'review') {
          this.selectReviewMove(idx);
        } else {
          this.jumpReplay(idx + 1);
        }
      });
      this.moveHistoryList.appendChild(entry);

      if (isActive && this.mode === 'review') {
        setTimeout(() => entry.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 10);
      }
    });

    if (this.replayIndex === -1 && this.mode !== 'review') {
      this.moveHistoryList.scrollTop = this.moveHistoryList.scrollHeight;
    }
    this.updateClockDisplays();
  }

  public render(): void {
    if (this.replayIndex !== -1 || this.mode === 'review') return;

    const inf = this.showInfluenceMap ? InfluenceMap.calculate(this.board, 4) : undefined;

    this.renderer.render(this.board, {
      theme: this.theme,
      showCoordinates: this.showCoordinates,
      showMoveNumbers: this.showMoveNumbers,
      showInfluenceMap: this.showInfluenceMap,
      influenceMatrix: inf?.matrix,
      influenceOwnership: inf?.ownership,
      hoverPoint: this.hoverPoint,
      currentTurn: this.board.turn,
      lastMove: this.board.lastMove ? { x: this.board.lastMove.x, y: this.board.lastMove.y } : null,
      aiHint: this.aiHint,
      deadStones: this.deadStones,
      territoryMap: this.scoringResult?.territoryMap,
      isScoringPhase: this.isScoringPhase
    });
  }
}

// Bootstrap on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  new App();
});
