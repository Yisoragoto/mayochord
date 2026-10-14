import {
  formatChordSymbol,
  handMidi,
  midiToName,
  nearestBass,
  rankRightHandVoicings,
  semitoneFormula,
} from '@mayochord/core';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_DEVICE_PROFILES,
  BUILTIN_PACK,
  CONTENT_SCHEMA_VERSION,
  DeviceProfileSchema,
  formatIssues,
  JUNO_D7,
  loadContentPack,
} from './index';
import builtin from './packs/mayochord-core.json';

/**
 * 规格第 11 节的表格，原样抄录（左手只弹根音用 5 指；右手括号内为指法）。
 * 内置内容包必须与它一致。
 */
const SPEC_TABLE: [string, string, string][] = [
  ['C', 'C3', 'C4(1) E4(3) G4(5)'],
  ['G', 'G3', 'B3(1) D4(2) G4(5)'],
  ['Am', 'A3', 'C4(1) E4(2) A4(5)'],
  ['F', 'F3', 'C4(1) F4(3) A4(5)'],
  ['Dm', 'D3', 'D4(1) F4(3) A4(5)'],
  ['Em', 'E3', 'E4(1) G4(3) B4(5)'],
  ['FM7', 'F3', 'A4(1) C5(3) E5(5)'],
  ['E7', 'E3', 'G#4(1) B4(3) D5(5)'],
  ['Am7', 'A3', 'G4(1) C5(3) E5(5)'],
  ['Gm7', 'G3', 'F4(1) Bb4(3) D5(5)'],
  ['C7(9)', 'C3', 'E4(1) Bb4(3) D5(5)'],
];

const fmtVoicing = (chordId: string) => {
  const v = BUILTIN_PACK.chordById.get(chordId)?.reference;
  if (!v) throw new Error(chordId);
  const lh = v.notes.filter((n) => n.hand === 'left');
  const rh = v.notes.filter((n) => n.hand === 'right');
  return [
    lh.map((n) => n.name).join(' '),
    rh.map((n) => `${n.name}(${n.finger})`).join(' '),
    lh.every((n) => n.finger === 5),
  ] as const;
};

describe('内置内容包', () => {
  it('通过校验，格式版本正确', () => {
    expect(builtin.schemaVersion).toBe(CONTENT_SCHEMA_VERSION);
    expect(BUILTIN_PACK.id).toBe('mayochord-core');
    expect(BUILTIN_PACK.chords).toHaveLength(16);
  });

  it('参考键位与规格第 11 节的表格完全一致', () => {
    for (const [name, lh, rh] of SPEC_TABLE) {
      const chord = BUILTIN_PACK.chords.find(
        (c) => formatChordSymbol(c.symbol) === name.replace('#', '♯'),
      );
      expect(chord, name).toBeDefined();
      const [actualLh, actualRh, lhFinger5] = fmtVoicing(chord?.id ?? '');
      expect(actualLh, name).toBe(lh);
      expect(actualRh, name).toBe(rh);
      expect(lhFinger5, name).toBe(true);
      expect(chord?.reference.status).toBe('confirmed');
    }
  });

  it('待确认的键位标记为 tentative，且由就近转位算法推导', () => {
    const tentative = ['dm7', 'g7', 'cmaj7', 'd', 'bm'];
    for (const id of tentative) {
      expect(BUILTIN_PACK.chordById.get(id)?.reference.status, id).toBe('tentative');
      expect(BUILTIN_PACK.voicingNotes.get(`${id}-ref`)?.['zh-CN']).toContain('待确认');
    }
    // 按进行顺序，从前一个和弦的键位推导下一个：右手就近转位，左手就近取根音
    const derive = (fromId: string, toId: string) => {
      const from = BUILTIN_PACK.chordById.get(fromId)?.reference;
      const to = BUILTIN_PACK.chordById.get(toId);
      if (!from || !to) throw new Error(`${fromId} → ${toId}`);
      const rh = rankRightHandVoicings(handMidi(from, 'right'), to.rootName, to.quality)[0];
      const lh = nearestBass(handMidi(from, 'left')[0] as number, to.rootName);
      expect(rh?.maxMove, `${fromId} → ${toId}`).toBeLessThanOrEqual(2);
      expect(handMidi(to.reference, 'right'), `${fromId} → ${toId}`).toEqual(rh?.notes);
      expect(handMidi(to.reference, 'left'), `${fromId} → ${toId}`).toEqual([lh]);
    };
    derive('dm7', 'g7');
    derive('g7', 'cmaj7');
    derive('c', 'd');
    derive('d', 'bm');
    derive('bm', 'em');
  });

  it('键位里的升降号拼写与和弦音一致', () => {
    const gm7 = BUILTIN_PACK.chordById.get('gm7');
    expect(gm7?.tones).toEqual(['G', 'Bb', 'D', 'F']);
    expect(gm7?.reference.notes.map((n) => n.name)).toContain('Bb4');
    expect(BUILTIN_PACK.chordById.get('e7')?.reference.notes.map((n) => n.name)).toContain('G#4');
    expect(
      BUILTIN_PACK.chordById.get('bm')?.reference.notes.map((n) => midiToName(n.midi, 'sharp')),
    ).toContain('F#4');
  });

  it('半音公式示例：Am = A +3 C +4 E', () => {
    const am = BUILTIN_PACK.chordById.get('am');
    expect(am && semitoneFormula(am.rootName, am.quality)).toEqual({
      tones: ['A', 'C', 'E'],
      steps: [3, 4],
    });
  });

  it('进行引用的和弦与键位都存在', () => {
    const names = BUILTIN_PACK.progressions.map((p) => [
      p.id,
      p.steps.map((s) => formatChordSymbol(s.chord.symbol)).join(' '),
    ]);
    expect(names).toEqual([
      ['c-g-am-f', 'C G Am F'],
      ['royal-road-c', 'F G Em Am'],
      ['royal-road-g', 'C D Bm Em'],
      ['marusa', 'FM7 E7 Am7 Gm7 C7(9)'],
      ['ii-v-i-c', 'Dm7 G7 CM7'],
    ]);
    expect(BUILTIN_PACK.progressionById.get('marusa')?.steps.map((s) => s.beats)).toEqual([
      4, 4, 4, 2, 2,
    ]);
    expect(BUILTIN_PACK.voicingById.size).toBe(16);
  });
});

