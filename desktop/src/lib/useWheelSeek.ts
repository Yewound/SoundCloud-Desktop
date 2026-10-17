import { type RefObject, useEffect, useRef } from 'react';
import { formatTime } from './formatters';

const STEP_SEC = 5;
const SHIFT_STEP_SEC = 15;
const NOTCH_GAP_MS = 50;
const STREAM_STEP_PX = 100;
const BURST_GAP_MS = 160;
const COMMIT_DELAY_MS = 200;

interface WheelSeekSource {
  position: () => number;
  duration: () => number;
  seek: (seconds: number) => void;
  preview: (seconds: number) => void;
  dragging: () => boolean;
}

export function useWheelSeek(
  rootRef: RefObject<HTMLElement | null>,
  tipRef: RefObject<HTMLElement | null>,
  source: WheelSeekSource,
): RefObject<number | null> {
  const sourceRef = useRef(source);
  const targetRef = useRef<number | null>(null);

  useEffect(() => {
    sourceRef.current = source;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let lastWheelAt = 0;
    let burstOnBar = false;
    let spaced = false;
    let streamPx = 0;
    let timer = 0;

    const reset = () => {
      window.clearTimeout(timer);
      targetRef.current = null;
      if (tipRef.current) tipRef.current.style.opacity = '0';
    };

    const commit = () => {
      const target = targetRef.current;
      reset();
      if (target !== null) sourceRef.current.seek(target);
    };

    const onAnyWheel = (e: WheelEvent) => {
      const now = performance.now();
      const gap = now - lastWheelAt;
      lastWheelAt = now;
      spaced = gap >= NOTCH_GAP_MS;
      if (gap > BURST_GAP_MS) burstOnBar = e.target instanceof Node && root.contains(e.target);
    };

    const onWheel = (e: WheelEvent) => {
      if (!burstOnBar || e.ctrlKey || e.metaKey) return;
      const src = sourceRef.current;
      const duration = src.duration();
      if (duration <= 0 || src.dragging()) return;
      e.preventDefault();

      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      if (spaced || e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
        streamPx = delta;
      } else {
        streamPx += delta;
        if (Math.abs(streamPx) < STREAM_STEP_PX) return;
      }

      const step = (e.shiftKey ? SHIFT_STEP_SEC : STEP_SEC) * (streamPx < 0 ? 1 : -1);
      streamPx %= STREAM_STEP_PX;
      const target = Math.max(0, Math.min(duration, (targetRef.current ?? src.position()) + step));
      targetRef.current = target;
      src.preview(target);

      const tip = tipRef.current;
      if (tip) {
        tip.textContent = formatTime(target);
        tip.style.left = `${(target / duration) * 100}%`;
        tip.style.opacity = '1';
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(commit, COMMIT_DELAY_MS);
    };

    window.addEventListener('wheel', onAnyWheel, { capture: true, passive: true });
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('pointerdown', reset);
    return () => {
      window.removeEventListener('wheel', onAnyWheel, { capture: true });
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('pointerdown', reset);
      reset();
    };
  }, [rootRef, tipRef]);

  return targetRef;
}
