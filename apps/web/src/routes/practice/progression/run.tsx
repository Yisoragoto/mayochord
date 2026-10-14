import { createFileRoute } from '@tanstack/react-router';
import { ProgressionRunPage } from '@/features/progression/ProgressionRunPage';

export const Route = createFileRoute('/practice/progression/run')({
  staticData: { focus: true },
  component: ProgressionRunPage,
});
