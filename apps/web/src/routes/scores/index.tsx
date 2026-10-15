import { createFileRoute } from '@tanstack/react-router';
import { ScoreLibraryPage } from '@/features/scores/ScoreLibraryPage';

export const Route = createFileRoute('/scores/')({
  component: ScoreLibraryPage,
});
