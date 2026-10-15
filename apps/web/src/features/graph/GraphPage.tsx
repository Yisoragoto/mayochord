import { BUILTIN_PACK, type TopicEntry } from '@mayochord/content';
import { type GraphLayout, layoutTopicGraph, type TopicStatus } from '@mayochord/core';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Check,
  Clock,
  Lock,
  Maximize,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design/ui/button';
import { Switch } from '@/design/ui/switch';
import { learning, refreshLearning, useLearning } from '@/features/learn/service';
import { phaseCounts } from '@/features/practice/controller';
import { listSep, locale, localize } from '@/lib/localize';
import { useDocumentTitle } from '@/lib/use-document-title';
import { cn } from '@/lib/utils';

const NODE_W = 184;
const NODE_H = 60;
const pick = localize;

/** 状态 → 样式（颜色之外还有图标和边框样式区分，照顾色弱） */
const STATUS_STYLE: Record<TopicStatus, { box: string; text: string; dash?: string }> = {
  locked: { box: 'fill-surface-2/60 stroke-border', text: 'fill-subtle-foreground', dash: '4 4' },
  available: { box: 'fill-card stroke-primary', text: 'fill-foreground' },
  learning: { box: 'fill-primary/12 stroke-primary', text: 'fill-foreground' },
  mastered: { box: 'fill-mark-correct/10 stroke-mark-correct/70', text: 'fill-foreground' },
  review: { box: 'fill-warning/10 stroke-warning', text: 'fill-foreground' },
};

function StatusIcon({
  status,
  x,
  y,
  size = 16,
}: {
  status: TopicStatus;
  x: number;
  y: number;
  size?: number;
}) {
  const common = { x, y, width: size, height: size, 'aria-hidden': true } as const;
  switch (status) {
    case 'locked':
      return <Lock {...common} className="text-subtle-foreground" />;
    case 'available':
      return <Sparkles {...common} className="text-primary" />;
    case 'learning':
      return <ArrowRight {...common} className="text-primary" />;
    case 'mastered':
      return <Check {...common} className="text-mark-correct" />;
    case 'review':
      return <Clock {...common} className="text-warning" />;
  }
}

export function StatusBadge({ status }: { status: TopicStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
        status === 'locked' && 'border-dashed border-border text-subtle-foreground',
        status === 'available' && 'border-primary/60 text-primary',
        status === 'learning' && 'border-primary bg-primary/12 text-primary',
        status === 'mastered' && 'border-mark-correct/60 text-mark-correct',
        status === 'review' && 'border-warning/70 text-warning',
      )}
    >
      <svg width={12} height={12} aria-hidden>
        <StatusIcon status={status} x={0} y={0} size={12} />
      </svg>
      {t(`graph.status.${status}`)}
    </span>
  );
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

interface View {
  x: number;
  y: number;
  k: number;
}

function fitView(layout: GraphLayout, w: number, h: number, pad = 32): View {
  const k = Math.min(1.2, (w - pad * 2) / layout.width, (h - pad * 2) / layout.height);
  const kk = Math.max(0.3, k);
  return { k: kk, x: (w - layout.width * kk) / 2, y: (h - layout.height * kk) / 2 };
}

/**
 * 初始视图：放得下就整体适应窗口；放不下（手机竖屏）时用可读的缩放，
 * 以下一个要学的主题为中心。
 */
function initialView(layout: GraphLayout, w: number, h: number, focusId: string | null): View {
  const fit = fitView(layout, w, h);
  const node = focusId ? layout.nodes.get(focusId) : undefined;
  if (fit.k >= 0.7 || !node) return fit;
  const k = 0.8;
  return { k, x: w / 2 - (node.x + NODE_W / 2) * k, y: h / 3 - (node.y + NODE_H / 2) * k };
}

