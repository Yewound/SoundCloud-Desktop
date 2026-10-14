import { useState } from 'react';
import type { useSuperlikedTracks } from '../../../lib/superlikes';
import { type Track, usePlayerStore } from '../../../stores/player';

type SuperlikesQuery = ReturnType<typeof useSuperlikedTracks>;

async function everySuperlike(query: SuperlikesQuery): Promise<Track[]> {
  let result = query.hasNextPage ? await query.fetchNextPage() : undefined;
  while (result?.hasNextPage) result = await result.fetchNextPage();
  const pages = (result?.data ?? query.data)?.pages ?? [];
  return pages.flatMap((page) => page.collection);
}

export function usePlaySuperlikes(query: SuperlikesQuery) {
  const [loading, setLoading] = useState(false);

  const start = async (shuffle: boolean) => {
    if (loading) return;
    setLoading(true);
    try {
      const all = await everySuperlike(query);
      if (all.length === 0) return;
      if (shuffle) usePlayerStore.setState({ shuffle: true });
      const first = shuffle ? all[Math.floor(Math.random() * all.length)] : all[0];
      usePlayerStore.getState().play(first, all);
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    playAll: () => void start(false),
    shuffle: () => void start(true),
  };
}
