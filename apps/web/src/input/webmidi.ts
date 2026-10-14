import {
  type DeviceProfile,
  type InputEvent,
  type InputSource,
  matchesDevice,
  parseMidiMessage,
} from '@mayochord/core';
import { create } from 'zustand';

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer: string;
  type: 'input' | 'output';
  state: MIDIPortDeviceState;
  connection: MIDIPortConnectionState;
}

/** 未经解析的原始消息，用于监视页日志与实测数据导出。 */
export interface RawMidiMessage {
  /** MIDIMessageEvent.timeStamp（performance.now() 域） */
  t: number;
  /** 回调实际执行时的 performance.now()，与 t 的差反映驱动/浏览器的派发延迟 */
  recv: number;
  portId: string;
  portName: string;
  data: number[];
}

export type MidiAccessStatus = 'unsupported' | 'idle' | 'requesting' | 'ready' | 'denied' | 'error';

interface MidiState {
  status: MidiAccessStatus;
  errorMessage: string | null;
  inputs: MidiPortInfo[];
  outputs: MidiPortInfo[];
  selectedInputId: string | null;
  /** 打开所选端口失败（Windows 上常见原因：端口被 DAW 等程序占用） */
  openError: string | null;
}

export const useMidi = create<MidiState>()(() => ({
  status: isWebMidiSupported() ? 'idle' : 'unsupported',
  errorMessage: null,
  inputs: [],
  outputs: [],
  selectedInputId: null,
  openError: null,
}));

export function isWebMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
}

function portInfo(p: MIDIPort): MidiPortInfo {
  return {
    id: p.id,
    name: p.name ?? '(unnamed)',
    manufacturer: p.manufacturer ?? '',
    type: p.type,
    state: p.state,
    connection: p.connection,
  };
}

type RawListener = (msg: RawMidiMessage) => void;
type EventListener = (e: InputEvent) => void;
type DetachListener = (source: string) => void;
type SelectListener = (portName: string | null) => void;

/**
 * Web MIDI 访问的单例服务：申请权限、维护端口列表、自动选择设备、把所选输入的消息分发给订阅者。
 * 不请求 sysex 权限。
 */
class WebMidiService {
  private access: MIDIAccess | null = null;
  /** 正在进行的权限请求。并发调用 request() 时共用同一个，否则会得到两个 MIDIAccess、每条消息分发两次 */
  private pending: Promise<void> | null = null;
  private attached: MIDIInput | null = null;
  /** 正在打开（或已挂上回调）的端口 id，避免端口打开时的 statechange 触发重复挂载 */
  private attachingId: string | null = null;
  /** 每次 attach 递增；open() 返回后若已有更新的 attach，则放弃本次挂载 */
  private attachGeneration = 0;
  private manualSelection = false;
  private rawListeners = new Set<RawListener>();
  private eventListeners = new Set<EventListener>();
  private detachListeners = new Set<DetachListener>();
  private selectListeners = new Set<SelectListener>();
  private preferred: DeviceProfile[] = [];
  private preferredName: string | null = null;

  setPreferredProfiles(profiles: DeviceProfile[]) {
    this.preferred = profiles;
  }

  /** 用户上次手动选择的设备名：自动选择时优先于设备配置的名称匹配 */
  setPreferredName(name: string | null) {
    this.preferredName = name;
  }

