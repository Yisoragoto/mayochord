import { describe, expect, it } from 'vitest';
import type { InputEvent } from '../input/events';
import type { ChordAttempt } from '../recognition/attempt';
import {
  cardChords,
  chordCard,
  chordCardId,
  chordCardsFor,
  transitionCard,
  transitionCardId,
  transitionCardsFor,
} from './cards';
import {
  type DrillContext,
  drillForCard,
  getDrill,
  nameToChordDrill,
  transitionDrill,
} from './drill';
import { msUntilTimeout, startTrial, stepTrial, type Trial } from './trial';

const MIDI = 'webmidi:juno';
const on = (note: number, t: number, source = MIDI): InputEvent => ({
  kind: 'noteOn',
  note,
  velocity: 80,
  channel: 1,
  t,
  source,
});
const off = (note: number, t: number, source = MIDI): InputEvent => ({
  kind: 'noteOff',
  note,
  velocity: 0,
  channel: 1,
  t,
  source,
});
const chordOn = (notes: number[], t: number, gap = 10, source = MIDI) =>
  notes.map((n, i) => on(n, t + i * gap, source));
const chordOff = (notes: number[], t: number) => notes.map((n) => off(n, t));

// 第 11 节参考键位
const REF: Record<string, number[]> = {
  c: [48, 60, 64, 67],
  g: [55, 59, 62, 67],
  am: [57, 60, 64, 69],
  f: [53, 60, 65, 69],
};

const ctx = (over: Partial<DrillContext> = {}): DrillContext => ({
  referenceNotes: (id) => REF[id] as number[],
  timeLimitMs: 5000,
  onsetWindowMs: 80,
  hintAtStart: false,
  trialId: 't1',
  ...over,
});

describe('cards', () => {
  it('ID 只包含测量内容，不包含 topicId', () => {
    expect(chordCardId('am7', 'name', 'any')).toBe('chord:am7:name:any');
    expect(chordCardId('g7', 'roman', 'reference', 'C')).toBe('chord:g7:roman@C:reference');
    expect(transitionCardId('am', 'f', 'any')).toBe('transition:am>f:any');
    expect(chordCard('am', { topicId: 'x' }).id).toBe(chordCard('am').id);
    expect(transitionCard('c', 'g', { voicingMode: 'reference' })).toMatchObject({
      id: 'transition:c>g:reference',
      fromChordId: 'c',
      toChordId: 'g',
      topicId: null,
    });
  });

  it('和弦组 → 卡片（去重）；序列 → 切换卡片（可循环、跳过相同和弦）', () => {
    expect(chordCardsFor(['c', 'g', 'c']).map((c) => c.chordId)).toEqual(['c', 'g']);
    expect(transitionCardsFor(['c', 'g', 'am', 'f']).map((c) => c.id)).toEqual([
      'transition:c>g:any',
      'transition:g>am:any',
      'transition:am>f:any',
    ]);
    expect(transitionCardsFor(['c', 'g', 'am', 'f'], { cyclic: true })).toHaveLength(4);
    expect(
      transitionCardsFor(['c', 'c', 'g', 'c', 'g'], { cyclic: true }).map((c) => c.id),
    ).toEqual(['transition:c>g:any', 'transition:g>c:any']);
    expect(transitionCardsFor(['c'], { cyclic: true })).toEqual([]);
    expect(cardChords(transitionCard('c', 'g'))).toEqual(['c', 'g']);
    expect(cardChords(chordCard('am'))).toEqual(['am']);
  });
});

describe('registry', () => {
  it('按类型或卡片找到练习', () => {
    expect(getDrill('name-to-chord')).toBe(nameToChordDrill);
    expect(drillForCard(transitionCard('c', 'g'))).toBe(transitionDrill);
    expect(drillForCard(chordCard('c'))).toBe(nameToChordDrill);
    expect(() => getDrill('nope' as 'transition')).toThrow();
  });
});

