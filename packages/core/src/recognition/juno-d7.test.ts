import { describe, expect, it } from 'vitest';
import { parseMidiMessage } from '../input/midi';
import { formatChordSymbol } from '../theory/chord-symbol';
import capture from './fixtures/juno-d7-reference-chords.json';
import { applyHeldEvent, EMPTY_HELD_STATE, heldNoteNumbers } from './held-notes';
import { identifyChord } from './identify';

/**
 * 回归测试：用 JUNO-D7 真机录下的数据重放。
 * 每当按住的音数达到 4 个（左手根音 + 右手三个音）时，记录识别结果和齐整度（最早与最晚按下的时间差）。
 */
function replay() {
  let state = EMPTY_HELD_STATE;
  const chords: { name: string | null; spreadMs: number }[] = [];
  for (const m of capture.messages) {
    const e = parseMidiMessage(m.data, m.t, 'juno');
    if (!e) continue;
    state = applyHeldEvent(state, e);
    const held = heldNoteNumbers(state, { sustainCountsAsHeld: false });
    if (e.kind === 'noteOn' && held.length === 4) {
      const onsets = [...state.notes.values()].map((n) => n.t);
      const best = identifyChord(held)[0];
      chords.push({
        name: best ? formatChordSymbol(best.symbol) : null,
        spreadMs: Math.max(...onsets) - Math.min(...onsets),
      });
    }
  }
  return chords;
}

describe('JUNO-D7 实测数据重放', () => {
  const chords = replay();

  it('第 11 节的参考键位全部识别正确', () => {
    expect(chords.map((c) => c.name)).toEqual([
      'C',
      'G',
      'Am',
      'F',
      'F',
      'G',
      'Em',
      'Am',
      'Dm',
      'FM7',
      'E7',
      'Am7',
      'Gm7',
      'C7(9)',
    ]);
  });

  it('实测齐整度都在 80ms 判定窗口内', () => {
    for (const c of chords) expect(c.spreadMs).toBeLessThan(80);
  });
});
