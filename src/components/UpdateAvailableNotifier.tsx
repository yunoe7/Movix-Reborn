import { useEffect } from 'react';
import { toast } from 'sonner';

type PublishedVersion = {
  buildId?: unknown;
};

const CHECK_INTERVAL_MS = 60_000;

function UpdateAvailableToast({ toastId }: { toastId: string | number }) {
  return (
    <section
      role="status"
      className="relative w-[min( calc(100vw-32px), 390px)] overflow-hidden rounded-2xl border border-white/10 bg-[#111318]/95 text-white shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
      style={{ width: 'min(390px, calc(100vw - 32px))' }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-500/80 to-transparent" />
      <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-red-600/10 blur-3xl" />

      <div className="relative flex gap-3.5 p-4 sm:p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 shadow-inner shadow-red-500/5">
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
            <path d="M20 7v5h-5M4.5 17a8 8 0 0 0 13.7 1.2A8 8 0 0 0 20 12M4 12a8 8 0 0 1 13.7-6.2L20 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-red-400">Movix · Nouveauté</span>
            <span className="h-1 w-1 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]" />
          </div>
          <p className="text-sm font-bold leading-snug text-white sm:text-[15px]">
            Une nouvelle version est disponible
          </p>
          <p className="mt-1 text-xs leading-relaxed text-white/55 sm:text-[13px]">
            De nouvelles améliorations t’attendent. Recharge la page quand tu es prêt.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-[#e51d36] px-3.5 text-xs font-bold text-white shadow-[0_5px_18px_rgba(229,29,54,0.22)] transition hover:bg-[#f02a43] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111318]"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M16.5 6.5V2.8m0 3.7h-3.7M16 6.5A7 7 0 1 0 17 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Recharger
            </button>
            <button
              type="button"
              onClick={() => toast.dismiss(toastId)}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-white/10 px-3.5 text-xs font-semibold text-white/65 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              Plus tard
            </button>
          </div>
        </div>

        <button
          type="button"
          aria-label="Fermer la notification"
          onClick={() => toast.dismiss(toastId)}
          className="absolute right-3 top-3 rounded-md p-1 text-white/35 transition hover:bg-white/10 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="h-px bg-gradient-to-r from-red-500/35 via-white/[0.06] to-transparent" />
    </section>
  );
}

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
        toast.custom((toastId) => <UpdateAvailableToast toastId={toastId} />, {
          id: 'movix-update-available',
          duration: Infinity,
          position: 'bottom-right',
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
