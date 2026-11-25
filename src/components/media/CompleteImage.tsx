import React from 'react';

type CompleteImageProps = {
  src?: string | null;
  alt: string;
  className?: string;
  imageClassName?: string;
  fit?: 'contain' | 'cover';
  position?: string;
  ambient?: boolean;
  loading?: 'eager' | 'lazy';
  onError?: () => void;
};

function cssUrl(value: string): string {
  return `url("${value.replace(/["\\]/g, '\\$&')}")`;
}

/**
 * Affiche une image dans son intégralité par défaut. Le fond flouté n'est
 * qu'un complément décoratif : l'image nette reste toujours en `object-contain`.
 */
const CompleteImage: React.FC<CompleteImageProps> = ({
  src,
  alt,
  className = '',
  imageClassName = '',
  fit = 'contain',
  position = 'center',
  ambient = true,
  loading = 'lazy',
  onError,
}) => {
  const image = src?.trim() ? src : null;

  return (
    <div className={`relative h-full w-full overflow-hidden bg-black/40 ${className}`}>
      {ambient && image && (
        <div
          aria-hidden="true"
          className="complete-image__ambient absolute inset-0 scale-110 bg-cover bg-center opacity-40 blur-2xl"
          style={{ backgroundImage: cssUrl(image) }}
        />
      )}
      {image ? (
        <img
          src={image}
          alt={alt}
          loading={loading}
          decoding="async"
          onError={onError}
          className={`relative h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${imageClassName}`}
          style={{ objectPosition: position }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-white/[0.03] text-xs text-white/35">
          {alt}
        </div>
      )}
    </div>
  );
};

export default CompleteImage;
