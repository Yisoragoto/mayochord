import type { Page } from '@playwright/test';

/**
 * 在页面加载前注入一个假的 navigator.requestMIDIAccess，走真实的 Web MIDI 适配器代码路径。
 * 测试里用 sendMidi(page, [0x90, 60, 100]) 模拟琴发出的消息。
 */
export async function installFakeMidi(page: Page, portName = 'Fake JUNO-D7') {
  await page.addInitScript((name: string) => {
    type Listener = ((ev: { data: Uint8Array; timeStamp: number }) => void) | null;
    const input = {
      id: 'fake-input-1',
      name,
      manufacturer: 'MayoChord Test',
      type: 'input',
      state: 'connected',
      connection: 'closed',
      onmidimessage: null as Listener,
      onstatechange: null,
      open() {
        this.connection = 'open';
        return Promise.resolve(this);
      },
      close() {
        this.connection = 'closed';
        return Promise.resolve(this);
      },
    };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map(),
      sysexEnabled: false,
      onstatechange: null,
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: () => Promise.resolve(access),
    });
    (window as unknown as { __fakeMidiSend: (bytes: number[]) => void }).__fakeMidiSend = (
      bytes,
    ) => {
      input.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp: performance.now() });
    };
  }, portName);
}

export async function sendMidi(page: Page, ...messages: number[][]) {
  await page.evaluate((msgs) => {
    const send = (window as unknown as { __fakeMidiSend: (bytes: number[]) => void })
      .__fakeMidiSend;
    for (const m of msgs) send(m);
  }, messages);
}