describe('看名弹和弦', () => {
  const trial = nameToChordDrill.createTrial(chordCard('am'), ctx());

  it('createTrial：目标是参考键位，宽松判定', () => {
    expect(trial).toMatchObject({ target: REF.am, from: null, mode: 'loose', timeLimitMs: 5000 });
    expect(
      nameToChordDrill.createTrial(chordCard('am', { voicingMode: 'reference' }), ctx()).mode,
    ).toBe('strict');
  });

  it('弹对：反应时间 = 最后一个音按下 - 出题时刻；记录齐整度', () => {
    const s = nameToChordDrill.evaluate(
      trial,
      1000,
      chordOn(REF.am as number[], 2000, 15),
      {},
      3000,
    );
    expect(s.status).toBe('done');
    expect(s.outcome).toMatchObject({
      correct: true,
      timedOut: false,
      reactionMs: 1045,
      spreadMs: 45,
      together: true,
      hintUsed: false,
      inputSource: 'midi',
    });
    const ev = nameToChordDrill.toEvidence(trial, s.outcome as NonNullable<typeof s.outcome>);
    expect(ev).toEqual([
      expect.objectContaining({ cardId: 'chord:am:name:any', cardKind: 'chord', correct: true }),
    ]);
  });

  it('宽松模式下其他转位也算对；按得不齐记 together = false', () => {
    const s = nameToChordDrill.evaluate(trial, 0, chordOn([45, 64, 69, 72], 500, 40), {}, 2000);
    expect(s.outcome).toMatchObject({ correct: true, spreadMs: 120, together: false });
  });

  it('弹错：第一次判定定成绩，进入 retry 并显示提示；之后弹对才结束', () => {
    const events = [
      ...chordOn([57, 60, 65, 69], 500), // F 代替 E
      ...chordOff([57, 60, 65, 69], 1000),
      ...chordOn(REF.am as number[], 1500),
    ];
    const s = nameToChordDrill.evaluate(trial, 0, events, {}, 3000);
    expect(s.status).toBe('done');
    expect(s.hintVisible).toBe(true);
    expect(s.outcome).toMatchObject({ correct: false, extraNotes: [65], missingNotes: [64] });
    expect(s.feedback?.judge.correct).toBe(true);
  });

  it('只按了一部分（没有多按）不算作答，继续等', () => {
    const events = [on(57, 500), on(60, 520), on(64, 1000), on(69, 1010)];
    const s = nameToChordDrill.evaluate(trial, 0, events, {}, 2000);
    expect(s.outcome).toMatchObject({ correct: true, reactionMs: 1010, spreadMs: 510 });
  });

  it('整体平移（OCTAVE 被改动）不计成绩，给出 shift', () => {
    const strict = nameToChordDrill.createTrial(
      chordCard('am', { voicingMode: 'reference' }),
      ctx(),
    );
    const s = nameToChordDrill.evaluate(strict, 0, chordOn([69, 72, 76, 81], 500), {}, 1500);
    expect(s.status).toBe('awaiting');
    expect(s.outcome).toBeNull();
    expect(s.feedback?.shift).toBe(12);
  });

  it('超时：Again 所需信息 timedOut，显示提示；跳过后结束', () => {
    let s = nameToChordDrill.evaluate(trial, 0, [], {}, 6000);
    expect(s.status).toBe('retry');
    expect(s.outcome).toMatchObject({ correct: false, timedOut: true, reactionMs: null });
    s = stepTrial(s, { type: 'skip', now: 7000 });
    expect(s).toMatchObject({ status: 'done', doneAt: 7000 });
    expect(stepTrial(s, { type: 'skip', now: 8000 })).toBe(s);
  });

  it('超时之后才弹稳的尝试：先按超时处理', () => {
    const s = nameToChordDrill.evaluate(trial, 0, chordOn(REF.am as number[], 4900), {}, 6000);
    expect(s.outcome?.timedOut).toBe(true);
    expect(s.status).toBe('done');
  });

  it('请求提示：hintUsed，之后弹对仍记为用过提示', () => {
    let s = startTrial(trial, 0, []);
    expect(msUntilTimeout(s, 1000)).toBe(4000);
    s = stepTrial(s, { type: 'hint', now: 100 });
    expect(s).toMatchObject({ hintVisible: true, hintUsed: true });
    const attempt: ChordAttempt = {
      notes: REF.am as number[],
      newNotes: REF.am as number[],
      onsets: { 57: 500, 60: 500, 64: 500, 69: 500 },
      sources: { 57: 'onscreen', 60: 'onscreen', 64: 'onscreen', 69: 'onscreen' },
      firstOnset: 500,
      lastOnset: 500,
      spreadMs: 0,
      together: true,
      stableAt: 650,
    };
    s = stepTrial(s, { type: 'attempt', attempt });
    expect(s.outcome).toMatchObject({
      correct: true,
      hintUsed: true,
      inputSource: 'onscreen',
      spreadMs: null,
      together: null,
    });
    expect(msUntilTimeout(s, 1000)).toBeNull();
    // 结束后的事件不再改变状态
    expect(stepTrial(s, { type: 'attempt', attempt })).toBe(s);
    expect(stepTrial(s, { type: 'hint', now: 2000 })).toBe(s);
  });

  it('hintAtStart：一开始就显示键位并记为用过提示', () => {
    const t2 = nameToChordDrill.createTrial(chordCard('am'), ctx({ hintAtStart: true }));
    expect(startTrial(t2, 0, [])).toMatchObject({ hintVisible: true, hintUsed: true });
    const t3 = transitionDrill.createTrial(transitionCard('c', 'g'), ctx({ hintAtStart: true }));
    expect(startTrial(t3, 0, [])).toMatchObject({ status: 'setup', setupHintVisible: true });
  });

  it('retry 状态下弹错只更新反馈', () => {
    const events = [
      ...chordOn([57, 60, 65, 69], 500),
      ...chordOff([57, 60, 65, 69], 1000),
      ...chordOn([57, 60, 66, 69], 1500),
    ];
    const s = nameToChordDrill.evaluate(trial, 0, events, {}, 3000);
    expect(s.status).toBe('retry');
    expect(s.feedback?.judge.extra).toEqual([66]);
    expect(s.outcome?.extraNotes).toEqual([65]);
  });

  it('出题前按住的共同音不计入齐整度和反应时间', () => {
    // 按着 C（C3 C4 E4 G4）出 Am 题：松开 G4、C3，按 A3、A4
    const events = [
      ...chordOn(REF.c as number[], 0),
      off(67, 1100),
      off(48, 1100),
      on(57, 1300),
      on(69, 1320),
    ];
    const s = nameToChordDrill.evaluate(trial, 1000, events, {}, 2000);
    expect(s.outcome).toMatchObject({ correct: true, reactionMs: 320, spreadMs: 20 });
  });
});

