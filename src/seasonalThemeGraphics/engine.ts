import {
  loadSeasonalGraphics,
  type SeasonalGraphicsReason,
  type SeasonalGraphicsSnapshot,
  type SeasonalResolver,
} from './loader';
import { detectPlatform, motionPolicy, type SeasonalPlatform } from './platform';
import { createFrameScheduler } from './performance';
import { selectGraphicsDecorations, type SeasonalGraphicsSelection } from './registry';
import {
  createParticleRenderer,
  createStaticLayer,
  particleKindFor,
  type ParticleRenderer,
} from './renderers';
import type { SeasonalRouteMode } from './routes';
import { SeasonalTypographyController } from './typography/controller';

/**
 * Cycle de vie du moteur : chargement du resolver, rendu, rafraîchissement,
 * arrêt d'urgence et nettoyage intégral. Aucune source locale n'est lue ici.
 */

export const SEASONAL_GRAPHICS_REFRESH_MS = 20_000;

export interface SeasonalGraphicsState {
  ready: boolean;
  active: boolean;
  /** Vrai quand une configuration publiée ou une urgence prend l'autorité. */
  override: boolean;
  reason: SeasonalGraphicsReason | 'idle' | 'excluded';
  revision: number | null;
  emergency: boolean;
  decorations: string[];
  families: string[];
  particles: number;
  frames: number;
  platform: SeasonalPlatform;
}

export interface SeasonalGraphicsEngineOptions {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  resolve: SeasonalResolver;
  platform?: SeasonalPlatform;
  reducedMotion?: boolean;
  mode: SeasonalRouteMode;
  refreshMs?: number;
  onState?: (state: SeasonalGraphicsState) => void;
}

const EMPTY_STATE: SeasonalGraphicsState = {
  ready: false,
  active: false,
  override: false,
  reason: 'idle',
  revision: null,
  emergency: false,
  decorations: [],
  families: [],
  particles: 0,
  frames: 0,
  platform: 'desktop',
};

export class SeasonalGraphicsEngine {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly resolve: SeasonalResolver;
  private readonly platform: SeasonalPlatform;
  private readonly motion: ReturnType<typeof motionPolicy>;
  private readonly mode: SeasonalRouteMode;
  private readonly refreshMs: number;
  private readonly onState?: (state: SeasonalGraphicsState) => void;

  private state: SeasonalGraphicsState = EMPTY_STATE;
  private layers: HTMLElement[] = [];
  private particles: ParticleRenderer | null = null;
  private scheduler = createFrameScheduler({
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    now: () => performance.now(),
  }, (delta) => this.particles?.frame(delta));
  private typography: SeasonalTypographyController;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private appliedTypographyRevision: number | null = null;
  private destroyed = false;
  private started = false;
  private hidden = false;

  constructor(options: SeasonalGraphicsEngineOptions) {
    this.root = options.root;
    this.canvas = options.canvas;
    this.resolve = options.resolve;
    this.platform = options.platform ?? detectPlatform({
      viewportWidth: typeof window === 'undefined' ? undefined : window.innerWidth,
      tv: typeof document !== 'undefined' && document.documentElement.classList.contains('tv-mode'),
    });
    const reduced = options.reducedMotion ?? (typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.motion = motionPolicy(this.platform, reduced);
    this.typography = new SeasonalTypographyController({ staticOnly: this.motion !== 'full' });
    this.mode = options.mode;
    this.refreshMs = options.refreshMs ?? SEASONAL_GRAPHICS_REFRESH_MS;
    this.onState = options.onState;
    this.state = { ...EMPTY_STATE, platform: this.platform };
  }

  getState(): SeasonalGraphicsState {
    // Les frames sont un compteur vivant : il ne doit pas exploser l'état React
    // à chaque frame, mais l'état exposé doit rester exact quand on le lit.
    return { ...this.state, frames: this.scheduler.frames };
  }

  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    if (this.mode === 'none') {
      this.setState({ ...this.state, ready: true, reason: 'excluded' });
      return;
    }
    this.hidden = typeof document !== 'undefined' && document.hidden;
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('focus', this.onFocus);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('online', this.onFocus);
    this.refreshTimer = setInterval(() => {
      if (!this.hidden) void this.refresh();
    }, this.refreshMs);
    void this.refresh();
  }

