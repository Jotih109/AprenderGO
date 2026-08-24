import {
  AlternativeMove,
  BoardSize,
  BoardTheme,
  Color,
  GameMode,
  GameReviewReport,
  JosekiNode,
  Move,
  MoveClassificationType,
  Point,
  RuleSet,
  TerritoryScore,
  TsumegoNode,
  TsumegoProblem
} from '../types/go';
import { GoBoard } from '../core/GoBoard';
import { InfluenceMap } from '../core/InfluenceMap';
import { GoScoring } from '../core/GoScoring';
import { SoundEffects } from '../audio/SoundEffects';
import { BotManager } from '../ai/BotManager';
import { BoardRenderer } from './BoardRenderer';
import { GameReviewer, ReviewCancelledError } from '../ai/GameReviewer';
import { TSUMEGO_PROBLEMS } from '../data/tsumegoData';
import { JOSEKI_PATTERNS } from '../data/josekiData';
import { PRESET_REVIEW_GAMES, ReviewGamePreset } from '../data/reviewGamesData';
import { SgfParser } from '../sgf/SgfParser';
import confetti from 'canvas-confetti';

type ClockType = 'none' | 'byoyomi' | 'fischer' | 'absolute';

interface ClockPreset {
  mainSeconds: number;
  byoyomiPeriods: number;
  byoyomiSeconds: number;
  fischerIncrement: number;
}

/** Kept in step with the labels in the new-game dialog. */
const CLOCK_PRESETS: Record<ClockType, ClockPreset> = {
  none: { mainSeconds: 0, byoyomiPeriods: 0, byoyomiSeconds: 0, fischerIncrement: 0 },
  byoyomi: { mainSeconds: 600, byoyomiPeriods: 3, byoyomiSeconds: 30, fischerIncrement: 0 },
  fischer: { mainSeconds: 300, byoyomiPeriods: 0, byoyomiSeconds: 0, fischerIncrement: 5 },
  absolute: { mainSeconds: 900, byoyomiPeriods: 0, byoyomiSeconds: 0, fischerIncrement: 0 }
};

interface PlayerClockState {
  mainTimeRemaining: number;
  byoyomiPeriodsRemaining: number;
  byoyomiCurrentTime: number;
  isInByoyomi: boolean;
}

interface PersistedSettings {
  theme: BoardTheme;
  soundEnabled: boolean;
  showCoordinates: boolean;
  showMoveNumbers: boolean;
  botLevel: number;
  boardSize: BoardSize;
  clockType: ClockType;
  ruleSet: RuleSet;
}

const SETTINGS_KEY = 'goMaster.settings.v2';
const COLUMN_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

/** The game currently loaded into review mode, independent of the live board. */
interface ReviewSource {
  size: BoardSize;
  komi: number;
  setupStones: { x: number; y: number; color: Color }[];
  moves: Move[];
}

export class App {
  // Core components
  private board: GoBoard;
  private renderer: BoardRenderer;
  private sound: SoundEffects;
  private botManager: BotManager;

  // Settings and modes
  private mode: GameMode = 'pve';
  private playerColor: Color = 'black';
  private botLevel = 3;
  private boardSize: BoardSize = 19;
  private theme: BoardTheme = 'kaya';
  private komi = 6.5;
  private ruleSet: RuleSet = 'japanese';
  private handicap = 0;

  // Visual overlays
  private showCoordinates = true;
  private showMoveNumbers = false;
  private showInfluenceMap = false;
  private hoverPoint: Point | null = null;
  private aiHint: { point: Point; winRate?: number } | null = null;

  // Clocks
  private clockType: ClockType = 'byoyomi';
  private blackClock: PlayerClockState = App.freshClock('byoyomi');
  private whiteClock: PlayerClockState = App.freshClock('byoyomi');
  private clockInterval: number | null = null;
  private clockLastTick = 0;

  // Scoring phase
  private isScoringPhase = false;
  private deadStones = new Set<string>();
  private scoringResult: TerritoryScore | null = null;

  // Study modules
  private currentTsumegoIndex = 0;
  private currentTsumego: TsumegoProblem | null = null;
  private tsumegoStepNode: TsumegoNode | null = null;
  private currentJoseki: JosekiNode | null = null;
  private josekiMoveIndex = 0;

  // Replay and review
  private replayIndex = -1; // -1 means the live position
  private autoPlayTimer: number | null = null;
  private reviewReport: GameReviewReport | null = null;
  private reviewSource: ReviewSource | null = null;
  private currentReviewMoveIndex = 0;
  private activeAlternative: AlternativeMove | null = null;
  private reviewCancelled = false;

  // Variation sandbox and blunder challenge
  private isSandboxMode = false;
  private sandboxBoard: GoBoard | null = null;
  private sandboxMoves: { point: Point; color: Color; step: number }[] = [];
  private isChallengeMode = false;
  private challengeTargetPoint: Point | null = null;

  /**
   * Guards against a search finishing after the position it was asked about is
   * gone (new game, undo, mode switch).
   */
  private botThinking = false;
  private renderHandle = 0;
  private influenceCache: { key: string; result: ReturnType<typeof InfluenceMap.calculate> } | null = null;
  /**
   * Replaying a game from move zero costs one playMove per move, and rendering
   * happens on every hover frame, so the reconstructed board is cached and only
   * rebuilt when the position being shown actually changes.
   */
  private replayBoardCache: { key: string; board: GoBoard } | null = null;

  // DOM elements
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
    this.loadSettings();

    this.board = new GoBoard(this.boardSize);
    this.sound = new SoundEffects();
    this.botManager = new BotManager();

    this.canvas = this.requireElement<HTMLCanvasElement>('go-board');
    this.chartCanvas = this.requireElement<HTMLCanvasElement>('winrate-chart');
    this.renderer = new BoardRenderer(this.canvas);

    this.cardBlack = this.requireElement('card-black');
    this.cardWhite = this.requireElement('card-white');
    this.timerBlack = this.requireElement('timer-black');
    this.timerWhite = this.requireElement('timer-white');
    this.capturesBlack = this.requireElement('captures-black');
    this.capturesWhite = this.requireElement('captures-white');
    this.statusText = this.requireElement('status-text');
    this.evalBarBlack = this.requireElement('eval-bar-black');
    this.evalBlackPct = this.requireElement('eval-black-pct');
    this.evalWhitePct = this.requireElement('eval-white-pct');
    this.evalLead = this.requireElement('eval-lead');
    this.estBlackPts = this.requireElement('est-black-pts');
    this.estWhitePts = this.requireElement('est-white-pts');
    this.moveHistoryList = this.requireElement('move-history-list');
    this.moveCountBadge = this.requireElement('move-count-badge');

