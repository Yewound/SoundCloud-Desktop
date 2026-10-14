import { create } from 'zustand';
import type { Track } from './player';

export type SuperlikeTarget = Pick<Track, 'urn'> & Partial<Track>;

interface SuperlikeLimitState {
  wanted: SuperlikeTarget | null;
  open: (wanted: SuperlikeTarget) => void;
  close: () => void;
}

export const useSuperlikeLimit = create<SuperlikeLimitState>()((set) => ({
  wanted: null,
  open: (wanted) => set({ wanted }),
  close: () => set({ wanted: null }),
}));