  request(): Promise<void> {
    if (!isWebMidiSupported() || this.access) return Promise.resolve();
    this.pending ??= this.doRequest().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async doRequest(): Promise<void> {
    useMidi.setState({ status: 'requesting', errorMessage: null });
    let access: MIDIAccess;
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      const denied = err instanceof DOMException && err.name === 'SecurityError';
      useMidi.setState({
        status: denied ? 'denied' : 'error',
        errorMessage: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      return;
    }
    this.access = access;
    access.onstatechange = () => this.refreshPorts();
    useMidi.setState({ status: 'ready' });
    this.refreshPorts();
  }

  /** 用户手动选择输入端口（null = 不监听）。 */
  select(id: string | null) {
    this.manualSelection = true;
    const name = id ? (this.access?.inputs.get(id)?.name ?? null) : null;
    for (const cb of this.selectListeners) cb(name);
    void this.attach(id);
  }

  /** 当前所选输入端口的名称（用作校准数据的设备键） */
  selectedPortName(): string | null {
    const id = useMidi.getState().selectedInputId;
    return id ? (this.access?.inputs.get(id)?.name ?? null) : null;
  }

  /** 输入端口被断开或切换时通知（参数是事件里的 source），用于释放还按着的音 */
  onDetach(cb: DetachListener): () => void {
    this.detachListeners.add(cb);
    return () => this.detachListeners.delete(cb);
  }

  /** 用户手动选择设备时通知（参数是端口名），用于记住选择 */
  onSelect(cb: SelectListener): () => void {
    this.selectListeners.add(cb);
    return () => this.selectListeners.delete(cb);
  }

  /** 直接从 MIDIAccess 读取当前端口状态（用于导出，避免 store 快照过时）。 */
  portSnapshot(): { inputs: MidiPortInfo[]; outputs: MidiPortInfo[] } {
    if (!this.access) return { inputs: [], outputs: [] };
    return {
      inputs: Array.from(this.access.inputs.values()).map(portInfo),
      outputs: Array.from(this.access.outputs.values()).map(portInfo),
    };
  }

  onRaw(cb: RawListener): () => void {
    this.rawListeners.add(cb);
    return () => this.rawListeners.delete(cb);
  }

  onEvent(cb: EventListener): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  private refreshPorts() {
    if (!this.access) return;
    const inputs = Array.from(this.access.inputs.values()).map(portInfo);
    const outputs = Array.from(this.access.outputs.values()).map(portInfo);
    useMidi.setState({ inputs, outputs });

    const { selectedInputId } = useMidi.getState();
    const current = inputs.find((p) => p.id === selectedInputId && p.state === 'connected');
    if (current) {
      // 同一端口拔掉再插上后，确保回调仍然挂在它上面
      if (this.attachingId !== current.id) void this.attach(current.id);
      return;
    }
    if (this.manualSelection && selectedInputId && !current) {
      // 手动选择的设备暂时断开：保留选择，等它重新连接
      this.detach();
      return;
    }
    const connected = inputs.filter((p) => p.state === 'connected');
    const preferred =
      connected.find((p) => p.name === this.preferredName) ??
      connected.find((p) => this.preferred.some((prof) => matchesDevice(prof, p.name))) ??
      connected[0];
    void this.attach(preferred?.id ?? null);
  }

  private detach() {
    if (this.attached) {
      this.attached.onmidimessage = null;
      const source = `webmidi:${this.attached.id}`;
      this.attached = null;
      for (const cb of this.detachListeners) cb(source);
    }
    this.attachingId = null;
  }

  private async attach(id: string | null) {
    const generation = ++this.attachGeneration;
    this.detach();
    this.attachingId = id;
    useMidi.setState({ selectedInputId: id, openError: null });
    if (!id || !this.access) return;
    const input = this.access.inputs.get(id);
    if (!input) return;
    try {
      await input.open();
    } catch (err) {
      if (generation !== this.attachGeneration) return;
      this.attachingId = null;
      useMidi.setState({
        openError: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      return;
    }
    // open() 期间可能已经开始了新的 attach（用户切换设备、端口重新连接）
    if (generation !== this.attachGeneration) return;
    input.onmidimessage = (ev) => this.dispatch(input, ev);
    this.attached = input;
    useMidi.setState({ inputs: Array.from(this.access.inputs.values()).map(portInfo) });
  }

  private dispatch(input: MIDIInput, ev: MIDIMessageEvent) {
    const recv = performance.now();
    if (!ev.data) return;
    const data = Array.from(ev.data);
    if (this.rawListeners.size > 0) {
      const raw: RawMidiMessage = {
        t: ev.timeStamp,
        recv,
        portId: input.id,
        portName: input.name ?? '',
        data,
      };
      for (const cb of this.rawListeners) cb(raw);
    }
    const parsed = parseMidiMessage(data, ev.timeStamp, `webmidi:${input.id}`);
    if (parsed) for (const cb of this.eventListeners) cb(parsed);
  }
}

export const webMidi = new WebMidiService();

/** InputSource 适配器：所选 Web MIDI 输入端口。 */
export const webMidiInputSource: InputSource = {
  id: 'webmidi',
  label: 'Web MIDI',
  start: () => webMidi.request(),
  stop: () => {},
  subscribe: (listener) => webMidi.onEvent(listener),
};
