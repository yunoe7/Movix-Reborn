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
          <path className="mx-xmas-wire" d="M-20 0 C80 130 160 130 260 54 S420 -8 540 70" />
          <path className="mx-xmas-pine" d="M0 5l22 28-28-12 38 30-32-8 48 31-30-5 48 26M115 80l20 30-28-14 40 30-32-9 47 24-30-4 43 20M260 54l17 28-27-12 38 28-32-7 44 23-29-3 40 17" />
        </svg>
      </div>
      <div className="mx-xmas-garland mx-xmas-garland-right">
        <svg viewBox="0 0 520 150" preserveAspectRatio="none">
          <path className="mx-xmas-wire" d="M-20 70 C100 -8 180 130 280 54 S440 0 540 0" />
          <path className="mx-xmas-pine" d="M0 70l22 28-28-12 38 30-32-8 48 31-30-5 48 26M150 80l20 30-28-14 40 30-32-9 47 24-30-4 43 20M280 54l17 28-27-12 38 28-32-7 44 23-29-3 40 17" />
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
