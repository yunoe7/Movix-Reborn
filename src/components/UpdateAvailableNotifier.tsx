import { useEffect } from 'react';
import { toast } from 'sonner';

type PublishedVersion = {
  buildId?: unknown;
};

const CHECK_INTERVAL_MS = 60_000;

export default function UpdateAvailableNotifier() {
  useEffect(() => {
    let stopped = false;
    let checking = false;
    let notified = false;

    const checkForUpdate = async () => {
      if (stopped || checking || notified || document.visibilityState !== 'visible') return;
      checking = true;

      try {
        const response = await fetch(`/version.json?check=${Date.now()}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return;

        const published = (await response.json()) as PublishedVersion;
        if (
          typeof published.buildId !== 'string' ||
          !published.buildId ||
          published.buildId === __MOVIX_BUILD_ID__
        ) {
          return;
        }

        notified = true;
        toast('Une nouvelle version de Movix est disponible', {
          id: 'movix-update-available',
          description: 'Recharge la page pour profiter des dernières améliorations.',
          duration: Infinity,
          action: {
            label: 'Recharger',
            onClick: () => window.location.reload(),
          },
          cancel: {
            label: 'Plus tard',
            onClick: () => undefined,
          },
        });
      } catch {
        // Une vérification indisponible ne doit jamais gêner la navigation.
      } finally {
        checking = false;
      }
    };

    const intervalId = window.setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', checkForUpdate);
    const initialCheckId = window.setTimeout(checkForUpdate, 15_000);

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
      window.clearTimeout(initialCheckId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', checkForUpdate);
    };
  }, []);

  return null;
}
