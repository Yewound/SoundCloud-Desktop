import type React from 'react';
import { memo } from 'react';
import { Heart } from '../../../lib/icons';
import { usePerfMode } from '../../../lib/perf';
import { SuperHeart } from './SuperHeart';
import { type HeartGesture, RING_FILL_MS } from './useHeartGesture';
import './superlike.css';

const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315];
const SPARK_COLORS = [
  'var(--color-superlike-from)',
  'var(--color-superlike-via)',
  'var(--color-superlike-to)',
];

export function HeartGlyph({
  liked,
  superliked,
  size,
}: {
  liked: boolean;
  superliked: boolean;
  size: number;
}) {
  if (superliked) return <SuperHeart size={size} />;
  return <Heart size={size} fill={liked ? 'currentColor' : 'none'} />;
}

export const HoldHeart = memo(function HoldHeart({
  liked,
  superliked,
  size,
  gesture,
}: {
  liked: boolean;
  superliked: boolean;
  size: number;
  gesture: HeartGesture;
}) {
  return (
    <span className="superlike-anchor" style={{ width: size, height: size }}>
      <span
        key={gesture.burst}
        className={gesture.bursting ? 'superlike-anchor superlike-pop' : 'superlike-anchor'}
      >
        <HeartGlyph liked={liked} superliked={superliked} size={size} />
      </span>
      {gesture.holding && <HoldRing />}
      {gesture.bursting && <Burst key={gesture.burst} size={size} />}
    </span>
  );
});

function HoldRing() {
  return (
    <svg
      className="superlike-ring"
      viewBox="0 0 36 36"
      aria-hidden="true"
      style={{ '--superlike-hold': `${RING_FILL_MS}ms` } as React.CSSProperties}
    >
      <circle className="superlike-ring-track" cx="18" cy="18" r="16" />
      <circle className="superlike-ring-fill" cx="18" cy="18" r="16" pathLength={100} />
    </svg>
  );
}

function Burst({ size }: { size: number }) {
  const perf = usePerfMode();
  const sparks = SPARKS.slice(0, perf.particles(SPARKS.length));
  if (sparks.length === 0) return null;
  return (
    <>
      <span className="superlike-wave" />
      {sparks.map((angle, i) => (
        <span
          key={angle}
          className="superlike-spark"
          style={
            {
              '--superlike-angle': `${angle}deg`,
              '--superlike-reach': `${-Math.round(size * 1.35)}px`,
              '--superlike-spark-color': SPARK_COLORS[i % SPARK_COLORS.length],
            } as React.CSSProperties
          }
        />
      ))}
    </>
  );
}
