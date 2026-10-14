import type { ChordSymbol } from '@mayochord/core';
import { Check, Flame, Pause, Play, RotateCcw, SkipForward, Volume2, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { ChordName } from '@/design/ChordName';
import { Keyboard, type KeyMark } from '@/design/keyboard/Keyboard';
import { Staff } from '@/design/staff/Staff';
import { Badge } from '@/design/ui/badge';
import { Button } from '@/design/ui/button';
import { Label } from '@/design/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design/ui/select';
import { Slider } from '@/design/ui/slider';
import { Switch } from '@/design/ui/switch';
import { cn } from '@/lib/utils';
import { type ResolvedTheme, resolveTheme, useAppearance } from '@/stores/appearance';

const SAMPLE_CHORDS: ChordSymbol[] = [
  { root: 0, quality: 'maj' },
  { root: 9, quality: 'm7' },
  { root: 0, quality: 'm7b5' },
  { root: 0, quality: '7(9)' },
  { root: 5, quality: 'M7' },
  { root: 6, quality: 'm', bass: 4 },
  { root: 10, quality: 'M7' },
  { root: 3, quality: 'add9' },
];

// Am7 参考键位：左手 A3，右手 G4(1) C5(3) E5(5)
const AM7_TARGET = new Map<number, KeyMark>([
  [57, { kind: 'target', hand: 'left', finger: 5 }],
  [67, { kind: 'target', hand: 'right', finger: 1 }],
  [72, { kind: 'target', hand: 'right', finger: 3 }],
  [76, { kind: 'target', hand: 'right', finger: 5 }],
]);
// 判定结果示例：A3、G4 对，C5 少按，C♯5 多按，E5 对
const AM7_RESULT = new Map<number, KeyMark>([
  [57, { kind: 'correct', hand: 'left' }],
  [67, { kind: 'correct', hand: 'right' }],
  [72, { kind: 'missing', hand: 'right', finger: 3 }],
  [73, { kind: 'extra' }],
  [76, { kind: 'correct', hand: 'right' }],
]);

export function DesignPage() {
  const themePref = useAppearance((s) => s.theme);
  const [compare, setCompare] = useState(true);
  const current = resolveTheme(themePref);

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="font-mono text-xs tracking-[0.2em] text-primary uppercase">
          Design system · 真夜中
        </p>
        <h1 className="font-cjk-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          组件与令牌
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          墨蓝黑的底色，街灯般的钠灯琥珀色点缀，左手用冷青色。所有组件只通过设计令牌取色，深色和浅色只切换令牌的值。和弦名
          Bricolage Grotesque，界面 Instrument Sans + Noto Sans SC，数字 JetBrains Mono。
        </p>
      </header>

      <div className="flex items-center gap-3">
        <Switch id="compare" checked={compare} onCheckedChange={setCompare} />
        <Label htmlFor="compare" className="font-normal">
          深色、浅色并排对比
        </Label>
      </div>

      <div className={cn('grid gap-6', compare && 'xl:grid-cols-2')}>
        {compare ? (
          <>
            <Specimen theme="dark" />
            <Specimen theme="light" />
          </>
        ) : (
          <Specimen theme={current} />
        )}
      </div>
    </div>
  );
}

