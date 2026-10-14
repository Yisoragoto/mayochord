import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type ThemePreference = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

interface AppearanceState {
  theme: ThemePreference;
  setTheme: (t: ThemePreference) => void;
}

/** localStorage 在隐私模式等情况下可能不可用：读写失败时静默退回默认值。 */
const safeLocalStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 忽略 */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* 忽略 */
    }
  },
};

// 键名与 index.html 里的首屏脚本保持一致
export const useAppearance = create<AppearanceState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'mayochord.appearance',
      // v2：M0 选定“真夜中”后去掉了视觉方向（direction）字段
      version: 2,
      migrate: (persisted) => {
        const theme = (persisted as { theme?: ThemePreference } | null)?.theme;
        return { theme: theme ?? 'system' } as AppearanceState;
      },
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: ({ theme }) => ({ theme }),
    },
  ),
);

const lightQuery = (): MediaQueryList | null =>
  typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: light)');

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref !== 'system') return pref;
  return lightQuery()?.matches ? 'light' : 'dark';
}

/** 把外观设置同步到 <html> 的 data-theme，并跟随系统深浅色变化。 */
export function bindAppearanceToDocument(): () => void {
  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = resolveTheme(useAppearance.getState().theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    const bg = getComputedStyle(root).getPropertyValue('--background').trim();
    if (meta && bg) meta.setAttribute('content', bg);
  };
  apply();
  const unsub = useAppearance.subscribe(apply);
  const mq = lightQuery();
  mq?.addEventListener('change', apply);
  return () => {
    unsub();
    mq?.removeEventListener('change', apply);
  };
}
