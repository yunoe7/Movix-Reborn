import { useEffect, useState } from 'react';
import { toast } from 'sonner';

type ReleaseEntry = {
  version?: string;
  date?: string;
  summary?: string;
  changes?: string[];
};

type PublishedVersion = {
  buildId?: unknown;
  version?: string;
  severity?: 'normal' | 'important' | 'critical';
  mandatory?: boolean;
  summary?: string;
  changes?: string[];
  history?: ReleaseEntry[];
};

const CHECK_INTERVAL_MS = 60_000;
const SNOOZE_DURATION_MS = 4 * 60 * 60 * 1000;
const SNOOZE_STORAGE_KEY = 'movix-update-snoozed-until';

function readSnoozeUntil(): number {
  try {
    const value = Number(window.localStorage.getItem(SNOOZE_STORAGE_KEY) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function snoozeUpdate(): void {
  try {
    window.localStorage.setItem(SNOOZE_STORAGE_KEY, String(Date.now() + SNOOZE_DURATION_MS));
  } catch {
    // Le stockage local est facultatif : la notification reste simplement fermée.
  }
}

function getReloadWarnings(): string[] {
  const warnings: string[] = [];
  const mediaPlaying = Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio'))
    .some((media) => !media.paused && !media.ended);
  if (mediaPlaying) warnings.push('Une vidéo ou un contenu audio est en cours de lecture.');

  const hasEditedFields = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input, textarea, select'
    )
  ).some((field) => {
    if (field.disabled || field instanceof HTMLInputElement && ['button', 'submit', 'reset', 'file'].includes(field.type)) {
      return false;
    }
    if (field instanceof HTMLSelectElement) {
      return Array.from(field.options).some((option) => option.selected !== option.defaultSelected);
    }
    if (field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type)) {
      return field.checked !== field.defaultChecked;
    }
    return field.value !== field.defaultValue;
  });
  if (hasEditedFields) warnings.push('Un formulaire contient des modifications qui pourraient ne pas être enregistrées.');

  const hasEditedContent = Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"]'))
    .some((element) => element.textContent?.trim().length);
  if (hasEditedContent) warnings.push('Un éditeur de texte contient du contenu non enregistré.');

  return warnings;
}

