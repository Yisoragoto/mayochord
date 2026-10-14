import { createFileRoute } from '@tanstack/react-router';
import { PracticeSetupPage } from '@/features/practice/PracticeSetupPage';

export const Route = createFileRoute('/practice/')({
  component: PracticeSetupPage,
});
