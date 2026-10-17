import { useEffect } from 'react';
import { create } from 'zustand';
import { useSettingsStore } from '../stores/settings';
import { trackedInvoke as invoke } from './diagnostics';

const POLL_MS = 5000;

export const useDesktopWallpaperLost = create<{ lost: boolean }>(() => ({ lost: false }));

export function isDesktopWallpaper(name: string): boolean {
  return name.startsWith('desktop_');
}

export function findDesktopWallpaper(): Promise<boolean> {
  return invoke<boolean>('desktop_wallpaper_found').catch(() => false);
}

export function syncDesktopWallpaper(): Promise<string | null> {
  return invoke<string | null>('desktop_wallpaper_sync').catch(() => null);
}

export function useDesktopWallpaper(): void {
  const following = useSettingsStore((s) => isDesktopWallpaper(s.backgroundImage));

  useEffect(() => {
    if (!following) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let stopped = false;
    const poll = async () => {
      clearTimeout(timer);
      if (busy || stopped || document.visibilityState === 'hidden') return;
      busy = true;
      const name = await syncDesktopWallpaper();
      busy = false;
      if (stopped) return;
      useDesktopWallpaperLost.setState({ lost: !name });
      const s = useSettingsStore.getState();
      if (name && name !== s.backgroundImage && isDesktopWallpaper(s.backgroundImage)) {
        s.setBackgroundImage(name);
      }
      timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    document.addEventListener('visibilitychange', poll);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', poll);
      useDesktopWallpaperLost.setState({ lost: false });
    };
  }, [following]);
}
