import { createFileRoute } from '@tanstack/react-router';
import { DailyTaskPage } from '@/features/learn/TaskPage';

export const Route = createFileRoute('/today/task/$taskId')({
  staticData: { focus: true },
  component: function TaskRoute() {
    const { taskId } = Route.useParams();
    return <DailyTaskPage key={taskId} taskId={taskId} />;
  },
});