    this.applySettingsToControls();
    this.updatePlayerNames();
    this.initLayout();
    this.bindEvents();
    this.resetClocks();
    this.startClockLoop();
    this.updateBoardSize();
    this.updateUI();
  }

  private requireElement<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id) as T | null;
    if (!el) throw new Error(`Elemento obrigatório ausente no HTML: #${id}`);
    return el;
  }

  private static freshClock(type: ClockType): PlayerClockState {
    const preset = CLOCK_PRESETS[type];
    return {
      mainTimeRemaining: preset.mainSeconds,
      byoyomiPeriodsRemaining: preset.byoyomiPeriods,
      byoyomiCurrentTime: preset.byoyomiSeconds,
      isInByoyomi: false
    };
  }

  // -------------------------------------------------------------
  // SETTINGS PERSISTENCE
  // -------------------------------------------------------------

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<PersistedSettings>;
      if (s.theme) this.theme = s.theme;
      if (typeof s.showCoordinates === 'boolean') this.showCoordinates = s.showCoordinates;
      if (typeof s.showMoveNumbers === 'boolean') this.showMoveNumbers = s.showMoveNumbers;
      if (typeof s.botLevel === 'number') this.botLevel = s.botLevel;
      if (s.boardSize === 9 || s.boardSize === 13 || s.boardSize === 19) this.boardSize = s.boardSize;
      if (s.clockType) this.clockType = s.clockType;
      if (s.ruleSet) this.ruleSet = s.ruleSet;
      if (typeof s.soundEnabled === 'boolean') this.pendingSoundEnabled = s.soundEnabled;
    } catch {
      // Corrupt or unavailable storage is not worth interrupting startup for.
    }
  }

  private pendingSoundEnabled: boolean | null = null;

  private saveSettings(): void {
    try {
      const settings: PersistedSettings = {
        theme: this.theme,
        soundEnabled: this.sound.enabled,
        showCoordinates: this.showCoordinates,
        showMoveNumbers: this.showMoveNumbers,
        botLevel: this.botLevel,
        boardSize: this.boardSize,
        clockType: this.clockType,
        ruleSet: this.ruleSet
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Ignore quota or privacy-mode failures.
    }
  }

  private applySettingsToControls(): void {
    if (this.pendingSoundEnabled !== null) {
      this.sound.enabled = this.pendingSoundEnabled;
      const icon = document.getElementById('sound-icon');
      if (icon) icon.textContent = this.sound.enabled ? '🔊' : '🔇';
    }

    const themeSelect = document.getElementById('theme-select') as HTMLSelectElement | null;
    if (themeSelect) themeSelect.value = this.theme;

    const levelSelect = document.getElementById('select-bot-level') as HTMLSelectElement | null;
    if (levelSelect) levelSelect.value = String(this.botLevel);

    const clockSelect = document.getElementById('select-clock-type') as HTMLSelectElement | null;
    if (clockSelect) clockSelect.value = this.clockType;

    this.setSegmentedVal('control-board-size', String(this.boardSize));
  }

  // -------------------------------------------------------------
  // LAYOUT
  // -------------------------------------------------------------

  private initLayout(): void {
    const wrapper = document.querySelector('.board-container-wrapper');
    if (wrapper && typeof ResizeObserver !== 'undefined') {
      // Reacts to sidebars showing and hiding, not just to window resizes.
      const observer = new ResizeObserver(() => this.updateBoardSize());
      observer.observe(wrapper);
    }
    window.addEventListener('resize', () => this.updateBoardSize());
  }

  public updateBoardSize(newSize?: BoardSize): void {
    if (newSize) this.boardSize = newSize;

    const wrapper = document.querySelector('.board-container-wrapper') as HTMLElement | null;
    const isReview = this.mode === 'review';
    const quickBar = document.getElementById(isReview ? 'review-quick-controls' : 'board-quick-controls');
    const timelineCard = isReview ? document.getElementById('winrate-chart-card') : null;

    const timelineHeight = timelineCard && timelineCard.style.display !== 'none' ? timelineCard.offsetHeight + 10 : 0;
    const quickBarHeight = quickBar && quickBar.style.display !== 'none' ? quickBar.offsetHeight + 10 : 46;
    const availableHeight = window.innerHeight - 64 - quickBarHeight - timelineHeight - 24;
    const availableWidth = wrapper && wrapper.clientWidth > 100 ? wrapper.clientWidth - 16 : window.innerWidth - 96;

    const targetDim = Math.max(280, Math.min(availableWidth, availableHeight, 1080));

    this.renderer.resize(targetDim, targetDim, this.boardSize);
    this.render();
    if (isReview) this.drawWinRateChart();
  }

  // -------------------------------------------------------------
  // EVENT BINDING
  // -------------------------------------------------------------

  private bindEvents(): void {
    this.canvas.addEventListener('mousemove', (e) => {
      const pt = this.renderer.screenToBoard(e.clientX, e.clientY);
      const changed = (pt?.x ?? -1) !== (this.hoverPoint?.x ?? -1) || (pt?.y ?? -1) !== (this.hoverPoint?.y ?? -1);
      if (!changed) return;
      this.hoverPoint = pt;
      this.scheduleRender();
    });

    this.canvas.addEventListener('mouseleave', () => {
      if (!this.hoverPoint) return;
      this.hoverPoint = null;
      this.scheduleRender();
    });

    this.canvas.addEventListener('click', (e) => {
      const pt = this.renderer.screenToBoard(e.clientX, e.clientY);
      if (pt) this.handleBoardClick(pt.x, pt.y);
    });

    const themeSelect = document.getElementById('theme-select') as HTMLSelectElement | null;
    themeSelect?.addEventListener('change', (e) => {
      this.theme = (e.target as HTMLSelectElement).value as BoardTheme;
      this.saveSettings();
      this.render();
    });

    document.getElementById('btn-sound-toggle')?.addEventListener('click', () => {
      this.sound.enabled = !this.sound.enabled;
      const icon = document.getElementById('sound-icon');
      if (icon) icon.textContent = this.sound.enabled ? '🔊' : '🔇';
      this.saveSettings();
    });

    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const mode = (e.currentTarget as HTMLElement).dataset.mode;
        void this.handleTabSwitch(mode || 'play');
      });
    });

    // Quick action bar
    document.getElementById('btn-undo')?.addEventListener('click', () => this.handleUndo());
    document.getElementById('btn-pass')?.addEventListener('click', () => this.handlePass());
    document.getElementById('btn-resign')?.addEventListener('click', () => this.handleResign());
    document.getElementById('btn-hint')?.addEventListener('click', () => void this.handleRequestHint());

    document.getElementById('btn-toggle-influence')?.addEventListener('click', () => {
      this.showInfluenceMap = !this.showInfluenceMap;
      const btn = document.getElementById('btn-toggle-influence');
      btn?.classList.toggle('btn-primary', this.showInfluenceMap);
      btn?.classList.toggle('btn-secondary', !this.showInfluenceMap);
      this.render();
    });

    const toggleNumbers = () => {
      this.showMoveNumbers = !this.showMoveNumbers;
      this.saveSettings();
      this.render();
    };
    const toggleCoords = () => {
      this.showCoordinates = !this.showCoordinates;
      this.saveSettings();
      this.render();
    };
    document.getElementById('btn-toggle-numbers')?.addEventListener('click', toggleNumbers);
    document.getElementById('btn-toggle-coords')?.addEventListener('click', toggleCoords);
    document.getElementById('btn-review-toggle-numbers')?.addEventListener('click', toggleNumbers);
    document.getElementById('btn-review-toggle-coords')?.addEventListener('click', toggleCoords);

    // Library and SGF paste
    document.getElementById('btn-open-library-quick')?.addEventListener('click', () => this.openReviewLibrary());
    document.getElementById('btn-open-library-sidebar')?.addEventListener('click', () => this.openReviewLibrary());
    document.getElementById('btn-review-open-library')?.addEventListener('click', () => this.openReviewLibrary());
    document.getElementById('btn-paste-sgf-trigger')?.addEventListener('click', () => this.openModal('modal-paste-sgf'));
    document.getElementById('btn-library-paste-trigger')?.addEventListener('click', () => {
      this.closeModal('modal-review-library');
      this.openModal('modal-paste-sgf');
    });
    document.getElementById('btn-submit-paste-sgf')?.addEventListener('click', () => void this.handlePasteSgf());

    // Review controls
    document.getElementById('btn-review-trigger')?.addEventListener('click', () => void this.startPostGameReview());
    document.getElementById('btn-modal-start-review')?.addEventListener('click', () => {
      this.closeModal('modal-scoring');
      void this.startPostGameReview();
    });
    document.getElementById('btn-cancel-review')?.addEventListener('click', () => {
      this.reviewCancelled = true;
    });
    document.getElementById('btn-review-next-blunder')?.addEventListener('click', () => this.stepBlunder(1));
    document.getElementById('btn-review-prev-blunder')?.addEventListener('click', () => this.stepBlunder(-1));
    document.getElementById('btn-review-sandbox-toggle')?.addEventListener('click', () => this.toggleSandboxMode());
    document.getElementById('btn-review-challenge')?.addEventListener('click', () => this.startBlunderChallenge());

    // Replay transport
    document.getElementById('btn-replay-start')?.addEventListener('click', () => this.jumpReplay(0));
    document.getElementById('btn-replay-prev')?.addEventListener('click', () => this.stepReplay(-1));
    document.getElementById('btn-replay-next')?.addEventListener('click', () => this.stepReplay(1));
    document.getElementById('btn-replay-end')?.addEventListener('click', () => this.jumpReplay(-1));
    document.getElementById('btn-replay-autoplay')?.addEventListener('click', () => this.toggleAutoPlay());

    this.bindSgfTools();
    this.bindNewGameModal();
    this.bindModalDismissal();
    this.bindKeyboard();

    this.chartCanvas.addEventListener('click', (e) => {
      if (!this.reviewReport || this.reviewReport.evaluations.length === 0) return;
      const rect = this.chartCanvas.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.selectReviewMove(Math.round(pct * (this.reviewReport.evaluations.length - 1)));
    });
  }

  private bindSgfTools(): void {
    document.getElementById('btn-export-sgf')?.addEventListener('click', () => {
      const botName = `Bot Nv.${this.botLevel}`;
      const blackName = this.mode === 'pve' && this.playerColor === 'white' ? botName : this.mode === 'eve' ? botName : 'Humano';
      const whiteName = this.mode === 'pve' && this.playerColor === 'black' ? botName : this.mode === 'eve' ? botName : 'Humano';
      const result = this.scoringResult
        ? `${this.scoringResult.winner === 'black' ? 'B' : 'W'}+${this.scoringResult.margin.toFixed(1)}`
        : '';
      const sgf = SgfParser.generate(this.board, blackName, whiteName, this.komi, this.ruleSet, result);
      SgfParser.downloadSgf(sgf, `partida_go_${new Date().toISOString().slice(0, 10)}.sgf`);
    });

    const fileInput = document.getElementById('sgf-file-input') as HTMLInputElement | null;
    document.getElementById('btn-import-sgf-trigger')?.addEventListener('click', () => fileInput?.click());
    document.getElementById('btn-library-upload-trigger')?.addEventListener('click', () => {
      this.closeModal('modal-review-library');
      fileInput?.click();
    });

    fileInput?.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const content = String(evt.target?.result ?? '');
        if (this.loadSgf(content)) void this.startPostGameReview();
      };
      reader.onerror = () => this.showStatus('Não foi possível ler o arquivo selecionado.', '⚠️');
      reader.readAsText(file);
      // Allow re-selecting the same file later.
      input.value = '';
    });

    document.getElementById('btn-export-png')?.addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = `goban_${new Date().toISOString().slice(0, 10)}.png`;
      link.href = this.canvas.toDataURL('image/png');
      link.click();
    });
  }

  private bindNewGameModal(): void {
    document.getElementById('btn-new-game-modal')?.addEventListener('click', () => this.openModal('modal-new-game'));

    this.bindSegmentedControl('control-game-mode', (val) => {
      const isPve = val === 'pve';
      const levelGroup = document.getElementById('group-bot-level');
      const colorGroup = document.getElementById('group-player-color');
      if (levelGroup) levelGroup.style.display = isPve || val === 'eve' ? 'block' : 'none';
      if (colorGroup) colorGroup.style.display = isPve ? 'block' : 'none';
    });
    this.bindSegmentedControl('control-player-color');
    this.bindSegmentedControl('control-board-size');

    document.getElementById('btn-start-new-game')?.addEventListener('click', () => {
      const modeVal = (this.getSegmentedVal('control-game-mode') || 'pve') as GameMode;
      const colorVal = this.getSegmentedVal('control-player-color') || 'black';
      const sizeVal = (parseInt(this.getSegmentedVal('control-board-size'), 10) || 19) as BoardSize;
      const levelSelect = document.getElementById('select-bot-level') as HTMLSelectElement | null;
      const handicapSelect = document.getElementById('select-handicap') as HTMLSelectElement | null;
      const clockSelect = document.getElementById('select-clock-type') as HTMLSelectElement | null;

      this.mode = modeVal;
      this.boardSize = sizeVal;
      this.botLevel = parseInt(levelSelect?.value ?? '3', 10) || 3;
      this.handicap = parseInt(handicapSelect?.value ?? '0', 10) || 0;
      this.clockType = (clockSelect?.value as ClockType) || 'byoyomi';
      this.playerColor = colorVal === 'random' ? (Math.random() < 0.5 ? 'black' : 'white') : (colorVal as Color);

      this.saveSettings();
      this.closeModal('modal-new-game');
      this.startNewGame();
    });

    document.getElementById('btn-scoring-new-game')?.addEventListener('click', () => {
      this.closeModal('modal-scoring');
      this.openModal('modal-new-game');
    });
    document.getElementById('btn-scoring-review')?.addEventListener('click', () => this.closeModal('modal-scoring'));
  }

  /** Close buttons, backdrop clicks and Escape all dismiss modals. */
  private bindModalDismissal(): void {
    document.querySelectorAll<HTMLElement>('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('mousedown', (e) => {
        // Only a click on the backdrop itself, not on the dialog inside it.
        if (e.target === backdrop && backdrop.id !== 'modal-review-progress') {
          backdrop.classList.remove('show');
        }
      });
      backdrop.querySelectorAll<HTMLElement>('.modal-close-btn, [id$="-close"]').forEach(btn => {
        btn.addEventListener('click', () => backdrop.classList.remove('show'));
      });
    });

    document.getElementById('btn-cancel-new-game')?.addEventListener('click', () => this.closeModal('modal-new-game'));
    document.getElementById('btn-cancel-paste-sgf')?.addEventListener('click', () => this.closeModal('modal-paste-sgf'));
    document.getElementById('btn-close-rules')?.addEventListener('click', () => this.closeModal('modal-rules-guide'));
  }

  private openModal(id: string): void {
    document.getElementById(id)?.classList.add('show');
  }

  private closeModal(id: string): void {
    document.getElementById(id)?.classList.remove('show');
  }

  private isAnyModalOpen(): boolean {
    return document.querySelector('.modal-backdrop.show') !== null;
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.code === 'Escape') {
        const open = document.querySelector('.modal-backdrop.show');
        if (open && open.id !== 'modal-review-progress') {
          open.classList.remove('show');
          e.preventDefault();
        }
        return;
      }

      // Shortcuts stay out of the way while a dialog has focus.
      if (this.isAnyModalOpen()) return;

      const inReview = this.mode === 'review';

      switch (e.code) {
        case 'Space':
          if (!inReview) {
            e.preventDefault();
            this.handlePass();
          }
          break;
        case 'KeyU':
          if (!inReview) {
            e.preventDefault();
            this.handleUndo();
          }
          break;
        case 'KeyZ':
          if ((e.ctrlKey || e.metaKey) && !inReview) {
            e.preventDefault();
            this.handleUndo();
          }
          break;
        case 'KeyH':
          if (!inReview) {
            e.preventDefault();
            void this.handleRequestHint();
          }
          break;
        case 'KeyT':
          e.preventDefault();
          this.showInfluenceMap = !this.showInfluenceMap;
          this.render();
          break;
        case 'KeyB':
          if (inReview) {
            e.preventDefault();
            this.stepBlunder(1);
          }
          break;
        case 'KeyS':
          if (inReview) {
            e.preventDefault();
            this.toggleSandboxMode();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.stepReplay(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.stepReplay(1);
          break;
        case 'Home':
          e.preventDefault();
          this.jumpReplay(0);
          break;
        case 'End':
          e.preventDefault();
          this.jumpReplay(-1);
          break;
        default:
          break;
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
        callback?.(target.dataset.val || '');
      });
    });
  }

  private getSegmentedVal(containerId: string): string {
    const active = document.getElementById(containerId)?.querySelector('.segmented-btn.active') as HTMLElement | null;
    return active?.dataset.val || '';
  }

  private setSegmentedVal(containerId: string, value: string): void {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll<HTMLElement>('.segmented-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === value);
    });
  }

  // -------------------------------------------------------------
  // GAME LIFECYCLE
  // -------------------------------------------------------------

  public startNewGame(): void {
    // Any search still running belongs to the previous position.
    this.botManager.cancelPending();
    this.botThinking = false;
    this.stopAutoPlay();

    this.isScoringPhase = false;
    this.deadStones.clear();
    this.scoringResult = null;
    this.aiHint = null;
    this.replayIndex = -1;
    this.reviewReport = null;
    this.reviewSource = null;
    this.activeAlternative = null;
    this.isSandboxMode = false;
    this.isChallengeMode = false;
    this.influenceCache = null;
    this.replayBoardCache = null;

    this.board.reset(this.boardSize);
    // Handicap compensation: white keeps only the half point that breaks ties.
    this.komi = this.handicap >= 2 ? 0.5 : this.boardSize === 9 ? 5.5 : 6.5;
    if (this.handicap >= 2) this.board.setHandicap(this.handicap);

    this.setReviewModeUI(false);
    this.resetClocks();
    this.updatePlayerNames();
    this.updateBoardSize(this.boardSize);
    this.updateUI();
    void this.checkTriggerBotMove();
  }

  private updatePlayerNames(): void {
    const nameBlack = document.getElementById('name-black');
    const nameWhite = document.getElementById('name-white');
    if (!nameBlack || !nameWhite) return;

    const botLabel = `Bot Nv. ${this.botLevel}`;
    if (this.mode === 'eve') {
      nameBlack.textContent = `Pretas (${botLabel})`;
      nameWhite.textContent = `Brancas (${botLabel})`;
    } else if (this.mode === 'pve') {
      nameBlack.textContent = this.playerColor === 'black' ? 'Pretas (Você)' : `Pretas (${botLabel})`;
      nameWhite.textContent = this.playerColor === 'white' ? 'Brancas (Você)' : `Brancas (${botLabel})`;
    } else {
      nameBlack.textContent = 'Pretas (Humano)';
      nameWhite.textContent = 'Brancas (Humano)';
    }
  }

  private handleBoardClick(x: number, y: number): void {
    if (this.isScoringPhase) {
      this.toggleDeadGroup(x, y);
      return;
    }

    if (this.mode === 'review') {
      this.handleReviewClick(x, y);
      return;
    }

    if (this.board.isGameOver) return;

    if (this.mode === 'tsumego') {
      this.handleTsumegoMove(x, y);
      return;
    }

    if (this.mode === 'joseki') return; // the joseki explorer is driven by its buttons
    if (this.mode === 'eve') return;
    if (this.mode === 'pve' && (this.botThinking || this.board.turn !== this.playerColor)) return;

    // Clicking while reviewing an earlier position jumps back to live play.
    if (this.replayIndex !== -1) {
      this.replayIndex = -1;
      this.render();
      return;
    }

    const result = this.board.playMove(x, y, this.board.turn);
    if (!result.success) {
      if (result.reason) this.showStatus(result.reason, '⚠️');
      return;
    }

    this.sound.playStoneClick();
    if (result.move?.captured?.length) this.sound.playCapture();
    this.applyFischerIncrement(result.move!.color);
    this.aiHint = null;
    this.onMovePlayed();
  }

  private toggleDeadGroup(x: number, y: number): void {
    if (!this.board.grid[y][x]) return;
    const group = this.board.getGroup(x, y);
    if (!group) return;

    const isDead = this.deadStones.has(`${x},${y}`);
    for (const pt of group.points) {
      const key = `${pt.x},${pt.y}`;
      if (isDead) this.deadStones.delete(key);
      else this.deadStones.add(key);
    }
    this.sound.playStoneClick();
    this.recalculateScoring();
    this.render();
  }

  private onMovePlayed(): void {
    this.influenceCache = null;
    this.replayBoardCache = null;
    this.updateUI();
    this.render();

    if (this.board.consecutivePasses >= 2 || this.board.isGameOver) {
      this.enterScoringPhase();
      return;
    }

    void this.checkTriggerBotMove();
  }

  private async checkTriggerBotMove(): Promise<void> {
    if (this.board.isGameOver || this.botThinking) return;

    const isBotTurn = this.mode === 'eve' || (this.mode === 'pve' && this.board.turn !== this.playerColor);
    if (!isBotTurn) return;

    this.botThinking = true;
    this.setControlsBusy(true);
    const thinkingFor = this.board.turn;
    this.showStatus(`Bot (Nv. ${this.botLevel}) pensando...`, '🤔');

    let botRes = null;
    try {
      botRes = await this.botManager.getMove(this.board, thinkingFor, this.botLevel, this.komi, {
        opponentPassed: this.board.lastMove?.pass === true
      });
    } catch (e) {
      console.error('Error during bot move:', e);
      this.showStatus('A IA encontrou um erro. Jogue novamente ou reinicie a partida.', '⚠️');
    } finally {
      // Cleared before continuing the chain. Doing this after onMovePlayed
      // would wipe the flag that the *next* bot turn had just set, because in
      // bot-versus-bot play that next turn starts inside onMovePlayed.
      this.botThinking = false;
      this.setControlsBusy(false);
    }

    // A null answer means the request was superseded, or the position moved on.
    if (!botRes || this.board.turn !== thinkingFor || this.board.isGameOver) return;

    if (botRes.bestMove === null) {
      this.board.pass(thinkingFor);
      this.sound.playPass();
    } else {
      const res = this.board.playMove(botRes.bestMove.x, botRes.bestMove.y, thinkingFor);
      if (res.success) {
        this.sound.playStoneClick();
        if (res.move?.captured?.length) this.sound.playCapture();
      } else {
        // Should not happen, but passing keeps the game moving if it does.
        console.warn('Bot proposed an illegal move, passing instead:', botRes.bestMove, res.reason);
        this.board.pass(thinkingFor);
      }
    }

    this.applyFischerIncrement(thinkingFor);
    this.onMovePlayed();
  }

  private setControlsBusy(busy: boolean): void {
    for (const id of ['btn-pass', 'btn-hint', 'btn-resign']) {
      const btn = document.getElementById(id) as HTMLButtonElement | null;
      if (btn) btn.disabled = busy;
    }
    this.canvas.style.cursor = busy ? 'progress' : 'pointer';
  }

  private handlePass(): void {
    if (this.board.isGameOver || this.isScoringPhase) return;
    if (this.mode === 'review' || this.mode === 'tsumego' || this.mode === 'joseki') return;
    if (this.mode === 'eve') return;
    if (this.mode === 'pve' && (this.botThinking || this.board.turn !== this.playerColor)) return;

    const passer = this.board.turn;
    this.board.pass(passer);
    this.sound.playPass();
    this.applyFischerIncrement(passer);
    this.onMovePlayed();
  }

  private handleResign(): void {
    if (this.board.isGameOver || this.isScoringPhase) return;
    if (this.mode === 'review' || this.mode === 'tsumego' || this.mode === 'joseki') return;

    const resigningColor = this.mode === 'pve' ? this.playerColor : this.board.turn;
    if (!window.confirm('Tem certeza de que deseja desistir da partida?')) return;

    this.botManager.cancelPending();
    this.botThinking = false;
    this.board.resign(resigningColor);

    const winnerLabel = resigningColor === 'black' ? 'Brancas' : 'Pretas';
    this.showStatus(`${winnerLabel} venceram por desistência!`, '🏳️');
    this.celebrateIfPlayerWon(resigningColor === 'black' ? 'white' : 'black');
    this.updateUI();
    this.render();
  }

  private handleUndo(): void {
    if (this.mode === 'review' || this.mode === 'joseki') return;
    if (this.board.history.length === 0) return;

    // Drop whatever the bot is thinking about; that position is being rewound.
    this.botManager.cancelPending();
    this.botThinking = false;
    this.setControlsBusy(false);

    this.board.undo();
    // In a game against the bot, one undo should give back the player's move.
    if (this.mode === 'pve' && this.board.turn !== this.playerColor && this.board.history.length > 0) {
      this.board.undo();
    }

    this.isScoringPhase = false;
    this.deadStones.clear();
    this.scoringResult = null;
    this.aiHint = null;
    this.replayIndex = -1;
    this.influenceCache = null;
    this.replayBoardCache = null;
    this.closeModal('modal-scoring');
    this.updateUI();
    this.render();
  }

  private async handleRequestHint(): Promise<void> {
    if (this.board.isGameOver || this.isScoringPhase || this.mode === 'review') return;
    if (this.botThinking) return;

    this.botThinking = true;
    this.setControlsBusy(true);
    this.showStatus('IA calculando a melhor jogada...', '💡');
    const askedFor = this.board.turn;

    try {
      const analysis = await this.botManager.analyzePosition(this.board, askedFor, this.komi, {
        timeBudgetMs: 1500
      });
      if (!analysis || this.board.turn !== askedFor) return;

      if (analysis.bestMove) {
        const winRateForPlayer = askedFor === 'black' ? analysis.winRate : 1 - analysis.winRate;
        this.aiHint = { point: analysis.bestMove, winRate: winRateForPlayer };
        this.render();
        const coordStr = GameReviewer.coordToString(analysis.bestMove.x, analysis.bestMove.y, this.boardSize);
        this.showStatus(`Sugestão da IA: ${coordStr} (${Math.round(winRateForPlayer * 100)}% de vitória)`, '💡');
      } else {
        this.showStatus('A IA recomenda passar a vez.', '💡');
      }
    } finally {
      this.botThinking = false;
      this.setControlsBusy(false);
    }
  }

  private celebrateIfPlayerWon(winner: Color): void {
    const humanWon =
      this.mode === 'pvp' ||
      (this.mode === 'pve' && winner === this.playerColor) ||
      this.mode === 'tsumego';
    if (!humanWon) return;
    confetti({ particleCount: 90, spread: 75, origin: { y: 0.6 } });
    this.sound.playWinFanfare();
  }

  private showStatus(text: string, icon?: string): void {
    this.statusText.textContent = text;
    if (icon) {
      const iconEl = document.getElementById('status-icon');
      if (iconEl) iconEl.textContent = icon;
    }
  }

  // -------------------------------------------------------------
  // POST-GAME REVIEW
  // -------------------------------------------------------------

  public async startPostGameReview(): Promise<void> {
    const source: ReviewSource = this.reviewSource ?? {
      size: this.boardSize,
      komi: this.komi,
      setupStones: this.board.setupStones.map(s => ({ ...s })),
      moves: this.board.movesList.map(m => ({ ...m }))
    };

    if (source.moves.length === 0) {
      this.openReviewLibrary();
      return;
    }

    this.botManager.cancelPending();
    this.botThinking = false;
    this.stopAutoPlay();
    this.reviewCancelled = false;

    const progressBar = document.getElementById('review-progress-bar');
    const progressText = document.getElementById('review-progress-text');
    this.openModal('modal-review-progress');

    // A per-position budget that keeps a long game reviewable in about a minute.
    const timeBudgetMs = source.moves.length > 150 ? 200 : source.moves.length > 80 ? 300 : 450;
    const startedAt = Date.now();

    try {
      this.reviewReport = await GameReviewer.analyzeGame(
        source.size,
        source.setupStones,
        source.komi,
        source.moves,
        this.botManager,
        {
          timeBudgetMs,
          onProgress: (curr, total) => {
            if (this.reviewCancelled) return false;
            const pct = Math.round((curr / total) * 100);
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressText) {
              const elapsed = (Date.now() - startedAt) / 1000;
              const eta = curr > 1 ? Math.round((elapsed / (curr - 1)) * (total - curr)) : 0;
              progressText.textContent = `Analisando lance ${curr} de ${total} (${pct}%)` +
                (eta > 0 ? ` — cerca de ${eta}s restantes` : '');
            }
            return true;
          }
        }
      );

      this.closeModal('modal-review-progress');
      this.reviewSource = source;
      this.mode = 'review';
      this.isSandboxMode = false;
      this.isChallengeMode = false;
      this.setReviewModeUI(true);
      this.populateReviewStats();
      this.selectReviewMove(0);
    } catch (err) {
      this.closeModal('modal-review-progress');
      if (err instanceof ReviewCancelledError) {
        this.showStatus('Análise cancelada.', '🎯');
        return;
      }
      console.error('Error during review:', err);
      window.alert('Ocorreu um erro ao processar a análise da partida.');
    }
  }

  private setReviewModeUI(isReview: boolean): void {
    const show = (id: string, visible: boolean, display = 'block') => {
      const el = document.getElementById(id);
      if (el) el.style.display = visible ? display : 'none';
    };

    show('live-player-cards', !isReview);
    show('review-summary-card', isReview);
    show('live-eval-card', !isReview);
    show('territory-widget-card', !isReview);
    show('board-quick-controls', !isReview, 'flex');
    show('review-quick-controls', isReview, 'flex');
    show('review-move-details-card', isReview);
    show('winrate-chart-card', isReview, 'flex');

    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(isReview ? 'tab-review' : 'tab-play')?.classList.add('active');
    if (isReview) this.showStatus('Modo de Revisão ativo. Navegue pelos lances abaixo.', '📊');

    this.updateBoardSize();
  }

  private populateReviewStats(): void {
    const report = this.reviewReport;
    if (!report) return;

    const accBlack = document.getElementById('review-acc-black');
    const accWhite = document.getElementById('review-acc-white');
    if (accBlack) accBlack.textContent = `${report.blackAccuracyPct}%`;
    if (accWhite) accWhite.textContent = `${report.whiteAccuracyPct}%`;

    const breakdownEl = document.getElementById('review-stats-breakdown');
    if (!breakdownEl) return;
    breakdownEl.textContent = '';

    const categories: { key: MoveClassificationType; label: string; color: string }[] = [
      { key: 'brilliant', label: '🌟 Brilhantes', color: '#c084fc' },
      { key: 'best', label: '🟢 Melhores', color: '#10b981' },
      { key: 'good', label: '🔵 Boas', color: '#3b82f6' },
      { key: 'inaccuracy', label: '🟡 Imprecisões', color: '#eab308' },
      { key: 'mistake', label: '🟠 Erros', color: '#f97316' },
      { key: 'blunder', label: '☠️ Erros Críticos', color: '#ef4444' }
    ];

    const fragment = document.createDocumentFragment();
    for (const cat of categories) {
      const row = document.createElement('div');
      row.className = 'review-stat-row';

      const label = document.createElement('span');
      label.style.color = cat.color;
      label.style.fontWeight = '600';
      label.textContent = cat.label;

      const counts = document.createElement('span');
      counts.style.fontFamily = 'var(--font-mono)';
      counts.style.color = 'var(--text-primary)';
      counts.textContent = `⚫ ${report.stats.black[cat.key] || 0}  |  ⚪ ${report.stats.white[cat.key] || 0}`;

      row.append(label, counts);
      fragment.appendChild(row);
    }
    breakdownEl.appendChild(fragment);
  }

  private drawWinRateChart(): void {
    const report = this.reviewReport;
    if (!report || report.evaluations.length === 0) return;

    const canvas = this.chartCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, width, height);

    const midY = height / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    const evals = report.evaluations;
    const n = evals.length;
    const stepX = n > 1 ? width / (n - 1) : width;

    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < n; i++) {
      ctx.lineTo(i * stepX, height * (1 - evals[i].blackWinRateHistory));
    }
    ctx.lineTo(n > 1 ? width : 0, height);
    ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
    ctx.fill();

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

    for (let i = 0; i < n; i++) {
      const ev = evals[i];
      const x = i * stepX;
      const y = height * (1 - ev.blackWinRateHistory);

      if (ev.classification === 'blunder' || ev.classification === 'brilliant') {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = ev.classification === 'blunder' ? '#ef4444' : '#c084fc';
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
    const report = this.reviewReport;
    if (!report || index < 0 || index >= report.evaluations.length) return;

    this.currentReviewMoveIndex = index;
    this.activeAlternative = null;
    this.isSandboxMode = false;
    this.isChallengeMode = false;
    this.sandboxBoard = null;
    this.sandboxMoves = [];

    const sandboxBtnLabel = document.getElementById('sandbox-btn-label');
    if (sandboxBtnLabel) sandboxBtnLabel.textContent = '💡 Testar Variações (E se...?)';

    const ev = report.evaluations[index];
    const size = this.reviewSource?.size ?? this.boardSize;
    const playedCoord = ev.playedMove ? GameReviewer.coordToString(ev.playedMove.x, ev.playedMove.y, size) : 'Passou';

    const title = document.getElementById('review-move-title');
    if (title) {
      title.textContent = `Lance ${ev.moveNumber} (${ev.color === 'black' ? 'Pretas' : 'Brancas'}): ${playedCoord}`;
    }

    const badgeEl = document.getElementById('review-move-badge');
    if (badgeEl) {
      badgeEl.className = `badge-move-eval badge-${ev.classification}`;
      badgeEl.textContent = `${ev.badgeSymbol} ${ev.labelPt}`;
    }

    const deltaEl = document.getElementById('review-move-delta');
    if (deltaEl) {
      const deltaPct = (ev.winRateDelta * 100).toFixed(1);
      deltaEl.textContent = `(${ev.winRateDelta >= 0 ? '+' : ''}${deltaPct}%)`;
      deltaEl.style.color = ev.winRateDelta < -0.1 ? '#ef4444' : ev.winRateDelta < 0 ? '#eab308' : '#10b981';
    }

    const explanation = document.getElementById('review-move-explanation');
    if (explanation) explanation.textContent = ev.explanation;

    this.renderAlternatives(ev.alternatives, size);
    this.drawWinRateChart();
    this.render();
    this.updateUI();
  }

  private renderAlternatives(alternatives: AlternativeMove[], size: BoardSize): void {
    const altList = document.getElementById('review-alternatives-list');
    if (!altList) return;
    altList.textContent = '';

    if (alternatives.length === 0) {
      const empty = document.createElement('span');
      empty.style.fontSize = '12px';
      empty.style.color = 'var(--text-muted)';
      empty.textContent = 'Nenhuma alternativa relevante (jogada precisa).';
      altList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    alternatives.forEach((alt, idx) => {
      const card = document.createElement('div');
      card.className = 'alt-move-card';

      const left = document.createElement('div');
      const strong = document.createElement('strong');
      strong.style.color = '#10b981';
      strong.textContent = `[${['A', 'B', 'C'][idx] || idx + 1}] ${GameReviewer.coordToString(alt.point.x, alt.point.y, size)}`;

      const desc = document.createElement('span');
      desc.style.fontSize = '11px';
      desc.style.color = 'var(--text-secondary)';
      desc.style.marginLeft = '6px';
      desc.textContent = alt.description;
      left.append(strong, desc);

      const rate = document.createElement('span');
      rate.style.fontSize = '11px';
      rate.style.fontWeight = '700';
      rate.style.color = '#10b981';
      rate.textContent = `${(alt.winRate * 100).toFixed(1)}%`;

      card.append(left, rate);
      card.addEventListener('click', () => {
        this.activeAlternative = alt;
        this.render();
      });
      fragment.appendChild(card);
    });
    altList.appendChild(fragment);
  }

  private stepReview(delta: number): void {
    if (!this.reviewReport) return;
    const next = Math.max(
      0,
      Math.min(this.reviewReport.evaluations.length - 1, this.currentReviewMoveIndex + delta)
    );
    this.selectReviewMove(next);
  }

  public stepBlunder(direction: 1 | -1): void {
    const report = this.reviewReport;
    if (!report) return;

    const evals = report.evaluations;
    const isProblem = (c: MoveClassificationType) => c === 'blunder' || c === 'mistake';

    for (let idx = this.currentReviewMoveIndex + direction; idx >= 0 && idx < evals.length; idx += direction) {
      if (isProblem(evals[idx].classification)) {
        this.selectReviewMove(idx);
        return;
      }
    }

    // Wrap around to the other end before giving up.
    const start = direction === 1 ? 0 : evals.length - 1;
    for (let idx = start; direction === 1 ? idx < evals.length : idx >= 0; idx += direction) {
      if (idx === this.currentReviewMoveIndex) break;
      if (isProblem(evals[idx].classification)) {
        this.selectReviewMove(idx);
        return;
      }
    }

    this.showStatus('Nenhum outro erro encontrado nesta partida.', '🎉');
  }

  public toggleSandboxMode(): void {
    if (!this.reviewReport || !this.reviewSource) return;

    this.isSandboxMode = !this.isSandboxMode;
    this.isChallengeMode = false;
    const label = document.getElementById('sandbox-btn-label');

    if (this.isSandboxMode) {
      if (label) label.textContent = '↩ Sair do Modo Variação';
      // Clone it: buildReviewBoard hands back a cached instance, and the
      // sandbox is about to play moves on top of whatever it is given.
      this.sandboxBoard = this.buildReviewBoard(this.currentReviewMoveIndex + 1).clone();
      this.sandboxMoves = [];
      this.showStatus('💡 Modo Variação: clique no tabuleiro para testar qualquer lance.', '💡');
    } else {
      if (label) label.textContent = '💡 Testar Variações (E se...?)';
      this.sandboxBoard = null;
      this.sandboxMoves = [];
      this.showStatus('Modo de Revisão ativo. Navegue pelos lances abaixo.', '📊');
    }
    this.render();
  }

  public startBlunderChallenge(): void {
    const report = this.reviewReport;
    if (!report) return;

    let targetIdx = this.currentReviewMoveIndex;
    const current = report.evaluations[targetIdx];

    if (current.classification !== 'blunder' && current.classification !== 'mistake') {
      const firstIdx = report.evaluations.findIndex(
        e => e.classification === 'blunder' || e.classification === 'mistake'
      );
      if (firstIdx === -1) {
        this.showStatus('Nenhum erro identificado para treinar nesta partida.', '🎉');
        return;
      }
      targetIdx = firstIdx;
    }

    const blunderEval = report.evaluations[targetIdx];
    if (!blunderEval.bestMove) {
      this.showStatus('Não há lance alternativo sugerido para esta posição.', '⚠️');
      return;
    }

    this.currentReviewMoveIndex = targetIdx;
    this.isChallengeMode = true;
    this.isSandboxMode = false;
    this.sandboxBoard = null;
    this.challengeTargetPoint = blunderEval.bestMove;

    this.showStatus(
      `🎯 Desafio: no lance ${blunderEval.moveNumber} (${blunderEval.color === 'black' ? 'Pretas' : 'Brancas'}), encontre a jogada ideal.`,
      '🎯'
    );
    this.drawWinRateChart();
    this.render();
  }

  private handleReviewClick(x: number, y: number): void {
    if (this.isChallengeMode) {
      if (this.challengeTargetPoint && x === this.challengeTargetPoint.x && y === this.challengeTargetPoint.y) {
        this.sound.playStoneClick();
        confetti({ particleCount: 75, spread: 70, origin: { y: 0.65 } });
        this.sound.playWinFanfare();
        this.showStatus('🎉 Excelente! Você encontrou a jogada recomendada pela IA.', '🎉');
        this.isChallengeMode = false;
        window.setTimeout(() => this.selectReviewMove(this.currentReviewMoveIndex), 1600);
      } else {
        this.sound.playPass();
        this.showStatus('❌ Não é esse o ponto vital. Observe as alternativas [A] e [B] e tente de novo.', '❌');
      }
      return;
    }

    if (this.isSandboxMode && this.sandboxBoard) {
      const turn = this.sandboxBoard.turn;
      const res = this.sandboxBoard.playMove(x, y, turn);
      if (!res.success) {
        if (res.reason) this.showStatus(res.reason, '⚠️');
        return;
      }
      this.sound.playStoneClick();
      if (res.move?.captured?.length) this.sound.playCapture();
      this.sandboxMoves.push({ point: { x, y }, color: turn, step: this.sandboxMoves.length + 1 });
      const size = this.reviewSource?.size ?? this.boardSize;
      this.showStatus(
        `Variação: lance ${this.sandboxMoves.length} em ${GameReviewer.coordToString(x, y, size)}.`,
        '💡'
      );
      this.render();
    }
  }

  /** Rebuilds the reviewed game up to `moveCount` moves, reusing the last result. */
  private buildReviewBoard(moveCount: number): GoBoard {
    const source = this.reviewSource;
    const size = source?.size ?? this.boardSize;
    const key = `review|${size}|${moveCount}|${source?.moves.length ?? 0}`;
    if (this.replayBoardCache && this.replayBoardCache.key === key) return this.replayBoardCache.board;

    const board = new GoBoard(size);

    if (source && source.setupStones.length > 0) {
      board.placeSetupStones(source.setupStones, source.moves[0]?.color ?? 'black');
    }

    const moves = source?.moves ?? this.board.movesList;
    const limit = Math.max(0, Math.min(moveCount, moves.length));
    for (let i = 0; i < limit; i++) {
      const m = moves[i];
      if (m.pass) board.pass(m.color);
      else if (m.resign) board.resign(m.color);
      else board.playMove(m.x, m.y, m.color);
    }

    this.replayBoardCache = { key, board };
    return board;
  }

  // -------------------------------------------------------------
  // REVIEW LIBRARY
  // -------------------------------------------------------------

  public openReviewLibrary(): void {
    const listEl = document.getElementById('review-library-list');
    if (!listEl) return;
    listEl.textContent = '';

    const fragment = document.createDocumentFragment();
    for (const game of PRESET_REVIEW_GAMES) {
      const card = document.createElement('div');
      card.className = 'review-game-card';

      const header = document.createElement('div');
      header.className = 'review-game-header';
      const title = document.createElement('span');
      title.className = 'review-game-title';
      title.textContent = game.title;
      const sizeBadge = document.createElement('span');
      sizeBadge.className = 'puzzle-badge badge-easy';
      sizeBadge.textContent = `${game.size}x${game.size}`;
      header.append(title, sizeBadge);

      const meta = document.createElement('div');
      meta.className = 'review-game-meta';
      for (const text of [
        `⚫ ${game.blackPlayer} (${game.blackRank || '?'})`,
        `⚪ ${game.whitePlayer} (${game.whiteRank || '?'})`,
        `📅 ${game.date}`
      ]) {
        const badge = document.createElement('span');
        badge.className = 'review-game-meta-badge';
        badge.textContent = text;
        meta.appendChild(badge);
      }
      const resultBadge = document.createElement('span');
      resultBadge.className = 'review-game-meta-badge';
      resultBadge.style.color = 'var(--accent-gold)';
      resultBadge.textContent = game.result;
      meta.appendChild(resultBadge);

      const desc = document.createElement('div');
      desc.className = 'review-game-desc';
      desc.textContent = game.description;

      const actions = document.createElement('div');
      actions.className = 'review-game-actions';
      const analyzeBtn = document.createElement('button');
      analyzeBtn.className = 'btn btn-primary btn-sm';
      analyzeBtn.style.flex = '1';
      analyzeBtn.textContent = '⚡ Analisar com IA';
      analyzeBtn.addEventListener('click', () => {
        this.closeModal('modal-review-library');
        this.loadPresetGame(game, true);
      });
      const openBtn = document.createElement('button');
      openBtn.className = 'btn btn-secondary btn-sm';
      openBtn.textContent = '👁️ Abrir no Tabuleiro';
      openBtn.addEventListener('click', () => {
        this.closeModal('modal-review-library');
        this.loadPresetGame(game, false);
      });
      actions.append(analyzeBtn, openBtn);

      card.append(header, meta, desc, actions);
      fragment.appendChild(card);
    }

    listEl.appendChild(fragment);
    this.openModal('modal-review-library');
  }

  public loadPresetGame(preset: ReviewGamePreset, autoAnalyze: boolean): void {
    if (!this.loadSgf(preset.sgfContent)) return;
    if (autoAnalyze) void this.startPostGameReview();
  }

  public async handlePasteSgf(): Promise<void> {
    const textarea = document.getElementById('paste-sgf-textarea') as HTMLTextAreaElement | null;
    const content = textarea?.value.trim() ?? '';
    if (!content) {
      window.alert('Por favor, cole o código SGF no campo.');
      return;
    }

    this.closeModal('modal-paste-sgf');
    if (this.loadSgf(content)) await this.startPostGameReview();
  }

  // -------------------------------------------------------------
  // SCORING PHASE
  // -------------------------------------------------------------

  private enterScoringPhase(): void {
    this.isScoringPhase = true;
    this.botManager.cancelPending();
    this.botThinking = false;
    this.setControlsBusy(false);
    this.deadStones = GoScoring.autoDetectDeadStones(this.board);
    this.recalculateScoring();
    this.render();

    this.openModal('modal-scoring');
    if (this.scoringResult && this.scoringResult.winner !== 'draw') {
      this.celebrateIfPlayerWon(this.scoringResult.winner);
    }
  }

  private recalculateScoring(): void {
    const result = GoScoring.calculateScore(this.board, this.deadStones, this.ruleSet, this.komi);
    this.scoringResult = result;

    const setText = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText('score-black-territory', String(result.blackTerritory));
    setText('score-white-territory', String(result.whiteTerritory));
    setText('score-black-captures', String(result.blackCaptures));
    setText('score-white-captures', String(result.whiteCaptures));
    setText('score-komi-val', this.komi.toFixed(1));
    setText('score-black-total', result.blackTotal.toFixed(1));
    setText('score-white-total', result.whiteTotal.toFixed(1));

    if (result.winner === 'black') {
      setText('scoring-winner-title', '⚫ Vitória das Pretas!');
      setText('scoring-winner-desc', `Pretas venceram por ${result.margin.toFixed(1)} pontos.`);
    } else if (result.winner === 'white') {
      setText('scoring-winner-title', '⚪ Vitória das Brancas!');
      setText('scoring-winner-desc', `Brancas venceram por ${result.margin.toFixed(1)} pontos.`);
    } else {
      setText('scoring-winner-title', '🤝 Empate (Jigo)!');
      setText('scoring-winner-desc', 'A partida terminou rigorosamente empatada.');
    }
  }

  // -------------------------------------------------------------
  // REPLAY
  // -------------------------------------------------------------

  private stepReplay(delta: number): void {
    if (this.mode === 'review') {
      this.stepReview(delta);
      return;
    }
    if (this.board.movesList.length === 0) return;

    const current = this.replayIndex === -1 ? this.board.movesList.length : this.replayIndex;
    this.jumpReplay(Math.max(0, Math.min(this.board.movesList.length, current + delta)));
  }

  private jumpReplay(index: number): void {
    if (this.mode === 'review') {
      if (!this.reviewReport) return;
      const last = this.reviewReport.evaluations.length - 1;
      this.selectReviewMove(index === -1 ? last : Math.max(0, Math.min(last, index === 0 ? 0 : index - 1)));
      return;
    }

    this.replayIndex = index === -1 || index >= this.board.movesList.length ? -1 : index;
    this.updateUI();
    this.render();
  }

  private toggleAutoPlay(): void {
    if (this.autoPlayTimer !== null) {
      this.stopAutoPlay();
      return;
    }

    const btn = document.getElementById('btn-replay-autoplay');
    if (btn) btn.textContent = '⏸ Pausar';

    this.autoPlayTimer = window.setInterval(() => {
      if (this.mode === 'review') {
        if (!this.reviewReport || this.currentReviewMoveIndex >= this.reviewReport.evaluations.length - 1) {
          this.stopAutoPlay();
          return;
        }
        this.stepReview(1);
      } else {
        if (this.replayIndex === -1 || this.replayIndex >= this.board.movesList.length) {
          this.stopAutoPlay();
          return;
        }
        this.stepReplay(1);
      }
    }, 700);
  }

  private stopAutoPlay(): void {
    if (this.autoPlayTimer !== null) {
      clearInterval(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    const btn = document.getElementById('btn-replay-autoplay');
    if (btn) btn.textContent = '▶ Auto';
  }

  // -------------------------------------------------------------
  // STUDY MODES
  // -------------------------------------------------------------

  private async handleTabSwitch(tabName: string): Promise<void> {
    if (tabName === 'rules') {
      this.openModal('modal-rules-guide');
      return;
    }

    // Leaving a live game in progress should be a deliberate choice.
    const hasLiveGame = this.board.movesList.length > 0 && !this.board.isGameOver && this.mode !== 'review';
    const leavingPlay = tabName !== 'play' && (this.mode === 'pve' || this.mode === 'pvp' || this.mode === 'eve');
    if (hasLiveGame && leavingPlay && !window.confirm('Sair da partida atual? O progresso será perdido.')) {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.getElementById(this.mode === 'review' ? 'tab-review' : 'tab-play')?.classList.add('active');
      return;
    }

    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${tabName}`)?.classList.add('active');

    const specialCard = document.getElementById('special-mode-card');

    if (tabName === 'play') {
      const restarting =
        this.mode === 'review' || this.mode === 'tsumego' || this.mode === 'joseki' || this.board.isGameOver;
      this.mode = 'pve';
      this.setReviewModeUI(false);
      if (specialCard) specialCard.style.display = 'none';
      if (restarting || this.board.movesList.length === 0) this.openModal('modal-new-game');
      else this.updateUI();
      this.render();
    } else if (tabName === 'review') {
      if (this.reviewReport) {
        this.mode = 'review';
        this.setReviewModeUI(true);
        this.selectReviewMove(this.currentReviewMoveIndex);
      } else if (this.board.movesList.length > 0) {
        await this.startPostGameReview();
      } else {
        this.openReviewLibrary();
      }
    } else if (tabName === 'tsumego') {
      this.mode = 'tsumego';
      this.setReviewModeUI(false);
      if (specialCard) specialCard.style.display = 'block';
      this.showTsumegoSelection();
    } else if (tabName === 'joseki') {
      this.mode = 'joseki';
      this.setReviewModeUI(false);
      if (specialCard) specialCard.style.display = 'block';
      this.showJosekiSelection();
    }
  }

  private showTsumegoSelection(): void {
    const header = document.getElementById('modal-study-header');
    const content = document.getElementById('modal-study-content');
    if (!header || !content) return;

    header.textContent = '🧩 Problemas de Tsumego (Vida e Morte)';
    content.textContent = '';

    const fragment = document.createDocumentFragment();
    TSUMEGO_PROBLEMS.forEach((prob, idx) => {
      const item = document.createElement('div');
      item.className = `puzzle-item ${idx === this.currentTsumegoIndex ? 'active' : ''}`;

      const head = document.createElement('div');
      head.className = 'puzzle-header';
      const title = document.createElement('div');
      title.className = 'puzzle-title';
      title.textContent = prob.title;
      const badge = document.createElement('span');
      badge.className = `puzzle-badge ${
        prob.difficulty === 'Iniciante' ? 'badge-easy' : prob.difficulty === 'Intermediário' ? 'badge-medium' : 'badge-hard'
      }`;
      badge.textContent = prob.difficulty;
      head.append(title, badge);

      const desc = document.createElement('div');
      desc.style.fontSize = '12px';
      desc.style.color = 'var(--text-secondary)';
      desc.textContent = prob.description;

      item.append(head, desc);
      item.addEventListener('click', () => {
        this.loadTsumego(idx);
        this.closeModal('modal-study-list');
      });
      fragment.appendChild(item);
    });

    content.appendChild(fragment);
    this.openModal('modal-study-list');
  }

  private loadTsumego(index: number): void {
    const prob = TSUMEGO_PROBLEMS[index];
    if (!prob) return;

    this.currentTsumegoIndex = index;
    this.currentTsumego = prob;
    this.tsumegoStepNode = prob.solutionTree;
    this.boardSize = prob.size;
    this.replayIndex = -1;

    this.board.reset(prob.size);
    this.board.placeSetupStones(prob.initialStones.map(s => ({ ...s })), prob.playerColor);
    this.influenceCache = null;
    this.replayBoardCache = null;

    this.updateBoardSize(prob.size);

    const title = document.getElementById('special-mode-title');
    const body = document.getElementById('special-mode-body');
    if (title) title.textContent = prob.title;
    if (body) {
      body.textContent = '';

      const goal = document.createElement('div');
      goal.style.marginBottom = '8px';
      const goalLabel = document.createElement('strong');
      goalLabel.textContent = 'Objetivo: ';
      goal.append(goalLabel, document.createTextNode(prob.description));

      const hint = document.createElement('div');
      hint.style.color = 'var(--accent-gold)';
      hint.style.fontSize = '12px';
      hint.textContent = `💡 Dica: ${prob.hint}`;

      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn btn-secondary btn-sm';
      resetBtn.style.marginTop = '10px';
      resetBtn.style.width = '100%';
      resetBtn.textContent = 'Reiniciar Problema';
      resetBtn.addEventListener('click', () => this.loadTsumego(index));

      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn btn-secondary btn-sm';
      nextBtn.style.marginTop = '6px';
      nextBtn.style.width = '100%';
      nextBtn.textContent = 'Próximo Problema ▶';
      nextBtn.addEventListener('click', () => this.loadTsumego((index + 1) % TSUMEGO_PROBLEMS.length));

      body.append(goal, hint, resetBtn, nextBtn);
    }

    this.showStatus(
      `Sua vez (${prob.playerColor === 'black' ? 'Pretas' : 'Brancas'}). Encontre o ponto vital!`,
      '🧩'
    );
    this.updateUI();
    this.render();
  }

  private handleTsumegoMove(x: number, y: number): void {
    const problem = this.currentTsumego;
    const node = this.tsumegoStepNode;
    if (!problem || !node) return;

    if (x !== node.x || y !== node.y) {
      this.sound.playPass();
      this.showStatus('❌ Jogada incorreta. Tente outro ponto vital!', '❌');
      return;
    }

    const res = this.board.playMove(x, y, node.color);
    if (!res.success) {
      this.showStatus(res.reason ?? 'Jogada ilegal nesta posição.', '⚠️');
      return;
    }
    this.sound.playStoneClick();
    if (res.move?.captured?.length) this.sound.playCapture();

    // Play the scripted reply, if the problem has one, and advance the script.
    if (node.response) {
      const reply = node.response;
      this.board.playMove(reply.x, reply.y, reply.color);
      this.sound.playStoneClick();
      this.tsumegoStepNode = reply.response ?? null;
      this.showStatus(reply.message ?? 'Boa! O oponente respondeu. Continue a sequência.', '🧩');
    } else {
      this.tsumegoStepNode = null;
    }

    if (node.isCorrect) {
      confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 } });
      this.sound.playWinFanfare();
      this.showStatus(`🎉 ${node.message || 'Problema resolvido com sucesso!'}`, '🎉');
    }

    this.updateUI();
    this.render();
  }

  private showJosekiSelection(): void {
    const header = document.getElementById('modal-study-header');
    const content = document.getElementById('modal-study-content');
    if (!header || !content) return;

    header.textContent = '📜 Dicionário e Explorador de Joseki';
    content.textContent = '';

    const fragment = document.createDocumentFragment();
    for (const joseki of JOSEKI_PATTERNS) {
      const item = document.createElement('div');
      item.className = 'joseki-item';

      const head = document.createElement('div');
      head.className = 'puzzle-header';
      const title = document.createElement('div');
      title.className = 'puzzle-title';
      title.textContent = joseki.name;
      const badge = document.createElement('span');
      badge.className = 'puzzle-badge badge-easy';
      badge.textContent = joseki.category;
      head.append(title, badge);

      const desc = document.createElement('div');
      desc.style.fontSize = '12px';
      desc.style.color = 'var(--text-secondary)';
      desc.textContent = joseki.description;

      item.append(head, desc);
      item.addEventListener('click', () => {
        this.loadJoseki(joseki);
        this.closeModal('modal-study-list');
      });
      fragment.appendChild(item);
    }

    content.appendChild(fragment);
    this.openModal('modal-study-list');
  }

  private loadJoseki(joseki: JosekiNode): void {
    this.currentJoseki = joseki;
    this.josekiMoveIndex = 0;
    this.boardSize = 19;
    this.replayIndex = -1;
    this.board.reset(19);
    this.influenceCache = null;
    this.replayBoardCache = null;
    this.updateBoardSize(19);

    const title = document.getElementById('special-mode-title');
    const body = document.getElementById('special-mode-body');
    if (title) title.textContent = joseki.name;
    if (body) {
      body.textContent = '';

      const desc = document.createElement('div');
      desc.style.marginBottom = '8px';
      desc.textContent = joseki.description;

      const note = document.createElement('div');
      note.id = 'joseki-note';
      note.style.color = 'var(--accent-gold)';
      note.style.fontSize = '12px';
      note.style.marginBottom = '10px';
      note.textContent = 'Clique em Próximo Lance para avançar.';

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '6px';
      const prev = document.createElement('button');
      prev.className = 'btn btn-secondary btn-sm';
      prev.style.flex = '1';
      prev.textContent = '◀ Anterior';
      prev.addEventListener('click', () => this.stepJoseki(-1));
      const next = document.createElement('button');
      next.className = 'btn btn-primary btn-sm';
      next.style.flex = '1';
      next.textContent = 'Próximo ▶';
      next.addEventListener('click', () => this.stepJoseki(1));
      row.append(prev, next);

      body.append(desc, note, row);
    }

    this.updateUI();
    this.render();
  }

  private stepJoseki(delta: number): void {
    const joseki = this.currentJoseki;
    if (!joseki) return;

    const nextIdx = Math.max(0, Math.min(joseki.moves.length, this.josekiMoveIndex + delta));
    if (nextIdx === this.josekiMoveIndex) return;
    this.josekiMoveIndex = nextIdx;

    this.board.reset(19);
    for (let i = 0; i < nextIdx; i++) {
      const m = joseki.moves[i];
      this.board.playMove(m.x, m.y, m.color);
    }
    this.influenceCache = null;
    this.replayBoardCache = null;
    this.sound.playStoneClick();

    const noteEl = document.getElementById('joseki-note');
    if (noteEl) {
      noteEl.textContent =
        nextIdx > 0
          ? `Lance ${nextIdx}: ${joseki.moves[nextIdx - 1].note || ''}`
          : 'Início da variação.';
    }

    this.updateUI();
    this.render();
  }

  // -------------------------------------------------------------
  // SGF IMPORT
  // -------------------------------------------------------------

  public loadSgf(content: string): boolean {
    let parsed;
    try {
      parsed = SgfParser.parse(content);
    } catch (e) {
      console.error('SGF parse failed:', e);
      window.alert('Não foi possível interpretar este arquivo SGF.');
      return false;
    }

    if (parsed.moves.length === 0 && parsed.initialBlackStones.length === 0) {
      window.alert('O SGF não contém jogadas.');
      return false;
    }

    this.botManager.cancelPending();
    this.botThinking = false;
    this.stopAutoPlay();

    this.boardSize = parsed.size;
    this.komi = parsed.komi;
    this.ruleSet = parsed.ruleSet;
    this.handicap = parsed.handicap;
    this.replayIndex = -1;
    this.reviewReport = null;
    this.isScoringPhase = false;
    this.deadStones.clear();
    this.scoringResult = null;
    this.influenceCache = null;
    this.replayBoardCache = null;

    this.board.reset(parsed.size);

    // AB/AW placements are setup, not moves, so the replay stays faithful.
    const setupStones = [
      ...parsed.initialBlackStones.map(pt => ({ x: pt.x, y: pt.y, color: 'black' as Color })),
      ...parsed.initialWhiteStones.map(pt => ({ x: pt.x, y: pt.y, color: 'white' as Color }))
    ];
    if (setupStones.length > 0) this.board.placeSetupStones(setupStones, parsed.firstPlayer);
    else this.board.turn = parsed.firstPlayer;

    let applied = 0;
    for (const m of parsed.moves) {
      if (m.pass) {
        this.board.pass(m.color);
        applied++;
      } else if (this.board.playMove(m.x, m.y, m.color).success) {
        applied++;
      } else {
        console.warn(`SGF move ${applied + 1} is illegal on this board, stopping there.`);
        break;
      }
    }

    // Review reads from here, so it never depends on the live game state.
    this.reviewSource = {
      size: parsed.size,
      komi: parsed.komi,
      setupStones,
      moves: this.board.movesList.map(m => ({ ...m }))
    };

    this.mode = 'pvp';
    this.setReviewModeUI(false);
    this.updatePlayerNames();
    const nameBlack = document.getElementById('name-black');
    const nameWhite = document.getElementById('name-white');
    if (nameBlack) nameBlack.textContent = `Pretas (${parsed.blackPlayer}${parsed.blackRank ? ` ${parsed.blackRank}` : ''})`;
    if (nameWhite) nameWhite.textContent = `Brancas (${parsed.whitePlayer}${parsed.whiteRank ? ` ${parsed.whiteRank}` : ''})`;

    this.updateBoardSize(parsed.size);
    this.updateUI();

    const variationNote = parsed.variationsSkipped > 0
      ? ` (${parsed.variationsSkipped} variação(ões) ignorada(s), usando a linha principal)`
      : '';
    this.showStatus(`SGF carregado: ${applied} lances${variationNote}.`, '📁');
    return true;
  }

  // -------------------------------------------------------------
  // CLOCKS
  // -------------------------------------------------------------

  private resetClocks(): void {
    this.blackClock = App.freshClock(this.clockType);
    this.whiteClock = App.freshClock(this.clockType);
    this.clockLastTick = Date.now();
    this.updateClockDisplays();
  }

  /** Fischer time control adds the increment after each completed move. */
  private applyFischerIncrement(color: Color): void {
    if (this.clockType !== 'fischer') return;
    const clock = color === 'black' ? this.blackClock : this.whiteClock;
    clock.mainTimeRemaining += CLOCK_PRESETS.fischer.fischerIncrement;
    this.updateClockDisplays();
  }

  private startClockLoop(): void {
    if (this.clockInterval !== null) clearInterval(this.clockInterval);
    this.clockLastTick = Date.now();

    // Driven by wall-clock deltas rather than by counting ticks, so a throttled
    // background tab or a slow frame cannot make the clock drift.
    this.clockInterval = window.setInterval(() => {
      const now = Date.now();
      const elapsedMs = now - this.clockLastTick;

      const paused =
        this.board.isGameOver ||
        this.clockType === 'none' ||
        this.isScoringPhase ||
        this.mode === 'review' ||
        this.mode === 'tsumego' ||
        this.mode === 'joseki' ||
        this.board.movesList.length === 0;

      if (paused) {
        this.clockLastTick = now;
        return;
      }

      const wholeSeconds = Math.floor(elapsedMs / 1000);
      if (wholeSeconds <= 0) return;
      this.clockLastTick += wholeSeconds * 1000;

      for (let i = 0; i < wholeSeconds; i++) {
        if (this.tickClockOneSecond()) break;
      }
      this.updateClockDisplays();
    }, 250);
  }

  /** Advances the active clock by one second; returns true when time ran out. */
  private tickClockOneSecond(): boolean {
    const activeColor = this.board.turn;
    const clock = activeColor === 'black' ? this.blackClock : this.whiteClock;

    if (!clock.isInByoyomi) {
      if (clock.mainTimeRemaining > 0) {
        clock.mainTimeRemaining--;
        return false;
      }
      if (this.clockType === 'byoyomi') {
        clock.isInByoyomi = true;
        clock.byoyomiCurrentTime = CLOCK_PRESETS.byoyomi.byoyomiSeconds;
        return false;
      }
      this.handleTimeout(activeColor);
      return true;
    }

    if (clock.byoyomiCurrentTime > 0) {
      clock.byoyomiCurrentTime--;
      if (clock.byoyomiCurrentTime > 0 && clock.byoyomiCurrentTime <= 5) this.sound.playTimerWarning();
      return false;
    }

    clock.byoyomiPeriodsRemaining--;
    if (clock.byoyomiPeriodsRemaining <= 0) {
      this.handleTimeout(activeColor);
      return true;
    }
    clock.byoyomiCurrentTime = CLOCK_PRESETS.byoyomi.byoyomiSeconds;
    return false;
  }

  private handleTimeout(timedOutColor: Color): void {
    this.botManager.cancelPending();
    this.botThinking = false;
    this.board.resign(timedOutColor);
    const winner: Color = timedOutColor === 'black' ? 'white' : 'black';
    this.showStatus(`Tempo esgotado! ${winner === 'black' ? 'Pretas' : 'Brancas'} venceram a partida.`, '⏰');
    this.celebrateIfPlayerWon(winner);
    this.updateUI();
    this.render();
  }

  private formatClock(clock: PlayerClockState): string {
    if (this.clockType === 'none') return '∞';
    if (clock.isInByoyomi) return `${clock.byoyomiCurrentTime}s (${clock.byoyomiPeriodsRemaining}x)`;
    const min = Math.floor(clock.mainTimeRemaining / 60);
    const sec = clock.mainTimeRemaining % 60;
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  }

  private updateClockDisplays(): void {
    this.timerBlack.textContent = this.formatClock(this.blackClock);
    this.timerWhite.textContent = this.formatClock(this.whiteClock);

    const isLow = (c: PlayerClockState) =>
      this.clockType !== 'none' &&
      ((c.isInByoyomi && c.byoyomiCurrentTime <= 5) || (!c.isInByoyomi && c.mainTimeRemaining <= 10));

    this.timerBlack.classList.toggle('warning', isLow(this.blackClock));
    this.timerWhite.classList.toggle('warning', isLow(this.whiteClock));
  }

  // -------------------------------------------------------------
  // UI UPDATE AND RENDER
  // -------------------------------------------------------------

  public updateUI(): void {
    const isBlackTurn = this.board.turn === 'black';
    this.cardBlack.classList.toggle('active-turn', isBlackTurn && !this.board.isGameOver);
    this.cardWhite.classList.toggle('active-turn', !isBlackTurn && !this.board.isGameOver);

    this.capturesBlack.textContent = `Prisioneiros: ${this.board.captures.black}`;
    this.capturesWhite.textContent = `Prisioneiros: ${this.board.captures.white} (+${this.komi.toFixed(1)} Komi)`;
    this.moveCountBadge.textContent = `${this.board.movesList.length} lances`;

    if (!this.board.isGameOver && this.mode !== 'review' && !this.botThinking && !this.isScoringPhase) {
      if (this.mode === 'pvp' || this.mode === 'pve' || this.mode === 'eve') {
        this.showStatus(
          `Vez das ${isBlackTurn ? 'Pretas' : 'Brancas'} (Jogada ${this.board.movesList.length + 1})`,
          '🎯'
        );
      }
    }

    this.updateEvaluationWidgets();
    this.renderMoveHistory();
    this.updateClockDisplays();
  }

  /**
   * The influence map is recomputed only when the position actually changed;
   * it used to run on every UI update, including every clock tick.
   */
  private getInfluence(): ReturnType<typeof InfluenceMap.calculate> {
    const key = `${this.board.hash}|${this.board.size}`;
    if (this.influenceCache && this.influenceCache.key === key) return this.influenceCache.result;
    const result = InfluenceMap.calculate(this.board, 4);
    this.influenceCache = { key, result };
    return result;
  }

  private updateEvaluationWidgets(): void {
    if (this.mode === 'review') return;

    const inf = this.getInfluence();
    this.estBlackPts.textContent = `${inf.blackEstimate} pts`;
    this.estWhitePts.textContent = `${(inf.whiteEstimate + this.komi).toFixed(1)} pts`;

    const blackPts = inf.blackEstimate;
    const whitePts = inf.whiteEstimate + this.komi;

    // Map the point difference through a sigmoid rather than taking a raw
    // ratio. A ratio reads 5% for Black on an empty board, purely because komi
    // is the only value on it; the difference scales sensibly all game long.
    const lead = blackPts - whitePts;
    const scale = (this.boardSize * this.boardSize) / 8;
    const blackPct = Math.round(50 + 45 * Math.tanh(lead / scale));
    const whitePct = 100 - blackPct;

    this.evalBarBlack.style.width = `${blackPct}%`;
    this.evalBlackPct.textContent = `Pretas: ${blackPct}%`;
    this.evalWhitePct.textContent = `Brancas: ${whitePct}%`;

    if (Math.abs(lead) < 2) {
      this.evalLead.textContent = 'Equilibrado';
    } else if (lead > 0) {
      this.evalLead.textContent = `Pretas lideram (+${lead.toFixed(1)} pts)`;
    } else {
      this.evalLead.textContent = `Brancas lideram (+${Math.abs(lead).toFixed(1)} pts)`;
    }
  }

  private renderMoveHistory(): void {
    const list = this.moveHistoryList;
    list.textContent = '';

    const size = this.mode === 'review' ? this.reviewSource?.size ?? this.boardSize : this.boardSize;
    const moves = this.mode === 'review' ? this.reviewSource?.moves ?? this.board.movesList : this.board.movesList;

    const fragment = document.createDocumentFragment();
    let activeEntry: HTMLElement | null = null;

    moves.forEach((m, idx) => {
      const isActive =
        this.mode === 'review' ? this.currentReviewMoveIndex === idx : this.replayIndex === idx + 1;

      const entry = document.createElement('div');
      entry.className = `move-entry ${isActive ? 'active' : ''}`;

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '4px';

      const num = document.createElement('span');
      num.style.color = 'var(--text-muted)';
      num.style.fontSize = '11px';
      num.style.width = '22px';
      num.textContent = `${idx + 1}.`;

      const stone = document.createElement('span');
      stone.style.fontSize = '11px';
      stone.textContent = m.color === 'black' ? '⚫' : '⚪';

      const coord = document.createElement('strong');
      coord.style.color = 'var(--text-primary)';
      coord.style.fontSize = '11px';
      coord.textContent = m.pass
        ? 'Passou'
        : m.resign
          ? 'Desistiu'
          : `${COLUMN_LETTERS[m.x] ?? '?'}${size - m.y}`;

      left.append(num, stone, coord);
      entry.appendChild(left);

      if (this.mode === 'review' && this.reviewReport?.evaluations[idx]) {
        const ev = this.reviewReport.evaluations[idx];
        const dot = document.createElement('span');
        dot.className = `move-eval-dot dot-${ev.classification}`;
        dot.title = ev.labelPt;
        entry.appendChild(dot);
      }

      entry.addEventListener('click', () => {
        if (this.mode === 'review') this.selectReviewMove(idx);
        else this.jumpReplay(idx + 1);
      });

      if (isActive) activeEntry = entry;
      fragment.appendChild(entry);
    });

    list.appendChild(fragment);

    if (activeEntry) (activeEntry as HTMLElement).scrollIntoView({ block: 'nearest' });
    else if (this.replayIndex === -1 && this.mode !== 'review') list.scrollTop = list.scrollHeight;
  }

  /** Coalesces hover-driven repaints into one per animation frame. */
  private scheduleRender(): void {
    if (this.renderHandle !== 0) return;
    this.renderHandle = requestAnimationFrame(() => {
      this.renderHandle = 0;
      this.render();
    });
  }

  public render(): void {
    if (this.mode === 'review') {
      this.renderReviewState();
      return;
    }

    const board = this.replayIndex === -1 ? this.board : this.buildLiveReplayBoard(this.replayIndex);
    const isLive = this.replayIndex === -1;
    const inf = this.showInfluenceMap && isLive ? this.getInfluence() : undefined;

    this.renderer.render(board, {
      theme: this.theme,
      showCoordinates: this.showCoordinates,
      showMoveNumbers: this.showMoveNumbers,
      showInfluenceMap: this.showInfluenceMap && isLive,
      influenceMatrix: inf?.matrix,
      influenceOwnership: inf?.ownership,
      hoverPoint: isLive ? this.hoverPoint : null,
      currentTurn: board.turn,
      lastMove: board.lastMove && !board.lastMove.pass && !board.lastMove.resign
        ? { x: board.lastMove.x, y: board.lastMove.y }
        : null,
      aiHint: isLive ? this.aiHint : null,
      deadStones: this.deadStones,
      territoryMap: this.scoringResult?.territoryMap,
      isScoringPhase: this.isScoringPhase,
      interactive: isLive && this.canPlayNow()
    });
  }

  private canPlayNow(): boolean {
    if (this.board.isGameOver || this.isScoringPhase) return false;
    if (this.mode === 'eve' || this.mode === 'joseki') return false;
    if (this.mode === 'pve') return !this.botThinking && this.board.turn === this.playerColor;
    return true;
  }

  /** Rebuilds the live game up to a replay position, reusing the last result. */
  private buildLiveReplayBoard(moveCount: number): GoBoard {
    const key = `live|${this.boardSize}|${moveCount}|${this.board.movesList.length}`;
    if (this.replayBoardCache && this.replayBoardCache.key === key) return this.replayBoardCache.board;

    const board = new GoBoard(this.boardSize);
    if (this.board.setupStones.length > 0) {
      board.placeSetupStones(
        this.board.setupStones.map(s => ({ ...s })),
        this.board.movesList[0]?.color ?? 'black'
      );
    }
    const limit = Math.max(0, Math.min(moveCount, this.board.movesList.length));
    for (let i = 0; i < limit; i++) {
      const m = this.board.movesList[i];
      if (m.pass) board.pass(m.color);
      else if (m.resign) board.resign(m.color);
      else board.playMove(m.x, m.y, m.color);
    }

    this.replayBoardCache = { key, board };
    return board;
  }

  private renderReviewState(): void {
    const report = this.reviewReport;
    if (!report) return;
    const ev = report.evaluations[this.currentReviewMoveIndex];
    if (!ev) return;

    const board = this.isSandboxMode && this.sandboxBoard
      ? this.sandboxBoard
      : this.buildReviewBoard(this.isChallengeMode ? this.currentReviewMoveIndex : this.currentReviewMoveIndex + 1);

    const ghostMoves: { point: Point; color: Color; step: number }[] = [];
    if (this.activeAlternative && !this.isChallengeMode && !this.isSandboxMode) {
      ghostMoves.push({ point: this.activeAlternative.point, color: ev.color, step: 1 });
    }
    if (this.isSandboxMode) ghostMoves.push(...this.sandboxMoves);

    const showOverlays = !this.isChallengeMode && !this.isSandboxMode;

    this.renderer.render(board, {
      theme: this.theme,
      showCoordinates: this.showCoordinates,
      showMoveNumbers: this.showMoveNumbers,
      showInfluenceMap: false,
      hoverPoint: this.hoverPoint,
      currentTurn: board.turn,
      lastMove: board.lastMove && !board.lastMove.pass && !board.lastMove.resign
        ? { x: board.lastMove.x, y: board.lastMove.y }
        : null,
      aiHint: null,
      interactive: this.isSandboxMode,
      reviewBadge: showOverlays && ev.playedMove
        ? { point: ev.playedMove, symbol: ev.badgeSymbol, color: ev.badgeColor }
        : null,
      reviewAlternatives: showOverlays ? ev.alternatives : [],
      variationGhostMoves: ghostMoves
    });
  }
}

// Bootstrap once the DOM is ready.
const start = () => {
  try {
    new App();
  } catch (err) {
    console.error('Falha ao iniciar o Go Master:', err);
    const status = document.getElementById('status-text');
    if (status) status.textContent = 'Erro ao iniciar a aplicação. Veja o console para detalhes.';
  }
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
