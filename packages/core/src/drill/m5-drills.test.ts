import { describe, expect, it } from 'vitest';
import { chordCard } from './cards';
import {
  buildChordDrill,
  CHORD_CUE_DRILL,
  type DrillContext,
  drillForCard,
  earToChordDrill,
  nameToChordDrill,
  romanToChordDrill,
  staffToChordDrill,
} from './drill';

const ctx: DrillContext = {
  referenceNotes: () => [48, 60, 64, 67],
  timeLimitMs: 8000,
  onsetWindowMs: 80,
  hintAtStart: false,
  trialId: 't',
};

describe('和弦卡的题面 → 练习类型', () => {
  it('每种题面一个练习类型；卡片 ID 不同', () => {
    expect(CHORD_CUE_DRILL).toEqual({
      name: 'name-to-chord',
      spelled: 'build-chord',
      audio: 'ear-to-chord',
      staff: 'staff-to-chord',
      roman: 'roman-to-chord',
    });
    expect(drillForCard(chordCard('c'))).toBe(nameToChordDrill);
    expect(drillForCard(chordCard('eb', { cue: 'spelled' }))).toBe(buildChordDrill);
    expect(drillForCard(chordCard('am', { cue: 'audio', key: 'C' }))).toBe(earToChordDrill);
    expect(drillForCard(chordCard('c', { cue: 'staff', voicingMode: 'reference' }))).toBe(
      staffToChordDrill,
    );
    expect(drillForCard(chordCard('am', { cue: 'roman', key: 'C' }))).toBe(romanToChordDrill);
    expect(chordCard('am', { cue: 'audio', key: 'C' }).id).toBe('chord:am:audio@C:any');
    expect(chordCard('am', { cue: 'audio' }).id).toBe('chord:am:audio:any');
  });

  it('五线谱题按参考键位严格判定；证据带上练习类型', () => {
    const card = chordCard('c', { cue: 'staff', voicingMode: 'reference' });
    const trial = staffToChordDrill.createTrial(card, ctx);
    expect(trial).toMatchObject({ drillType: 'staff-to-chord', mode: 'strict' });
    const wrongOctave = staffToChordDrill.evaluate(
      trial,
      0,
      [48, 52, 55, 60].map((note, i) => ({
        kind: 'noteOn' as const,
        note,
        velocity: 80,
        channel: 1,
        t: 100 + i,
        source: 'webmidi:x',
      })),
      {},
      1000,
    );
    expect(wrongOctave.outcome?.correct).toBe(false);
    const audio = chordCard('am', { cue: 'audio' });
    const t2 = earToChordDrill.createTrial(audio, ctx);
    expect(t2.mode).toBe('loose');
    const ev = earToChordDrill.toEvidence(t2, {
      correct: true,
      timedOut: false,
      reactionMs: 1200,
      extraNotes: [],
      missingNotes: [],
      spreadMs: null,
      together: null,
      hintUsed: false,
      inputSource: 'manual',
    });
    expect(ev[0]).toMatchObject({
      drillType: 'ear-to-chord',
      cardKind: 'chord',
      inputSource: 'manual',
    });
  });
});
