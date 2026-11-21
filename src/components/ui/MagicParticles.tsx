"use client";

import React, { useEffect, useRef } from "react";

type Particle = {
  x: number; y: number; vx: number; vy: number;
  radius: number; alpha: number; phase: number;
};

type MagicParticlesProps = {
  className?: string;
  quantity?: number;
  color?: string;
};

/** Magic UI-inspired ambient particle field, scoped to the moving sleigh. */
export function MagicParticles({
  className = "",
  quantity = 34,
  color = "#f5d995",
}: MagicParticlesProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!host || !canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let frame = 0;
    let particles: Particle[] = [];
    let lastTime = 0;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = Array.from({ length: quantity }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: -.12 - Math.random() * .42,
        vy: -.18 + Math.random() * .36,
        radius: .7 + Math.random() * 1.7,
        alpha: .24 + Math.random() * .65,
        phase: Math.random() * Math.PI * 2,
      }));
    };

    const draw = (time: number) => {
      if (time - lastTime > 28) {
        lastTime = time;
        context.clearRect(0, 0, width, height);
        particles.forEach((particle) => {
          const shimmer = .62 + Math.sin(time * .0015 + particle.phase) * .28;
          context.beginPath();
          context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
          context.fillStyle = color;
          context.globalAlpha = particle.alpha * shimmer;
          context.shadowColor = color;
          context.shadowBlur = 7;
          context.fill();
          context.shadowBlur = 0;
          context.globalAlpha = 1;

          if (!reducedMotion) {
            particle.x += particle.vx;
            particle.y += particle.vy;
            if (particle.x < -4) particle.x = width + 4;
            if (particle.y < -4) particle.y = height + 4;
            if (particle.y > height + 4) particle.y = -4;
          }
        });
      }
      if (!reducedMotion) frame = window.requestAnimationFrame(draw);
    };

    resize();
    draw(0);
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    if (!reducedMotion) frame = window.requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      context.clearRect(0, 0, width, height);
    };
  }, [color, quantity]);

  return (
    <div ref={hostRef} className={className} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
