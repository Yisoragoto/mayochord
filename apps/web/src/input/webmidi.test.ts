import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 模拟 Chrome 的行为：每次调用 requestMIDIAccess 都返回新的 MIDIAccess 和新的端口对象，
 * 但它们都对应同一台物理设备——设备发出的每条消息会送到所有已打开端口对象的 onmidimessage。
 */
function installFakeDevice() {
  type Handler = ((ev: { data: Uint8Array; timeStamp: number }) => void) | null;
  const inputs: { onmidimessage: Handler }[] = [];
  const accesses: { onstatechange: ((ev: unknown) => void) | null }[] = [];

  const makeAccess = () => {
    const input = {
      id: 'input-0',
      name: 'JUNO-D',
      manufacturer: 'Roland Corp.',
      type: 'input' as const,
      state: 'connected' as const,
      connection: 'closed' as 'closed' | 'open',
      onmidimessage: null as Handler,
      async open() {
        await Promise.resolve();
        if (this.connection === 'open') return this;
        this.connection = 'open';
        // Chrome 在端口连接状态变化时派发 statechange
        for (const a of accesses) a.onstatechange?.({});
        return this;
      },
    };
    inputs.push(input);
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map(),
      onstatechange: null,
    };
    accesses.push(access);
    return access;
  };

  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: vi.fn(async () => {
      await Promise.resolve();
      return makeAccess();
    }),
  });

  return {
    send(bytes: number[]) {
      for (const i of inputs) i.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp: 1 });
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('WebMidiService', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'requestMIDIAccess');
  });

  it('并发调用 request()（例如 StrictMode 下 effect 执行两次）时每条消息只分发一次', async () => {
    const device = installFakeDevice();
    const { webMidi } = await import('./webmidi');
    const received: number[][] = [];
    webMidi.onRaw((m) => received.push(m.data));

    await Promise.all([webMidi.request(), webMidi.request()]);
    await flush();
    device.send([0x90, 60, 100]);

    expect(received).toEqual([[0x90, 60, 100]]);
    expect(navigator.requestMIDIAccess).toHaveBeenCalledTimes(1);
  });

  it('自动选中 JUNO 设备，端口打开时的 statechange 不会导致重复挂载', async () => {
    const device = installFakeDevice();
    const { webMidi, useMidi } = await import('./webmidi');
    const { JUNO_D7 } = await import('@mayochord/content');
    webMidi.setPreferredProfiles([JUNO_D7]);
    const received: number[][] = [];
    webMidi.onEvent((e) => received.push([e.t]));

    await webMidi.request();
    await flush();
    expect(useMidi.getState().selectedInputId).toBe('input-0');
    device.send([0x90, 60, 100]);
    device.send([0x80, 60, 0]);
    expect(received).toHaveLength(2);
  });
});
