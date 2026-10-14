import { Link, useMatches } from '@tanstack/react-router';
import { Activity, CalendarCheck2, Dumbbell, Library, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TooltipProvider } from '@/design/ui/tooltip';
import { Wordmark } from '@/design/Wordmark';
import { ThemeSwitcher } from './ThemeSwitcher';

const NAV = [
  { to: '/', key: 'today', icon: CalendarCheck2 },
  { to: '/practice', key: 'practice', icon: Dumbbell },
  { to: '/chords', key: 'chords', icon: Library },
  { to: '/monitor', key: 'monitor', icon: Activity },
  { to: '/settings', key: 'settings', icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const focus = useMatches({ select: (ms) => ms.some((m) => m.staticData.focus === true) });
  if (focus) {
    return (
      <TooltipProvider delayDuration={300}>
        <main id="main">{children}</main>
      </TooltipProvider>
    );
  }
  return (
    <TooltipProvider delayDuration={300}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t('app.skipToContent')}
      </a>
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6 lg:gap-6">
          <Link to="/" className="rounded-sm text-lg" aria-label={t('app.name')}>
            <Wordmark />
          </Link>
          <nav aria-label={t('nav.primary')} className="hidden items-center gap-1 sm:flex">
            {NAV.map(({ to, key, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground data-[status=active]:bg-surface-2 data-[status=active]:text-foreground"
                activeOptions={{ exact: to === '/' }}
              >
                <Icon className="size-4" aria-hidden />
                {t(`nav.${key}`)}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      <main
        id="main"
        className="mx-auto max-w-6xl overflow-x-clip px-4 pt-6 pb-28 sm:px-6 sm:pb-16"
      >
        {children}
      </main>

      {/* 手机竖屏：底部标签栏 */}
      <nav
        aria-label={t('nav.primary')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      >
        <ul className="grid grid-cols-5">
          {NAV.map(({ to, key, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                activeOptions={{ exact: to === '/' }}
                className="flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground data-[status=active]:text-primary"
              >
                <Icon className="size-5" aria-hidden />
                {t(`nav.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </TooltipProvider>
  );
}
