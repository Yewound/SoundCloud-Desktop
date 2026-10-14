import type React from 'react';
import { type SuperlikeTarget, toggleSuperlike } from '../../../lib/superlike-actions';
import { type HeartGesture, useHeartGesture } from './useHeartGesture';

export function useSuperlikeGesture(
  target: SuperlikeTarget,
  onTap?: (e: React.MouseEvent) => void,
): HeartGesture {
  return useHeartGesture({ onTap, onSuperlike: () => toggleSuperlike(target) });
}
