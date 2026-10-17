import type { NotationElement, ScoreDirection } from '@mayochord/core';
import { describe, expect, it } from 'vitest';
import { diatonic, rowY, STAFF_HEIGHT, staffSpaces, systemLayout } from './score-layout';

const el = (
  staff: number,
  spelled: string[],
  over: Partial<NotationElement> = {},
): NotationElement => ({
  measure: 0,
  staff,
  voice: '1',
  start: 0,
  dur: 960,
  rest: false,
  type: 'quarter',
  dots: 0,
  tuplet: null,
  pitches: spelled.map((s) => ({
    pitch: 60,
    spelled: s,
    noteId: 0,
    tieStart: false,
    tieStop: false,
    accidental: null,
  })),
  ...over,
});

const dir = (staff: number, placement: 'above' | 'below', d: Partial<ScoreDirection>) =>
  ({ measure: 0, staff, tick: 0, placement, ...d }) as ScoreDirection;

describe('谱面竖直排版', () => {
  it('diatonic：字母 + 八度 × 7，8va 移动八度', () => {
    expect(diatonic('C4')).toBe(28);
    expect(diatonic('F#5')).toBe(38);
    expect(diatonic('C6', -1)).toBe(diatonic('C5'));
  });

  it('谱表内的音不需要额外空间；高音、低音按加线和符干撑开', () => {
    const inside = staffSpaces([el(1, ['G4', 'B4'], { type: 'whole' })], [], ['treble', 'bass'], 2);
    expect(inside[0]).toMatchObject({ above: expect.any(Number), below: expect.any(Number) });
    expect(inside[0]?.above).toBeLessThanOrEqual(0);
    // C6 在第一线（F5）上方 4 步，符干向下
    const high = staffSpaces([el(1, ['C6'])], [], ['treble', 'bass'], 2);
    expect(high[0]?.above).toBe(20);
    // 符干向下也伸不到第五线以下
    expect(high[0]?.below).toBe(0);
    // 低音谱表的 A1：第五线（G2）下方 8 步 + 向上的符干不往下伸
    const low = staffSpaces([el(2, ['A1'])], [], ['treble', 'bass'], 2);
    expect(low[1]?.below).toBe(30);
    expect(low[1]?.above).toBe(0);
  });

  it('记号行：上方、下方各自去重，按固定顺序', () => {
    const s = staffSpaces(
      [],
      [
        dir(1, 'above', { kind: 'words', text: 'cresc.' }),
        dir(1, 'above', { kind: 'rehearsal', text: 'F' }),
        dir(1, 'above', { kind: 'octave', type: 'down', size: 8 }),
        dir(1, 'below', { kind: 'wedge', type: 'crescendo' }),
        dir(1, 'below', { kind: 'dynamic', text: 'mf' }),
        dir(2, 'below', { kind: 'pedal', type: 'start' }),
      ],
      ['treble', 'bass'],
      2,
    );
    expect(s[0]?.rowsAbove).toEqual(['octave', 'words', 'rehearsal']);
    expect(s[0]?.rowsBelow).toEqual(['dynamic']);
    expect(s[1]?.rowsBelow).toEqual(['pedal']);
  });

  it('两个谱表之间按上一个谱表下方 + 下一个谱表上方的空间拉开，最少 40 px', () => {
    const tight = systemLayout(staffSpaces([], [], ['treble', 'bass'], 2));
    expect((tight.lineY[1] as number) - (tight.lineY[0] as number)).toBe(STAFF_HEIGHT + 40);
    const crowded = systemLayout(
      staffSpaces(
        [el(1, ['C4']), el(2, ['C4'], { stem: 'up' })],
        [dir(1, 'below', { kind: 'dynamic', text: 'p' })],
        ['treble', 'bass'],
        2,
      ),
    );
    expect((crowded.lineY[1] as number) - (crowded.lineY[0] as number)).toBeGreaterThan(
      STAFF_HEIGHT + 40,
    );
    // 和弦名在最上面：第一个谱表上方的空间之上
    const withHigh = systemLayout(staffSpaces([el(1, ['C7'])], [], ['treble', 'bass'], 2));
    expect(withHigh.labelY).toBeLessThan((withHigh.lineY[0] as number) - 50);
    expect(withHigh.height).toBeGreaterThan((withHigh.lineY[1] as number) + STAFF_HEIGHT);
  });

  it('rowY：上方的行越往外越高，下方的行越往外越低', () => {
    const [s] = staffSpaces(
      [],
      [
        dir(1, 'above', { kind: 'octave', type: 'down', size: 8 }),
        dir(1, 'above', { kind: 'words', text: 'rit.' }),
      ],
      ['treble'],
      1,
    );
    if (!s) throw new Error('no space');
    expect(rowY(s, 100, 'above', 'words')).toBeLessThan(rowY(s, 100, 'above', 'octave'));
    expect(rowY(s, 100, 'above', 'octave')).toBeLessThan(100);
  });
});
