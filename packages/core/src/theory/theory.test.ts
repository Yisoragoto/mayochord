import { describe, expect, it } from 'vitest';
import {
  CHORD_QUALITIES,
  chordQualityDef,
  chordSlug,
  chordSymbolParts,
  chordTones,
  formatChordSymbol,
  isChordQuality,
  parseChordSymbol,
  semitoneFormula,
  symbolFromNames,
} from './chord-symbol';
import { majorScale, romanNumeral, scaleDegree } from './key';
import {
  formatNoteName,
  isBlackKey,
  midiToName,
  nameToMidi,
  nameToPitchClass,
  octaveOf,
  parseNoteName,
  pitchClass,
  pitchClassName,
  prettyAccidentals,
  spellInterval,
} from './notes';

describe('notes', () => {
  it('中央 C = C4 = 60', () => {
    expect(midiToName(60)).toBe('C4');
    expect(nameToMidi('C4')).toBe(60);
  });

  it('音名解析支持升降号、重升重降与 Unicode 字形', () => {
    expect(nameToMidi('Bb4')).toBe(70);
    expect(nameToMidi('B♭4')).toBe(70);
    expect(nameToMidi('G#4')).toBe(68);
    expect(nameToMidi('F♯2')).toBe(42);
    expect(nameToMidi('Cb4')).toBe(59);
    expect(nameToMidi('B#3')).toBe(60);
    expect(nameToMidi('Cx4')).toBe(62);
    expect(nameToMidi('Ebb4')).toBe(62);
    expect(nameToMidi('A0')).toBe(21);
    expect(nameToMidi('C8')).toBe(108);
    expect(nameToMidi('C-1')).toBe(0);
    expect(nameToMidi('H4')).toBeNull();
    expect(nameToMidi('C')).toBeNull();
    expect(nameToPitchClass('Bb')).toBe(10);
    expect(nameToPitchClass('??')).toBeNull();
    expect(parseNoteName('f#3')).toEqual({ letter: 'F', alter: 1, octave: 3 });
    expect(formatNoteName({ letter: 'E', alter: -2 })).toBe('Ebb');
  });

  it('不同拼写', () => {
    expect(midiToName(70)).toBe('Bb4');
    expect(midiToName(70, 'sharp')).toBe('A#4');
    expect(midiToName(66)).toBe('F#4');
    expect(midiToName(66, 'flat')).toBe('Gb4');
    expect(pitchClassName(-1)).toBe('B');
  });

  it('按音程拼写：字母由度数决定', () => {
    expect(spellInterval('G', 3, 3)).toBe('Bb');
    expect(spellInterval('E', 3, 4)).toBe('G#');
    expect(spellInterval('A', 3, 3)).toBe('C');
    expect(spellInterval('B', 5, 7)).toBe('F#');
    expect(spellInterval('C', 7, 9)).toBe('Bbb');
    expect(spellInterval('C', 9, 14)).toBe('D');
    expect(spellInterval('Bb', 3, 4)).toBe('D');
    expect(spellInterval('Cb', 3, 4)).toBe('Eb');
    expect(spellInterval('G3', 3, 3)).toBe('Bb3');
    expect(spellInterval('A3', 3, 3)).toBe('C4');
    expect(spellInterval('C4', 9, 14)).toBe('D5');
    expect(() => spellInterval('X', 3, 3)).toThrow();
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
    expect(prettyAccidentals('Bb4 F#3 Eb Ebb Cx')).toBe('B♭4 F♯3 E♭ E♭♭ Cx');
    expect(prettyAccidentals('F##')).toBe('F♯♯');
  });
});