function Specimen({ theme }: { theme: ResolvedTheme }) {
  return (
    <section
      data-theme={theme}
      aria-label={theme === 'dark' ? '夜间模式' : '白天模式'}
      className="min-w-0 space-y-8 rounded-[calc(var(--radius)*1.6)] border border-border bg-background p-5 text-foreground sm:p-7"
    >
      <p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
        {theme === 'dark' ? 'Night · 夜间' : 'Day · 白天'}
      </p>

      {/* 练习界面（专注模式）缩影 */}
      <PracticePreview />

      <Block title="和弦符号">
        <div className="flex flex-wrap items-baseline gap-x-7 gap-y-4">
          {SAMPLE_CHORDS.map((c) => (
            <ChordName key={`${c.root}${c.quality}${c.bass}`} symbol={c} size="md" />
          ))}
        </div>
      </Block>

      <Block title="键盘状态：目标 → 判定结果">
        <div className="grid gap-4">
          <Keyboard low={53} high={79} marks={AM7_TARGET} />
          <Keyboard low={53} high={79} marks={AM7_RESULT} pressed={new Set([57, 67, 73, 76])} />
          <Legend />
        </div>
      </Block>

      <Block title="五线谱">
        <Staff
          lh={['A3']}
          rh={['G4', 'C5', 'E5']}
          label="五线谱：左手 A3，右手 G4 C5 E5"
          className="max-w-48"
        />
      </Block>

      <Block title="中文排版">
        <h3 className="font-cjk-heading text-2xl font-semibold tracking-tight">
          丸サ進行，一次弹对
        </h3>
        <p className="mt-2 max-w-prose leading-relaxed text-muted-foreground">
          FM7 – E7 – Am7 – Gm7 – C7(9)。右手每次只移动半音或全音，左手只弹根音。今天的目标是在 72
          BPM 下连续弹完 4 遍，不停顿、和弦的音同时落下。
        </p>
        <p className="mt-3 font-mono text-sm tabular text-muted-foreground">
          反应时间 0.84 s · 齐整度 18 ms · 节拍偏差 ±23 ms · 正确率 92%
        </p>
      </Block>

      <Block title="按钮与控件">
        <div className="flex flex-wrap gap-3">
          <Button>
            <Play />
            开始练习
          </Button>
          <Button variant="secondary">
            <SkipForward />
            跳过
          </Button>
          <Button variant="outline">
            <Volume2 />
            示范
          </Button>
          <Button variant="ghost">
            <RotateCcw />
            重来
          </Button>
          <Button variant="destructive">删除</Button>
          <Button size="icon" variant="outline" aria-label="暂停">
            <Pause />
          </Button>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div className="space-y-3">
            <Label htmlFor={`bpm-${theme}`}>BPM 72</Label>
            <Slider id={`bpm-${theme}`} defaultValue={[72]} min={40} max={160} />
          </div>
          <div className="space-y-3">
            <Label>拍号</Label>
            <Select defaultValue="44">
              <SelectTrigger aria-label="拍号" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent data-theme={theme}>
                <SelectItem value="44">4/4</SelectItem>
                <SelectItem value="34">3/4</SelectItem>
                <SelectItem value="68">6/8</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Switch id={`hide-${theme}`} defaultChecked />
            <Label htmlFor={`hide-${theme}`} className="font-normal">
              隐藏键位（先回忆后提示）
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>已掌握</Badge>
            <Badge variant="secondary">学习中</Badge>
            <Badge variant="outline">需复习</Badge>
          </div>
        </div>
      </Block>

      <Block title="任务卡片">
        <TaskList />
      </Block>

      <Block title="反馈动效">
        <FeedbackDemo />
      </Block>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-4 text-xs font-medium tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Legend() {
  const items: { label: string; mark: KeyMark }[] = [
    { label: '目标（左手）', mark: { kind: 'target', hand: 'left', finger: 5 } },
    { label: '目标（右手）', mark: { kind: 'target', hand: 'right', finger: 1 } },
    { label: '按对', mark: { kind: 'correct' } },
    { label: '多按', mark: { kind: 'extra' } },
    { label: '少按', mark: { kind: 'missing', finger: 3 } },
  ];
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
      {items.map(({ label, mark }) => (
        <li key={label} className="inline-flex items-center gap-2">
          <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
            <LegendGlyph mark={mark} />
          </svg>
          {label}
        </li>
      ))}
    </ul>
  );
}

function LegendGlyph({ mark }: { mark: KeyMark }) {
  switch (mark.kind) {
    case 'target':
      return (
        <circle
          cx="10"
          cy="10"
          r="8"
          fill={mark.hand === 'left' ? 'var(--hand-left)' : 'var(--hand-right)'}
        />
      );
    case 'correct':
      return (
        <>
          <circle cx="10" cy="10" r="8" fill="var(--mark-correct)" />
          <path
            d="M6.2 10.2l2.6 2.7 5-5.6"
            fill="none"
            stroke="var(--background)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case 'extra':
      return (
        <>
          <rect x="2" y="2" width="16" height="16" rx="2" fill="var(--mark-extra)" />
          <path
            d="M7 7l6 6M13 7l-6 6"
            stroke="var(--background)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      );
    case 'missing':
      return (
        <circle
          cx="10"
          cy="10"
          r="7.5"
          fill="none"
          stroke="var(--mark-missing)"
          strokeWidth="1.8"
          strokeDasharray="3 2.2"
        />
      );
  }
}

function PracticePreview() {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
        <span className="font-mono tabular">7 / 20</span>
        <div className="mx-4 h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-[35%] rounded-full bg-primary" />
        </div>
        <span className="inline-flex items-center gap-1 font-mono tabular">
          <Flame className="size-3.5 text-primary" aria-hidden />5
        </span>
      </div>
      <div className="grid place-items-center gap-1 px-4 pt-8 pb-6">
        <ChordName
          symbol={{ root: 9, quality: 'm7' }}
          size="lg"
          className="text-[clamp(4rem,10vw,6.5rem)]"
        />
        <p className="text-xs text-muted-foreground">
          下一个
          <ChordName
            symbol={{ root: 7, quality: 'm7' }}
            size="sm"
            className="ml-2 align-baseline text-base text-foreground"
          />
        </p>
      </div>
      <div className="px-3 pb-3">
        <Keyboard low={53} high={79} labels="none" />
      </div>
    </div>
  );
}

function TaskList() {
  const tasks = [
    { title: '热身：C 调三和弦', meta: '3 分钟 · 复习', done: true },
    { title: '到期复习：丸サ進行', meta: '8 分钟 · 覆盖 6 张到期卡片', done: false },
    { title: '新主题：七和弦公式', meta: '12 分钟 · 讲解 → 引导 → 独立', done: false },
  ];
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      {tasks.map((task, i) => (
        <li key={task.title} className="flex items-center gap-4 px-4 py-3.5">
          <span
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-full border font-mono text-xs tabular',
              task.done
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border-strong text-muted-foreground',
            )}
          >
            {task.done ? <Check className="size-3.5" aria-label="已完成" /> : i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'truncate font-medium',
                task.done && 'text-muted-foreground line-through decoration-1',
              )}
            >
              {task.title}
            </p>
            <p className="truncate text-sm text-muted-foreground">{task.meta}</p>
          </div>
          {!task.done && i === 1 && (
            <Button size="sm">
              <Play />
              开始
            </Button>
          )}
        </li>
      ))}
    </ol>
  );
}

