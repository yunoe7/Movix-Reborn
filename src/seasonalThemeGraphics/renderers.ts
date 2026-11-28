import { isAllowedSeasonalAsset, type SeasonalGraphicsSelection } from './registry';
import { canAllocateCanvas, canvasBytes, clampDpr, particleBudget } from './performance';
import type { SeasonalMotionMode } from './registry';

/**
 * Rendu des familles graphiques. Aucun composant React par particule : les
 * particules sont dessinées dans un unique canvas. Les couches DOM sont non
 * interactives, aria-hidden et créées uniquement depuis le resolver.
 */

export type ParticleKind = 'snow' | 'leaves' | 'candy' | 'spiders' | 'glow';

export interface ParticleRenderer {
  readonly count: number;
  resize(): void;
  frame(deltaMs: number): void;
  destroy(): void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  age: number;
  life: number;
  spin: number;
}

const COLORS: Record<ParticleKind, readonly string[]> = {
  snow: ['rgba(255,255,255,0.85)', 'rgba(214,236,255,0.75)'],
  leaves: ['rgba(196,106,38,0.8)', 'rgba(132,72,30,0.75)', 'rgba(214,150,48,0.8)'],
  candy: ['rgba(255,138,40,0.85)', 'rgba(150,86,214,0.8)', 'rgba(255,236,190,0.85)'],
  spiders: ['rgba(28,24,32,0.75)'],
  glow: ['rgba(255,170,70,0.65)', 'rgba(178,120,255,0.6)'],
};

/** Ajuste le DPR jusqu'à respecter le budget canvas (12 MiB), puis dimensionne. */
export function sizeParticleCanvas(canvas: HTMLCanvasElement, platform: string): {
  width: number; height: number; dpr: number;
} | null {
  const width = Math.max(1, canvas.clientWidth || (typeof window === 'undefined' ? 1 : window.innerWidth));
  const height = Math.max(1, canvas.clientHeight || (typeof window === 'undefined' ? 1 : window.innerHeight));
  let dpr = clampDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, platform);
  while (dpr > 1 && !canAllocateCanvas([], canvasBytes(width, height, dpr))) {
    dpr = Math.max(1, Number((dpr - 0.25).toFixed(2)));
  }
  if (!canAllocateCanvas([], canvasBytes(width, height, dpr))) return null;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  return { width, height, dpr };
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function createParticleRenderer(
  canvas: HTMLCanvasElement,
  kind: ParticleKind,
  platform: string,
  motion: SeasonalMotionMode,
): ParticleRenderer | null {
  const budget = particleBudget(platform, motion);
  if (budget <= 0) return null;
  const context = canvas.getContext('2d');
  if (!context) return null;

  let size = sizeParticleCanvas(canvas, platform);
  if (!size) return null;
  let particles: Particle[] = [];
  let destroyed = false;

  const spawn = (initial: boolean): Particle => {
    const life = randomBetween(2200, 5200);
    const speed = randomBetween(12, 36);
    return {
      x: randomBetween(0, size!.width),
      y: initial ? randomBetween(0, size!.height) : randomBetween(-40, -4),
      vx: kind === 'leaves' ? randomBetween(6, 24) : randomBetween(-8, 8),
      vy: kind === 'leaves' || kind === 'snow' ? speed : speed * 0.6,
      size: randomBetween(kind === 'glow' ? 6 : 2, kind === 'glow' ? 14 : 6),
      opacity: randomBetween(0.35, 0.85),
      age: initial ? randomBetween(0, life / 2) : 0,
      life,
      spin: randomBetween(-2, 2),
    };
  };

  particles = Array.from({ length: budget }, () => spawn(true));

  const draw = (particle: Particle) => {
    const color = COLORS[kind][Math.floor(particle.x) % COLORS[kind].length];
    context.globalAlpha = particle.opacity * Math.min(1, (particle.life - particle.age) / 600);
    context.fillStyle = color;
    context.beginPath();
    if (kind === 'spiders') {
      context.moveTo(particle.x, particle.y);
      context.lineTo(particle.x + particle.size, particle.y + particle.size * 0.25);
      context.lineTo(particle.x - particle.size, particle.y + particle.size * 0.25);
    } else if (kind === 'leaves') {
      context.ellipse(particle.x, particle.y, particle.size, particle.size * 0.45, particle.age * particle.spin / 400, 0, Math.PI * 2);
    } else {
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    }
    context.fill();
  };

  return {
    get count() { return particles.length; },
    resize() {
      if (destroyed) return;
      const next = sizeParticleCanvas(canvas, platform);
      if (!next) {
        particles = [];
        // Libère immédiatement le backing store précédent si le viewport
        // dépasse le budget mémoire autorisé après un redimensionnement.
        canvas.width = 0;
        canvas.height = 0;
        return;
      }
      const scaleX = next.width / size.width;
      const scaleY = next.height / size.height;
      size = next;
      for (const particle of particles) {
        particle.x *= scaleX;
        particle.y *= scaleY;
      }
      if (particles.length === 0) particles = Array.from({ length: budget }, () => spawn(true));
    },
    frame(deltaMs: number) {
      if (destroyed || !size || particles.length === 0) return;
      const step = Math.min(50, Math.max(0, deltaMs)) / 1000;
      context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        particle.age += deltaMs;
        particle.x += particle.vx * step + (kind === 'candy' ? Math.sin(particle.age / 300) * 8 * step : 0);
        particle.y += particle.vy * step;
        if (particle.age >= particle.life || particle.y > size.height + 20) {
          particles[index] = spawn(false);
          continue;
        }
        draw(particle);
      }
      context.globalAlpha = 1;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      particles = [];
      context.clearRect(0, 0, canvas.width, canvas.height);
      // Remettre les dimensions à zéro libère le backing store du canvas.
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

export function themeKeyFor(id: string): string | null {
  const key = id.split('.')[0];
  return key === 'halloween' || key === 'christmas' ? key : null;
}

export function createStaticLayer(selection: SeasonalGraphicsSelection): HTMLElement | null {
  const { definition, decoration } = selection;
  const key = themeKeyFor(definition.id);
  if (!key) return null;

  if (definition.family === 'typography') return null;

  const layer = document.createElement('div');
  layer.className = `sg-layer sg-layer--${definition.family} sg-theme--${key}`;
  layer.setAttribute('data-sg-decoration', definition.id);

  if (definition.family === 'background') {
    const asset = isAllowedSeasonalAsset(decoration.options?.assetPath);
    if (asset) layer.style.setProperty('--sg-asset', `url("${asset}")`);
    const opacity = Number(decoration.options?.opacity);
    if (Number.isFinite(opacity) && opacity >= 0 && opacity <= 1) {
      layer.style.setProperty('--sg-opacity', String(opacity));
    }
  }

  if (definition.family === 'screenDecor') {
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const element = document.createElement('span');
      element.className = `sg-corner sg-corner--${corner}`;
      layer.append(element);
    }
    const base = document.createElement('span');
    base.className = 'sg-base-decor';
    layer.append(base);
  }

  if (definition.family === 'lights') {
    for (const spot of ['left', 'right', 'top']) {
      const element = document.createElement('span');
      element.className = `sg-light sg-light--${spot}`;
      layer.append(element);
    }
  }

  return layer;
}

export function particleKindFor(selection: SeasonalGraphicsSelection): ParticleKind | null {
  return selection.definition.particleKind ?? null;
}
