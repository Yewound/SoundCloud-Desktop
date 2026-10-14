import { memo, useId } from 'react';
import { usePerfMode } from '../../../lib/perf';

const HEART =
  'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5';
const SPARKLE = 'M20.5 0.6l0.85 2.05 2.05 0.85-2.05 0.85-0.85 2.05-0.85-2.05-2.05-0.85 2.05-0.85z';

export const SuperHeart = memo(function SuperHeart({
  size = 16,
  className,
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const id = useId();
  const perf = usePerfMode();
  const gradient = `superlike-${id.replace(/[^\w-]/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      overflow="visible"
      aria-hidden="true"
      className={className}
      style={{
        filter: perf.glow ? 'drop-shadow(0 0 4px var(--color-superlike-glow))' : undefined,
      }}
    >
      <defs>
        <linearGradient id={gradient} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--color-superlike-from)" />
          <stop offset="0.55" stopColor="var(--color-superlike-via)" />
          <stop offset="1" stopColor="var(--color-superlike-to)" />
        </linearGradient>
      </defs>
      <path
        d={HEART}
        fill={`url(#${gradient})`}
        stroke={`url(#${gradient})`}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7.2 8.4a2.6 2.6 0 0 1 2.4-1.9" fill="none" stroke="white" strokeOpacity={0.55} strokeWidth={1.4} strokeLinecap="round" />
      <path d={SPARKLE} fill="white" stroke="var(--color-superlike-from)" strokeWidth={0.6} strokeLinejoin="round" />
    </svg>
  );
});
