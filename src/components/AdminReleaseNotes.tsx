import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MAIN_API } from '../config/runtime';

type ReleaseHistoryEntry = {
  version: string;
  date: string;
  summary: string;
  changes: string[];
};

type ReleaseNotes = {
  version: string;
  severity: 'normal' | 'important' | 'critical';
  mandatory: boolean;
  summary: string;
  changes: string[];
  history: ReleaseHistoryEntry[];
};

const EMPTY_NOTES: ReleaseNotes = {
  version: '',
  severity: 'normal',
  mandatory: false,
  summary: '',
  changes: [],
  history: [],
};

const inputClass = 'w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/30 focus:bg-white/[0.07]';
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/55';

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` };
}

const AdminReleaseNotes: React.FC = () => {
  const [notes, setNotes] = useState<ReleaseNotes>(EMPTY_NOTES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newChange, setNewChange] = useState('');
  const [historyDraft, setHistoryDraft] = useState<ReleaseHistoryEntry>({
    version: '', date: '', summary: '', changes: [],
  });
  const [historyChange, setHistoryChange] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${MAIN_API}/api/admin/release-notes`, {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok || payload?.success !== true) throw new Error(payload?.error || 'Chargement impossible');
      setNotes({ ...EMPTY_NOTES, ...(payload.metadata || {}) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de charger les notes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = <K extends keyof ReleaseNotes>(key: K, value: ReleaseNotes[K]) => {
    setNotes((current) => ({ ...current, [key]: value }));
  };

  const addChange = () => {
    const value = newChange.trim();
    if (!value) return;
    update('changes', [...notes.changes, value]);
    setNewChange('');
  };

  const addHistoryChange = () => {
    const value = historyChange.trim();
    if (!value) return;
    setHistoryDraft((current) => ({ ...current, changes: [...current.changes, value] }));
    setHistoryChange('');
  };

  const addHistory = () => {
    if (!historyDraft.version.trim()) {
      toast.error('Indique le numéro de la version précédente.');
      return;
    }
    update('history', [...notes.history, { ...historyDraft, version: historyDraft.version.trim() }]);
    setHistoryDraft({ version: '', date: '', summary: '', changes: [] });
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${MAIN_API}/api/admin/release-notes`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(notes),
      });
      const payload = await response.json();
      if (!response.ok || payload?.success !== true) throw new Error(payload?.error || 'Enregistrement impossible');
      setNotes({ ...EMPTY_NOTES, ...(payload.metadata || {}) });
      toast.success('Notes de version enregistrées. Elles seront utilisées à la prochaine publication.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible d’enregistrer les notes');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-white/45" role="status">Chargement des notes de version…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">Publication · Movix</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-white">Notes de version</h2>
          <p className="mt-1 max-w-2xl text-sm text-white/50">Rédige ici les nouveautés que les utilisateurs verront dans la notification de mise à jour.</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/65 transition hover:bg-white/5 hover:text-white">Actualiser</button>
      </div>

      <div className="rounded-2xl border border-sky-400/20 bg-sky-400/[0.06] p-4 text-sm leading-relaxed text-sky-100/75">
        <strong className="font-semibold text-sky-100">À savoir :</strong> tu peux préparer et enregistrer les notes à tout moment. Elles seront affichées avec le prochain déploiement de Movix, sans avoir à modifier de fichier.
      </div>

      <section className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className={labelClass}>Numéro de version (facultatif)</span>
            <input className={inputClass} value={notes.version} maxLength={40} placeholder="Ex. 2.8.0" onChange={(e) => update('version', e.target.value)} />
          </label>
          <label>
            <span className={labelClass}>Importance de la mise à jour</span>
            <select className={inputClass} value={notes.severity} onChange={(e) => update('severity', e.target.value as ReleaseNotes['severity'])}>
              <option value="normal">Normale</option>
              <option value="important">Importante</option>
              <option value="critical">Critique</option>
            </select>
          </label>
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <input type="checkbox" checked={notes.mandatory} onChange={(e) => update('mandatory', e.target.checked)} className="h-4 w-4 accent-white" />
          <span>
            <span className="block text-sm font-semibold text-white">Mise à jour obligatoire</span>
            <span className="block text-xs text-white/45">Les utilisateurs ne pourront pas reporter la notification.</span>
          </span>
        </label>

        <label className="block">
          <span className={labelClass}>Résumé de la mise à jour</span>
          <textarea className={inputClass + ' min-h-24 resize-y'} value={notes.summary} maxLength={500} placeholder="Présente en quelques phrases les changements de cette version…" onChange={(e) => update('summary', e.target.value)} />
          <span className="mt-1 block text-right text-[10px] text-white/30">{notes.summary.length}/500</span>
        </label>

        <div>
          <span className={labelClass}>Nouveautés et corrections</span>
          <div className="space-y-2">
            {notes.changes.map((change, index) => (
              <div key={index} className="flex items-start gap-2 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2">
                <span className="pt-0.5 text-white/35">✦</span>
                <p className="min-w-0 flex-1 text-sm text-white/80">{change}</p>
                <button type="button" onClick={() => update('changes', notes.changes.filter((_, i) => i !== index))} className="px-1 text-xs text-white/35 hover:text-red-300" aria-label={`Supprimer la ligne ${index + 1}`}>✕</button>
              </div>
            ))}
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className={inputClass} value={newChange} placeholder="Ex. Correction du lecteur vidéo…" onChange={(e) => setNewChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChange(); } }} />
              <button type="button" onClick={addChange} className="shrink-0 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/75 hover:bg-white/10">Ajouter</button>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-6">
        <div>
          <h3 className="text-base font-semibold text-white">Historique des versions précédentes</h3>
          <p className="mt-1 text-xs text-white/45">Ajoute ici les anciennes versions pour que les utilisateurs puissent les retrouver.</p>
        </div>
        {notes.history.map((entry, index) => (
          <article key={index} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">Version {entry.version} <span className="ml-2 text-xs font-normal text-white/40">{entry.date}</span></p>
              <button type="button" onClick={() => update('history', notes.history.filter((_, i) => i !== index))} className="text-xs text-white/40 hover:text-red-300">Supprimer</button>
            </div>
            {entry.summary && <p className="mt-1 text-sm text-white/60">{entry.summary}</p>}
            {entry.changes.map((change, i) => <p key={i} className="mt-1 text-xs text-white/45">• {change}</p>)}
          </article>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className={labelClass}>Version précédente</span><input className={inputClass} value={historyDraft.version} placeholder="Ex. 2.7.0" onChange={(e) => setHistoryDraft((v) => ({ ...v, version: e.target.value }))} /></label>
          <label><span className={labelClass}>Date (facultative)</span><input className={inputClass} value={historyDraft.date} placeholder="Ex. 12/10/2026" onChange={(e) => setHistoryDraft((v) => ({ ...v, date: e.target.value }))} /></label>
        </div>
        <label className="block"><span className={labelClass}>Résumé de cette ancienne version</span><textarea className={inputClass + ' min-h-16 resize-y'} value={historyDraft.summary} onChange={(e) => setHistoryDraft((v) => ({ ...v, summary: e.target.value }))} /></label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={inputClass} value={historyChange} placeholder="Une nouveauté de cette ancienne version…" onChange={(e) => setHistoryChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHistoryChange(); } }} />
          <button type="button" onClick={addHistoryChange} className="shrink-0 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/75 hover:bg-white/10">Ajouter</button>
        </div>
        {historyDraft.changes.length > 0 && <div className="space-y-1">{historyDraft.changes.map((item, i) => <div key={i} className="flex items-center justify-between gap-2 text-xs text-white/60"><span>• {item}</span><button type="button" onClick={() => setHistoryDraft((v) => ({ ...v, changes: v.changes.filter((_, j) => j !== i) }))} className="text-white/35 hover:text-red-300">✕</button></div>)}</div>}
        <button type="button" onClick={addHistory} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/75 hover:bg-white/10">Ajouter cette ancienne version</button>
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={() => void load()} disabled={saving} className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-white/60 hover:bg-white/5 disabled:opacity-40">Annuler les modifications</button>
        <button type="button" onClick={() => void save()} disabled={saving || (!notes.summary.trim() && notes.changes.length === 0)} className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-black transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40">{saving ? 'Enregistrement…' : 'Enregistrer les notes'}</button>
      </div>
    </div>
  );
};

export default AdminReleaseNotes;
