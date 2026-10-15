import { BUILTIN_PACK } from '@mayochord/content';
import { Download, FileUp, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design/ui/button';
import { refreshLearning } from '@/features/learn/service';
import { wallNow } from '@/lib/clock';
import { downloadText, fileStamp } from '@/lib/download';
import { tryRepositories } from '@/storage';
import { type Backup, logsToCsv, parseBackup } from '@/storage/backup';

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; backup: Backup; fileName: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

/** 数据导出 / 导入（规格 12）：JSON 全部数据、CSV 作答日志；导入会替换现有数据 */
export function DataPanel() {
  const { t } = useTranslation();
  const repos = tryRepositories();
  const [count, setCount] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void repos?.reviewLogs
      .count()
      .then(setCount)
      .catch(() => setCount(null));
  }, [repos]);

  if (!repos) {
    return <p className="text-sm text-warning">{t('settings.dataUnavailable')}</p>;
  }

  const exportJson = async () => {
    const backup = await repos.backup.export(wallNow(), BUILTIN_PACK.version);
    downloadText(
      `mayochord-backup-${fileStamp()}.json`,
      JSON.stringify(backup),
      'application/json',
    );
  };
  const exportCsv = async () => {
    const logs = await repos.backup.allLogs();
    // 加 BOM，Excel 打开中文不乱码
    downloadText(`mayochord-logs-${fileStamp()}.csv`, `﻿${logsToCsv(logs)}`, 'text/csv');
  };
  const onFile = async (file: File) => {
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      setPhase({ kind: 'error', message: t(`settings.importError.${parsed.error}`) });
      return;
    }
    setPhase({ kind: 'confirm', backup: parsed.backup, fileName: file.name });
  };
  const confirmImport = async (backup: Backup) => {
    try {
      await repos.backup.import(backup);
      setCount(backup.tables.reviewLogs.length);
      await refreshLearning();
      setPhase({ kind: 'done' });
      // 设置、校准等都在内存里有一份：重新加载页面，从导入的数据开始
      setTimeout(() => window.location.reload(), 800);
    } catch {
      setPhase({ kind: 'error', message: t('settings.importFailed') });
    }
  };

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <span className="text-sm">{t('settings.logCount')}</span>
        <span className="font-mono text-sm tabular-nums" data-testid="log-count">
          {count ?? '—'}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        <Button size="sm" onClick={() => void exportJson()}>
          <Download />
          {t('settings.exportJson')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void exportCsv()}>
          <Download />
          {t('settings.exportCsv')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
          <FileUp />
          {t('settings.importJson')}
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label={t('settings.importJson')}
          data-testid="import-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void onFile(file);
          }}
        />
      </div>
      {phase.kind === 'confirm' && (
        <div
          className="space-y-3 px-4 py-3"
          role="alertdialog"
          aria-label={t('settings.importConfirmTitle')}
        >
          <p className="flex gap-2 text-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('settings.importConfirm', {
              file: phase.fileName,
              n: phase.backup.tables.reviewLogs.length,
              date: new Date(phase.backup.exportedAt).toLocaleString(),
            })}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void confirmImport(phase.backup)}
            >
              {t('settings.importReplace')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPhase({ kind: 'idle' })}>
              {t('settings.cancel')}
            </Button>
          </div>
        </div>
      )}
      {phase.kind === 'done' && (
        <p className="px-4 py-3 text-sm text-success" role="status">
          {t('settings.importDone')}
        </p>
      )}
      {phase.kind === 'error' && (
        <p className="px-4 py-3 text-sm text-warning" role="status">
          {phase.message}
        </p>
      )}
    </div>
  );
}
