import { describe, expect, it } from 'vitest';
import { nameToMidi } from '../theory/notes';
import { describeRightHand } from './inversion';
import { nearestBass, rankRightHandVoicings } from './nearest';
import { handMidi, type Voicing, voicingMidi } from './types';
import { voiceLeading } from './voice-leading';

const m = (s: string) =>
  s.split(' ').map((n) => {
    const v = nameToMidi(n);
    if (v === null) throw new Error(n);
    return v;
  });
const best = (prev: string, root: string, quality: Parameters<typeof rankRightHandVoicings>[2]) =>
  rankRightHandVoicings(m(prev), root, quality)[0];

describe('voiceLeading', () => {
  it('找到移动总量最小的配对，并标出共同音', () => {
    const vl = voiceLeading(m('F4 A4 C5'), m('F4 G4 B4'));
    expect(vl.total).toBe(3);
    expect(vl.maxMove).toBe(2);
    expect(vl.common).toEqual(m('F4'));
    expect(vl.moves).toEqual([
      { from: 65, to: 65, semitones: 0 },
      { from: 69, to: 67, semitones: -2 },
      { from: 72, to: 71, semitones: -1 },
    ]);
  });

  it('音数不同：多出来的音是新增或消失的声部', () => {
    const grow = voiceLeading(m('C4 E4'), m('C4 E4 G4'));
    expect(grow.moves.at(-1)).toEqual({ from: null, to: 67, semitones: null });
    const shrink = voiceLeading(m('C4 E4 G4'), m('C4 E4'));
    expect(shrink.moves.at(-1)).toEqual({ from: 67, to: null, semitones: null });
    expect(voiceLeading([], []).moves).toEqual([]);
  });

  it('声部不交叉时移动总量最小', () => {
    // C4 G4 → E4 F4：配对 (C→E, G→F) 总量 6；交叉配对 (C→F, G→E) 总量 8
    const vl = voiceLeading(m('C4 G4'), m('E4 F4'));
    expect(vl.total).toBe(6);
    expect(vl.maxMove).toBe(4);
  });
});

describe('就近转位（规格第 11 节：右手就近转位、每次只移动半音或全音）', () => {
  it('II–V–I：Dm7 → G7 → CM7', () => {
    const g7 = best('F4 A4 C5', 'G', '7');
    expect(g7?.notes).toEqual(m('F4 G4 B4'));
    expect(g7?.maxMove).toBeLessThanOrEqual(2);
    const cmaj7 = best('F4 G4 B4', 'C', 'M7');
    expect(cmaj7?.notes).toEqual(m('E4 G4 B4'));
    expect(cmaj7?.maxMove).toBeLessThanOrEqual(2);
  });

  it('G 调王道进行：C → D → Bm → Em', () => {
    const d = best('C4 E4 G4', 'D', 'maj');
    expect(d?.notes).toEqual(m('D4 F#4 A4'));
    const bm = best('D4 F#4 A4', 'B', 'm');
    expect(bm?.notes).toEqual(m('D4 F#4 B4'));
    const em = best('D4 F#4 B4', 'E', 'm');
    expect(em?.notes).toEqual(m('E4 G4 B4'));
    for (const c of [d, bm, em]) expect(c?.maxMove).toBeLessThanOrEqual(2);
  });

  it('左手根音就近（E2–B3）', () => {
    expect(nearestBass(48, 'D')).toBe(50);
    expect(nearestBass(50, 'B')).toBe(47);
    expect(nearestBass(47, 'E')).toBe(52);
    expect(nearestBass(50, 'G')).toBe(55);
    expect(nearestBass(55, 'C')).toBe(48);
    expect(() => nearestBass(48, 'C', 49, 50)).toThrow();
    expect(() => nearestBass(48, 'X')).toThrow();
  });

  it('参数与错误处理', () => {
    expect(() => rankRightHandVoicings([], 'X', 'maj')).toThrow();
    const four = rankRightHandVoicings(m('C4 E4 G4'), 'C', 'M7', {
      size: 4,
      requiredDegrees: [1, 3, 5, 7],
    });
    // 两个候选都不移动原有声部，跨度更小的 B3 C4 E4 G4 优先
    expect(four[0]?.notes).toEqual(m('B3 C4 E4 G4'));
    expect(four[0]?.total).toBe(0);
  });
});

describe('右手形状', () => {
  it('包含根音时给出转位', () => {
    expect(describeRightHand(m('C4 E4 G4'), 'C', 'maj')).toEqual({
      lowestDegree: 1,
      inversion: 'root',
    });
    expect(describeRightHand(m('B3 D4 G4'), 'G', 'maj')).toEqual({
      lowestDegree: 3,
      inversion: 'first',
    });
    expect(describeRightHand(m('C4 F4 A4'), 'F', 'maj')).toEqual({
      lowestDegree: 5,
      inversion: 'second',
    });
  });

  it('右手不含根音时只给出最低音的度数', () => {
    expect(describeRightHand(m('G4 C5 E5'), 'A', 'm7')).toEqual({
      lowestDegree: 7,
      inversion: null,
    });
    expect(describeRightHand([], 'C', 'maj')).toEqual({ lowestDegree: null, inversion: null });
    expect(describeRightHand(m('C#4'), 'C', 'maj').lowestDegree).toBeNull();
    expect(() => describeRightHand([60], 'X', 'maj')).toThrow();
  });
});

describe('Voicing 工具函数', () => {
  const v: Voicing = {
    id: 'am7-ref',
    chordId: 'am7',
    status: 'confirmed',
    notes: [
      { name: 'E5', midi: 76, hand: 'right', finger: 5 },
      { name: 'A3', midi: 57, hand: 'left', finger: 5 },
      { name: 'G4', midi: 67, hand: 'right', finger: 1 },
      { name: 'C5', midi: 72, hand: 'right', finger: 3 },
    ],
  };
  it('按手分组并排序', () => {
    expect(voicingMidi(v)).toEqual([57, 67, 72, 76]);
    expect(handMidi(v, 'left')).toEqual([57]);
    expect(handMidi(v, 'right')).toEqual([67, 72, 76]);
  });
});
