import {
  formatChordSymbol,
  handMidi,
  labelChords,
  midiToName,
  nameToPitchClass,
  nearestBass,
  parseMusicXml,
  rankRightHandVoicings,
  semitoneFormula,
} from '@mayochord/core';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_DEVICE_PROFILES,
  BUILTIN_PACK,
  CONTENT_SCHEMA_VERSION,
  DeviceProfileSchema,
  EXAMPLE_SCORE_XML,
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
    expect(BUILTIN_PACK.chords).toHaveLength(108);
    // 第 11 节的 11 个和弦 + 5 个就近转位推导的键位是写好的，其余自动生成
    const written = BUILTIN_PACK.chords.filter((c) => c.reference.status !== 'generated');
    expect(written).toHaveLength(16);
  });

  it('没有给键位的和弦：自动生成密集排列的参考键位', () => {
    const eb = BUILTIN_PACK.chordById.get('eb');
    expect(eb?.reference).toMatchObject({ id: 'eb-ref', status: 'generated' });
    expect(eb?.reference.notes.map((n) => n.name)).toEqual(['Eb3', 'Eb4', 'G4', 'Bb4']);
    expect(BUILTIN_PACK.chordById.get('c-on-e')?.reference.notes.map((n) => n.name)).toEqual([
      'E3',
      'E4',
      'G4',
      'C5',
    ]);
  });

  it('知识图谱：59 个主题，先修关系无环，卡片由练习内容生成', () => {
    const { graph, topicById, cardById, topicsOfCard } = BUILTIN_PACK;
    expect(BUILTIN_PACK.topics).toHaveLength(59);
    expect(graph.order[0]).toBe('keyboard-names');
    expect(graph.order.indexOf('c-major-triads')).toBeGreaterThan(
      graph.order.indexOf('minor-triad-formula'),
    );
    expect(topicById.get('keyboard-names')?.cards).toHaveLength(12);
    expect(topicById.get('keyboard-names')?.cards[0]).toMatchObject({
      kind: 'note',
      id: 'note:c',
      topicId: 'keyboard-names',
    });
    expect(topicById.get('thirds')?.cards[0]?.id).toBe('interval:c:M3');
    expect(topicById.get('triads-12-keys')?.cards).toHaveLength(24);
    // 两条进行的切换合在一起去重
    expect(topicById.get('royal-road')?.cards.map((c) => c.id)).toEqual([
      'transition:f>g:reference',
      'transition:g>em:reference',
      'transition:em>am:reference',
      'transition:am>f:reference',
      'transition:c>d:reference',
      'transition:d>bm:reference',
      'transition:bm>em:reference',
      'transition:em>c:reference',
    ]);
    expect(topicById.get('maj7-formula')?.interferenceGroup).toBe('seventh-quality');
    // 同一张卡片可以属于多个主题
    expect(topicsOfCard.get('chord:c:name:any')).toEqual([
      'major-triad-formula',
      'c-major-triads',
      'triads-12-keys',
    ]);
    expect(cardById.get('chord:c:name:any')?.topicId).toBe('major-triad-formula');
    // 跟拍主题：卡片是这条进行的切换卡（循环），课程用到进行与速度
    const push = topicById.get('sixteenth-anticipation');
    expect(push?.cards.map((c) => c.id)).toEqual([
      'transition:c>g:any',
      'transition:g>am:any',
      'transition:am>f:any',
      'transition:f>c:any',
    ]);
    expect(push?.practice).toMatchObject({
      kind: 'progression',
      progression: 'c-g-am-f-push',
      bpm: 76,
    });
    expect(topicById.get('marusa-tempo')?.cards[0]?.id).toBe('transition:fmaj7>e7:reference');
    // M5：题面（文字名称、级数、听声音、五线谱）与对比配对
    expect(topicById.get('build-sevenths')?.cards).toHaveLength(36);
    expect(topicById.get('build-triads')?.cards[3]?.id).toBe('chord:eb:spelled:any');
    expect(topicById.get('roman-c')?.cards[5]).toMatchObject({
      id: 'chord:am:roman@C:any',
      key: 'C',
    });
    expect(topicById.get('staff-c-triads')?.cards[0]?.id).toBe('chord:c:staff:reference');
    const ear = topicById.get('ear-c-triads');
    expect(ear?.cards[0]?.id).toBe('chord:c:audio@C:any');
    expect(BUILTIN_PACK.choicesByCard.get('chord:c:audio@C:any')).toEqual([
      'c',
      'dm',
      'em',
      'f',
      'g',
      'am',
    ]);
    // 对比配对：没有调，选项就是这一对
    expect(
      topicById
        .get('contrast-major-minor')
        ?.cards.map((c) => c.id)
        .slice(0, 2),
    ).toEqual(['chord:c:audio:any', 'chord:cm:audio:any']);
    expect(BUILTIN_PACK.choicesByCard.get('chord:cm:audio:any')).toEqual(['c', 'cm']);
    // 课程默认值
    expect(topicById.get('maj7-formula')?.lesson).toMatchObject({
      guided: { count: 6 },
      independent: { requiredCorrect: 8 },
      mastery: { questions: 8, minAccuracy: 0.85, timeLimitMs: 6000 },
    });
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

  it('II–V–I 与 G 调王道进行的键位由就近转位算法推导（用户已采纳）', () => {
    const derived = ['dm7', 'g7', 'cmaj7', 'd', 'bm'];
    for (const id of derived) {
      expect(BUILTIN_PACK.chordById.get(id)?.reference.status, id).toBe('confirmed');
      expect(BUILTIN_PACK.voicingNotes.get(`${id}-ref`)?.['zh-CN']).toContain('采纳');
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
      ['c-g-am-f-push', 'C G Am F'],
      ['ii-v-i-f', 'Gm7 C7 FM7'],
      ['ii-v-i-bb', 'Cm7 F7 B♭M7'],
      ['ii-v-i-eb', 'Fm7 B♭7 E♭M7'],
      ['ii-v-i-ab', 'B♭m7 E♭7 A♭M7'],
      ['ii-v-i-db', 'E♭m7 A♭7 D♭M7'],
      ['ii-v-i-g', 'Am7 D7 GM7'],
      ['ii-v-i-d', 'Em7 A7 DM7'],
      ['ii-v-i-a', 'Bm7 E7 AM7'],
      ['ii-v-i-e', 'F♯m7 B7 EM7'],
      ['ii-v-i-b', 'C♯m7 F♯7 BM7'],
      ['ii-v-i-fs', 'G♯m7 C♯7 F♯M7'],
      ['one-six-two-five', 'C Am Dm G'],
      ['komuro', 'Am F G C'],
      ['canon', 'C G/B Am Em/G F C/E Dm G'],
      ['secondary-dominants', 'C E7 Am A7 Dm G7 C'],
      ['borrowed-chords', 'C F Fm C A♭ B♭ C'],
      ['passing-diminished', 'C C♯dim7 Dm7 D♯dim7 Em7'],
    ]);
    expect(
      BUILTIN_PACK.progressionById.get('c-g-am-f-push')?.steps.map((s) => s.anticipation),
    ).toEqual([1, 1, 1, 1]);
    expect(BUILTIN_PACK.progressionById.get('c-g-am-f')?.steps[0]?.anticipation).toBe(0);
    expect(BUILTIN_PACK.progressionById.get('marusa')?.steps.map((s) => s.beats)).toEqual([
      4, 4, 4, 2, 2,
    ]);
    expect(BUILTIN_PACK.voicingById.size).toBe(108);
  });

  it('读谱主题（M10）：看谱认音卡带谱号与调号，节奏型都能解析', () => {
    const key = BUILTIN_PACK.topicById.get('key-signatures');
    expect(key?.cards[0]).toMatchObject({
      kind: 'staffNote',
      id: 'staffnote:treble:fs4@g',
      clef: 'treble',
      pitch: 'F#4',
      key: 'G',
    });
    const ledger = BUILTIN_PACK.topicById.get('ledger-notes')?.cards.map((c) => c.id) ?? [];
    // 同一个中央 C 在两种谱表里是不同的卡片
    expect(ledger).toContain('staffnote:treble:c4');
    expect(ledger).toContain('staffnote:bass:c4');
    expect(BUILTIN_PACK.rhythms).toHaveLength(26);
    expect(BUILTIN_PACK.rhythmById.get('r-syncope-tie')?.pattern.onsets.length).toBe(5);
    const rhythmTopic = BUILTIN_PACK.topicById.get('syncopation-reading');
    expect(rhythmTopic?.cards.every((c) => c.kind === 'rhythm')).toBe(true);
  });

  it('不存在的节奏型、写错的节奏型会被发现', () => {
    expect(
      variant((p) => {
        (p.rhythms[0] as { notes: string }).notes = 'q q q';
      }).join(),
    ).toContain('不符');
    expect(
      variant((p) => {
        const t = p.topics.find((x) => x.id === 'note-values');
        if (t?.practice.kind === 'rhythms') t.practice.rhythms = ['zz'];
      }).join(),
    ).toContain('不存在的节奏型：zz');
  });

  it('没有给键位的进行：按就近转位推出，只用和弦音、低音正确、右手移动小', () => {
    for (const p of BUILTIN_PACK.progressions) {
      let prevRight: number[] | null = null;
      for (const s of p.steps) {
        const pcs = new Set<number | null>(s.chord.tones.map((t) => nameToPitchClass(t)));
        const notes = s.voicing.notes;
        for (const n of notes) expect(pcs.has(n.midi % 12), `${p.id} ${n.name}`).toBe(true);
        const bass = Math.min(...notes.map((n) => n.midi));
        expect(bass % 12, `${p.id} ${s.chord.id} 低音`).toBe(
          nameToPitchClass(s.chord.bassName ?? s.chord.rootName),
        );
        const right = notes.filter((n) => n.hand === 'right').map((n) => n.midi);
        if (prevRight && s.voicing.status === 'generated') {
          // 右手最高音一步不跳超过 5 个半音
          const top = Math.max(...right);
          const prevTop = Math.max(...prevRight);
          expect(Math.abs(top - prevTop), `${p.id} ${s.chord.id}`).toBeLessThanOrEqual(5);
        }
        prevRight = right;
      }
    }
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
      const step = p.progressions[0]?.steps[0] as
        | { chordId: string; voicingId?: string }
        | undefined;
      if (step) step.voicingId = 'g-ref';
    });
    expect(badStep.join()).toContain('键位 g-ref 不属于 c');
    const missing = variant((p) => {
      const step = p.progressions[0]?.steps[0] as
        | { chordId: string; voicingId?: string }
        | undefined;
      if (step) {
        step.voicingId = 'zz';
        step.chordId = 'zz';
      }
    });
    expect(missing.join()).toContain('不存在的和弦：zz');
    expect(missing.join()).toContain('不存在的键位：zz');
  });

  it('知识图谱的引用与环', () => {
    type Topic = (typeof builtin.topics)[number];
    const topic = (p: typeof builtin, id: string) => p.topics.find((t) => t.id === id) as Topic;
    expect(
      variant((p) => (topic(p, 'thirds').prerequisites as string[]).push('nope')).join(),
    ).toContain('thirds 的先修主题不存在：nope');
    expect(
      variant((p) => (topic(p, 'keyboard-names').prerequisites as string[]).push('marusa')).join(),
    ).toContain('先修关系有环');
    expect(
      variant((p) => {
        (topic(p, 'c-major-triads').practice as { chords: string[] }).chords.push('zz');
      }).join(),
    ).toContain('不存在的和弦：zz');
    expect(
      variant((p) => {
        (topic(p, 'marusa').practice as { progressions: string[] }).progressions.push('zz');
      }).join(),
    ).toContain('不存在的进行：zz');
    expect(
      variant((p) => {
        (topic(p, 'marusa-tempo').practice as { progression: string }).progression = 'yy';
      }).join(),
    ).toContain('不存在的进行：yy');
    expect(
      variant((p) => {
        delete (topic(p, 'roman-c').practice as { key?: string }).key;
      }).join(),
    ).toContain('级数题需要指定调');
    expect(
      variant((p) => {
        (topic(p, 'contrast-7-maj7').practice as { pairs: string[][] }).pairs.push(
          ['c7', 'c7'],
          ['zz', 'c7'],
        );
      }).join(),
    ).toMatch(/一对里的两个和弦相同：c7.*不存在的和弦：zz/);
    expect(
      variant((p) => {
        const step = topic(p, 'marusa').lesson.explain[0] as { demo: { chord: string } };
        step.demo.chord = 'zz';
      }).join(),
    ).toContain('不存在的和弦：zz');
    expect(variant((p) => p.topics.push(topic(p, 'marusa'))).join()).toContain('重复的 ID：marusa');
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

describe('example score', () => {
  it('parses: 16 bars of Ode to Joy, melody in the right hand', () => {
    const score = parseMusicXml(EXAMPLE_SCORE_XML);
    expect(score.title).toBe('Ode to Joy');
    expect(score.measures).toHaveLength(16);
    expect(score.tempo).toBe(96);
    expect(score.warnings).toEqual([]);
    expect(score.notes.filter((n) => n.hand === 'right')).toHaveLength(62);
    expect(score.notes.filter((n) => n.hand === 'left')).toHaveLength(44);
    expect(
      score.notes.filter((n) => n.hand === 'right').every((n) => n.pitch >= 55 && n.pitch <= 67),
    ).toBe(true);
    // 自动标和弦：与编配一致（第 4、8、9、10、12、16 小节在第 3 拍换和弦）
    expect(labelChords(score).map((l) => `${l.measure + 1}:${l.text}`)).toEqual([
      '1:C',
      '2:G',
      '3:C',
      '4:C',
      '4:G',
      '5:C',
      '6:G',
      '7:C',
      '8:G',
      '8:C',
      '9:G',
      '9:C',
      '10:G',
      '10:C',
      '11:G',
      '12:C',
      '12:G',
      '13:C',
      '14:G',
      '15:C',
      '16:G',
      '16:C',
    ]);
  });
});