/** 知识图谱（规格 6.1）：主题节点、先修关系，状态用颜色 + 图标 + 边框区分 */
export function GraphPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('graph.title'));
  const snapshot = useLearning((s) => s.snapshot);
  const [selected, setSelected] = useState<string | null>(null);
  const [showEncompass, setShowEncompass] = useState(false);
  const [containerRef, size] = useSize<HTMLElement>();

  useEffect(() => {
    void refreshLearning();
  }, []);

  const orientation = size.w > 0 && size.w < 720 ? 'TB' : 'LR';
  const layout = useMemo(
    () =>
      layoutTopicGraph(BUILTIN_PACK.graph, {
        orientation,
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
        rankGap: orientation === 'LR' ? 64 : 48,
        nodeGap: 20,
      }),
    [orientation],
  );

  const statuses = snapshot?.statuses;
  const total = BUILTIN_PACK.topics.length;
  const masteredCount = statuses
    ? [...statuses.values()].filter((s) => s === 'mastered' || s === 'review').length
    : 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-cjk-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('graph.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('graph.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="font-mono text-muted-foreground tabular-nums">
            {t('graph.progress', { n: masteredCount, total })}
          </span>
          <Link
            to="/diagnostic"
            className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {t('graph.diagnostic')}
          </Link>
          <span className="flex items-center gap-2">
            <Switch
              id="graph-encompass"
              checked={showEncompass}
              onCheckedChange={setShowEncompass}
            />
            <label htmlFor="graph-encompass">{t('graph.showEncompass')}</label>
          </span>
        </div>
      </header>

      <ul className="flex flex-wrap gap-2" aria-label={t('graph.legend')}>
        {(['locked', 'available', 'learning', 'mastered', 'review'] as const).map((s) => (
          <li key={s}>
            <StatusBadge status={s} />
          </li>
        ))}
      </ul>
      {showEncompass && <p className="text-xs text-muted-foreground">{t('graph.encompassHint')}</p>}

      <section
        ref={containerRef}
        aria-label={t('graph.title')}
        className="relative h-[min(72dvh,760px)] min-h-[420px] overflow-hidden rounded-xl border border-border bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:22px_22px]"
      >
        {size.w > 0 && (
          <GraphCanvas
            layout={layout}
            orientation={orientation}
            width={size.w}
            height={size.h}
            statuses={statuses}
            selected={selected}
            onSelect={setSelected}
            showEncompass={showEncompass}
          />
        )}
        {!snapshot && (
          <p className="absolute top-3 left-3 text-sm text-muted-foreground" role="status">
            {t('graph.loading')}
          </p>
        )}
        <AnimatePresence mode="wait">
          {selected && snapshot && (
            <TopicPanel
              key={selected}
              topicId={selected}
              onClose={() => setSelected(null)}
              onSelect={setSelected}
            />
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

function GraphCanvas({
  layout,
  orientation,
  width,
  height,
  statuses,
  selected,
  onSelect,
  showEncompass,
}: {
  layout: GraphLayout;
  orientation: 'LR' | 'TB';
  width: number;
  height: number;
  statuses: ReadonlyMap<string, TopicStatus> | undefined;
  selected: string | null;
  onSelect: (id: string) => void;
  showEncompass: boolean;
}) {
  const { t } = useTranslation();
  const focusId =
    BUILTIN_PACK.graph.order.find((id) => {
      const s = statuses?.get(id);
      return s === 'learning' || s === 'available' || s === 'review';
    }) ?? null;
  const [view, setView] = useState<View>(() => initialView(layout, width, height, focusId));
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number; view: View; cx: number; cy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 布局、容器尺寸或焦点主题变化时重新定位
  useEffect(
    () => setView(initialView(layout, width, height, focusId)),
    [layout, width, height, focusId],
  );

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.25, v.k * factor));
      const f = k / v.k;
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });
  }, []);

  // 滚轮缩放（需要非 passive 监听才能阻止页面滚动）
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const local = (e: PointerEvent) => {
    const r = (svgRef.current as SVGSVGElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) {
      drag.current = { ...local(e), view, moved: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        view,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
      drag.current = null;
    }
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const { dist, view: v0, cx, cy } = pinch.current;
      const k = Math.min(2.5, Math.max(0.25, v0.k * (Math.hypot(a.x - b.x, a.y - b.y) / dist)));
      const f = k / v0.k;
      setView({ k, x: cx - (cx - v0.x) * f, y: cy - (cy - v0.y) * f });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) e.currentTarget.setPointerCapture?.(e.pointerId);
    d.moved = true;
    setView({ ...d.view, x: d.view.x + dx, y: d.view.y + dy });
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    // 没有拖动：当作点击节点
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const node = (e.target as Element).closest?.('[data-topic-id]');
      const id = node?.getAttribute('data-topic-id');
      if (id) onSelect(id);
    }
  };

  const horizontal = orientation === 'LR';
  const edgePath = (x1: number, y1: number, x2: number, y2: number, horizontal: boolean) => {
    if (horizontal) {
      const dx = Math.max(24, (x2 - x1) / 2);
      return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    }
    const dy = Math.max(20, (y2 - y1) / 2);
    return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
  };

  const mastered = (id: string) => {
    const s = statuses?.get(id);
    return s === 'mastered' || s === 'review';
  };

  const onKey = (e: KeyboardEvent<SVGGElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(id);
    }
  };

  return (
    <>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="block cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <title>{t('graph.title')}</title>
        <defs>
          <marker
            id="mc-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="fill-border-strong" />
          </marker>
          <marker
            id="mc-arrow-on"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="fill-primary" />
          </marker>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* 先修关系 */}
          {layout.edges.map((e) => {
            const on = mastered(e.from);
            return (
              <path
                key={`${e.from}-${e.to}`}
                d={edgePath(e.x1, e.y1, e.x2, e.y2, horizontal)}
                className={cn('fill-none', on ? 'stroke-primary/70' : 'stroke-border-strong')}
                strokeWidth={1.6}
                markerEnd={on ? 'url(#mc-arrow-on)' : 'url(#mc-arrow)'}
              />
            );
          })}
          {/* 包含关系（隐式重复） */}
          {showEncompass &&
            BUILTIN_PACK.topics.flatMap((topic) =>
              topic.encompasses.map((enc) => {
                const a = layout.nodes.get(topic.id);
                const b = layout.nodes.get(enc.topicId);
                if (!a || !b) return null;
                const x1 = a.x + NODE_W / 2;
                const y1 = a.y + NODE_H / 2;
                const x2 = b.x + NODE_W / 2;
                const y2 = b.y + NODE_H / 2;
                return (
                  <g key={`enc-${topic.id}-${enc.topicId}`}>
                    <path
                      d={`M${x1},${y1} Q${(x1 + x2) / 2},${Math.min(y1, y2) - 40} ${x2},${y2}`}
                      className="fill-none stroke-hand-left/70"
                      strokeWidth={1 + enc.weight * 2}
                      strokeDasharray="5 5"
                    />
                    <text
                      x={(x1 + x2) / 2}
                      y={Math.min(y1, y2) - 22}
                      textAnchor="middle"
                      className="fill-hand-left font-mono text-[11px]"
                    >
                      {enc.weight}
                    </text>
                  </g>
                );
              }),
            )}
          {/* 节点 */}
          {BUILTIN_PACK.graph.order.map((id) => {
            const n = layout.nodes.get(id);
            const topic = BUILTIN_PACK.topicById.get(id) as TopicEntry;
            if (!n) return null;
            const status = statuses?.get(id) ?? 'locked';
            const style = STATUS_STYLE[status];
            const isSel = selected === id;
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG 里不能用 <button>，用 role + 键盘处理
              <g
                key={id}
                data-topic-id={id}
                transform={`translate(${n.x},${n.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${pick(topic.title)}，${t(`graph.status.${status}`)}`}
                aria-pressed={isSel}
                onKeyDown={(e) => onKey(e, id)}
                className="cursor-pointer outline-none [&:focus-visible>rect:first-child]:stroke-ring [&:focus-visible>rect:first-child]:stroke-[3]"
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={12}
                  className={cn(style.box, 'transition-colors')}
                  strokeWidth={isSel ? 2.5 : 1.4}
                  strokeDasharray={style.dash}
                />
                {status === 'learning' && (
                  <rect
                    x={0}
                    y={NODE_H - 4}
                    width={NODE_W}
                    height={4}
                    rx={2}
                    className="fill-primary"
                  />
                )}
                <StatusIcon status={status} x={12} y={12} />
                <text x={34} y={25} className={cn(style.text, 'text-[14px] font-medium')}>
                  {pick(topic.title)}
                </text>
                <text x={34} y={45} className="fill-muted-foreground text-[11px]">
                  {t(`graph.status.${status}`)} · {t('graph.cards', { n: topic.cards.length })}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute bottom-3 left-3 flex gap-1 rounded-lg border border-border bg-background/90 p-1 backdrop-blur">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => zoomAt(1.25, width / 2, height / 2)}
          aria-label={t('graph.zoomIn')}
        >
          <Plus />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => zoomAt(0.8, width / 2, height / 2)}
          aria-label={t('graph.zoomOut')}
        >
          <Minus />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setView(fitView(layout, width, height))}
          aria-label={t('graph.fit')}
        >
          <Maximize />
        </Button>
      </div>
    </>
  );
}

