/** Monogramme Movix : nouveau M rouge fourni, sur fond transparent. */
export function MovixMark({ className = '', testId }: { className?: string; testId?: string }) {
  return (
    <img
      data-testid={testId}
      src="/movix-mark.png"
      alt="Movix"
      className={`h-full w-auto aspect-square object-contain ${className}`}
      draggable={false}
    />
  );
}
