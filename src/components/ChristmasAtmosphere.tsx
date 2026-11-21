import { useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useLightMode } from '@/context/LightModeContext';
import { CHRISTMAS_ENABLED_ATTR, CHRISTMAS_THEME_CLASS, useChristmasTheme } from '@/hooks/useChristmasTheme';
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
        <div className="mx-xmas-sleigh-bob">
          <svg viewBox="0 0 620 190" role="presentation" focusable="false">
            <defs>
              <linearGradient id="xmas-sleigh-red" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ff7774" />
                <stop offset=".52" stopColor="#c92f43" />
                <stop offset="1" stopColor="#781b2d" />
              </linearGradient>
              <linearGradient id="xmas-gold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff0b4" />
                <stop offset=".5" stopColor="#e5b957" />
                <stop offset="1" stopColor="#9e6828" />
              </linearGradient>
              <filter id="xmas-sleigh-glow" x="-30%" y="-40%" width="160%" height="180%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <g className="mx-xmas-sleigh-stars" fill="#ffe7a6">
              <path d="M28 42l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" />
              <path d="M345 24l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
              <circle cx="78" cy="112" r="2.8" /><circle cx="390" cy="150" r="2" /><circle cx="580" cy="42" r="2.5" />
            </g>
            {/* Guides et harnais */}
            <g fill="none" stroke="#d7ae61" strokeWidth="3" strokeLinecap="round" opacity=".9">
              <path d="M268 104 C316 83 333 76 365 83 M270 116 C326 103 365 106 415 92 M270 122 C360 132 430 120 493 100" />
            </g>
            {/* Trois rennes, silhouettes dessinées en vectoriel */}
            <g className="mx-xmas-reindeer" stroke="#6f432b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <g transform="translate(340 40)">
                <path fill="#a96c43" d="M20 56c-12-9-13-25-3-34 12-10 35-5 42 7l18 2 12 13-13 11-22-4c-8 11-23 13-34 5z" />
                <path fill="#c98b5d" d="M68 35l19-7 12 7-10 13-18 1z" />
                <path fill="#f3d9b8" d="M86 37l12-2 5 6-9 7-10-2z" />
                <circle cx="78" cy="37" r="3.2" fill="#211712" stroke="none" />
                <path fill="none" stroke="#b47b4f" strokeWidth="7" d="M27 70l-3 31m19-30 3 30m24-34 4 32" />
                <path fill="none" stroke="#b47b4f" strokeWidth="5" d="M19 26Q5 10 11 0m0 10Q-1 4 0-5m12 14Q27 4 25-7m-5 17Q-2 20-8 13" />
                <path fill="#e6c18a" stroke="none" d="M94 43l5 1-3 4-5-1z" />
              </g>
              <g transform="translate(430 28) scale(.9)">
                <path fill="#a96c43" d="M20 56c-12-9-13-25-3-34 12-10 35-5 42 7l18 2 12 13-13 11-22-4c-8 11-23 13-34 5z" />
                <path fill="#c98b5d" d="M68 35l19-7 12 7-10 13-18 1z" />
                <path fill="#f3d9b8" d="M86 37l12-2 5 6-9 7-10-2z" />
                <circle cx="78" cy="37" r="3.2" fill="#211712" stroke="none" />
                <path fill="none" stroke="#b47b4f" strokeWidth="7" d="M27 70l-3 31m19-30 3 30m24-34 4 32" />
                <path fill="none" stroke="#b47b4f" strokeWidth="5" d="M19 26Q5 10 11 0m0 10Q-1 4 0-5m12 14Q27 4 25-7" />
              </g>
              <g transform="translate(520 47) scale(.76)">
                <path fill="#a96c43" d="M20 56c-12-9-13-25-3-34 12-10 35-5 42 7l18 2 12 13-13 11-22-4c-8 11-23 13-34 5z" />
                <path fill="#c98b5d" d="M68 35l19-7 12 7-10 13-18 1z" />
                <path fill="#f3d9b8" d="M86 37l12-2 5 6-9 7-10-2z" />
                <circle cx="78" cy="37" r="3.2" fill="#211712" stroke="none" />
                <path fill="none" stroke="#b47b4f" strokeWidth="7" d="M27 70l-3 31m19-30 3 30m24-34 4 32" />
                <path fill="none" stroke="#b47b4f" strokeWidth="5" d="M19 26Q5 10 11 0m0 10Q-1 4 0-5m12 14Q27 4 25-7" />
              </g>
            </g>
            {/* Traîneau doré et cadeaux */}
            <g filter="url(#xmas-sleigh-glow)">
              <path d="M55 125c18 31 57 39 133 38 47 0 77-10 92-27" fill="none" stroke="url(#xmas-gold)" strokeWidth="8" strokeLinecap="round" />
              <path d="M65 116c-17 1-25-8-25-18 0-11 9-17 20-16" fill="none" stroke="url(#xmas-gold)" strokeWidth="6" strokeLinecap="round" />
              <path d="M76 91h185l-16 39H104z" fill="url(#xmas-sleigh-red)" stroke="#f0c56d" strokeWidth="3" />
              <path d="M89 91h161l-8 12H96z" fill="#f7d68a" opacity=".9" />
              <path d="M128 91v39m44-39v39m42-39v39" stroke="#f3ca75" strokeWidth="3" opacity=".85" />
              <rect x="108" y="66" width="40" height="26" rx="5" fill="#1d754c" stroke="#e8c16e" strokeWidth="2" />
              <path d="M126 66V92m-18-15h40" stroke="#f5d58b" strokeWidth="5" />
              <rect x="158" y="57" width="48" height="34" rx="5" fill="#245e9a" stroke="#e8c16e" strokeWidth="2" />
              <path d="M182 57v34m-24-17h48" stroke="#f5d58b" strokeWidth="5" />
            </g>
            {/* Père Noël au poste de conduite */}
            <g className="mx-xmas-santa">
              <path d="M190 83c-1-25 11-43 31-43 19 0 30 16 27 36l-8 23h-44z" fill="#c82e40" stroke="#8d1d2e" strokeWidth="3" />
              <path d="M194 77c8-13 36-18 53-4l8 14-9 18h-51z" fill="#f5e5d3" />
              <ellipse cx="226" cy="58" rx="25" ry="25" fill="#f0c19a" />
              <path d="M198 51c1-25 18-37 39-28 12 5 17 16 13 27-12-8-31-10-52 1z" fill="#c72c3d" stroke="#8e1d2e" strokeWidth="3" />
              <path d="M196 46c16-9 36-11 55-1" fill="none" stroke="#fff2dc" strokeWidth="9" strokeLinecap="round" />
              <path d="M212 62q5-4 10 0m9 0q5-4 10 0" fill="none" stroke="#5d352b" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M216 70q10 7 20 0" fill="none" stroke="#9d4b43" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M206 70q20 29 42 0-1 30-21 31-19-1-21-31z" fill="#fff5e9" stroke="#dfd0c0" strokeWidth="2" />
              <circle cx="253" cy="23" r="8" fill="#fff1d7" />
            </g>
            <g fill="#f9df9d" opacity=".8"><circle cx="30" cy="91" r="2"/><circle cx="300" cy="55" r="2.5"/><circle cx="605" cy="114" r="2"/></g>
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
