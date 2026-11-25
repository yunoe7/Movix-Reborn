/** Monogramme Movix : nouveau M rouge fourni, sur fond transparent. */
export function MovixMark({ className = '' }: { className?: string }) {
  return (
    <img
      src="/movix-mark.png"
      alt="Movix"
      className={`h-full w-auto aspect-square object-contain ${className}`}
      draggable={false}
    />
  );
}
