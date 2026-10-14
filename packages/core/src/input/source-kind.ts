import type { InputSourceKind } from '../log/review-log';

/** 输入源 ID → 输入源类型（写入作答日志，用于判断齐整度是否有意义）。 */
export function sourceKind(source: string): InputSourceKind {
  if (source.startsWith('webmidi')) return 'midi';
  if (source === 'onscreen') return 'onscreen';
  if (source === 'keyboard') return 'keyboard';
  return 'manual';
}
