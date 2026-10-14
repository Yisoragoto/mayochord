import { useEffect } from 'react';

/** 设置页面标题：'和弦库 · MayoChord'。 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · MayoChord` : 'MayoChord';
  }, [title]);
}
