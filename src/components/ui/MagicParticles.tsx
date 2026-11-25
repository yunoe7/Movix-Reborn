import React, { useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";

type MousePosition = { x: number; y: number };

function useMousePosition(): MousePosition {
  const [position, setPosition] = useState<MousePosition>({ x: 0, y: 0 });
  useEffect(() => {
    const move = (event: MouseEvent) => setPosition({ x: event.clientX, y: event.clientY });
    window.addEventListener("mousemove", move, { passive: true });
    return () => window.removeEventListener("mousemove", move);
  }, []);
  return position;
}

interface MagicParticlesProps extends ComponentPropsWithoutRef<"div"> {
  quantity?: number;
  staticity?: number;
  ease?: number;
  size?: number;
  refresh?: boolean;
  color?: string;
  vx?: number;
  vy?: number;
}

type Circle = {
  x: number; y: number; translateX: number; translateY: number;
  size: number; alpha: number; targetAlpha: number;
  dx: number; dy: number; magnetism: number;
};

function hexToRgb(hex: string): number[] {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const parsed = Number.parseInt(normalized, 16);
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

/**
 * Magic UI Particles, adapted from the official Magic UI registry for Movix:
 * no Tailwind dependency, with a scoped canvas and a low particle count.
 */
export const MagicParticles: React.FC<MagicParticlesProps> = ({
  className = "",
  quantity = 42,
  staticity = 50,
  ease = 50,
  size = 0.7,
  refresh = false,
  color = "#f5d995",
  vx = -0.12,
  vy = 0,
  ...props
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const context = useRef<CanvasRenderingContext2D | null>(null);
  const circles = useRef<Circle[]>([]);
  const mousePosition = useMousePosition();
  const mouse = useRef({ x: 0, y: 0 });
  const canvasSize = useRef({ w: 0, h: 0 });
  const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const rafId = useRef<number | null>(null);
  const reducedMotion = useRef(false);
  const resizeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initCanvasRef = useRef<() => void>(() => {});
  const onMouseMoveRef = useRef<() => void>(() => {});
  const animateRef = useRef<() => void>(() => {});
  const rgb = hexToRgb(color);

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (canvasRef.current) context.current = canvasRef.current.getContext("2d");
    initCanvasRef.current();
    if (reducedMotion.current) circles.current.forEach((circle) => { circle.alpha = circle.targetAlpha; });
    animateRef.current();

    const onResize = () => {
      if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
      resizeTimeout.current = setTimeout(() => initCanvasRef.current(), 160);
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
      window.removeEventListener("resize", onResize);
    };
  }, [color]);

  useEffect(() => { onMouseMoveRef.current(); }, [mousePosition.x, mousePosition.y]);
  useEffect(() => { initCanvasRef.current(); }, [refresh]);

  const circleParams = (): Circle => {
    const targetAlpha = Number((Math.random() * 0.48 + 0.18).toFixed(2));
    return {
      x: Math.floor(Math.random() * canvasSize.current.w),
      y: Math.floor(Math.random() * canvasSize.current.h),
      translateX: 0,
      translateY: 0,
      size: Math.random() * 1.1 + size,
      alpha: reducedMotion.current ? targetAlpha : 0,
      targetAlpha,
      dx: (Math.random() - 0.5) * 0.12,
      dy: (Math.random() - 0.5) * 0.12,
      magnetism: 0.6 + Math.random() * 2.2,
    };
  };

  const drawCircle = (circle: Circle, add = false) => {
    if (!context.current) return;
    context.current.translate(circle.translateX, circle.translateY);
    context.current.beginPath();
    context.current.arc(circle.x, circle.y, circle.size, 0, Math.PI * 2);
    context.current.fillStyle = `rgba(${rgb.join(",")},${circle.alpha})`;
    context.current.fill();
    context.current.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (add) circles.current.push(circle);
  };

  const initCanvas = () => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas || !context.current) return;
    canvasSize.current = { w: Math.max(1, host.offsetWidth), h: Math.max(1, host.offsetHeight) };
    canvas.width = Math.round(canvasSize.current.w * dpr);
    canvas.height = Math.round(canvasSize.current.h * dpr);
    context.current.setTransform(dpr, 0, 0, dpr, 0, 0);
    circles.current = [];
    for (let i = 0; i < quantity; i++) drawCircle(circleParams(), true);
  };

  const onMouseMove = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = mousePosition.x - rect.left - canvasSize.current.w / 2;
    const y = mousePosition.y - rect.top - canvasSize.current.h / 2;
    if (Math.abs(x) < canvasSize.current.w / 2 && Math.abs(y) < canvasSize.current.h / 2) mouse.current = { x, y };
  };

  const animate = () => {
    const ctx = context.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasSize.current.w, canvasSize.current.h);
    circles.current.forEach((circle, index) => {
      const edge = [
        circle.x + circle.translateX - circle.size,
        canvasSize.current.w - circle.x - circle.translateX - circle.size,
        circle.y + circle.translateY - circle.size,
        canvasSize.current.h - circle.y - circle.translateY - circle.size,
      ];
      const closest = Math.min(...edge);
      const fade = Math.max(0, Math.min(1, closest / 20));
      circle.alpha = Math.min(circle.targetAlpha, circle.alpha + 0.02) * fade;
      circle.x += circle.dx + vx;
      circle.y += circle.dy + vy;
      circle.translateX += (mouse.current.x / (staticity / circle.magnetism) - circle.translateX) / ease;
      circle.translateY += (mouse.current.y / (staticity / circle.magnetism) - circle.translateY) / ease;
      drawCircle(circle);
      if (circle.x < -circle.size || circle.x > canvasSize.current.w + circle.size ||
          circle.y < -circle.size || circle.y > canvasSize.current.h + circle.size) {
        circles.current.splice(index, 1);
        drawCircle(circleParams(), true);
      }
    });
    if (!reducedMotion.current) rafId.current = requestAnimationFrame(animateRef.current);
  };

  useLayoutEffect(() => {
    initCanvasRef.current = initCanvas;
    onMouseMoveRef.current = onMouseMove;
    animateRef.current = animate;
  });

  return (
    <div ref={hostRef} className={`pointer-events-none ${className}`} aria-hidden="true" {...props}>
      <canvas ref={canvasRef} />
    </div>
  );
};
