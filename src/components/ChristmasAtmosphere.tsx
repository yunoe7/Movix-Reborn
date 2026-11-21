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
