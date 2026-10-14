import { describe, expect, it } from 'vitest';
import type { InputEvent } from '../input/events';
import { formatChordSymbol } from '../theory/chord-symbol';
import { nameToMidi } from '../theory/notes';
import { applyHeldEvent, EMPTY_HELD_STATE, type HeldState, heldNoteNumbers } from './held-notes';
import { identifyChord } from './identify';

const on = (note: number, t = 0): InputEvent => ({
  kind: 'noteOn',
  note,
  velocity: 80,
  channel: 1,
  t,
  source: 's',
});
const off = (note: number, t = 0): InputEvent => ({
  kind: 'noteOff',
  note,
  velocity: 0,
  channel: 1,
  t,
  source: 's',
});
const pedal = (down: boolean): InputEvent => ({
  kind: 'sustain',
  down,
  value: down ? 127 : 0,
  channel: 1,
  t: 0,
  source: 's',
});

const run = (events: InputEvent[]): HeldState => events.reduce(applyHeldEvent, EMPTY_HELD_STATE);

describe('held notes', () => {
  it('按下与松开', () => {
    const s = run([on(60), on(64), on(67), off(64)]);
    expect(heldNoteNumbers(s, { sustainCountsAsHeld: false })).toEqual([60, 67]);
  });

  it('松开未按下的音不改变状态', () => {
    const s = run([on(60)]);
    expect(applyHeldEvent(s, off(61))).toBe(s);
  });

  it('踏板：松开的音标记为 sustained，由选项决定是否计入', () => {
    const s = run([pedal(true), on(60), on(64), off(60)]);
    expect(heldNoteNumbers(s, { sustainCountsAsHeld: false })).toEqual([64]);
    expect(heldNoteNumbers(s, { sustainCountsAsHeld: true })).toEqual([60, 64]);
    const released = applyHeldEvent(s, pedal(false));
    expect(heldNoteNumbers(released, { sustainCountsAsHeld: true })).toEqual([64]);
    expect(released.sustainDown).toBe(false);
  });

  it('重复的踏板状态与其他事件不改变状态', () => {
    const s = run([on(60)]);
    expect(applyHeldEvent(s, pedal(false))).toBe(s);
    expect(applyHeldEvent(s, { kind: 'clock', t: 0, source: 's' })).toBe(s);
  });

  it('踏板踩下时重新按下同一个音，清除 sustained 标记', () => {
    const s = run([pedal(true), on(60), off(60), on(60)]);
    expect(s.notes.get(60)?.sustained).toBe(false);
  });
});

const notes = (s: string) =>
  s.split(' ').map((n) => {
    const m = nameToMidi(n);
    if (m === null) throw new Error(n);
    return m;
  });
const best = (s: string) => {
  const c = identifyChord(notes(s))[0];
  return c ? formatChordSymbol(c.symbol) : null;
};
const all = (s: string) => identifyChord(notes(s)).map((c) => formatChordSymbol(c.symbol));

describe('identifyChord', () => {
  it('第 11 节的参考键位全部识别正确', () => {
    expect(best('C3 C4 E4 G4')).toBe('C');
    expect(best('G3 B3 D4 G4')).toBe('G');
    expect(best('A3 C4 E4 A4')).toBe('Am');
    expect(best('F3 C4 F4 A4')).toBe('F');
    expect(best('D3 D4 F4 A4')).toBe('Dm');
    expect(best('E3 E4 G4 B4')).toBe('Em');
    expect(best('F3 A4 C5 E5')).toBe('FM7');
    expect(best('E3 G#4 B4 D5')).toBe('E7');
    expect(best('A3 G4 C5 E5')).toBe('Am7');
    expect(best('G3 F4 Bb4 D5')).toBe('Gm7');
    expect(best('C3 E4 Bb4 D5')).toBe('C7(9)');
  });

  it('规格要求的和弦类型', () => {
    expect(best('C4 Eb4 Gb4')).toBe('Cdim');
    expect(best('C4 E4 G#4')).toBe('Caug');
    expect(best('C4 E4 G4 B4')).toBe('CM7');
    expect(best('C4 Eb4 Gb4 Bb4')).toBe('Cm7♭5');
    expect(best('C4 Eb4 Gb4 A4')).toBe('Cdim7');
    expect(best('C4 D4 G4')).toBe('Csus2');
    expect(best('C4 F4 G4')).toBe('Csus4');
    expect(best('C4 D4 E4 G4')).toBe('Cadd9');
    expect(best('C4 E4 G4 Bb4 D5')).toBe('C7(9)');
  });

  it('斜杠和弦：低音不是根音', () => {
    expect(best('E3 C4 E4 G4')).toBe('C/E');
    expect(best('G2 C4 E4 G4')).toBe('C/G');
  });

  it('多解时按常见程度排序', () => {
    // C E G A：C 在低音时 C6 优先于 Am7/C
    expect(all('C3 E4 G4 A4').slice(0, 2)).toEqual(['C6', 'Am7/C']);
    // A 在低音时 Am7 优先
    expect(best('A2 C4 E4 G4')).toBe('Am7');
    // 减七和弦对称：低音为根
    expect(best('Eb3 C4 Gb4 A4')).toBe('E♭dim7');
  });

  it('少于三个音级不识别', () => {
    expect(identifyChord([])).toEqual([]);
    expect(identifyChord([60, 72])).toEqual([]);
    expect(identifyChord([60, 64])).toEqual([]);
  });

  it('无法识别的音簇返回空', () => {
    expect(identifyChord(notes('C4 Db4 D4'))).toEqual([]);
  });
});
