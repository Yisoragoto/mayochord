import { Link, useNavigate } from '@tanstack/react-router';
import { FileMusic, FileUp, Lock, Sparkles, Trash2 } from 'lucide-react';
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design/ui/button';
import { PracticeTabs } from '@/features/practice/PracticeTabs';
import { wallNow } from '@/lib/clock';
import { locale } from '@/lib/localize';
import { useDocumentTitle } from '@/lib/use-document-title';
import { cn } from '@/lib/utils';
import { uuid } from '@/lib/uuid';
import { type ScoreRecord, tryRepositories } from '@/storage';
import { addExampleScore, type ImportError, importScore } from './library';

export const SCORE_FILE_ACCEPT = '.musicxml,.mxl,.xml,.mid,.midi';

/** 本地乐谱库（规格第 10 节第 8 条）：导入 MusicXML / MIDI，列出已导入的曲子 */
export function ScoreLibraryPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('scores.title'));
  const navigate = useNavigate();
  const repos = tryRepositories();
  const [scores, setScores] = useState<ScoreRecord[] | null>(null);
  const [error, setError] = useState<ImportError | 'load' | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    if (!repos) return;
    try {
      setScores(await repos.scores.list());
    } catch {
      setError('load');
      setScores([]);
    }
  }, [repos]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onFile = async (file: File) => {
    if (!repos) return;
    setBusy(true);
    setError(null);
    const result = await importScore(repos, file, uuid(), wallNow());
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    void navigate({ to: '/scores/$scoreId', params: { scoreId: result.id } });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void onFile(file);
  };

  const addExample = async () => {
    if (!repos) return;
    const id = await addExampleScore(repos, uuid(), wallNow(), t('scores.exampleTitle'));
    void navigate({ to: '/scores/$scoreId', params: { scoreId: id } });
  };

  const remove = async (id: string) => {
    if (!repos) return;
    setConfirmDelete(null);
    await repos.scores.delete(id);
    await reload();
  };

  if (!repos) {
    return <p className="text-sm text-warning">{t('settings.dataUnavailable')}</p>;
  }

  return (
    <div className="space-y-8">
      <PracticeTabs current="scores" />
      <header>
        <h1 className="font-cjk-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('scores.title')}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('scores.subtitle')}</p>
      </header>

      <section
        aria-label={t('scores.importTitle')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong bg-card px-6 py-8 text-center transition-colors',
          dragging && 'border-primary bg-primary/5',
        )}
      >
        <FileMusic className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{t('scores.dropHint')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => input.current?.click()} disabled={busy}>
            <FileUp />
            {busy ? t('scores.importing') : t('scores.import')}
          </Button>
          <Button variant="outline" onClick={() => void addExample()}>
            <Sparkles />
            {t('scores.addExample')}
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          accept={SCORE_FILE_ACCEPT}
          className="hidden"
          data-testid="score-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void onFile(file);
          }}
        />
        <p className="text-xs text-subtle-foreground">{t('scores.formats')}</p>
        {error && (
          <p className="text-sm text-warning" role="alert">
            {t(`scores.importError.${error}`)}
          </p>
        )}
      </section>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('scores.privacy')}
      </p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('scores.libraryTitle')}</h2>
        {scores === null ? (
          <p className="text-muted-foreground" role="status">
            {t('practice.loading')}
          </p>
        ) : scores.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('scores.empty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {scores.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3" data-testid="score-row">
                <Link
                  to="/scores/$scoreId"
                  params={{ scoreId: s.id }}
                  className="min-w-0 flex-1 rounded-sm"
                >
                  <span className="block truncate font-medium">{s.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t('scores.meta', {
                      format: t(`scores.format.${s.format}`),
                      measures: s.measureCount,
                      notes: s.noteCount,
                    })}
                    {s.lastPlayedAt !== null &&
                      ` · ${t('scores.lastPlayed', {
                        date: new Date(s.lastPlayedAt).toLocaleDateString(locale()),
                      })}`}
                  </span>
                </Link>
                {confirmDelete === s.id ? (
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="destructive" onClick={() => void remove(s.id)}>
                      {t('scores.deleteConfirm')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                      {t('scores.cancel')}
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setConfirmDelete(s.id)}
                    aria-label={t('scores.delete', { title: s.title })}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
