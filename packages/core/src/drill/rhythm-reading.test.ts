import { describe, expect, it } from 'vitest';
import { TPQ } from '../score/model';
import { gradeRhythm, judgeRhythm, parseRhythm } from './rhythm-reading';

describe('parseRhythm', () => {
  it('四分、八分、附点、休止、连音线、三连音', () => {
    expect(parseRhythm('q q 8 8 q', [4, 4]).onsets).toEqual([0, 1, 2, 2.5, 3].map((x) => x * TPQ));
    expect(parseRhythm('q. 8 h', [4, 4]).onsets).toEqual([0, 1.5, 2].map((x) => x * TPQ));
    expect(parseRhythm('qr q hr', [4, 4]).onsets).toEqual([TPQ]);
    expect(parseRhythm('8 8~ 8 8 h', [4, 4]).onsets).toEqual([0, 0.5, 1.5, 2].map((x) => x * TPQ));
    expect(parseRhythm('8t 8t 8t q h', [4, 4]).onsets.map((x) => Math.round(x))).toEqual([
      0, 320, 640, 960, 1920,
    ]);
    expect(parseRhythm('q.. 16 h', [4, 4]).onsets).toEqual([0, 1.75 * TPQ, 2 * TPQ]);
    expect(parseRhythm('q q q', [3, 4]).length).toBe(3 * TPQ);
    expect(parseRhythm('8 8 8 8 8 8', [6, 8]).length).toBe(3 * TPQ);
  });

  it('记号不对、总时值不符、最后一个音带连音线时报错', () => {
    expect(() => parseRhythm('q x q', [2, 4])).toThrow('无法识别');
    expect(() => parseRhythm('q q q', [4, 4])).toThrow('不符');
    expect(() => parseRhythm('h h~', [4, 4])).toThrow('连音线');
  });

  it('休止符后面的连音线不影响下一个音', () => {
    expect(parseRhythm('qr~ q h', [4, 4]).onsets).toEqual([TPQ, 2 * TPQ]);
  });
});

describe('judgeRhythm', () => {
  const exp = [0, 500, 1000, 1250, 1500];
  it('全部按到、在拍上 → clean', () => {
    const j = judgeRhythm(exp, [10, 490, 1020, 1240, 1505], 60);
    expect(j.correct).toBe(true);
    expect(j.clean).toBe(true);
    expect(j.hits.map((h) => h.offset)).toEqual([10, -10, 20, -10, 5]);
    expect(gradeRhythm(j, false)).toBe(3);
    expect(gradeRhythm(j, true)).toBe(2);
  });
  it('不在拍上 → 对但不干净（Hard）', () => {
    const j = judgeRhythm(exp, [0, 590, 1000, 1250, 1500], 60);
    expect(j.correct).toBe(true);
    expect(j.clean).toBe(false);
    expect(gradeRhythm(j, false)).toBe(2);
  });
  it('漏按、多按 → 错（Again）', () => {
    const missed = judgeRhythm(exp, [0, 500, 1000, 1500], 60);
    expect(missed.missed).toBe(1);
    expect(missed.correct).toBe(false);
    expect(gradeRhythm(missed, false)).toBe(1);
    const extra = judgeRhythm(exp, [0, 500, 750, 1000, 1250, 1500], 60);
    expect(extra.extra).toEqual([750]);
    expect(extra.correct).toBe(false);
  });
  it('窗口：只有一个起点时最多 maxWindowMs', () => {
    expect(judgeRhythm([0], [240], 60).hits[0]?.tap).toBe(240);
    expect(judgeRhythm([0], [300], 60).missed).toBe(1);
  });
});
