import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { describeError, logInfo } from '../lib/diagnostics';
import { tauriStorage } from '../lib/tauri-storage';
import { syncThemeCss } from '../lib/themes/apply';
import { loadCatalog, readCachedCatalog } from '../lib/themes/catalog';
import {
  collectGarbage,
  downloadVersion,
  type InstalledVersion,
  ThemeCheckError,
  versionNames,
} from '../lib/themes/files';
import type { Catalog, CatalogTheme } from '../lib/themes/index-parse.ts';
import { probeTheme, whenShown } from '../lib/themes/probe';
import {
  activeLook,
  activeTheme,
  brokenKey,
  hasUpdate,
  type InstalledTheme,
  isBroken,
  isRevoked,
  rolledBack,
  type ThemeTrial,
  versionOf,
  withMetadata,
  withVersion,
} from '../lib/themes/records';
import { clearSentinel, sentinelHolds, writeSentinel } from '../lib/themes/sentinel';

export type ThemeNoticeKind =
  | 'updated'
  | 'revoked'
  | 'downloadFailed'
  | 'checkFailed'
  | 'breaksUi'
  | 'crashOff';

export interface ThemeNotice {
  kind: ThemeNoticeKind;
  id: string;
  name: string;
}

export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ThemesState {
  installed: Record<string, InstalledTheme>;
  activeId: string | null;
  enabled: boolean;
  autoUpdate: boolean;
  checkedAt: number;
  hydrated: boolean;
  catalog: Catalog | null;
  status: CatalogStatus;
  trial: ThemeTrial | null;
  busy: string | null;
  notices: ThemeNotice[];
  refresh: (manual: boolean) => Promise<void>;
  startTrial: (id: string) => Promise<void>;
  keepTrial: () => void;
  revertTrial: () => void;
  deactivate: () => void;
  remove: (id: string) => void;
  setPinned: (id: string, pinned: boolean) => void;
  update: (id: string) => Promise<void>;
  rollback: (id: string) => void;
  setAutoUpdate: (autoUpdate: boolean) => void;
  setEnabled: (enabled: boolean) => Promise<void>;
  markBroken: (id: string, hash?: string) => void;
  applyCatalog: (catalog: Catalog) => Promise<ThemeNotice[]>;
  verifyActive: () => Promise<void>;
  notify: (notices: ThemeNotice[]) => void;
}

export const TRIAL_MS = 20_000;
const SENTINEL_CLEAR_MS = 8_000;

let trialTimer: ReturnType<typeof setTimeout> | undefined;
let sentinelTimer: ReturnType<typeof setTimeout> | undefined;

function failureKind(error: unknown): ThemeNoticeKind {
  return error instanceof ThemeCheckError ? 'checkFailed' : 'downloadFailed';
}

function isVisible(): boolean {
  return document.visibilityState === 'visible';
}

function clearSentinelSoon() {
  clearTimeout(sentinelTimer);
  sentinelTimer = setTimeout(() => void clearSentinel(), SENTINEL_CLEAR_MS);
}

function keptNames(state: ThemesState): string[] {
  const versions: InstalledVersion[] = Object.values(state.installed).flatMap((theme) =>
    theme.previous ? [theme, theme.previous] : [theme],
  );
  if (state.trial) versions.push(state.trial.version);
  return versions.flatMap(versionNames);
}

function collect(state: ThemesState, afterRemove = false) {
  if (!state.hydrated) return;
  if (!afterRemove && Object.keys(state.installed).length === 0) return;
  void collectGarbage(keptNames(state));
}

