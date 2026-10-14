import { createFileRoute } from '@tanstack/react-router';
import { ChordLibraryPage } from '@/features/chords/ChordLibraryPage';

export const Route = createFileRoute('/chords/')({
  component: ChordLibraryPage,
});