/** 在内置包的基础上做小改动，检查校验能发现问题 */
function variant(mutate: (p: typeof builtin) => void) {
  const copy: typeof builtin = JSON.parse(JSON.stringify(builtin));
  mutate(copy);
  const r = loadContentPack(copy);
  return r.ok ? [] : formatIssues(r.issues);
}

describe('内容包校验', () => {
  it('升降号拼错（Gm7 写成 A#4）', () => {
    const issues = variant((p) => {
      const v = p.voicings.find((x) => x.id === 'gm7-ref');
      if (v?.notes[2]) v.notes[2].pitch = 'A#4';
    });
    expect(issues.some((i) => i.includes('A#4 不是 gm7 的和弦音'))).toBe(true);
  });

  it('缺少不可省略的和弦音；五音可以省略', () => {
    const missingThird = variant((p) => {
      const v = p.voicings.find((x) => x.id === 'am7-ref');
      if (v) v.notes = v.notes.filter((n) => n.pitch !== 'C5');
    });
    expect(missingThird.some((i) => i.includes('缺少和弦音 C'))).toBe(true);
    // C7(9) 的参考键位本来就省略了五音 G，内置包没有问题
    expect(variant(() => {})).toEqual([]);
  });

  it('ID 与引用', () => {
    expect(variant((p) => p.chords.push({ id: 'c', root: 'C', quality: 'maj' }))).toContain(
      'chords：重复的 ID：c',
    );
    expect(variant((p) => ((p.chords[0] as { id: string }).id = 'cmajor'))).toEqual(
      expect.arrayContaining(["chords.0.id：和弦 ID 应为 'c'"]),
    );
    expect(
      variant((p) => ((p.voicings[0] as { chordId: string }).chordId = 'nope')).join(),
    ).toContain('不存在的和弦：nope');
    expect(
      variant((p) => ((p.voicings[1] as { reference: boolean }).reference = false)).join(),
    ).toContain('和弦 g 应恰好有一个参考键位，现有 0 个');
    const badStep = variant((p) => {
      const step = p.progressions[0]?.steps[0];
      if (step) step.voicingId = 'g-ref';
    });
    expect(badStep.join()).toContain('键位 g-ref 不属于 c');
    const missing = variant((p) => {
      const step = p.progressions[0]?.steps[0];
      if (step) {
        step.voicingId = 'zz';
        step.chordId = 'zz';
      }
    });
    expect(missing.join()).toContain('不存在的和弦：zz');
    expect(missing.join()).toContain('不存在的键位：zz');
  });

  it('基础字段错误', () => {
    expect(variant((p) => ((p as { version: string }).version = '1.0')).join()).toContain('semver');
    expect(variant((p) => ((p.chords[0] as { root: string }).root = 'H')).length).toBeGreaterThan(
      0,
    );
    const r = loadContentPack({ hello: 'world' });
    expect(r.ok).toBe(false);
  });
});

describe('键盘设备配置', () => {
  it('JUNO-D7：实测音域 E1–G7，76 键', () => {
    expect(JUNO_D7.lowestNote).toBe(28);
    expect(JUNO_D7.highestNote).toBe(103);
    expect(JUNO_D7.keys).toBe(76);
    expect(JUNO_D7.verified).toBe(true);
    expect(JUNO_D7.hasMidiOut).toBe(true);
    expect(BUILTIN_DEVICE_PROFILES.map((p) => p.id)).toEqual(['roland-juno-d7', 'generic-88']);
  });

  it('音域与键数不一致时校验失败', () => {
    const bad = { ...JUNO_D7, highestNote: 104 };
    expect(DeviceProfileSchema.safeParse(bad).success).toBe(false);
    expect(DeviceProfileSchema.safeParse({ ...JUNO_D7, lowestNote: null }).success).toBe(true);
  });
});
