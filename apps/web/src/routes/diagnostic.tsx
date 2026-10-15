import { createFileRoute } from '@tanstack/react-router';
import { DiagnosticPage } from '@/features/learn/DiagnosticPage';

export const Route = createFileRoute('/diagnostic')({
  staticData: { focus: true },
  component: DiagnosticPage,
});
