/** The small sprout that marks Slow Garden's quiet screens. Decorative. */
export function Sprout({ size = 28, growing = false }: { size?: number; growing?: boolean }) {
  return (
    <svg
      className={`calm-sprout${growing ? " calm-growing" : ""}`}
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path className="stem" d="M20 36V18" />
      <path className="leaf" d="M20 24c0-7 5.500-11 12-11 0 7.400-5.500 11-12 11z" />
      <path className="leaf" d="M20 20c0-6-4.600-9.600-10.400-9.600C9.600 16.600 14.200 20 20 20z" />
    </svg>
  );
}
