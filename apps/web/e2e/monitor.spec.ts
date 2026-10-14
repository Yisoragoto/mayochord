import { expect, test } from '@playwright/test';
import { installFakeMidi, sendMidi } from './fake-midi';

test.beforeEach(async ({ page }) => {
  await installFakeMidi(page);
});

test('MIDI 监视页：连接设备、识别和弦、统计实测摘要', async ({ page }) => {
  await page.goto('monitor');
  await page.getByRole('button', { name: '连接 MIDI 设备' }).click();

  // 自动选中名称包含 JUNO 的设备
  await expect(page.getByRole('combobox', { name: '输入设备' })).toHaveText('Fake JUNO-D7');

  // Am7 参考键位：A3 + G4 C5 E5
  await sendMidi(page, [0x90, 57, 70], [0x90, 67, 80], [0x90, 72, 90], [0x90, 76, 100]);
  const chordRegion = page.getByRole('region', { name: '识别的和弦' });
  await expect(chordRegion.getByRole('img', { name: 'Am7', exact: true })).toBeVisible();

  // 松开（note on velocity 0 与 note off 两种形式）
  await sendMidi(page, [0x90, 57, 0], [0x80, 67, 0], [0x80, 72, 0], [0x80, 76, 0]);
  await expect(chordRegion.getByText('按下琴键试试')).toBeVisible();

  // 踏板：开启“踩踏板时松开的音仍算按住”后，C 和弦在松手后仍被识别
  await page.getByRole('switch', { name: '踩踏板时松开的音仍算“按住”' }).click();
  await sendMidi(page, [0xb0, 64, 127], [0x90, 60, 64], [0x90, 64, 64], [0x90, 67, 64]);
  await sendMidi(page, [0x80, 60, 0], [0x80, 64, 0], [0x80, 67, 0]);
  await expect(chordRegion.getByRole('img', { name: 'C', exact: true })).toBeVisible();
  await sendMidi(page, [0xb0, 64, 0]);
  await expect(chordRegion.getByText('按下琴键试试')).toBeVisible();

  const summary = page.getByRole('region', { name: '实测摘要' });
  await expect(summary).toContainText('A3 (57) – E5 (76)');
  await expect(summary).toContainText('8n: 6 · 9n v0: 1');
  await expect(summary).toContainText('0, 127');
});

test('不支持 Web MIDI 时给出提示', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('monitor');
  await expect(page.getByText('这个浏览器不支持 Web MIDI')).toBeVisible();
  await context.close();
});
