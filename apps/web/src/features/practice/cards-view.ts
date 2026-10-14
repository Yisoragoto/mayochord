import { BUILTIN_PACK, type ChordEntry } from '@mayochord/content';
import {
  type AnyCard,
  formatChordSymbol,
  type IntervalName,
  intervalCardTarget,
  noteCardTarget,
  prettyAccidentals,
  type Trial,
  type Voicing,
  voicingMidi,
} from '@mayochord/core';
import { keyboardRange } from '@/features/chords/voicing-view';

export const chordOf = (id: string | null | undefined): ChordEntry | undefined =>
  id ? BUILTIN_PACK.chordById.get(id) : undefined;

/** 和弦名的纯文本（用在句子里），例如 "B♭m7" */
export function chordLabel(chord: ChordEntry): string {
  return prettyAccidentals(formatChordSymbol(chord.symbol));
}

const pseudoVoicing = (id: string, notes: Voicing['notes']): Voicing => ({
  id,
  chordId: id,
  notes,
  status: 'generated',
});

/** 卡片的目标键位（提示、判定标记用）：和弦 = 参考键位；切换 = 目标和弦；认音名、音程 = 示范位置 */
export function targetVoicing(card: AnyCard): Voicing | undefined {
  switch (card.kind) {
    case 'chord':
      return chordOf(card.chordId)?.reference;
    case 'transition':
      return chordOf(card.toChordId)?.reference;
    case 'note':
      return pseudoVoicing(card.id, noteCardTarget(card));
    case 'interval':
      return pseudoVoicing(card.id, intervalCardTarget(card));
  }
}

/** 切换题的"从"和弦键位 */
export function fromVoicing(trial: Trial): Voicing | undefined {
  return chordOf(trial.fromChordId)?.reference;
}

/** 一组卡片共用的键盘范围（同一轮练习键盘不跳动） */
export function cardsRange(cards: readonly AnyCard[], pad = 3) {
  const notes = cards.flatMap((c) => {
    const vs = [targetVoicing(c)];
    if (c.kind === 'transition') vs.push(chordOf(c.fromChordId)?.reference);
    return vs.flatMap((v) => (v ? voicingMidi(v) : []));
  });
  return keyboardRange(notes.length > 0 ? notes : [60, 72], pad);
}

/** 卡片的简短文字描述（总结、任务列表用） */
export function cardLabel(card: AnyCard, intervalLabel: (i: IntervalName) => string): string {
  switch (card.kind) {
    case 'chord': {
      const c = chordOf(card.chordId);
      return c ? chordLabel(c) : card.chordId;
    }
    case 'transition': {
      const a = chordOf(card.fromChordId);
      const b = chordOf(card.toChordId);
      return `${a ? chordLabel(a) : card.fromChordId} → ${b ? chordLabel(b) : card.toChordId}`;
    }
    case 'note':
      return prettyAccidentals(card.note);
    case 'interval':
      return `${prettyAccidentals(card.root)} ↑ ${intervalLabel(card.interval)}`;
  }
}
