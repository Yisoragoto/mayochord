import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '@/features/shell/AppShell';

export const Route = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
