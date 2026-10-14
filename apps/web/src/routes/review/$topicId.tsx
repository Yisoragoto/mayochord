import { createFileRoute } from '@tanstack/react-router';
import { TopicReviewPage } from '@/features/learn/TaskPage';

export const Route = createFileRoute('/review/$topicId')({
  staticData: { focus: true },
  component: function ReviewRoute() {
    const { topicId } = Route.useParams();
    return <TopicReviewPage key={topicId} topicId={topicId} />;
  },
});
