import type React from 'react';
import { useEffect, useRef, useState } from 'react';

export const HOLD_MS = 500;
const RING_DELAY_MS = 140;
export const RING_FILL_MS = HOLD_MS - RING_DELAY_MS;
const BURST_MS = 700;

export interface HeartGesture {
  holding: boolean;
  burst: number;
  bursting: boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
    onClick: (e: React.MouseEvent) => void;
  };
}

export function useHeartGesture({
  onTap,
  onSuperlike,
}: {
  onTap?: (e: React.MouseEvent) => void;
  onSuperlike: () => boolean;
}): HeartGesture {
  const [holding, setHolding] = useState(false);
  const [burst, setBurst] = useState(0);
  const [bursting, setBursting] = useState(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const ringTimer = useRef<number | undefined>(undefined);
  const burstTimer = useRef<number | undefined>(undefined);
  const held = useRef(false);

  useEffect(
    () => () => {
      window.clearTimeout(holdTimer.current);
      window.clearTimeout(ringTimer.current);
      window.clearTimeout(burstTimer.current);
    },
    [],
  );

  const release = () => {
    window.clearTimeout(holdTimer.current);
    window.clearTimeout(ringTimer.current);
    setHolding(false);
  };

  const land = () => {
    setHolding(false);
    if (!onSuperlike()) return;
    setBurst((n) => n + 1);
    setBursting(true);
    window.clearTimeout(burstTimer.current);
    burstTimer.current = window.setTimeout(() => setBursting(false), BURST_MS);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    held.current = false;
    window.clearTimeout(holdTimer.current);
    window.clearTimeout(ringTimer.current);
    ringTimer.current = window.setTimeout(() => setHolding(true), RING_DELAY_MS);
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      land();
    }, HOLD_MS);
  };

  const onClick = (e: React.MouseEvent) => {
    if (held.current) {
      held.current = false;
      e.stopPropagation();
      return;
    }
    if (onTap) onTap(e);
    else land();
  };

  return {
    holding,
    burst,
    bursting,
    handlers: {
      onPointerDown,
      onPointerUp: release,
      onPointerLeave: release,
      onPointerCancel: release,
      onClick,
    },
  };
}
