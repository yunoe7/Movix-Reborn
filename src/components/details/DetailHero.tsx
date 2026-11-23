import type { ReactNode } from 'react';
import { ArrowLeft, Star } from '../icons/Icons8';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import CompleteImage from '@/components/media/CompleteImage';
import './details.css';

type HeroGenre = {
  id?: number;
  name: string;
};

export type DetailHeroProps = {
  title: string;
  year?: number | string | null;
  rating?: number | null;
  runtime?: string | null;
  classification?: string | null;
  seasons?: number | null;
  episodes?: number | null;
  seasonLabel?: string;
  episodeLabel?: string;
  genres?: HeroGenre[];
  synopsis?: string | null;
  imageUrl?: string | null;
  imagePosition?: string;
  fallbackImageUrl?: string | null;
  badges?: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
  genreHref?: (genreId: number) => string;
};

/** Single cinematic banner shared by films, series and anime. */
const DetailHero: React.FC<DetailHeroProps> = ({
  title,
  year,
  rating,
  runtime,
  classification,
  seasons,
  episodes,
  seasonLabel = 'Seasons',
  episodeLabel = 'Episodes',
  genres = [],
  synopsis,
  imageUrl,
  imagePosition = 'center center',
  fallbackImageUrl,
  badges,
  actions,
  note,
  genreHref,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const background = imageUrl || fallbackImageUrl || undefined;
  const hasMeta = Boolean(
    (typeof rating === 'number' && rating > 0) || year || runtime || classification
    || (seasons && seasons > 0) || (episodes && episodes > 0),
  );

  return (
    <section
      aria-label={title}
      className="detail-hero -mx-4 -mt-6 mb-0 w-[calc(100%+2rem)] px-5 pb-10 pt-28 sm:px-8 sm:pb-12 md:-mx-8 md:w-[calc(100%+4rem)] md:px-10 md:pb-14 md:pt-32 lg:-mx-16 lg:w-[calc(100%+8rem)] lg:px-16"
    >
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="detail-hero__back"
        aria-label={t('details.goBack')}
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        <span className="hidden sm:inline">{t('details.goBack')}</span>
      </button>

      <div className="detail-hero__image">
        <CompleteImage
          src={background}
          alt=""
          fit="cover"
          position={imagePosition}
          ambient={false}
          loading="eager"
          className="detail-hero__picture"
          imageClassName="detail-hero__picture-img"
        />
      </div>
      <div className="detail-hero__gradient" aria-hidden="true" />

      <div className="detail-hero__content">
        <div className="max-w-2xl">
          {badges && <div className="mb-4 flex flex-wrap items-center gap-2">{badges}</div>}

          <h1 className="detail-hero__title mb-4 text-3xl font-black leading-[1.06] tracking-tight text-white drop-shadow-[0_3px_18px_rgba(0,0,0,0.85)] sm:text-4xl md:text-[2.75rem] lg:text-5xl">
            {title}
          </h1>

          {hasMeta && (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold text-white/85">
              {typeof rating === 'number' && rating > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                  {rating.toFixed(1)}/10
                </span>
              )}
              {year && <span>{year}</span>}
              {runtime && <span>{runtime}</span>}
              {classification && <span className="rounded border border-white/25 px-1.5 py-0.5 text-xs">{classification}</span>}
              {seasons && seasons > 0 && <span>{seasons} {seasonLabel.toLowerCase()}</span>}
              {episodes && episodes > 0 && <span>{episodes} {episodeLabel.toLowerCase()}</span>}
            </div>
          )}

          {genres.length > 0 && (
            <div className="mb-5 flex flex-wrap gap-2">
              {genres.map((genre) => {
                const href = typeof genre.id === 'number' ? genreHref?.(genre.id) : undefined;
                const className = 'rounded-full border border-white/20 bg-black/40 px-3 py-1 text-xs font-semibold text-white/90 transition-colors hover:bg-white/15';
                return href ? (
                  <Link key={genre.id ?? genre.name} to={href} className={className}>{genre.name}</Link>
                ) : (
                  <span key={genre.id ?? genre.name} className={className}>{genre.name}</span>
                );
              })}
            </div>
          )}

          {synopsis && (
            <p className="detail-hero__synopsis mb-6 max-w-xl text-sm leading-6 text-white/85 drop-shadow-md sm:text-[15px] sm:leading-7" title={synopsis}>
              {synopsis}
            </p>
          )}

          {note && <div className="mb-4 max-w-xl text-xs leading-relaxed text-white/65">{note}</div>}

          {actions && <div className="detail-hero__actions">{actions}</div>}
        </div>
      </div>

      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-black" />
    </section>
  );
};

export default DetailHero;
