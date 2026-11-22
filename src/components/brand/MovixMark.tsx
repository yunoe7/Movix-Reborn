import type { SVGProps } from 'react';

/** Monogramme Movix inspiré du premier M fourni : dégradé rouge et tracé arrondi. */
export function MovixMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 200 112" role="img" aria-label="Movix" {...props}>
      <defs>
        <linearGradient id="movix-mark-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff4b55" />
          <stop offset="48%" stopColor="#ed202d" />
          <stop offset="100%" stopColor="#b90d1c" />
        </linearGradient>
        <filter id="movix-mark-shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="4" />
          <feOffset dy="3" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.2" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d="M 34 91 V 25 L 100 78 L 166 25 V 91"
        fill="none"
        stroke="url(#movix-mark-gradient)"
        strokeWidth="27"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#movix-mark-shadow)"
      />
    </svg>
  );
}