function FeedbackDemo() {
  const reduce = useReducedMotion();
  const [state, setState] = useState<{ kind: 'correct' | 'wrong' | 'streak'; n: number } | null>(
    null,
  );
  const fire = (kind: 'correct' | 'wrong' | 'streak') =>
    setState((s) => ({ kind, n: (s?.n ?? 0) + 1 }));

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => fire('correct')}>
          答对
        </Button>
        <Button size="sm" variant="outline" onClick={() => fire('wrong')}>
          答错
        </Button>
        <Button size="sm" variant="outline" onClick={() => fire('streak')}>
          连对 ×5
        </Button>
      </div>
      <div
        className="relative grid h-16 min-w-48 flex-1 place-items-center overflow-hidden rounded-[var(--radius)] border border-border bg-card"
        aria-live="polite"
      >
        <AnimatePresence mode="popLayout">
          {state && (
            <motion.div
              key={state.n}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.92 }}
              animate={
                reduce
                  ? { opacity: 1 }
                  : state.kind === 'wrong'
                    ? { opacity: 1, y: 0, scale: 1, x: [0, -7, 6, -4, 2, 0] }
                    : { opacity: 1, y: 0, scale: 1 }
              }
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: 'spring', stiffness: 520, damping: 28 }}
              className={cn(
                'inline-flex items-center gap-2 font-medium',
                state.kind === 'wrong'
                  ? 'text-mark-extra'
                  : state.kind === 'streak'
                    ? 'text-primary'
                    : 'text-mark-correct',
              )}
            >
              {state.kind === 'wrong' ? (
                <X className="size-5" />
              ) : state.kind === 'streak' ? (
                <Flame className="size-5" />
              ) : (
                <Check className="size-5" />
              )}
              {state.kind === 'wrong'
                ? '少按了 C5'
                : state.kind === 'streak'
                  ? '连对 5 次'
                  : '0.62 s'}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
