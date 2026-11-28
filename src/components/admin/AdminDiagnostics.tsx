import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from '../icons/Icons8';
import { MAIN_API } from '../../config/runtime';
import { fetchStatsOverview } from '../../services/adminStatsService';
import { getRoleLabel, type AdminRole } from './adminRegistry';
import { AdminPanel, AdminServiceRow, AdminStateBlock } from './AdminUi';

type ProbeState = 'loading' | 'ready' | 'error';

/**
 * Diagnostics limités aux sources réellement utilisées par la console.
 * Aucun flux de logs n'est exposé par l'API actuelle : l'état est indiqué
 * comme indisponible plutôt que simulé.
 */
const AdminDiagnostics: React.FC<{ role: AdminRole }> = ({ role }) => {
  const { t } = useTranslation();
  const [state, setState] = useState<ProbeState>('loading');
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setState('loading');
    setError(null);
    try {
      const payload = await fetchStatsOverview(7);
      if (requestId !== requestRef.current) return;
      setGeneratedAt(payload.generatedAt);
      setState('ready');
    } catch {
      if (requestId !== requestRef.current) return;
      setGeneratedAt(null);
      setError(t('admin.stats.loadError', 'Erreur de chargement des statistiques'));
      setState('error');
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const statsDetail = generatedAt
    ? `${t('admin.console.generatedAt', 'Généré le')} ${new Date(generatedAt).toLocaleString('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'short',
    })}`
    : t('admin.console.waitingData', 'En attente des données serveur');

  return (
    <div className="space-y-5" data-testid="admin-diagnostics">
      <AdminPanel
        eyebrow={t('admin.console.diagnosticsEyebrow', 'Observabilité')}
        title={t('admin.console.diagnosticsTitle', 'Diagnostics')}
        description={t(
          'admin.console.diagnosticsIntroDesc',
          'Statut déduit des réponses réelles des endpoints admin, sans donnée simulée.'
        )}
        action={(
          <button
            type="button"
            className="admin-icon-button"
            onClick={() => void load()}
            disabled={state === 'loading'}
            aria-label={t('admin.stats.refresh', 'Actualiser')}
            title={t('admin.stats.refresh', 'Actualiser')}
          >
            <RefreshCw className={`h-4 w-4 ${state === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        )}
      >
        <AdminServiceRow
          label={t('admin.console.authService', 'Contrôle des droits admin')}
          detail={`${t('admin.console.sessionRole', 'rôle actif')} : ${getRoleLabel(t, role)}`}
          healthy
        />
        <AdminServiceRow
          label={t('admin.console.statsService', 'Source de statistiques')}
          detail={statsDetail}
          healthy={state !== 'error'}
          pending={state === 'loading'}
        />
        <AdminServiceRow
          label={t('admin.console.logsService', 'Flux de logs serveur')}
          detail={t('admin.console.logsServiceDetail', 'Aucun endpoint de logs n’est exposé dans cette version')}
          healthy={false}
          unavailable
        />
        {state === 'error' && (
          <div className="mt-4">
            <AdminStateBlock
              tone="error"
              title={error ?? t('admin.stats.loadError', 'Erreur de chargement des statistiques')}
              description={t('admin.console.statsUnavailable', 'Les chiffres ci-dessous ne sont pas affichés tant que la source est indisponible.')}
              action={(
                <button type="button" className="admin-text-button" onClick={() => void load()}>
                  {t('common.retry', 'Réessayer')}
                </button>
              )}
            />
          </div>
        )}
      </AdminPanel>

      <AdminPanel
        eyebrow={t('admin.console.diagnosticsSourcesTitle', 'Sources')}
        title={t('admin.console.diagnosticsSourceHeading', 'Origines actives')}
        description={t('admin.console.diagnosticsSourcesDesc', 'La console utilise uniquement les endpoints déjà présents.')}
      >
        <div className="admin-bar-row">
          <div className="admin-bar-meta">
            <span>{t('admin.console.diagnosticsApiOrigin', 'Origine API active')}</span>
            <span className="truncate" title={MAIN_API || undefined}>
              {MAIN_API || t('admin.console.diagnosticsNotConfigured', 'Non configurée')}
            </span>
          </div>
        </div>
        <div className="mt-4">
          <AdminStateBlock
            tone="info"
            title={t('admin.console.logsNotExposedTitle', 'Journalisation non exposée')}
            description={t(
              'admin.console.logsNotExposedDesc',
              'La console n’affiche pas de faux journal. Les événements restent dans les logs serveur existants.'
            )}
          />
        </div>
      </AdminPanel>
    </div>
  );
};

export default AdminDiagnostics;
