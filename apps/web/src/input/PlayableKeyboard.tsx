import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Keyboard, type KeyMark } from '@/design/keyboard/Keyboard';
import { useSettings } from '@/stores/settings';
import { OFFSET_TO_LABEL, useComputerKeyboard } from './computer-keyboard';
import { inputHub } from './hub';
import { useLiveInput } from './live';

const SOURCE = 'onscreen';
const EMPTY: ReadonlySet<number> = new Set();

export interface PlayableKeyboardProps {
  low: number;
  high: number;
  marks?: ReadonlyMap<number, KeyMark>;
  labels?: 'none' | 'c' | 'all';
  /** 在键上显示电脑键盘对应的字母（电脑键盘弹奏开启时） */
  showComputerHints?: boolean;
  /**
   * 不显示按下的键（练习里"反馈逐渐减少"：熟练的卡判定前不给实时反馈）。
   * 点击切换模式下仍然显示，否则看不出哪些键被点下了。
   */
  hidePressed?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** 由屏幕键盘弹出的音：在“切换”模式下用于清空。 */
export function releaseOnscreenNotes() {
  inputHub.releaseSource(SOURCE);
}

/**
 * 可以弹的屏幕键盘：鼠标/触摸/键盘操作送进输入汇流（source = 'onscreen'），
 * 显示的按下状态来自全部输入源（MIDI、屏幕键盘、电脑键盘）合并后的结果。
 *
 * 模式（设置里切换）：
 * - momentary：按住发声、松开停止，适合触摸屏多指按和弦；
 * - latch：点一下按下、再点一下抬起，方便只有鼠标时按出和弦。
 */
export function PlayableKeyboard({
  low,
  high,
  marks,
  labels = 'c',
  showComputerHints = false,
  hidePressed = false,
  className,
  'aria-label': ariaLabel,
}: PlayableKeyboardProps) {
  const held = useLiveInput((s) => s.held);
  const mode = useSettings((s) => s.settings.onscreenMode);
  const computerKeyboard = useSettings((s) => s.settings.computerKeyboard);
  const base = useComputerKeyboard((s) => s.base);
  const latched = useRef(new Set<number>());

  const pressed = useMemo(() => new Set(held), [held]);
  const hints = useMemo(() => {
    if (!showComputerHints || !computerKeyboard) return undefined;
    const m = new Map<number, string>();
    for (const [off, label] of Object.entries(OFFSET_TO_LABEL)) m.set(base + Number(off), label);
    return m;
  }, [showComputerHints, computerKeyboard, base]);

  const send = useCallback((kind: 'noteOn' | 'noteOff', note: number) => {
    const t = performance.now();
    inputHub.ingest(
      kind === 'noteOn'
        ? { kind, note, velocity: 80, channel: 1, t, source: SOURCE }
        : { kind, note, velocity: 0, channel: 1, t, source: SOURCE },
    );
  }, []);

  const onPress = useCallback(
    (note: number) => {
      if (mode === 'latch') {
        if (latched.current.has(note)) {
          latched.current.delete(note);
          send('noteOff', note);
        } else {
          latched.current.add(note);
          send('noteOn', note);
        }
      } else {
        send('noteOn', note);
      }
    },
    [mode, send],
  );
  const onRelease = useCallback(
    (note: number) => {
      if (mode === 'momentary') send('noteOff', note);
    },
    [mode, send],
  );

  // 切换模式或离开页面时，松开所有屏幕键盘按下的音
  // biome-ignore lint/correctness/useExhaustiveDependencies: mode 变化时需要清空
  useEffect(() => {
    return () => {
      latched.current.clear();
      releaseOnscreenNotes();
    };
  }, [mode]);

  // 别处清空了屏幕键盘的音（例如“清空”按钮）时，同步切换模式的状态
  useEffect(() => {
    for (const n of [...latched.current]) if (!pressed.has(n)) latched.current.delete(n);
  }, [pressed]);

  const props = {
    low,
    high,
    pressed: hidePressed && mode === 'momentary' ? EMPTY : pressed,
    labels,
    onPress,
    onRelease,
    ...(marks ? { marks } : {}),
    ...(hints ? { hints } : {}),
    ...(className ? { className } : {}),
    ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
  };
  return <Keyboard {...props} />;
}
