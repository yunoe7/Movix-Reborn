import type { RefObject } from 'react';
import { MessageCircle } from '../icons/Icons8';
import { useTranslation } from 'react-i18next';
import CommentsSection from '../CommentsSection';
import LazySection from '../LazySection';
import './details.css';

type DetailCommentsProps = {
  contentType: 'movie' | 'tv';
  contentId: string;
  anchorRef?: RefObject<HTMLDivElement>;
};

/** Keeps the existing comment system, with a section frame matching the page. */
const DetailComments: React.FC<DetailCommentsProps> = ({ contentType, contentId, anchorRef }) => {
  const { t } = useTranslation();

  return (
    <div ref={anchorRef} id="comments-section" className="detail-comments">
      <section className="detail-section" aria-labelledby="detail-comments-heading">
        <div className="detail-section__heading">
          <h2 id="detail-comments-heading" className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-white/70" aria-hidden="true" />
            {t('details.commentsTab')}
          </h2>
        </div>
        <LazySection index={1} immediateLoadCount={0} rootMargin="200px" minHeight="400px">
          <CommentsSection contentType={contentType} contentId={contentId} />
        </LazySection>
      </section>
    </div>
  );
};

export default DetailComments;
