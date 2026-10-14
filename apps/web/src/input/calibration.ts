import type { InputEvent } from '@mayochord/core';
import { create } from 'zustand';
import type { CalibrationRecord, CalibrationRepository } from '@/storage';
import type { InputHub } from './hub';

export const MIDDLE_C = 60;

export type CalibrationMode = 'idle' | 'octave' | 'low' | 'high';

interface CalibrationState {
  /** 当前 MIDI 输入设备（端口名）；没有设备时为 null */
  deviceKey: string | null;
  record: CalibrationRecord | null;
  mode: CalibrationMode;
  /** 音域测量中已按下的最低键（未扣除偏移） */
  pendingLow: number | null;
}

export const useCalibration = create<CalibrationState>()(() => ({
  deviceKey: null,
  record: null,
  mode: 'idle',
  pendingLow: null,
}));

/**
 * 八度/移调校准（规格第 7 节）：
 * - 八度校准：按一下琴上的中央 C，记录收到的音符号与 60 的差，之后所有 MIDI 输入都减去它；
 * - 音域测量：依次按最低键和最高键，记录实际音域（扣除偏移后），与设备配置对照。
 * 校准数据按设备（端口名）保存在 IndexedDB。
 */
export class CalibrationController {
  constructor(
    private readonly hub: InputHub,
    /** 懒取仓储：IndexedDB 不可用时返回 null，校准只在本次会话内生效 */
    private readonly repo: () => CalibrationRepository | null,
  ) {}

  /** 当前设备变化时加载它的校准数据，并把偏移应用到输入汇流。 */
  async setDevice(deviceKey: string | null) {
    useCalibration.setState({ deviceKey, record: null, mode: 'idle', pendingLow: null });
    if (!deviceKey) {
      this.hub.setMidiOffset(0);
      return;
    }
    const record = (await this.repo()?.get(deviceKey)) ?? null;
    if (useCalibration.getState().deviceKey !== deviceKey) return;
    useCalibration.setState({ record });
    this.hub.setMidiOffset(record?.noteOffset ?? 0);
  }

  start(mode: 'octave' | 'range') {
    useCalibration.setState({ mode: mode === 'octave' ? 'octave' : 'low', pendingLow: null });
  }

  cancel() {
    useCalibration.setState({ mode: 'idle', pendingLow: null });
  }

  async resetOffset() {
    await this.save({ noteOffset: 0 });
  }

  /** 接收未经校准的 MIDI 事件（直接来自 Web MIDI，不经过输入汇流）。 */
  handleRawMidi(e: InputEvent) {
    if (e.kind !== 'noteOn') return;
    const { mode, pendingLow, record } = useCalibration.getState();
    const offset = record?.noteOffset ?? 0;
    if (mode === 'octave') {
      useCalibration.setState({ mode: 'idle' });
      void this.save({ noteOffset: e.note - MIDDLE_C });
    } else if (mode === 'low') {
      useCalibration.setState({ mode: 'high', pendingLow: e.note });
    } else if (mode === 'high' && pendingLow !== null) {
      const lo = Math.min(pendingLow, e.note);
      const hi = Math.max(pendingLow, e.note);
      useCalibration.setState({ mode: 'idle', pendingLow: null });
      void this.save({ lowestNote: lo - offset, highestNote: hi - offset });
    }
  }

  private async save(patch: Partial<Omit<CalibrationRecord, 'deviceKey'>>) {
    const { deviceKey, record } = useCalibration.getState();
    if (!deviceKey) return;
    const next: CalibrationRecord = {
      deviceKey,
      noteOffset: record?.noteOffset ?? 0,
      lowestNote: record?.lowestNote ?? null,
      highestNote: record?.highestNote ?? null,
      ...patch,
      updatedAt: Date.now(),
    };
    useCalibration.setState({ record: next });
    this.hub.setMidiOffset(next.noteOffset);
    await this.repo()?.put(next);
  }
}
