import { memo } from 'react';
import { usePerfMode } from '../../../lib/perf';

const SPARKLES = Array.from({ length: 14 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  top: (i * 53 + 7) % 100,
  size: 6 + ((i * 7) % 8),
  delay: (i * 0.37) % 2.8,
}));

export const SparkleField = memo(function SparkleField() {
  const perf = usePerfMode();
  const sparkles = SPARKLES.slice(0, perf.particles(SPARKLES.length));
  if (sparkles.length === 0) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ contain: 'strict', transform: 'translateZ(0)' }}
    >
      {sparkles.map((s) => (
        <svg
          key={`${s.left}-${s.top}`}
          viewBox="0 0 10 10"
          width={s.size}
          height={s.size}
          className={perf.idleAnim ? 'absolute superlike-twinkle' : 'absolute opacity-60'}
          style={{ left: `${s.left}%`, top: `${s.top}%`, animationDelay: `${s.delay}s` }}
        >
          <path d="M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z" fill="var(--color-superlike-from)" />
        </svg>
      ))}
    </div>
  );
});
