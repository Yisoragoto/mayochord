import {
  type AttemptOptions,
  AttemptTracker,
  type ChordAttempt,
  type HeldNote,
  type InputEvent,
} from '@mayochord/core';
import { create } from 'zustand';
import { type InputHub, inputHub } from './hub';

export interface LiveInputState {
  /** 当前按住的音（已校准、已跨通道合并），升序 */
  held: number[];
  /** 按住音的详细信息（按下时间、力度、通道、是否靠踏板延音） */
  notes: ReadonlyMap<number, HeldNote>;
  sustainDown: boolean;
  /** 最近一次和弦尝试 */
  lastAttempt: ChordAttempt | null;
}

export const useLiveInput = create<LiveInputState>()(() => ({
  held: [],
  notes: new Map(),
  sustainDown: false,
  lastAttempt: null,
}));

type AttemptListener = (a: ChordAttempt) => void;
type EventListener = (e: InputEvent) => void;

/**
 * 全局的实时输入状态：订阅输入汇流，维护按住的音，并按设置里的阈值检测"弹出和弦"。
 * 稳定检测不依赖新事件：每次变化后用定时器在预计稳定的时刻再检查一次。
 */
export class LiveInput {
  private tracker: AttemptTracker;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attemptListeners = new Set<AttemptListener>();
  private eventListeners = new Set<EventListener>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly hub: InputHub,
    options: Partial<AttemptOptions> = {},
  ) {
    this.tracker = new AttemptTracker(options);
  }

  start() {
    this.unsubscribe ??= this.hub.subscribe((e) => this.handle(e));
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
  }

  /** 修改判定阈值或踏板选项：重新开始跟踪（保留当前按住的音由后续事件自然更新）。 */
  setOptions(options: Partial<AttemptOptions>) {
    this.tracker = new AttemptTracker(options);
    this.publish(null);
  }

  onAttempt(cb: AttemptListener): () => void {
    this.attemptListeners.add(cb);
    return () => this.attemptListeners.delete(cb);
  }

  /** 已校准、已合并的原始事件（练习逻辑需要完整事件流时用） */
  onEvent(cb: EventListener): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  private handle(e: InputEvent) {
    for (const cb of this.eventListeners) cb(e);
    const attempt = this.tracker.push(e);
    this.publish(attempt);
    this.schedule(e.t);
  }

  private schedule(now: number) {
    if (this.timer) clearTimeout(this.timer);
    const wait = this.tracker.msUntilStable(now);
    if (wait === null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const a = this.tracker.poll(performance.now());
      if (a) this.publish(a);
      else this.schedule(performance.now());
    }, wait + 1);
  }

  private publish(attempt: ChordAttempt | null) {
    const st = this.tracker.held;
    const patch: Partial<LiveInputState> = {
      held: this.tracker.heldNotes(),
      notes: st.notes,
      sustainDown: st.sustainDown,
    };
    if (attempt) patch.lastAttempt = attempt;
    useLiveInput.setState(patch);
    if (attempt) for (const cb of this.attemptListeners) cb(attempt);
  }
}

export const liveInput = new LiveInput(inputHub);
