import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import EmblaCarousel from './EmblaCarousel';
import { getTmdbLanguage } from '../i18n';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

interface ProviderMedia {
  id: number;
  title?: string;
  name?: string;
  poster_path: string;
  backdrop_path: string;
  overview: string;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  media_type: 'movie' | 'tv';
}

interface Props {
  providerId: number;
  providerName: string;
}

const COMPANY_IDS: Record<number, number> = {
  338: 420,
  355: 174,
  356: 9993,
};

const InlineStreamingCatalog: React.FC<Props> = ({ providerId, providerName }) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<ProviderMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const language = getTmdbLanguage();

    const load = async () => {
      setLoading(true);
      setError(false);
      try {
        const companyId = COMPANY_IDS[providerId];
        const common = {
          api_key: TMDB_API_KEY,
          language,
          region: 'FR',
          include_adult: false,
          sort_by: 'popularity.desc',
          page: 1,
          ...(companyId
            ? { with_companies: companyId }
            : { with_watch_providers: providerId, watch_region: 'FR', with_watch_monetization_types: 'flatrate|free|ads' }),
        };
        const [movies, shows] = await Promise.all([
          axios.get('https://api.themoviedb.org/3/discover/movie', { params: common, signal: controller.signal, timeout: 12000 }),
          axios.get('https://api.themoviedb.org/3/discover/tv', { params: common, signal: controller.signal, timeout: 12000 }),
        ]);
        const normalize = (result: any[], mediaType: 'movie' | 'tv'): ProviderMedia[] =>
          result
            .filter((item) => item.poster_path && item.overview?.trim())
            .map((item) => ({
              id: item.id,
              title: item.title || undefined,
              name: item.name || undefined,
              poster_path: item.poster_path,
              backdrop_path: item.backdrop_path || '',
              overview: item.overview || '',
              vote_average: item.vote_average || 0,
              release_date: item.release_date || undefined,
              first_air_date: item.first_air_date || undefined,
              media_type: mediaType,
            }));
        setItems([
          ...normalize(movies.data.results || [], 'movie'),
          ...normalize(shows.data.results || [], 'tv'),
        ].sort((a, b) => b.vote_average - a.vote_average).slice(0, 24));
      } catch (err) {
        if (!controller.signal.aborted) {
          setItems([]);
          setError(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [providerId]);

  const title = <span className="text-white text-xl font-bold">Uniquement sur {providerName}</span>;

  return (
    <section className="w-full min-w-0" aria-live="polite">
      {loading ? (
        <div className="flex items-center gap-3 py-10 px-2 text-white/60">
          <Loader2 className="h-5 w-5 animate-spin text-red-500" />
          <span className="text-sm">{t('common.loading', 'Chargement des contenus…')}</span>
        </div>
      ) : error ? (
        <p className="px-2 py-8 text-sm text-white/50">Impossible de charger les contenus de {providerName} pour le moment.</p>
      ) : items.length > 0 ? (
        <EmblaCarousel title={title} items={items} mediaType="provider-inline" />
      ) : (
        <p className="px-2 py-8 text-sm text-white/50">Aucun contenu trouvé pour {providerName}.</p>
      )}
    </section>
  );
};

export default InlineStreamingCatalog;
