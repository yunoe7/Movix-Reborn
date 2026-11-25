import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { getAdminHeroPromos, updateAdminHeroPromos, type HeroPromoSettings, type TeamSelectionSettings } from '../services/heroPromoService';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { SettingsSection, SettingsField } from './adminVipDonations/SettingsUi';
import { Skeleton } from './ui/Skeleton';

const fieldClass = 'w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus-visible:ring-2 focus-visible:ring-amber-400/50';

const FIELDS: { key: keyof TeamSelectionSettings; label: string; multiline?: boolean; type?: string }[] = [
  { key: 'tmdbId', label: 'Identifiant TMDB', type: 'number' },
  { key: 'badge', label: 'Badge affiché' },
  { key: 'title', label: 'Titre' },
  { key: 'description', label: 'Description', multiline: true },
  { key: 'backdropUrl', label: 'Image de fond (URL ou chemin public)' },
  { key: 'detailsUrl', label: 'Lien vers la fiche Movix' },
  { key: 'ageRating', label: 'Âge conseillé' },
  { key: 'rating', label: 'Note affichée' },
  { key: 'genres', label: 'Genres (séparés par des virgules)' },
  { key: 'duration', label: 'Durée / épisode' }
];

const AdminTeamSelection: React.FC = () => {
  const [settings, setSettings] = useState<HeroPromoSettings | null>(null);
  const [saved, setSaved] = useState<HeroPromoSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getAdminHeroPromos().then((payload) => {
      if (!active) return;
      setSettings(payload.settings);
      setSaved(payload.settings);
    }).catch((error) => {
      if (active) toast.error(error instanceof Error ? error.message : 'Impossible de charger la sélection');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const selection = settings?.teamSelection;
  const dirty = Boolean(settings && saved && JSON.stringify(settings.teamSelection) !== JSON.stringify(saved.teamSelection));

  const update = (key: keyof TeamSelectionSettings, value: string | number | boolean) => {
    setSettings((current) => current ? {
      ...current,
      teamSelection: { ...current.teamSelection, [key]: value }
    } : current);
  };

  const save = async () => {
    if (!settings || saving) return;
    if (!Number.isSafeInteger(settings.teamSelection.tmdbId) || settings.teamSelection.tmdbId < 1) {
      toast.error('Identifiant TMDB invalide.');
      return;
    }
    setSaving(true);
    try {
      const result = await updateAdminHeroPromos(settings);
      setSettings(result.settings);
      setSaved(result.settings);
      toast.success('Sélection de l’équipe enregistrée.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="space-y-3"><Skeleton variant="button" height={64} /><Skeleton variant="button" height={180} /></div>;
  if (!settings || !selection) return <p className="rounded-xl border border-red-500/30 p-5 text-sm text-red-200">Impossible de charger la sélection de l’équipe. Vérifie la connexion à l’API puis recharge la page.</p>;

  return (
    <div className="space-y-5">
      <SettingsSection
        icon={Sparkles}
        title="Sélection de l’équipe"
        description="Choisis le film ou la série mis en avant sur la page d’accueil. Ces réglages sont indépendants des promos du carrousel."
      >
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.025] p-4">
          <div>
            <p className="text-sm font-semibold text-white">Afficher la sélection</p>
            <p className="mt-1 text-xs text-white/50">Masquer ou afficher entièrement le grand encart sur l’accueil.</p>
          </div>
          <Switch checked={selection.enabled} onCheckedChange={(checked) => update('enabled', checked)} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField id="team-selection-type" label="Type de contenu" hint="Choisis un film ou une série TMDB.">
            <select id="team-selection-type" value={selection.mediaType} onChange={(event) => update('mediaType', event.target.value)} className={fieldClass}>
              <option value="tv">Série</option>
              <option value="movie">Film</option>
            </select>
          </SettingsField>
          {FIELDS.map(({ key, label, multiline, type }) => (
            <SettingsField key={key} id={`team-selection-${key}`} label={label} className={multiline ? 'md:col-span-2' : undefined}>
              {multiline ? (
                <textarea id={`team-selection-${key}`} rows={4} value={String(selection[key])} onChange={(event) => update(key, event.target.value)} className={settingsInputClass} />
              ) : (
                <input id={`team-selection-${key}`} type={type || 'text'} min={type === 'number' ? 1 : undefined} value={String(selection[key])} onChange={(event) => update(key, type === 'number' ? Number(event.target.value) : event.target.value)} className={settingsInputClass} />
              )}
            </SettingsField>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <p className="text-xs text-white/45">{dirty ? 'Modifications non enregistrées.' : 'Les réglages sont à jour.'}</p>
          <Button type="button" onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Enregistrement…' : 'Enregistrer la sélection'}</Button>
        </div>
      </SettingsSection>
    </div>
  );
};

export default AdminTeamSelection;
