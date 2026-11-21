import { useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useLightMode } from '@/context/LightModeContext';
import { CHRISTMAS_ENABLED_ATTR, CHRISTMAS_THEME_CLASS, useChristmasTheme } from '@/hooks/useChristmasTheme';
import { MagicParticles } from '@/components/ui/MagicParticles';
import './christmas-atmosphere.css';

const LIGHTS = Array.from({ length: 17 }, (_, index) => index);

export const ChristmasAtmosphere = ({ suspended }: { suspended: boolean }) => {
  const enabled = useChristmasTheme();
  const { isLightMode } = useLightMode();
  const { pathname } = useLocation();
  const active = enabled && !suspended && !isLightMode;

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle(CHRISTMAS_THEME_CLASS, active);
    if (enabled) root.setAttribute(CHRISTMAS_ENABLED_ATTR, '');
    else root.removeAttribute(CHRISTMAS_ENABLED_ATTR);
    return () => {
      root.classList.remove(CHRISTMAS_THEME_CLASS);
      root.removeAttribute(CHRISTMAS_ENABLED_ATTR);
    };
  }, [active, enabled]);

  if (!active) return null;
  const isDetail = /^\/(movie|tv)\//.test(pathname);

  return createPortal(
    <div className={`movix-christmas-atmosphere ${isDetail ? 'is-detail' : ''}`} aria-hidden="true">
      <div className="mx-xmas-snow mx-xmas-snow-back" />
      <div className="mx-xmas-snow mx-xmas-snow-mid" />
      <div className="mx-xmas-snow mx-xmas-snow-front" />
      <div className="mx-xmas-garland mx-xmas-garland-left">
        <svg viewBox="0 0 520 150" preserveAspectRatio="none">
          <path className="mx-xmas-wire" d="M-20 4 C90 112 165 118 260 58 S420 0 540 68" />
          <path className="mx-xmas-pine" d="M8 10 C30 24 36 42 48 58 M28 22 L5 14 M34 30 L58 23 M42 42 L20 37 M49 52 L75 43 M118 77 C138 90 148 104 160 120 M138 91 L116 84 M146 101 L172 91 M154 112 L132 107 M265 58 C285 70 300 86 312 103 M285 72 L264 64 M294 82 L321 73 M304 94 L283 90" />
        </svg>
      </div>
      <div className="mx-xmas-garland mx-xmas-garland-right">
        <svg viewBox="0 0 520 150" preserveAspectRatio="none">
          <path className="mx-xmas-wire" d="M-20 68 C100 0 180 118 280 58 S440 6 540 4" />
          <path className="mx-xmas-pine" d="M8 68 C30 52 42 38 54 22 M28 55 L5 62 M36 45 L61 51 M45 34 L22 30 M54 23 L78 32 M152 80 C172 92 184 106 196 122 M172 93 L150 86 M180 103 L206 94 M190 114 L166 108 M285 58 C305 72 320 86 332 104 M305 72 L284 64 M314 83 L341 74 M324 95 L303 89" />
        </svg>
      </div>
      <div className="mx-xmas-light-string">
        {LIGHTS.map((light) => <span key={light} style={{ '--light-index': light, marginTop: `${12 + Math.sin(light * 0.55) * 18}px` } as React.CSSProperties} />)}
      </div>
      <div className="mx-xmas-ornament mx-xmas-ornament-one"><i /></div>
      <div className="mx-xmas-ornament mx-xmas-ornament-two"><i /></div>
      <div className="mx-xmas-ornament mx-xmas-ornament-three"><i /></div>
      {/* Le traîneau traverse le ciel comme la sorcière à Halloween, sans intercepter les clics. */}
      <div className="mx-xmas-sleigh-flight">
        <MagicParticles className="mx-xmas-sleigh-particles" quantity={42} color="#f5d995" />
        <div className="mx-xmas-sleigh-bob">
          <svg viewBox="0 0 760 250" role="presentation" focusable="false">
            <defs>
              <linearGradient id="xmas-sleigh-red" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ff8a83" />
                <stop offset=".42" stopColor="#d7354b" />
                <stop offset="1" stopColor="#701b31" />
              </linearGradient>
              <linearGradient id="xmas-gold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff4c9" />
                <stop offset=".48" stopColor="#e9bd67" />
                <stop offset="1" stopColor="#9a6228" />
              </linearGradient>
              <linearGradient id="xmas-fur" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fffdf5" />
                <stop offset="1" stopColor="#d8d0c4" />
              </linearGradient>
              <linearGradient id="xmas-coat" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#f04b55" />
                <stop offset="1" stopColor="#9d1f35" />
              </linearGradient>
              <filter id="xmas-sleigh-glow" x="-25%" y="-35%" width="155%" height="175%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feColorMatrix in="blur" type="matrix" values="1 0 0 0 .35  0 1 0 0 .22  0 0 1 0 .08  0 0 0 .72 0" result="warmGlow" />
                <feMerge><feMergeNode in="warmGlow" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <g id="xmas-reindeer">
                <path d="M15 53c-8-12-4-28 10-35 15-8 40-4 53 8l23 4 18 13-8 15-26 3c-14 15-39 18-57 7z" fill="#9a603b" stroke="#59351f" strokeWidth="3" />
                <path d="M82 31l26-9 18 9-8 18-27 5-13-9z" fill="#b77b50" stroke="#704326" strokeWidth="2.5" />
                <path d="M111 32l20-1 12 10-12 12-20-4z" fill="#d7a477" stroke="#704326" strokeWidth="2" />
                <path d="M137 39l10 2 4 6-10 6-8-4z" fill="#f1d8b8" stroke="#704326" strokeWidth="1.5" />
                <path d="M104 31q-7-14-20-14" fill="none" stroke="#5a3825" strokeWidth="3" strokeLinecap="round" />
                <path d="M21 76l-5 37m24-35 2 38m35-40 6 37m18-40 8 35" fill="none" stroke="#704326" strokeWidth="7" strokeLinecap="round" />
                <path d="M17 112l-8 2m31 2-7 2m50-3-8 2m36-3-8 2" fill="none" stroke="#4b2b1c" strokeWidth="3" strokeLinecap="round" />
                <path d="M22 25Q5 10 12-4m1 16Q-5 12-7 1m21 17Q29 5 26-10m-5 27Q39 23 42 8" fill="none" stroke="#76502f" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M11 30Q-2 20-8 24" fill="none" stroke="#76502f" strokeWidth="4" strokeLinecap="round" />
                <circle cx="111" cy="34" r="3.4" fill="#24170f" />
                <path d="M142 46l6 2-6 3" fill="none" stroke="#704326" strokeWidth="1.8" strokeLinecap="round" />
              </g>
            </defs>

            {/* A fine, warm trail gives the flight a cinematic sense of speed. */}
            <g className="mx-xmas-sleigh-stars" fill="#ffe9b2">
              <path d="M30 82l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" />
              <path d="M355 25l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" />
              <circle cx="85" cy="170" r="2.5" /><circle cx="385" cy="185" r="2" />
              <circle cx="720" cy="60" r="2.5" /><circle cx="340" cy="68" r="2" />
            </g>
            <g fill="none" strokeLinecap="round">
              <path d="M285 116C345 92 370 92 411 101" stroke="#f6d58e" strokeWidth="2.5" opacity=".82" />
              <path d="M286 129C348 115 390 116 445 112" stroke="#dba94e" strokeWidth="1.8" opacity=".72" />
              <path d="M287 142C360 143 410 135 474 123" stroke="#f8e2ad" strokeWidth="1.4" opacity=".52" />
            </g>

            {/* Four reindeer, staggered in depth with a readable harness. */}
            <g className="mx-xmas-reindeer">
              <use href="#xmas-reindeer" transform="translate(385 42) scale(.68)" />
              <use href="#xmas-reindeer" transform="translate(462 26) scale(.75)" />
              <use href="#xmas-reindeer" transform="translate(545 42) scale(.82)" />
              <use href="#xmas-reindeer" transform="translate(630 25) scale(.9)" />
              <path d="M390 135C465 116 535 116 690 99" fill="none" stroke="#bd8a4d" strokeWidth="2.8" strokeLinecap="round" />
              <path d="M390 146C470 139 565 134 706 116" fill="none" stroke="#e3bc73" strokeWidth="2" strokeLinecap="round" />
              <path d="M694 69c8-7 18-4 18 5 0 8-8 12-15 8" fill="none" stroke="#8f242e" strokeWidth="3.5" strokeLinecap="round" />
              <circle cx="710" cy="78" r="5.5" fill="#d94b50" filter="url(#xmas-sleigh-glow)" />
            </g>

            {/* Sleigh runner and carved golden body. */}
            <g filter="url(#xmas-sleigh-glow)">
              <path d="M49 186c20 33 70 43 153 39 66-3 104-18 119-43" fill="none" stroke="url(#xmas-gold)" strokeWidth="8" strokeLinecap="round" />
              <path d="M52 185c-22-2-34-15-30-29 3-12 15-17 29-12" fill="none" stroke="url(#xmas-gold)" strokeWidth="6" strokeLinecap="round" />
              <path d="M71 139h256l-19 52H102z" fill="url(#xmas-sleigh-red)" stroke="#f3d18a" strokeWidth="3.5" />
              <path d="M88 139h224l-9 13H96z" fill="url(#xmas-gold)" />
              <path d="M110 152h192" stroke="#7b1c2e" strokeWidth="2" opacity=".55" />
              <path d="M125 153v35m53-35v35m53-35v35m53-35v35" stroke="#f0c878" strokeWidth="3" opacity=".86" />
              <path d="M98 190h205" stroke="#f8dfa6" strokeWidth="3" opacity=".8" />
              <path d="M112 194l-9 10m189-10 9 10" stroke="#e8bd68" strokeWidth="4" strokeLinecap="round" />
              <rect x="111" y="105" width="48" height="34" rx="5" fill="#176344" stroke="#e8c879" strokeWidth="3" />
              <path d="M135 105v34m-24-17h48" stroke="#f7dda0" strokeWidth="5" />
              <rect x="168" y="94" width="54" height="45" rx="5" fill="#244f82" stroke="#e8c879" strokeWidth="3" />
              <path d="M195 94v45m-27-22h54" stroke="#f7dda0" strokeWidth="5" />
              <path d="M246 110q19-19 37-5l-4 34h-34z" fill="#d8a34f" stroke="#f4d58d" strokeWidth="2" />
              <path d="M249 109q12-16 25-5" fill="none" stroke="#fff0c5" strokeWidth="4" strokeLinecap="round" />
            </g>

            {/* Santa: full red coat, fur trim, expressive face and unmistakable hat. */}
            <g className="mx-xmas-santa">
              <path d="M211 139c-3-26 9-42 31-45 27-3 47 16 47 43l-5 34h-74z" fill="url(#xmas-coat)" stroke="#7f1c2d" strokeWidth="3" />
              <path d="M207 145q39 15 84 0l-5 17q-39 14-75 0z" fill="url(#xmas-fur)" stroke="#d8cfc2" strokeWidth="2" />
              <path d="M218 112q-2-38 27-43 30-5 39 25l-7 25-54 8z" fill="#e9b98f" stroke="#9a5b48" strokeWidth="2" />
              <path d="M215 92q-2-37 31-43 35-5 45 31-26-16-77 12z" fill="#b9273d" stroke="#7e1c2d" strokeWidth="3" />
              <path d="M214 91q37-22 78-7" fill="none" stroke="#fff7e8" strokeWidth="12" strokeLinecap="round" />
              <path d="M243 48q5-13 18-18 4 16-8 25" fill="#c82d43" stroke="#7e1c2d" strokeWidth="2" />
              <circle cx="263" cy="31" r="9" fill="#fff8e8" stroke="#e5d9c8" strokeWidth="2" />
              <path d="M231 105q7-6 14 0m12 0q7-6 14 0" fill="none" stroke="#56372e" strokeWidth="2.8" strokeLinecap="round" />
              <path d="M250 112q5 5 10 0" fill="none" stroke="#a85d50" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M224 117q27 39 55 0 0 35-27 40-26-4-28-40z" fill="url(#xmas-fur)" stroke="#d2c6b8" strokeWidth="2" />
              <path d="M225 122q12-13 25-4 13-9 25 4-10 17-25 12-15 5-25-12z" fill="#fffaf0" stroke="#e3d7c8" strokeWidth="1.5" />
              <path d="M228 169q25 9 49 0" fill="none" stroke="#f7d58e" strokeWidth="4" strokeLinecap="round" />
              <path d="M237 150l-5 16m30-16 6 16" stroke="#f4e5ce" strokeWidth="3" strokeLinecap="round" />
              <path d="M218 126q-17 7-20 22 11 9 24 0" fill="#e9b98f" stroke="#9a5b48" strokeWidth="2" />
              <path d="M204 146l-9 8" stroke="#fff3df" strokeWidth="8" strokeLinecap="round" />
            </g>
            <g fill="#ffe6a6" opacity=".9">
              <circle cx="38" cy="125" r="2.5" /><circle cx="335" cy="105" r="2" />
              <circle cx="372" cy="160" r="2.4" /><circle cx="735" cy="146" r="2" />
            </g>
          </svg>
        </div>
      </div>
      <div className="mx-xmas-ground mx-xmas-ground-left" />
      <div className="mx-xmas-ground mx-xmas-ground-right" />
      <div className="mx-xmas-gift mx-xmas-gift-left"><i /><b /><span /></div>
      <div className="mx-xmas-gift mx-xmas-gift-right"><i /><b /><span /></div>
      <div className="mx-xmas-sparkle mx-xmas-sparkle-one">✦</div>
      <div className="mx-xmas-sparkle mx-xmas-sparkle-two">✧</div>
    </div>,
    document.body,
  );
};