const formatDate = (ts: number) =>
  new Intl.DateTimeFormat(locale(), { month: 'long', day: 'numeric' }).format(new Date(ts));

function TopicPanel({
  topicId,
  onClose,
  onSelect,
}: {
  topicId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const snapshot = useLearning((s) => s.snapshot);
  const topic = learning.topic(topicId);
  if (!topic || !snapshot) return null;
  const status = snapshot.statuses.get(topicId) ?? 'locked';
  const progress = snapshot.topicProgress.get(topicId);
  const counts = phaseCounts(topic.cards, snapshot.cardProgress, snapshot.now);
  const missing = topic.prerequisites.filter((p) => {
    const s = snapshot.statuses.get(p);
    return s !== 'mastered' && s !== 'review';
  });

  let action: ReactNode = null;
  if (status === 'available' || status === 'learning') {
    action = (
      <Button asChild className="w-full">
        <Link to="/learn/$topicId" params={{ topicId }}>
          {status === 'learning' ? t('graph.continueLesson') : t('graph.startLesson')}
          <ArrowRight />
        </Link>
      </Button>
    );
  } else if (status === 'locked') {
    // 跳级：已经会的可以直接参加这个主题的掌握检查，通过后它的先修主题也算掌握
    action = (
      <div className="space-y-2">
        <Button asChild variant="outline" className="w-full">
          <Link to="/learn/$topicId" params={{ topicId }}>
            {t('graph.skipAhead')}
          </Link>
        </Button>
        <p className="text-xs text-subtle-foreground">{t('graph.skipAheadHint')}</p>
      </div>
    );
  } else if (status === 'mastered' || status === 'review') {
    action = (
      <div className="flex flex-col gap-2">
        <Button asChild className="w-full">
          <Link to="/review/$topicId" params={{ topicId }}>
            <RotateCcw />
            {t('graph.review')}
          </Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link to="/learn/$topicId" params={{ topicId }}>
            {t('graph.continueLesson')}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <motion.aside
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-x-2 bottom-2 max-h-[70%] space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-3 sm:max-h-none sm:w-80"
      aria-label={pick(topic.title)}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="font-cjk-heading text-lg font-semibold">{pick(topic.title)}</h2>
          <StatusBadge status={status} />
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label={t('graph.close')}>
          <X />
        </Button>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{pick(topic.summary)}</p>

      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-subtle-foreground">{t('graph.prerequisites')}</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {topic.prerequisites.length === 0
              ? t('graph.none')
              : topic.prerequisites.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onSelect(p)}
                    className="rounded-md border border-border px-2 py-0.5 text-xs hover:border-border-strong"
                  >
                    {pick(learning.topic(p)?.title ?? { 'zh-CN': p })}
                  </button>
                ))}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground tabular-nums">
          <span>{t('graph.cards', { n: counts.total })}</span>
          <span>{t('practice.countNew', { n: counts.fresh })}</span>
          <span>{t('practice.countLearning', { n: counts.learning })}</span>
          <span>{t('practice.countMixed', { n: counts.mixed })}</span>
        </div>
        {progress?.memory && progress.masteredAt != null && (
          <p
            className={cn(
              'text-xs',
              status === 'review' ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {status === 'review'
              ? t('graph.due', { date: formatDate(progress.memory.due) })
              : t('graph.nextReview', { date: formatDate(progress.memory.due) })}
            {progress.confirmedAt != null && ` · ${t('graph.confirmed')}`}
          </p>
        )}
      </dl>

      {status === 'locked' && missing.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('graph.lockedHint', {
            topics: missing
              .map((p) => pick(learning.topic(p)?.title ?? { 'zh-CN': p }))
              .join(listSep()),
          })}
        </p>
      )}
      {action}
    </motion.aside>
  );
}
