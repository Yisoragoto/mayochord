import { createFileRoute } from '@tanstack/react-router';
import { ChordDetailPage } from '@/features/chords/ChordDetailPage';

export const Route = createFileRoute('/chords/$chordId')({
  component: function ChordRoute() {
    const { chordId } = Route.useParams();
    return <ChordDetailPage chordId={chordId} />;
  },
});
