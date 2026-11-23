import { useTranslation } from 'react-i18next';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import CompleteImage from '@/components/media/CompleteImage';
import './details.css';

export type DetailCastItem = {
  id: number;
  name: string;
  character?: string | null;
  profile_path?: string | null;
};

type DetailCastRailProps = {
  items: DetailCastItem[];
  imageUrl?: (path: string, width: number) => string;
  title?: string;
  emptyLabel?: string;
};

/** Compact horizontal cast rail used identically on films, series and anime. */
const DetailCastRail: React.FC<DetailCastRailProps> = ({ items, imageUrl, title, emptyLabel }) => {
  const { t } = useTranslation();

  return (
    <section className="detail-section detail-cast-section" aria-labelledby="detail-cast-heading">
      <div className="detail-section__heading">
        <h2 id="detail-cast-heading">{title ?? t('details.castTab')}</h2>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-white/50">{emptyLabel ?? t('details.noCast')}</p>
      ) : (
        <div className="detail-cast-rail" aria-label={title ?? t('details.castTab')}>
          {items.map((actor) => {
            const portrait = actor.profile_path && imageUrl
              ? imageUrl(actor.profile_path, 185)
              : null;
            return (
              <Link
                key={actor.id}
                to={`/person/${actor.id}`}
                className="detail-cast-card"
                aria-label={`${actor.name}${actor.character ? ` — ${actor.character}` : ''}`}
              >
                {portrait ? (
                  <span className="detail-cast-card__image" aria-hidden="false">
                    <CompleteImage
                      src={portrait}
                      alt={actor.name}
                      fit="cover"
                      position="center top"
                      ambient={false}
                    />
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className="detail-cast-card__image flex items-center justify-center text-xl font-semibold text-white/70"
                    style={{ backgroundColor: `hsl(${actor.name.charCodeAt(0) * 7 % 360}, 32%, 24%)` }}
                  >
                    {actor.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="detail-cast-card__meta">
                  <span className="detail-cast-card__name" title={actor.name}>{actor.name}</span>
                  {actor.character && <span className="detail-cast-card__character" title={actor.character}>{actor.character}</span>}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default DetailCastRail;
