import { createFileRoute } from '@tanstack/react-router';
import { TodayPage } from '@/features/today/TodayPage';

export const Route = createFileRoute('/')({
  component: TodayPage,
});