export const useThemesStore = create<ThemesState>()(
  persist(
    (set, get) => {
      const putTheme = (id: string, theme: InstalledTheme) =>
        set((s) => ({ installed: { ...s.installed, [id]: theme } }));

      const probeFailed = async (id: string, look: InstalledVersion): Promise<boolean> => {
        const failed = await probeTheme('main');
        if (failed.length) logInfo(`[Themes] ${id} ${look.version} breaks: ${failed.join(', ')}`);
        return failed.length > 0;
      };

      const installUpdate = async (
        id: string,
        entry: CatalogTheme,
      ): Promise<ThemeNotice | null> => {
        let version: InstalledVersion;
        try {
          version = await downloadVersion(entry);
        } catch (error) {
          logInfo(`[Themes] ${id} ${entry.version} install failed: ${describeError(error)}`);
          return { kind: failureKind(error), id, name: entry.name };
        }
        const current = get().installed[id];
        if (!current) return null;
        const painted = get().activeId === id && get().enabled && !get().trial;
        if (painted && isVisible()) await writeSentinel(id, version.hash);
        putTheme(id, withVersion(version, current));
        collect(get());
        if (painted) void get().verifyActive();
        return { kind: 'updated', id, name: entry.name };
      };

      return {
        installed: {},
        activeId: null,
        enabled: true,
        autoUpdate: true,
        checkedAt: 0,
        hydrated: false,
        catalog: null,
        status: 'idle',
        trial: null,
        busy: null,
        notices: [],

        refresh: async (manual) => {
          if (get().status === 'loading') return;
          set({ status: 'loading' });
          if (!get().catalog) set({ catalog: await readCachedCatalog() });
          try {
            const catalog = await loadCatalog();
            set({ catalog, status: 'ready', checkedAt: Date.now() });
            const notices = await get().applyCatalog(catalog);
            get().notify(notices.filter((n) => manual || n.kind !== 'downloadFailed'));
          } catch (error) {
            logInfo(`[Themes] catalog check failed: ${describeError(error)}`);
            set({ status: 'error' });
          }
        },

        startTrial: async (id) => {
          const { catalog, busy, installed } = get();
          const entry = catalog?.themes.find((theme) => theme.id === id);
          const current = installed[id];
          const download = entry?.compatible && entry.hash !== current?.hash ? entry : null;
          if (busy || (!download && !current) || isBroken(current, download?.hash)) return;
          get().revertTrial();
          set({ busy: id });
          let version: InstalledVersion;
          try {
            version = download ? await downloadVersion(download) : versionOf(current!);
          } catch (error) {
            logInfo(`[Themes] ${id} download failed: ${describeError(error)}`);
            set({ busy: null });
            get().notify([{ kind: failureKind(error), id, name: download?.name ?? id }]);
            return;
          }
          const trial = { id, version, until: Date.now() + TRIAL_MS };
          set({ busy: null, trial });
          clearTimeout(trialTimer);
          trialTimer = setTimeout(() => {
            if (get().trial === trial) get().revertTrial();
          }, TRIAL_MS);
          await syncThemeCss(version);
          if (!(await probeFailed(id, version)) || get().trial !== trial) return;
          get().revertTrial();
          get().markBroken(id, version.hash);
          get().notify([{ kind: 'breaksUi', id, name: version.name }]);
        },

        keepTrial: () => {
          const { trial, installed } = get();
          if (!trial) return;
          clearTimeout(trialTimer);
          set({
            trial: null,
            activeId: trial.id,
            enabled: true,
            installed: {
              ...installed,
              [trial.id]: withVersion(trial.version, installed[trial.id]),
            },
          });
          collect(get());
          void get().verifyActive();
        },

        revertTrial: () => {
          if (!get().trial) return;
          clearTimeout(trialTimer);
          set({ trial: null });
          void syncThemeCss(activeLook(get()));
        },

        deactivate: () => {
          get().revertTrial();
          set({ activeId: null });
        },

        remove: (id) => {
          if (get().trial?.id === id) get().revertTrial();
          const { [id]: _removed, ...installed } = get().installed;
          set((s) => ({ installed, activeId: s.activeId === id ? null : s.activeId }));
          collect(get(), true);
        },

        setPinned: (id, pinned) => {
          const theme = get().installed[id];
          if (theme) putTheme(id, { ...theme, pinned });
        },

        update: async (id) => {
          const theme = get().installed[id];
          const entry = get().catalog?.themes.find((item) => item.id === id);
          if (!theme || !entry || get().busy || !hasUpdate(theme, entry)) return;
          set({ busy: id });
          const notice = await installUpdate(id, entry);
          set({ busy: null });
          if (notice) get().notify([notice]);
        },

        rollback: (id) => {
          const theme = get().installed[id];
          if (!theme?.previous) return;
          putTheme(id, rolledBack(theme, theme.previous));
          collect(get());
          if (get().activeId === id) void get().verifyActive();
        },

        setAutoUpdate: (autoUpdate) => set({ autoUpdate }),

        setEnabled: async (enabled) => {
          if (!enabled) {
            get().revertTrial();
            set({ enabled: false });
            return;
          }
          const { activeId, installed } = get();
          const theme = activeId ? installed[activeId] : undefined;
          if (activeId && theme && !isBroken(theme) && isVisible()) {
            await writeSentinel(activeId, theme.hash);
          }
          set({ enabled: true });
          void get().verifyActive();
        },

        markBroken: (id, hash) => {
          const theme = get().installed[id];
          if (theme) putTheme(id, { ...theme, brokenFor: brokenKey(hash ?? theme.hash) });
        },

        applyCatalog: async (catalog) => {
          const notices: ThemeNotice[] = [];
          for (const id of Object.keys(get().installed)) {
            const theme = get().installed[id];
            const entry = catalog.themes.find((item) => item.id === id);
            if (!theme) continue;
            if (isRevoked(catalog, id, theme.hash)) {
              notices.push({ kind: 'revoked', id, name: theme.name });
              if (theme.previous && !isRevoked(catalog, id, theme.previous.hash))
                get().rollback(id);
              else get().remove(id);
              continue;
            }
            if (!entry) continue;
            if (entry.hash === theme.hash) {
              const fresh = withMetadata(theme, entry);
              if (fresh !== theme) putTheme(id, fresh);
              continue;
            }
            const wanted = get().autoUpdate && !theme.pinned && !isBroken(theme, entry.hash);
            if (!wanted || !hasUpdate(theme, entry)) continue;
            const notice = await installUpdate(id, entry);
            if (notice) notices.push(notice);
          }
          return notices;
        },

        verifyActive: async () => {
          const id = get().activeId;
          const look = activeTheme(get());
          if (!id || !look || get().trial) return;
          if (!sentinelHolds(id, look.hash)) {
            await whenShown();
            if (activeTheme(get()) !== look) return;
            await writeSentinel(id, look.hash);
          }
          await syncThemeCss(look);
          const broken = await probeFailed(id, look);
          if (activeTheme(get()) !== look || get().trial) return;
          if (!broken) {
            clearSentinelSoon();
            return;
          }
          get().markBroken(id);
          get().notify([{ kind: 'breaksUi', id, name: look.name }]);
          const theme = get().installed[id];
          const previous = theme?.previous;
          if (theme && previous && !isRevoked(get().catalog, id, previous.hash)) {
            putTheme(id, rolledBack(theme, previous));
            const restored = activeTheme(get());
            if (restored) {
              await syncThemeCss(restored);
              if (!(await probeFailed(id, restored))) {
                clearSentinelSoon();
                return;
              }
              get().markBroken(id);
            }
          }
          set({ enabled: false });
          await syncThemeCss(activeLook(get()));
          await clearSentinel();
        },

        notify: (notices) => {
          if (notices.length) set((s) => ({ notices: [...s.notices, ...notices] }));
        },
      };
    },
    {
      name: 'sc-themes',
      storage: createJSONStorage(() => tauriStorage),
      version: 1,
      skipHydration: true,
      partialize: (s) => ({
        installed: s.installed,
        activeId: s.activeId,
        enabled: s.enabled,
        autoUpdate: s.autoUpdate,
        checkedAt: s.checkedAt,
      }),
    },
  ),
);