  /** Recharge la configuration publiée ; les appels périmés sont ignorés. */
  async refresh(): Promise<void> {
    if (this.destroyed || this.mode === 'none') return;
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const snapshot = await loadSeasonalGraphics(this.resolve, {
      platform: this.platform,
      capabilities: this.capabilities(),
    }, controller.signal);
    if (this.destroyed || generation !== this.generation) return;
    this.apply(snapshot);
  }

  private capabilities(): string[] {
    const capabilities: string[] = [];
    if (this.platform === 'tv') capabilities.push('tvStaticEffects');
    if (this.motion !== 'full') capabilities.push('reducedMotion');
    return capabilities;
  }

  private apply(snapshot: SeasonalGraphicsSnapshot): void {
    this.clearVisuals();
    const root = document.documentElement;
    const active = snapshot.active;
    const override = active || snapshot.reason === 'emergency';
    root.dataset.seasonalGraphics = override ? (active ? 'active' : 'emergency') : 'inactive';

    if (!active) {
      delete root.dataset.seasonalComponents;
      this.typography.clear();
      this.appliedTypographyRevision = null;
      this.setState({
        ...this.state,
        ready: true,
        active: false,
        override,
        reason: snapshot.reason,
        revision: snapshot.revision,
        emergency: snapshot.emergency,
        decorations: [],
        families: [],
        particles: 0,
      });
      return;
    }

    const selected = selectGraphicsDecorations(snapshot.decorations, { motion: this.motion });
    const layers: HTMLElement[] = [];
    const families: string[] = [];
    let particle: ParticleRenderer | null = null;

    for (const entry of selected) {
      families.push(entry.definition.family);
      if (entry.definition.family === 'components') continue;
      if (entry.definition.family === 'typography') continue;
      const layer = createStaticLayer(entry);
      if (layer) layers.push(layer);
      if (entry.definition.family === 'particles' && this.mode === 'full') {
        const kind = particleKindFor(entry);
        if (kind) particle = createParticleRenderer(this.canvas, kind, this.platform, this.motion);
      }
    }

    for (const layer of layers) this.root.append(layer);
    this.layers = layers;
    this.particles = particle;

    const components = selected.find((entry: SeasonalGraphicsSelection) => entry.definition.family === 'components');
    if (components) root.dataset.seasonalComponents = components.id.startsWith('christmas') ? 'christmas' : 'halloween';
    else delete root.dataset.seasonalComponents;

    if (particle && !this.hidden) this.scheduler.start();

    if (this.appliedTypographyRevision !== snapshot.revision) {
      this.appliedTypographyRevision = snapshot.revision;
      void this.typography.apply(snapshot.typography);
    }

    this.setState({
      ...this.state,
      ready: true,
      active: true,
      override: true,
      reason: 'published',
      revision: snapshot.revision,
      emergency: false,
      decorations: selected.map((entry) => entry.id),
      families,
      particles: particle?.count ?? 0,
    });
  }

  private setState(next: SeasonalGraphicsState): void {
    this.state = { ...next, frames: this.scheduler.frames };
    this.onState?.(this.getState());
  }

  private clearVisuals(): void {
    this.scheduler.stop();
    this.particles?.destroy();
    this.particles = null;
    for (const layer of this.layers) layer.remove();
    this.layers = [];
    const context = this.canvas.getContext('2d');
    context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private readonly onVisibility = () => {
    if (this.destroyed) return;
    this.hidden = document.hidden;
    if (this.hidden) this.scheduler.pause();
    else {
      void this.refresh();
      if (this.particles) this.scheduler.resume();
    }
  };

  private readonly onFocus = () => {
    if (!this.destroyed && !this.hidden) void this.refresh();
  };

  private readonly onResize = () => {
    if (this.destroyed || this.hidden || !this.particles) return;
    this.particles.resize();
    this.scheduler.resume();
  };

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.controller?.abort();
    if (this.refreshTimer !== null) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('focus', this.onFocus);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('online', this.onFocus);
    this.clearVisuals();
    this.typography.destroy();
    this.appliedTypographyRevision = null;
    delete document.documentElement.dataset.seasonalGraphics;
    delete document.documentElement.dataset.seasonalComponents;
    this.setState({ ...EMPTY_STATE, platform: this.platform, reason: 'idle' });
  }
}
