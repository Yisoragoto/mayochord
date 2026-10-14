import { createFileRoute } from '@tanstack/react-router';
import { DesignPage } from '@/features/design-gallery/DesignPage';

export const Route = createFileRoute('/design')({
  component: DesignPage,
});
