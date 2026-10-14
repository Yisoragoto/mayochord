import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { LessonPage } from '@/features/learn/LessonPage';

export const Route = createFileRoute('/learn/$topicId')({
  validateSearch: z.object({ task: z.string().optional().catch(undefined) }),
  staticData: { focus: true },
  component: function LessonRoute() {
    const { topicId } = Route.useParams();
    const { task } = Route.useSearch();
    return <LessonPage key={topicId} topicId={topicId} taskId={task} />;
  },
});
