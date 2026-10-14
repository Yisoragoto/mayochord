import { expect, test } from '@playwright/test';
import { installFakeMidi, sendMidi } from './fake-midi';

test.beforeEach(async ({ page }) => {
  await installFakeMidi(page);
});

test('和弦库：列出第 11 节的和弦，进入详情页', async ({ page }) => {
  await page.goto('chords');
  await expect(page.getByRole('heading', { name: '和弦库', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看 Am7' })).toBeVisible();
  await expect(page.getByText('待确认')).toHaveCount(0);
  await page.getByRole('link', { name: '查看 Gm7' }).click();
  await expect(page).toHaveURL(/chords\/gm7$/);
  await expect(page.getByText('G · B♭ · D · F')).toBeVisible();
  await expect(page.getByRole('img', { name: '五线谱：左手 G3，右手 F4 B♭4 D5' })).toBeVisible();
});

test('试弹：MIDI 弹对、弹错、整体高一个八度', async ({ page }) => {
  await page.goto('chords/am7');
  await page.getByRole('button', { name: '连接 MIDI 设备' }).click();
  await expect(page.getByRole('button', { name: '连接 MIDI 设备' })).toBeHidden();
  const status = page.getByRole('status').filter({ hasText: /等你弹|对了|少按|多按|整体/ });

  // Am7 参考键位 A3 + G4 C5 E5，20ms 内按下
  await sendMidi(page, [0x90, 57, 80], [0x90, 67, 80], [0x90, 72, 80], [0x90, 76, 80]);
  await expect(status).toContainText('对了');
  await sendMidi(page, [0x80, 57, 0], [0x80, 67, 0], [0x80, 72, 0], [0x80, 76, 0]);

  // 把 C5 按成 C♯5
  await sendMidi(page, [0x90, 57, 80], [0x90, 67, 80], [0x90, 73, 80], [0x90, 76, 80]);
  await expect(status).toContainText('少按了 C5');
  await expect(status).toContainText('多按了 D♭5');
  await sendMidi(page, [0x80, 57, 0], [0x80, 67, 0], [0x80, 73, 0], [0x80, 76, 0]);

  // 严格模式下整体高一个八度：提示可能按过 OCTAVE
  await page.getByRole('radio', { name: '严格：参考键位' }).click();
  await sendMidi(page, [0x90, 69, 80], [0x90, 79, 80], [0x90, 84, 80], [0x90, 88, 80]);
  await expect(status).toContainText('整体高了 1 个八度');
});

test('八度校准：按中央 C 得到 72，之后输入整体减 12', async ({ page }) => {
  await page.goto('settings');
  await page.getByRole('button', { name: '连接 MIDI 设备' }).click();
  await expect(page.getByText('当前设备：Fake JUNO-D7')).toBeVisible();
  await page.getByRole('button', { name: '校准中央 C' }).click();
  await expect(page.getByText('请按一下琴上的中央 C')).toBeVisible();
  await sendMidi(page, [0x90, 72, 80], [0x80, 72, 0]);
  await expect(page.getByText('+12 个半音')).toBeVisible();

  // 校准后，物理中央 C（发出 72）在试弹里按 C4 计算：C 和弦 C3 C4 E4 G4 全部高一个八度发送
  await page.goto('chords/c');
  await page.getByRole('button', { name: '连接 MIDI 设备' }).click();
  await expect(page.getByRole('button', { name: '连接 MIDI 设备' })).toBeHidden();
  await sendMidi(page, [0x90, 60, 80], [0x90, 72, 80], [0x90, 76, 80], [0x90, 79, 80]);
  await expect(page.getByRole('status').filter({ hasText: '对了' })).toBeVisible();
});

test('屏幕键盘：点击切换模式下按出和弦', async ({ page }) => {
  await page.goto('settings');
  await page.getByRole('radio', { name: '点击切换' }).click();
  await page.goto('chords/c');
  const kb = page.getByRole('group', { name: /键盘/ });
  for (const name of ['C3', 'C4', 'E4', 'G4']) {
    await kb.getByRole('button', { name, exact: true }).click();
  }
  const status = page.getByRole('status').filter({ hasText: /对了|少按|多按/ });
  await expect(status).toContainText('对了');
  await expect(status).toContainText('屏幕键盘、电脑键盘不计齐整度');
});
