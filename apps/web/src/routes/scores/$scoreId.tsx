import { createFileRoute } from '@tanstack/react-router';
import { ScorePlayerPage } from '@/features/scores/ScorePlayerPage';

export const Route = createFileRoute('/scores/$scoreId')({
  staticData: { focus: true },
  component: function ScoreRoute() {
    const { scoreId } = Route.useParams();
    return <ScorePlayerPage scoreId={scoreId} />;
  },
});
