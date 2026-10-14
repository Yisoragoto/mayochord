import { createFileRoute } from '@tanstack/react-router';
import { ProgressionSetupPage } from '@/features/progression/ProgressionSetupPage';

export const Route = createFileRoute('/practice/progression/')({
  component: ProgressionSetupPage,
});
