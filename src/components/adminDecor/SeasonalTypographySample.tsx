import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fontFamilyFor,
  SEASONAL_TYPOGRAPHY_CATEGORIES,
  type SeasonalTypographyCategory,
} from '../../seasonalThemeGraphics/typography/registry';
import { getBrowserSeasonalFontLoader } from '../../seasonalThemeGraphics/typography/fontLoader';
import type { SeasonalTypographyMap, SeasonalTypographySelection } from '../../seasonalThemeGraphics/typography/resolve';

/**
 * Aperçu typographique du LOT 4B, strictement isolé dans la console d'admin.
 *
 * Il ne monte pas le moteur public, ne lit aucune configuration publiée et ne
 * modifie aucun style global. Les polices sont chargées depuis les mêmes fichiers
 * locaux que le moteur ; les styles sont des styles en ligne qui disparaissent
 * avec le composant à la fermeture de l'onglet d'aperçu.
 */

type LoadState = 'loading' | 'loaded' | 'failed';

const CATEGORY_LABELS: Record<SeasonalTypographyCategory, { key: string; fallback: string }> = {
  pageTitle: { key: 'admin.decor.category.pageTitle', fallback: 'Titre de page' },
  sectionTitle: { key: 'admin.decor.category.sectionTitle', fallback: 'Titre de section' },
  categoryTitle: { key: 'admin.decor.category.categoryTitle', fallback: 'Titre de catégorie' },
};

const INTER_STACK = "'Inter', ui-sans-serif, system-ui, sans-serif";

const effects: Record<string, string> = {
  glow: '0 0 14px rgba(255, 190, 92, 0.55)',
  frost: '0 0 12px rgba(198, 234, 255, 0.6)',
};

function styleFor(selection: SeasonalTypographySelection | null, state: LoadState | undefined): CSSProperties {
  if (!selection || state !== 'loaded') return {};
  return {
    fontFamily: selection.fontKey === 'inter'
      ? INTER_STACK
      : `'${fontFamilyFor(selection.fontKey)}', ${INTER_STACK}`,
    fontWeight: selection.weight,
    ...(effects[selection.effect] ? { textShadow: effects[selection.effect] } : {}),
  };
}

export interface SeasonalTypographySampleProps {
  selections: SeasonalTypographyMap;
  sample: string;
}

export const SeasonalTypographySample = ({ selections, sample }: SeasonalTypographySampleProps) => {
  const { t } = useTranslation();
  const loader = getBrowserSeasonalFontLoader();
  const signature = useMemo(() => Object.values(selections)
    .filter((item): item is SeasonalTypographySelection => Boolean(item))
    .map((item) => `${item.fontKey}:${item.weight}`)
    .sort()
    .join('|'), [selections]);
  const [states, setStates] = useState<Record<string, LoadState>>({});

  useEffect(() => {
    let active = true;
    const pairs = signature
      ? signature.split('|').map((value) => {
        const [fontKey, weight] = value.split(':');
        return { fontKey, weight: Number(weight) };
      })
      : [];
    if (pairs.length === 0) {
      setStates({});
      return () => { active = false; };
    }

    const next: Record<string, LoadState> = {};
    for (const pair of pairs) next[pair.fontKey] = 'loading';
    setStates(next);

    for (const pair of pairs) {
      void loader.load(pair.fontKey, pair.weight).then((ok) => {
        if (!active) return;
        setStates((current) => ({ ...current, [pair.fontKey]: ok ? 'loaded' : 'failed' }));
      });
    }
    return () => { active = false; };
  }, [loader, signature]);

  return (
    <div className="admin-decor-typography-preview" data-admin-decor-preview-typography data-testid="admin-decor-preview-typography">
      <p className="admin-decor-preview-kicker">
        {t('admin.decor.preview.typographyTitle', 'Comparaison des trois catégories — brouillon local')}
      </p>
      {SEASONAL_TYPOGRAPHY_CATEGORIES.map((category) => {
        const selection = selections[category];
        const state = selection ? states[selection.fontKey] : undefined;
        const label = CATEGORY_LABELS[category];
        return (
          <div key={category} className="admin-decor-typography-preview-row">
            <span className="admin-decor-typography-preview-label">{t(label.key, label.fallback)}</span>
            <span
              className="admin-decor-typography-preview-sample"
              data-typography={category}
              data-testid={`admin-decor-preview-${category}`}
              data-font-key={selection?.fontKey ?? 'inter'}
              data-font-status={selection ? state ?? 'loading' : 'reference'}
              style={styleFor(selection, state)}
            >
              {sample}
            </span>
            {selection && state === 'failed' && (
              <span className="admin-decor-state-pill" data-state="draft">
                {t('admin.decor.preview.typographyUnavailable', 'Police indisponible — repli Inter')}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
