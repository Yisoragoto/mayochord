import 'fake-indexeddb/auto';
import type { ReviewLog } from '@mayochord/core';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { logsToCsv, parseBackup } from './backup';
import { MayoChordDB } from './db';
import { createDexieRepositories } from './repositories';

const dbs: MayoChordDB[] = [];
const open = () => {
  const db = new MayoChordDB(`backup-${Date.now()}-${Math.random()}`);
  dbs.push(db);
  return { db, repos: createDexieRepositories(db) };
};
afterEach(async () => {
  for (const db of dbs.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

const log = (id: string, ts: number, over: Partial<ReviewLog> = {}): ReviewLog => ({
  id,
  ts,
  sessionId: 's1',
  cardId: 'chord:c:name:any',
  cardKind: 'chord',
  drillType: 'name-to-chord',
  evidence: 'explicit',
  weight: 1,
  correct: true,
  reactionMs: 900,
  extraNotes: [],
  missingNotes: [61, 64],
  spreadMs: 12,
  beatOffsetMs: null,
  hintUsed: false,
  rating: 3,
  inputSource: 'midi',
  contentVersion: '0.5.0',
  ...over,
});

describe('备份与迁移', () => {
  it('导出 → 导入到另一个数据库：全部数据一致，替换原有数据', async () => {
    const a = open();
    await a.repos.reviewLogs.appendMany([log('l1', 100), log('l2', 200)]);
    await a.repos.settings.set('app', { dailyMinutes: 45 });
    await a.repos.sessions.put({
      id: 's1',
      startedAt: 90,
      endedAt: 300,
      kind: 'practice',
      config: { kind: 'practice' },
      summary: null,
      xp: 1.5,
    });
    await a.repos.dailyPlans.put({
      date: '2026-10-15',
      createdAt: 1,
      tasks: [],
      dueTopics: [],
      spareLessons: [],
    });
    await a.repos.scores.put({
      id: 'sc1',
      title: 'Song',
      fileName: 'song.mid',
      format: 'midi',
      importedAt: 5,
      source: { kind: 'midi', base64: 'TVRoZA==' },
      measureCount: 2,
      noteCount: 3,
      prefs: null,
      lastPlayedAt: null,
    });
    const backup = await a.repos.backup.export(1234, '0.5.0');
    expect(backup).toMatchObject({ kind: 'mayochord-backup', formatVersion: 1, exportedAt: 1234 });
    expect(backup.tables.reviewLogs[0]).not.toHaveProperty('seq');

    const b = open();
    await b.repos.reviewLogs.append(log('old', 1));
    const parsed = parseBackup(JSON.stringify(backup));
    if (!parsed.ok) throw new Error(parsed.error);
    await b.repos.backup.import(parsed.backup);
    expect((await b.repos.backup.allLogs()).map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(await b.repos.settings.get('app')).toEqual({ dailyMinutes: 45 });
    expect((await b.repos.sessions.recent(5))[0]).toMatchObject({ id: 's1', xp: 1.5 });
    expect(await b.repos.dailyPlans.get('2026-10-15')).toBeDefined();
    expect((await b.repos.scores.get('sc1'))?.source).toEqual({ kind: 'midi', base64: 'TVRoZA==' });
    // 导入后日志仍然只追加
    await b.repos.reviewLogs.append(log('l3', 300));
    expect(await b.repos.reviewLogs.count()).toBe(3);
  });

  it('M6 的旧备份（没有乐谱表）也能导入', () => {
    const old = {
      kind: 'mayochord-backup',
      formatVersion: 1,
      exportedAt: 1,
      dbVersion: 2,
      tables: { reviewLogs: [] },
    };
    const parsed = parseBackup(JSON.stringify(old));
    expect(parsed.ok && parsed.backup.tables.scores).toEqual([]);
  });

  it('解析失败：不是 JSON / 不是备份文件 / 格式不对', () => {
    expect(parseBackup('{')).toEqual({ ok: false, error: 'json' });
    expect(parseBackup('{"kind":"midi-monitor-capture"}')).toEqual({ ok: false, error: 'kind' });
    expect(
      parseBackup(JSON.stringify({ kind: 'mayochord-backup', formatVersion: 1, tables: {} })),
    ).toEqual({ ok: false, error: 'format' });
  });

  it('作答日志 CSV：列名、转义、数组用空格连接', () => {
    const csv = logsToCsv([log('a', Date.UTC(2026, 9, 15), { sessionId: 'x,"y"' })]);
    const [head, row] = csv.split('\r\n');
    expect(head?.split(',').slice(0, 5)).toEqual(['id', 'ts', 'time', 'sessionId', 'cardId']);
    expect(row).toContain('2026-10-15T00:00:00.000Z');
    expect(row).toContain('"x,""y"""');
    expect(row).toContain(',61 64,');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
