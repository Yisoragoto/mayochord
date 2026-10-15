import 'fake-indexeddb/auto';
import { parseMusicXml } from '@mayochord/core';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { MayoChordDB } from '@/storage/db';
import { createDexieRepositories } from '@/storage/repositories';
import { addExampleScore, importScore, MAX_SCORE_BYTES, parsePrefs, scoreSeconds } from './library';

const dbs: MayoChordDB[] = [];
const open = () => {
  const db = new MayoChordDB(`library-${Date.now()}-${Math.random()}`);
  dbs.push(db);
  return createDexieRepositories(db);
};
afterEach(async () => {
  for (const db of dbs.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

const file = (name: string, text: string, size = text.length) => ({
  name,
  size,
  arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
});

describe('score library', () => {
  it('adds the example score and imports files', async () => {
    const repos = open();
    await addExampleScore(repos, 'ex', 5, '欢乐颂（示例）');
    const ex = await repos.scores.get('ex');
    expect(ex).toMatchObject({ title: '欢乐颂（示例）', format: 'musicxml', measureCount: 16 });
    if (ex?.source.kind !== 'musicxml') throw new Error('expected MusicXML');
    expect(scoreSeconds(parseMusicXml(ex.source.text))).toBe(40);

    const xml = `<score-partwise><part id="P"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`;
    const ok = await importScore(repos, file('My piece.musicxml', xml), 'a', 10);
    expect(ok).toEqual({ ok: true, id: 'a' });
    expect((await repos.scores.get('a'))?.title).toBe('My piece');
  });

  it('reports import errors', async () => {
    const repos = open();
    expect(await importScore(repos, file('x.pdf', '%PDF-1.4'), 'b', 1)).toEqual({
      ok: false,
      error: 'unknown-format',
    });
    expect(await importScore(repos, file('x.xml', '<foo/>'), 'c', 1)).toEqual({
      ok: false,
      error: 'not-musicxml',
    });
    expect(await importScore(repos, file('big.mid', '', MAX_SCORE_BYTES + 1), 'd', 1)).toEqual({
      ok: false,
      error: 'too-large',
    });
    expect(await repos.scores.list()).toEqual([]);
  });

  it('parses saved options, falling back field by field', () => {
    expect(parsePrefs(null)).toMatchObject({
      view: 'staff',
      mode: 'wait',
      from: 0,
      to: null,
      speed: 1,
    });
    expect(parsePrefs({ mode: 'tempo', speed: 9, hands: 'left', to: 3 })).toMatchObject({
      mode: 'tempo',
      speed: 1,
      hands: 'left',
      to: 3,
    });
    expect(parsePrefs('garbage').view).toBe('staff');
  });
});