function UpdateAvailableToast({
  toastId,
  published,
  onSnooze,
}: {
  toastId: string | number;
  published: PublishedVersion;
  onSnooze: () => void;
}) {
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [reloadWarnings, setReloadWarnings] = useState<string[]>([]);
  const severity = published.severity || 'normal';
  const mandatory = published.mandatory === true || severity === 'critical';
  const version = published.version || (typeof published.buildId === 'string' ? published.buildId.slice(0, 8) : 'Nouvelle version');
  const previousVersion = __MOVIX_BUILD_ID__.slice(0, 8);
  const history = Array.isArray(published.history) ? published.history : [];
  const changes = Array.isArray(published.changes) ? published.changes : [];
  const accent = severity === 'critical' ? 'text-red-300' : severity === 'important' ? 'text-amber-200' : 'text-white/75';

  const dismiss = () => {
    if (mandatory) return;
    onSnooze();
    toast.dismiss(toastId);
  };

  const reload = () => {
    const warnings = getReloadWarnings();
    if (warnings.length > 0) {
      setReloadWarnings(warnings);
      return;
    }
    window.location.reload();
  };

  return (
    <>
      <section
        role="status"
        className="relative w-full overflow-hidden rounded-2xl border border-white/[0.12] bg-[rgba(5,5,7,0.82)] text-white shadow-[0_18px_55px_rgba(0,0,0,0.48)] backdrop-blur-2xl"
        style={{ width: 'min(420px, calc(100vw - 32px))' }}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
        <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-white/[0.035] blur-3xl" />
        <div className="relative flex gap-3.5 p-4 sm:p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/55 shadow-inner shadow-black/40">
            <img src="/movix.svg?v=2" alt="Movix" className="h-8 w-8 object-contain" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/75">Movix · Nouveauté</span>
              <span className="h-1 w-1 rounded-full bg-white/80" />
              {mandatory ? (
                <span className="text-[10px] font-bold uppercase tracking-wider text-red-300">Mise à jour requise</span>
              ) : severity === 'important' ? (
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-200">Importante</span>
              ) : null}
            </div>
            <p className="text-[15px] font-semibold leading-snug tracking-[-0.02em] text-white sm:text-base">
              {mandatory ? 'Une mise à jour est nécessaire' : 'Une nouvelle version est disponible'}
            </p>
            <p className="mt-1.5 text-[13px] font-normal leading-[1.55] text-white/75 sm:text-sm">
              {published.summary || 'Des améliorations et nouveautés t’attendent. Recharge la page quand tu es prêt.'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-white/45">
              <span>Installée : {previousVersion}</span>
              <span aria-hidden="true">→</span>
              <span className={accent}>Disponible : {version}</span>
            </div>

            {reloadWarnings.length > 0 && (
              <div className="mt-3 rounded-xl border border-white/15 bg-white/[0.055] p-3" role="alert">
                <p className="text-xs font-semibold text-white">Avant de recharger…</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-white/65">
                  {reloadWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="rounded-lg border border-white/20 bg-white px-3 py-2 text-xs font-bold text-black transition hover:bg-white/90"
                  >
                    Recharger quand même
                  </button>
                  <button
                    type="button"
                    onClick={() => setReloadWarnings([])}
                    className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
                  >
                    Attendre
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={reload}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white px-4 text-xs font-bold tracking-wide text-[#09090b] shadow-sm transition hover:bg-white/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M16.5 6.5V2.8m0 3.7h-3.7M16 6.5A7 7 0 1 0 17 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Recharger
              </button>
              <button
                type="button"
                onClick={() => setShowReleaseNotes(true)}
                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-white/15 bg-black/35 px-4 text-xs font-semibold tracking-wide text-white/85 transition hover:border-white/25 hover:bg-black/55 hover:text-white"
              >
                Voir les nouveautés
              </button>
              {!mandatory && (
                <button
                  type="button"
                  onClick={dismiss}
                  className="inline-flex min-h-9 items-center justify-center rounded-lg px-2.5 text-xs font-medium text-white/55 transition hover:text-white"
                >
                  Plus tard
                </button>
              )}
            </div>
          </div>
          {!mandatory && (
            <button
              type="button"
              aria-label="Fermer la notification"
              onClick={dismiss}
              className="absolute right-3 top-3 rounded-md p-1 text-white/35 transition hover:bg-white/10 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="h-px bg-gradient-to-r from-white/20 via-white/[0.06] to-transparent" />
      </section>

      {showReleaseNotes && (
        <div
          className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowReleaseNotes(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="movix-release-title"
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/15 bg-[rgba(13,14,17,0.96)] text-white shadow-[0_30px_100px_rgba(0,0,0,0.7)]"
          >
            <header className="flex items-start justify-between border-b border-white/10 p-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Movix · Historique</p>
                <h2 id="movix-release-title" className="mt-1 text-lg font-semibold">Nouveautés de Movix</h2>
                <p className="mt-1 text-xs text-white/50">Version {version}</p>
              </div>
              <button type="button" onClick={() => setShowReleaseNotes(false)} aria-label="Fermer" className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white">
                <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </header>
            <div className="max-h-[min(65vh,520px)] space-y-5 overflow-y-auto p-5">
              <article>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Version {version}</h3>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${accent}`}>Actuelle</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-white/65">{published.summary || 'Améliorations et optimisations de Movix.'}</p>
                {changes.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {changes.map((change, index) => (
                      <li key={`${version}-${index}`} className="flex gap-2 text-sm text-white/80">
                        <span className="mt-0.5 text-white/45">✦</span><span>{change}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-white/40">Le détail des changements sera ajouté aux notes de version de cette publication.</p>
                )}
              </article>
              {history.length > 0 && (
                <div className="border-t border-white/10 pt-5">
                  <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-white/45">Versions précédentes</h3>
                  <div className="space-y-4">
                    {history.map((entry, index) => (
                      <article key={`${entry.version || 'release'}-${index}`} className="border-l border-white/15 pl-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold">{entry.version || 'Version précédente'}</h4>
                          {entry.date && <span className="text-[11px] text-white/40">{entry.date}</span>}
                        </div>
                        {entry.summary && <p className="mt-1 text-sm text-white/60">{entry.summary}</p>}
                        {Array.isArray(entry.changes) && entry.changes.length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs text-white/65">
                            {entry.changes.map((change, changeIndex) => <li key={changeIndex}>• {change}</li>)}
                          </ul>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <footer className="flex justify-end border-t border-white/10 p-4">
              <button type="button" onClick={() => setShowReleaseNotes(false)} className="rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white/85 hover:bg-white/10">
                Fermer
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

export default function UpdateAvailableNotifier() {
  useEffect(() => {
    let stopped = false;
    let checking = false;
    let notified = false;

    const checkForUpdate = async () => {
      if (stopped || checking || notified || document.visibilityState !== 'visible') return;
      if (readSnoozeUntil() > Date.now()) return;
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
        toast.custom(
          (toastId) => (
            <UpdateAvailableToast
              toastId={toastId}
              published={published}
              onSnooze={() => {
                snoozeUpdate();
                notified = false;
              }}
            />
          ),
          {
            id: 'movix-update-available',
            duration: Infinity,
            position: 'bottom-right',
          }
        );
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
