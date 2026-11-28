import React from 'react';
import { useTranslation } from 'react-i18next';
import { Palette } from '../icons/Icons8';
import { AdminPanel, AdminStateBlock } from './AdminUi';

/**
 * Contrats de la future catégorie « Décoratif ».
 *
 * Aucune publication n'est exposée dans ce lot : le backend correspondant
 * n'existe pas encore. Cette liste sert uniquement de point d'extension
 * explicite pour les familles de décorations globales prévues.
 */
export const ADMIN_DECOR_SURFACES = [
  { id: 'animation', labelKey: 'admin.console.decorSurfaceAnimation', labelDefault: 'Animations' },
  { id: 'effect', labelKey: 'admin.console.decorSurfaceEffect', labelDefault: 'Effets' },
  { id: 'background', labelKey: 'admin.console.decorSurfaceBackground', labelDefault: 'Arrière-plans' },
  { id: 'theme', labelKey: 'admin.console.decorSurfaceTheme', labelDefault: 'Thèmes' },
  { id: 'graphic', labelKey: 'admin.console.decorSurfaceGraphic', labelDefault: 'Éléments graphiques' },
] as const;

export type AdminDecorSurfaceId = typeof ADMIN_DECOR_SURFACES[number]['id'];

const AdminDecorPlaceholder: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="space-y-5" data-testid="admin-decor">
      <AdminPanel
        eyebrow={t('admin.console.decorEyebrow', 'Préparation')}
        title={t('admin.console.decorTitle', 'Décoratif')}
        description={t('admin.console.decorDesc', 'Emplacement réservé aux décorations globales à venir')}
      >
        <AdminStateBlock
          tone="info"
          title={t('admin.console.decorIntroTitle', 'Catégorie en préparation')}
          description={t(
            'admin.console.decorIntroDesc',
            'Les décorations globales visibles par tous les utilisateurs ne sont pas encore gérables depuis la console. Aucune action simulée n’est exposée.'
          )}
        />

        <div className="mt-5">
          <p className="admin-chart-title">
            {t('admin.console.decorSurfaceTitle', 'Familles prévues')}
          </p>
          <p className="mb-3 text-xs leading-5 text-white/45">
            {t('admin.console.decorSurfaceDesc', 'Périmètre architectural uniquement ; aucune donnée n’est chargée ou publiée ici.')}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {ADMIN_DECOR_SURFACES.map((surface) => (
              <div key={surface.id} className="admin-quick-action">
                <Palette className="h-4 w-4 shrink-0 text-white/55" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-white/80">
                  {t(surface.labelKey, surface.labelDefault)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </AdminPanel>

      <AdminPanel
        eyebrow={t('admin.console.decorBoundaryTitle', 'Périmètre')}
        title={t('admin.console.decorBoundaryHeading', 'Séparation des espaces')}
        description={t(
          'admin.console.decorBoundaryDesc',
          'Cette catégorie est distincte de « Autres » et de la page April Fools / du centre de contrôle parodique.'
        )}
      >
        <AdminStateBlock
          tone="empty"
          title={t('admin.console.decorEmptyTitle', 'Aucun élément à afficher')}
          description={t(
            'admin.console.decorEmptyDesc',
            'Les outils de publication arriveront avec leur backend dédié. En leur absence, aucun bouton ni formulaire n’est présenté.'
          )}
        />
      </AdminPanel>
    </div>
  );
};

export default AdminDecorPlaceholder;
