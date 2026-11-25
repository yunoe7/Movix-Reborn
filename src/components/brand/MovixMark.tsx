/** Monogramme Movix officiel fourni par le propriétaire de la marque. */
export function MovixMark({ className = '', testId }: { className?: string; testId?: string }) {
  return (
    <img
      data-testid={testId}
      src="/movix-monogram.svg"
      alt="Movix"
      draggable={false}
      className={`block h-full w-full object-contain ${className}`}
    />
  );
}
