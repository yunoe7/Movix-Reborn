import React from 'react';

export type StreamingPlatform = {
  id: number;
  name: string;
  logo: string;
  label?: string;
};

type StreamingPlatformSelectorProps = {
  platforms: StreamingPlatform[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  className?: string;
};

// Chaque logo garde ses proportions natives ; ces bornes évitent qu'un tracé
// très large ou très haut colonise toute la tuile et déséquilibre la rangée.
const logoBounds: Record<string, React.CSSProperties> = {
  netflix: { maxWidth: '78%', maxHeight: '92%' },
  'prime-video': { maxWidth: '92%', maxHeight: '60%' },
  'paramount-plus': { maxWidth: '94%', maxHeight: '52%' },
  'disney-plus': { maxWidth: '86%', maxHeight: '68%' },
  'hbo-max': { maxWidth: '86%', maxHeight: '86%' },
  'marvel-studios': { maxWidth: '92%', maxHeight: '64%' },
  'apple-tv-plus': { maxWidth: '92%', maxHeight: '58%' },
  'warner-bros': { maxWidth: '82%', maxHeight: '84%' },
  'dc-comics': { maxWidth: '80%', maxHeight: '80%' },
};

const logoKey = (logo: string) => logo.split('/').pop()?.replace(/\.svg$/i, '') || '';

export default function StreamingPlatformSelector({
  platforms,
  selectedId,
  onSelect,
  className = '',
}: StreamingPlatformSelectorProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2.5 sm:gap-3 pt-2 pb-3 ${className}`}>
      {platforms.map((platform) => {
        const selected = selectedId === platform.id;
        return (
          <button
            key={platform.id}
            type="button"
            data-testid="platform-logo-button"
            data-platform-id={platform.id}
            onClick={() => onSelect(platform.id)}
            aria-label={`Afficher les contenus ${platform.name}`}
            aria-pressed={selected}
            title={platform.name}
            className={`group flex-none w-[52px] h-[52px] sm:w-16 sm:h-16 rounded-[1.1rem] border-2 backdrop-blur-sm transition-all duration-200 flex items-center justify-center p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black
              ${selected
                ? 'border-white/90 bg-black/20 shadow-[inset_0_0_0_1px_rgba(255,255,255,.12),0_8px_24px_rgba(0,0,0,.32)]'
                : 'border-white/[0.12] bg-black/30 hover:border-white/35 hover:bg-white/[0.07] hover:-translate-y-0.5'}`}
          >
            <img
              data-testid="platform-logo"
              data-platform-id={platform.id}
              src={platform.logo}
              alt={platform.name}
              draggable={false}
              decoding="async"
              className="block w-full h-full object-contain select-none"
              style={logoBounds[logoKey(platform.logo)]}
            />
          </button>
        );
      })}
    </div>
  );
}