describe('chord qualities', () => {
  it('组成音的半音数与度数一致（模 12 去重后数量不变）', () => {
    for (const q of CHORD_QUALITIES) {
      expect(new Set(q.intervals).size).toBe(q.tones.length);
      expect(q.tones[0]).toEqual({ degree: 1, semitones: 0 });
    }
  });

  it('isChordQuality', () => {
    expect(isChordQuality('m7b5')).toBe(true);
    expect(isChordQuality('m7♭5')).toBe(false);
  });

  it('组成音拼写', () => {
    expect(chordTones('G', 'm7')).toEqual(['G', 'Bb', 'D', 'F']);
    expect(chordTones('E', '7')).toEqual(['E', 'G#', 'B', 'D']);
    expect(chordTones('C', '7(9)')).toEqual(['C', 'E', 'G', 'Bb', 'D']);
    expect(chordTones('B', 'm')).toEqual(['B', 'D', 'F#']);
    expect(chordTones('F', 'M7')).toEqual(['F', 'A', 'C', 'E']);
    expect(chordTones('C', 'dim7')).toEqual(['C', 'Eb', 'Gb', 'Bbb']);
    expect(chordTones('C', 'aug')).toEqual(['C', 'E', 'G#']);
    expect(chordTones('C', 'sus2')).toEqual(['C', 'D', 'G']);
    expect(chordTones('C', 'sus4')).toEqual(['C', 'F', 'G']);
    expect(chordTones('A', '6')).toEqual(['A', 'C#', 'E', 'F#']);
  });

  it('半音距离公式', () => {
    expect(semitoneFormula('A', 'm')).toEqual({ tones: ['A', 'C', 'E'], steps: [3, 4] });
    expect(semitoneFormula('C', '7(9)')).toEqual({
      tones: ['C', 'E', 'G', 'Bb', 'D'],
      steps: [4, 3, 3, 4],
    });
    expect(semitoneFormula('C', 'm7b5').steps).toEqual([3, 3, 4]);
  });

  it('URL 安全的和弦 ID', () => {
    expect(chordSlug('G', 'm7')).toBe('gm7');
    expect(chordSlug('F', 'M7')).toBe('fmaj7');
    expect(chordSlug('C', '7(9)')).toBe('c7-9');
    expect(chordSlug('Bb', 'maj')).toBe('bb');
    expect(chordSlug('F#', 'm7b5')).toBe('fsm7b5');
    expect(chordSlug('C', 'maj', 'E')).toBe('c-on-e');
    expect(chordSlug('Ebb', 'm')).toBe('ebbm');
    expect(() => chordSlug('?', 'm')).toThrow();
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

  it('使用显式拼写', () => {
    expect(formatChordSymbol(symbolFromNames('A#', 'm7'))).toBe('A♯m7');
    expect(formatChordSymbol(symbolFromNames('C', 'maj', 'E'))).toBe('C/E');
    expect(formatChordSymbol(symbolFromNames('C', 'maj', 'C'))).toBe('C');
    expect(() => symbolFromNames('X', 'm')).toThrow();
    expect(() => symbolFromNames('C', 'm', 'Y')).toThrow();
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

  it('解析和弦符号文本（含别名）', () => {
    const f = (s: string) => {
      const sym = parseChordSymbol(s);
      return sym ? formatChordSymbol(sym) : null;
    };
    expect(f('Gm7')).toBe('Gm7');
    expect(f('C7(9)')).toBe('C7(9)');
    expect(f('C9')).toBe('C7(9)');
    expect(f('F#m7b5')).toBe('F♯m7♭5');
    expect(f('B♭M7')).toBe('B♭M7');
    expect(f('Cmaj7')).toBe('CM7');
    expect(f('C/E')).toBe('C/E');
    expect(f('Am7/G')).toBe('Am7/G');
    expect(f('Bb')).toBe('B♭');
    expect(f('Cø')).toBe('Cm7♭5');
    expect(f('Csus')).toBe('Csus4');
    expect(f('Hm')).toBeNull();
    expect(f('Cxyz')).toBeNull();
  });
});

describe('key & roman numerals', () => {
  it('大调音阶拼写', () => {
    expect(majorScale('G')).toEqual(['G', 'A', 'B', 'C', 'D', 'E', 'F#']);
    expect(majorScale('F')).toEqual(['F', 'G', 'A', 'Bb', 'C', 'D', 'E']);
  });

  it('级数', () => {
    expect(scaleDegree('E', { tonic: 'C' })).toEqual({ degree: 3, alter: 0 });
    expect(scaleDegree('Bb', { tonic: 'C' })).toEqual({ degree: 7, alter: -1 });
    expect(scaleDegree('F#', { tonic: 'C' })).toEqual({ degree: 4, alter: 1 });
    expect(scaleDegree('B', { tonic: 'G' })).toEqual({ degree: 3, alter: 0 });
    expect(() => scaleDegree('X', { tonic: 'C' })).toThrow();
  });

  it('日本式写法：丸サ進行', () => {
    const key = { tonic: 'C' };
    expect(romanNumeral('F', 'M7', key)).toBe('IVM7');
    expect(romanNumeral('E', '7', key)).toBe('III7');
    expect(romanNumeral('A', 'm7', key)).toBe('VIm7');
    expect(romanNumeral('G', 'm7', key)).toBe('Vm7');
    expect(romanNumeral('C', '7(9)', key)).toBe('I7(9)');
    expect(romanNumeral('Bb', 'maj', key)).toBe('♭VII');
  });

  it('大小写写法：王道进行', () => {
    const key = { tonic: 'G' };
    expect(
      ['C', 'D', 'B', 'E'].map((r, i) =>
        romanNumeral(r, (['maj', 'maj', 'm', 'm'] as const)[i] ?? 'maj', key, 'case'),
      ),
    ).toEqual(['IV', 'V', 'iii', 'vi']);
    expect(romanNumeral('D', 'm7', { tonic: 'C' }, 'case')).toBe('ii7');
    expect(romanNumeral('B', 'm7b5', { tonic: 'C' }, 'case')).toBe('viiø7');
    expect(romanNumeral('B', 'dim', { tonic: 'C' }, 'case')).toBe('vii°');
    expect(romanNumeral('C', 'M7', { tonic: 'C' }, 'case')).toBe('IM7');
  });
});
