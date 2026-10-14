import { describe, expect, it } from 'vitest';
import { chordQualityDef, chordSymbolParts, formatChordSymbol } from './chord-symbol';
import {
  isBlackKey,
  midiToName,
  nameToMidi,
  octaveOf,
  pitchClass,
  pitchClassName,
  prettyAccidentals,
} from './notes';

describe('notes', () => {
  it('中央 C = C4 = 60', () => {
    expect(midiToName(60)).toBe('C4');
    expect(nameToMidi('C4')).toBe(60);
  });

  it('音名解析支持升降号与 Unicode 字形', () => {
    expect(nameToMidi('Bb4')).toBe(70);
    expect(nameToMidi('B♭4')).toBe(70);
    expect(nameToMidi('G#4')).toBe(68);
    expect(nameToMidi('F♯2')).toBe(42);
    expect(nameToMidi('Cb4')).toBe(59);
    expect(nameToMidi('A0')).toBe(21);
    expect(nameToMidi('C8')).toBe(108);
    expect(nameToMidi('C-1')).toBe(0);
    expect(nameToMidi('H4')).toBeNull();
  });

  it('不同拼写', () => {
    expect(midiToName(70)).toBe('Bb4');
    expect(midiToName(70, 'sharp')).toBe('A#4');
    expect(midiToName(66)).toBe('F#4');
    expect(midiToName(66, 'flat')).toBe('Gb4');
    expect(pitchClassName(-1)).toBe('B');
  });

  it('音级、八度、黑键', () => {
    expect(pitchClass(61)).toBe(1);
    expect(pitchClass(-1)).toBe(11);
    expect(octaveOf(59)).toBe(3);
    expect(isBlackKey(61)).toBe(true);
    expect(isBlackKey(64)).toBe(false);
    expect([66, 68, 70, 63].every(isBlackKey)).toBe(true);
  });

  it('prettyAccidentals', () => {
    expect(prettyAccidentals('Bb4 F#3 Eb')).toBe('B♭4 F♯3 E♭');
  });
});

describe('chord symbol', () => {
  it('格式化常见和弦', () => {
    expect(formatChordSymbol({ root: 0, quality: 'maj' })).toBe('C');
    expect(formatChordSymbol({ root: 0, quality: 'm7b5' })).toBe('Cm7♭5');
    expect(formatChordSymbol({ root: 0, quality: '7(9)' })).toBe('C7(9)');
    expect(formatChordSymbol({ root: 6, quality: 'm', bass: 4 })).toBe('F♯m/E');
    expect(formatChordSymbol({ root: 10, quality: 'M7' })).toBe('B♭M7');
    expect(formatChordSymbol({ root: 0, quality: 'maj', bass: 0 })).toBe('C');
  });

  it('分段用于排版', () => {
    expect(chordSymbolParts({ root: 3, quality: 'm7b5', bass: 1 }, 'flat')).toEqual({
      rootLetter: 'E',
      rootAccidental: '♭',
      main: 'm7',
      ext: '♭5',
      bass: { letter: 'D', accidental: '♭' },
    });
  });

  it('未知性质抛错', () => {
    expect(() => chordQualityDef('x' as never)).toThrow();
  });
});
