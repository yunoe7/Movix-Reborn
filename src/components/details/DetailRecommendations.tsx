import { useTranslation } from 'react-i18next';
import EmblaCarousel, { type Media } from '../EmblaCarousel';
import LazySection from '../LazySection';
import './details.css';

type DetailRecommendationsProps = {
  items: Media[];
  mediaType: string;
  title?: string;
  loading?: boolean;
  emptyLabel?: string;
};

/** Recommendations keep the existing TMDB sources and carousel mechanics. */
const DetailRecommendations: React.FC<DetailRecommendationsProps> = ({
  items,
  mediaType,
  title,
  loading = false,
  emptyLabel,
}) => {
  const { t } = useTranslation();

  return (
    <section className="detail-section" aria-labelledby="detail-recommendations-heading">
      <div className="detail-section__heading">
        <h2 id="detail-recommendations-heading">{title ?? t('details.youMightAlsoLike')}</h2>
      </div>

      <LazySection index={0} immediateLoadCount={0} rootMargin="300px" minHeight="320px">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="aspect-[2/3] animate-pulse rounded-xl bg-white/[0.05]" />
            ))}
          </div>
        ) : items.length > 0 ? (
          <div className="detail-recommendations">
            <EmblaCarousel items={items} mediaType={mediaType} />
          </div>
        ) : (
          <p className="text-sm text-white/50">{emptyLabel ?? t('details.noRecommendations')}</p>
        )}
      </LazySection>
    </section>
  );
};

export default DetailRecommendations;
