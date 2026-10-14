import { createFileRoute } from '@tanstack/react-router';
import { PracticeSessionPage } from '@/features/practice/PracticeSessionPage';
import { PracticeSearchSchema } from '@/features/practice/search';

export const Route = createFileRoute('/practice/session')({
  validateSearch: PracticeSearchSchema,
  staticData: { focus: true },
  component: function PracticeSessionRoute() {
    const search = Route.useSearch();
    return <PracticeSessionPage config={search} />;
  },
});
