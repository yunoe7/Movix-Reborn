import { useLightMode } from '@/context/LightModeContext';
import React, { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from '@/hooks/useFlexGapEmblaCarousel';
import { ChevronLeft, ChevronRight } from './icons/Icons8';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { useTranslation } from 'react-i18next';

interface GenreItem {
  id: number | string;
  name: string;
  route: string;
  imageUrl?: string;
}

interface EmblaCarouselGenresProps {
  title?: string | React.ReactNode;
  items: GenreItem[];
}

const EmblaCarouselGenres: React.FC<EmblaCarouselGenresProps> = ({ title, items }) => {
  const { t } = useTranslation();
  const { effectivePrefs } = useLightMode();
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    dragFree: true,
    containScroll: 'keepSnaps',
    slidesToScroll: 1,
    skipSnaps: false,
    duration: effectivePrefs.transitions ? 25 : 0,
    loop: false
  });
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    try {
      setCanScrollPrev(Boolean((emblaApi as any).canScrollPrev && emblaApi.canScrollPrev()));
      setCanScrollNext(Boolean((emblaApi as any).canScrollNext && emblaApi.canScrollNext()));
    } catch (_) {
      // noop
    }
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

  const getStep = useCallback(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
    if (w >= 1536) return 8; // 2K+
    if (w >= 1280) return 6; // xl
    if (w >= 1024) return 5; // lg
    if (w >= 768) return 4;  // md
    return 2;                // sm/xs
  }, []);

  const handlePrev = useCallback((e?: React.MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!emblaApi) return;
    try {
      const current = emblaApi.selectedScrollSnap();
      const target = Math.max(0, current - getStep());
      emblaApi.scrollTo(target, !effectivePrefs.transitions);
    } catch (_) {
      emblaApi.scrollPrev(!effectivePrefs.transitions);
    }
  }, [emblaApi, getStep, effectivePrefs.transitions]);

  const handleNext = useCallback((e?: React.MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!emblaApi) return;
    try {
      const current = emblaApi.selectedScrollSnap();
      const snaps = emblaApi.scrollSnapList().length;
      const target = Math.min(snaps - 1, current + getStep());
      emblaApi.scrollTo(target, !effectivePrefs.transitions);
    } catch (_) {
      emblaApi.scrollNext(!effectivePrefs.transitions);
    }
  }, [emblaApi, getStep, effectivePrefs.transitions]);

  return (
    <div className="w-full relative">
      {title && (
        <div className="flex justify-between items-center mb-2 px-4 md:px-6 relative z-10">
          <h2 data-seasonal-typography="sectionTitle" className="section-title">{title}</h2>
        </div>
      )}
      <div className="relative w-full">
        <div className="overflow-visible" ref={emblaRef}>
          <div className="flex gap-4 md:gap-6 pr-4 md:pr-6 py-4 pl-4 md:pl-6">
            {items.map((genre) => (
              <div key={genre.id} className="flex-none">
                <Link to={genre.route} className="group block h-[104px] w-[188px] select-none sm:h-[112px] sm:w-[210px] md:h-[124px] md:w-[236px]">
                  <div data-ambient-surface className="relative h-full w-full overflow-hidden rounded-xl border border-white/[0.09] bg-[#171719] shadow-[0_8px_24px_rgba(0,0,0,.16)] transition-[border-color,transform,box-shadow] duration-300 group-hover:-translate-y-0.5 group-hover:border-white/20 group-hover:shadow-[0_14px_32px_rgba(0,0,0,.28)]">
                    {genre.imageUrl && (
                      <img
                        src={genre.imageUrl}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 h-full w-full object-cover opacity-45 transition-transform duration-500 group-hover:scale-[1.04] group-hover:opacity-60"
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-r from-black/45 via-black/20 to-black/35" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-white/[0.035]" />
                    <div className="absolute inset-0 flex items-center justify-center px-3">
                      <span className="text-center font-semibold text-[15px] leading-snug tracking-[-0.025em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,.72)] md:text-base">
                        {genre.name}
                      </span>
                    </div>
                  </div>
                </Link>
              </div>
            ))}
            <div className="flex-none w-8 md:w-24" aria-hidden="true" />
          </div>
        </div>
        <button
          type="button"
          aria-label={t('common.previous')}
          onClick={handlePrev}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className={`absolute left-0 inset-y-0 z-[10000] rounded-none bg-black/40 hover:bg-black/50 text-white transition-colors shadow-lg
                     w-10 md:w-12 h-full flex items-center justify-center ${!canScrollPrev ? 'opacity-60' : ''}`}
          style={{ pointerEvents: 'auto' }}
        >
          <ChevronLeft className="w-5 h-5 md:w-6 md:h-6" />
        </button>
        <button
          type="button"
          aria-label={t('common.next')}
          onClick={handleNext}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className={`absolute right-0 inset-y-0 z-[10000] rounded-none bg-black/40 hover:bg-black/50 text-white transition-colors shadow-lg
                     w-10 md:w-12 h-full flex items-center justify-center ${!canScrollNext ? 'opacity-60' : ''}`}
          style={{ pointerEvents: 'auto' }}
        >
          <ChevronRight className="w-5 h-5 md:w-6 md:h-6" />
        </button>
      </div>
    </div>
  );
};

export default React.memo(EmblaCarouselGenres);
