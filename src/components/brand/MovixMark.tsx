/** Monogramme Movix : M seul, sans cadre ni contour autour du logo. */
export function MovixMark({ className = '', testId }: { className?: string; testId?: string }) {
  return (
    <svg
      data-testid={testId}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Movix"
      className={`h-full w-auto aspect-square object-contain ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 84V16h19l21 31 21-31h19v68H72V47L50 78 28 47v37H10Z"
        fill="#F04452"
      />
    </svg>
  );
}
