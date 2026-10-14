import { createFileRoute } from '@tanstack/react-router';
import { GraphPage } from '@/features/graph/GraphPage';

export const Route = createFileRoute('/graph')({
  component: GraphPage,
});
