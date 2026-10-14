import 'fake-indexeddb/auto';
import { emptyProgress, type ReviewLog, reviewMemory } from '@mayochord/core';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { MayoChordDB } from './db';
import { createDexieRepositories } from './repositories';

let counter = 0;
const opened: Dexie[] = [];
function freshDb() {
  const db = new MayoChordDB(`test-${Date.now()}-${counter++}`);
  opened.push(db);
  return db;
}

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

const log = (id: string, cardId: string, ts: number): ReviewLog => ({
  id,
  ts,
  sessionId: 's1',
  cardId,
  cardKind: 'chord',
  drillType: 'name-to-chord',
  evidence: 'explicit',
  weight: 1,
  correct: true,
  reactionMs: 800,
  extraNotes: [],
  missingNotes: [],
  spreadMs: 20,
  beatOffsetMs: null,
  hintUsed: false,
  rating: 3,
  inputSource: 'midi',
  contentVersion: '0.1.0',
});

describe('ReviewLogRepository', () => {
  it('追加并按卡片、时间查询', async () => {
    const repos = createDexieRepositories(freshDb());
    await repos.reviewLogs.append(log('a', 'card-am7', 100));
    await repos.reviewLogs.appendMany([log('b', 'card-c', 200), log('c', 'card-am7', 50)]);
    expect(await repos.reviewLogs.count()).toBe(3);
    expect((await repos.reviewLogs.byCard('card-am7')).map((l) => l.id)).toEqual(['c', 'a']);
    expect((await repos.reviewLogs.since(100)).map((l) => l.id)).toEqual(['a', 'b']);
    // 读出来的对象不带内部的自增主键
    expect(await repos.reviewLogs.byCard('card-c')).toEqual([log('b', 'card-c', 200)]);
  });

  it('只追加：同一个 ID 不能写两次', async () => {
    const repos = createDexieRepositories(freshDb());
    await repos.reviewLogs.append(log('a', 'x', 1));
    await expect(repos.reviewLogs.append(log('a', 'x', 2))).rejects.toThrow();
    expect(await repos.reviewLogs.count()).toBe(1);
  });
});

describe('最近的日志、卡片进度、练习记录', () => {
  it('latest 按追加顺序返回最后 n 条', async () => {
    const repos = createDexieRepositories(freshDb());
    await repos.reviewLogs.appendMany([log('a', 'x', 3), log('b', 'x', 1), log('c', 'x', 2)]);
    expect((await repos.reviewLogs.latest(2)).map((l) => l.id)).toEqual(['b', 'c']);
    expect((await repos.reviewLogs.latest(10)).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('卡片进度读写', async () => {
    const repos = createDexieRepositories(freshDb());
    const fresh = emptyProgress('chord:c:name:any');
    const reviewed = { ...emptyProgress('chord:g:name:any'), memory: reviewMemory(null, 3, 1000) };
    await repos.cardStates.put(fresh);
    await repos.cardStates.put(reviewed);
    const got = await repos.cardStates.getMany(['chord:c:name:any', 'chord:g:name:any', 'nope']);
    expect([...got.keys()]).toEqual(['chord:c:name:any', 'chord:g:name:any']);
    expect(got.get('chord:g:name:any')).toEqual(reviewed);
    expect(await repos.cardStates.all()).toHaveLength(2);
  });

  it('练习记录：新的在前', async () => {
    const repos = createDexieRepositories(freshDb());
    const rec = (id: string, startedAt: number) => ({
      id,
      startedAt,
      endedAt: null,
      kind: 'practice' as const,
      config: {},
      summary: null,
    });
    await repos.sessions.put(rec('a', 1));
    await repos.sessions.put(rec('b', 2));
    expect((await repos.sessions.recent(5)).map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('Settings / Calibration', () => {
  it('读写设置', async () => {
    const repos = createDexieRepositories(freshDb());
    expect(await repos.settings.get('app')).toBeUndefined();
    await repos.settings.set('app', { stableMs: 120 });
    expect(await repos.settings.get('app')).toEqual({ stableMs: 120 });
  });

  it('按设备保存校准', async () => {
    const repos = createDexieRepositories(freshDb());
    const rec = {
      deviceKey: 'JUNO-D',
      noteOffset: 12,
      lowestNote: 28,
      highestNote: 103,
      updatedAt: 1,
    };
    await repos.calibrations.put(rec);
    expect(await repos.calibrations.get('JUNO-D')).toEqual(rec);
    expect(await repos.calibrations.get('other')).toBeUndefined();
  });
});

describe('数据库版本与迁移', () => {
  it('当前版本号；用旧版本写入的数据在升级后仍然存在', async () => {
    const name = `migration-${Date.now()}`;
    // 模拟“旧版本的应用”：直接按 v1 的表结构写入
    const old = new Dexie(name);
    old.version(1).stores({ reviewLogs: '++seq, &id, ts, cardId, sessionId, [cardId+ts]' });
    await old.table('reviewLogs').add(log('legacy', 'card-c', 1));
    old.close();

    const db = new MayoChordDB(name);
    opened.push(db);
    await db.open();
    expect(db.verno).toBe(1);
    const repos = createDexieRepositories(db);
    expect((await repos.reviewLogs.byCard('card-c')).map((l) => l.id)).toEqual(['legacy']);
  });
});
