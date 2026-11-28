import type { SeasonalMotionMode } from './registry';

/** Budgets mesurables du moteur graphique : particules, DPR, canvas et RAF. */

export const MAX_CANVAS_BYTES = 12 * 1024 * 1024;
export const MAX_FRAME_DELTA_MS = 50;

export const PARTICLE_BUDGETS: Readonly<Record<string, number>> = Object.freeze({
  desktop: 42,
  tablet: 28,
  mobile: 18,
  tv: 0,
});

export function particleBudget(platform: string, motion: SeasonalMotionMode): number {
  if (motion !== 'full') return 0;
  return PARTICLE_BUDGETS[platform] ?? PARTICLE_BUDGETS.desktop;
}

export function clampDpr(dpr: number, platform = 'desktop'): number {
  const maximum = platform === 'mobile' ? 1.5 : platform === 'tv' ? 1 : 2;
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.min(maximum, Math.max(1, dpr));
}

export function canvasBytes(width: number, height: number, dpr: number): number {
  const pixelsWide = Math.max(0, Math.floor(width * dpr));
  const pixelsHigh = Math.max(0, Math.floor(height * dpr));
  return pixelsWide * pixelsHigh * 4;
}

export function canAllocateCanvas(allocations: readonly number[], next: number): boolean {
  if (!Number.isFinite(next) || next < 0) return false;
  const total = allocations.reduce((sum, bytes) => sum + (Number.isFinite(bytes) ? bytes : 0), next);
  return total <= MAX_CANVAS_BYTES;
}

export interface FrameSchedulerDependencies {
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
}

export interface FrameScheduler {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  isRunning(): boolean;
  readonly frames: number;
}

export function createFrameScheduler(
  dependencies: FrameSchedulerDependencies,
  onFrame: (deltaMs: number) => void,
): FrameScheduler {
  let running = false;
  let handle: number | null = null;
  let last = 0;
  let frames = 0;

  const schedule = () => {
    if (!running || handle !== null) return;
    handle = dependencies.requestFrame((time) => {
      handle = null;
      if (!running) return;
      const delta = Math.max(0, Math.min(MAX_FRAME_DELTA_MS, time - last));
      last = time;
      frames += 1;
      // Une exception de rendu ne doit pas tuer définitivement la boucle RAF.
      // L'erreur reste visible dans la console, mais la prochaine frame est planifiée.
      try {
        onFrame(delta);
      } finally {
        schedule();
      }
    });
  };

  const cancel = () => {
    if (handle !== null) {
      dependencies.cancelFrame(handle);
      handle = null;
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      last = dependencies.now();
      schedule();
    },
    pause() {
      if (!running) return;
      running = false;
      cancel();
    },
    resume() {
      if (running) return;
      running = true;
      last = dependencies.now();
      schedule();
    },
    stop() {
      running = false;
      cancel();
      last = 0;
    },
    isRunning: () => running,
    get frames() { return frames; },
  };
}