describe('和弦切换', () => {
  const card = transitionCard('c', 'g');
  const trial: Trial = transitionDrill.createTrial(card, ctx());

  it('createTrial：from 与 target', () => {
    expect(trial).toMatchObject({
      from: REF.c,
      target: REF.g,
      fromChordId: 'c',
      targetChordId: 'g',
    });
  });

  it('先弹"从"和弦（不计分），弹稳后开始计时', () => {
    const events = [
      ...chordOn(REF.c as number[], 100),
      ...chordOff(REF.c as number[], 600),
      ...chordOn(REF.g as number[], 900, 10),
    ];
    const s = transitionDrill.evaluate(trial, 0, events, { stableMs: 150 }, 2000);
    // C 最后一个音 130，稳定于 280；G 最后一个音 930 → 650
    expect(s.cueT).toBe(280);
    expect(s.outcome).toMatchObject({ correct: true, reactionMs: 650 });
    expect(transitionDrill.toEvidence(trial, s.outcome as NonNullable<typeof s.outcome>)).toEqual([
      expect.objectContaining({ cardId: 'transition:c>g:any', cardKind: 'transition' }),
    ]);
  });

  it('出题时已经按着"从"和弦：直接开始计时', () => {
    const s = startTrial(trial, 500, REF.c as number[]);
    expect(s).toMatchObject({ status: 'awaiting', cueT: 500 });
    expect(startTrial(trial, 500, [])).toMatchObject({ status: 'setup', cueT: null });
  });

  it('"从"和弦弹错：显示它的键位提示，不计成绩', () => {
    const s = transitionDrill.evaluate(trial, 0, chordOn([48, 60, 63, 67], 100), {}, 1000);
    expect(s).toMatchObject({ status: 'setup', setupHintVisible: true, outcome: null });
    expect(s.feedback?.stage).toBe('from');
    expect(stepTrial(s, { type: 'hint', now: 1000 }).setupHintVisible).toBe(true);
    // setup 阶段不计时
    expect(stepTrial(s, { type: 'tick', now: 99999 })).toBe(s);
    // setup 阶段跳过：没有成绩
    expect(stepTrial(s, { type: 'skip', now: 1000 })).toMatchObject({
      status: 'done',
      outcome: null,
    });
  });

  it('重新按一遍"从"和弦不算作答', () => {
    const events = [
      ...chordOn(REF.c as number[], 100),
      off(64, 600),
      on(64, 700),
      ...chordOff(REF.c as number[], 1000),
      ...chordOn(REF.g as number[], 1200),
    ];
    const s = transitionDrill.evaluate(trial, 0, events, {}, 2000);
    expect(s.outcome?.correct).toBe(true);
  });

  it('严格模式下重新按"从"和弦也不算作答', () => {
    const strict = transitionDrill.createTrial(
      transitionCard('c', 'g', { voicingMode: 'reference' }),
      ctx(),
    );
    const s = transitionDrill.evaluate(
      strict,
      0,
      [...chordOn(REF.c as number[], 100), off(64, 600), on(64, 700)],
      {},
      2000,
    );
    expect(s.status).toBe('awaiting');
  });
});
