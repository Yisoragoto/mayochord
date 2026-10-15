import { createFileRoute } from '@tanstack/react-router';
import { StatsPage } from '@/features/stats/StatsPage';

export const Route = createFileRoute('/stats')({
  component: StatsPage,
});
