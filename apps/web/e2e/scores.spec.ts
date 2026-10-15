import { expect, type Page, test } from '@playwright/test';
import { installFakeMidi, sendMidi } from './fake-midi';

test.beforeEach(async ({ page }) => {
  await installFakeMidi(page);
});

async function tap(page: Page, ...notes: number[]) {
  for (const n of notes) await sendMidi(page, [0x90, n, 90], [0x80, n, 0]);
}

/** 最小的 MIDI 文件：一条轨道，C4 E4 G4 各一拍 */
function tinyMidi(): Buffer {
  const vlq = (n: number) => (n < 128 ? [n] : [0x80 | (n >> 7), n & 0x7f]);
  const events = [60, 64, 67].flatMap((p) => [...vlq(0), 0x90, p, 80, ...vlq(480), 0x80, p, 0]);
  const body = [...events, 0, 0xff, 0x2f, 0];
  const len = [0, 0, (body.length >> 8) & 255, body.length & 255];
  return Buffer.from([
    ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0],
    ...[0x4d, 0x54, 0x72, 0x6b, ...len, ...body],
  ]);
}

test('曲谱跟弹：添加示例，等待模式弹两个小节，看每个小节的结果', async ({ page }) => {
  await page.goto('scores');
  await expect(page.getByRole('heading', { name: '曲谱跟弹' })).toBeVisible();
  await page.getByRole('button', { name: '添加示例：欢乐颂' }).click();
  await expect(page).toHaveURL(/scores\/[\w-]+$/);
  // 专注模式；五线谱画出来了
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.locator('.mc-score .vf-stavenote').first()).toBeVisible();

  await page.getByRole('radio', { name: '右手' }).click();
  await page.getByLabel('到', { exact: true }).selectOption({ value: '1' });
  const connect = page.getByRole('button', { name: '连接 MIDI 设备' });
  await connect.click();
  await expect(connect).toBeHidden();
  await page.getByTestId('score-start').click();
  await expect(page.getByTestId('play-status')).toHaveText('第 1 小节');

  // 第 1 小节 E E F G：第二个 E 之前按错一个音
  await tap(page, 64, 61, 64, 65, 67);
  await expect(page.getByTestId('play-status')).toHaveText('第 2 小节');
  await expect(page.locator('.mc-score .mc-bad')).toHaveCount(1);
  // 第 2 小节 G F E D
  await tap(page, 67, 65, 64, 62);

  const summary = page.getByTestId('score-summary');
  await expect(summary).toBeVisible();
  await expect(summary.getByText('88%')).toBeVisible();
  await expect(summary.getByRole('button', { name: '第 1 小节：1 处错误，共 4' })).toBeVisible();
  await expect(summary.getByRole('button', { name: '第 2 小节：0 处错误，共 4' })).toBeVisible();

  // 点一个小节：只循环练这个小节
  await summary.getByRole('button', { name: '第 1 小节：1 处错误，共 4' }).click();
  await expect(page.getByTestId('score-setup')).toBeVisible();
  await expect(page.getByLabel('从', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('到', { exact: true })).toHaveValue('0');
  await expect(page.getByRole('radio', { name: '一直弹' })).toHaveAttribute('data-state', 'on');

  // 回到乐谱库：可以删除
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/scores$/);
  await expect(page.getByTestId('score-row')).toHaveCount(1);
  await page.getByRole('button', { name: '删除《欢乐颂（示例）》' }).click();
  await page.getByRole('button', { name: '确定删除' }).click();
  await expect(page.getByTestId('score-row')).toHaveCount(0);
});

test('跟拍模式：预备一小节后按拍点弹，记录早晚', async ({ page }) => {
  await page.goto('scores');
  await page.getByRole('button', { name: '添加示例：欢乐颂' }).click();
  await page.getByRole('radio', { name: '跟拍' }).click();
  await page.getByRole('radio', { name: '右手' }).click();
  await page.getByRole('radio', { name: '静音' }).click();
  const connect = page.getByRole('button', { name: '连接 MIDI 设备' });
  await connect.click();
  await expect(connect).toBeHidden();
  await page.getByTestId('score-start').click();

  // 第 1 小节 E E F G，每拍一个音（♩ = 96）。在页面里按 performance.now() 等到拍点再发送
  await page.evaluate(
    async (notes) => {
      const send = (window as unknown as { __fakeMidiSend: (b: number[]) => void }).__fakeMidiSend;
      let el: Element | null = null;
      while (!el?.getAttribute('data-start-t')) {
        el = document.querySelector('[data-testid="play-status"]');
        await new Promise((r) => requestAnimationFrame(r));
      }
      const startT = Number(el.getAttribute('data-start-t'));
      const beatMs = Number(el.getAttribute('data-ms-per-tick')) * 960;
      for (const [i, n] of notes.entries()) {
        const t = startT + i * beatMs + 10;
        await new Promise((r) => setTimeout(r, Math.max(0, t - performance.now() - 4)));
        while (performance.now() < t) {
          /* 忙等到拍点 */
        }
        send([0x90, n, 90]);
        send([0x80, n, 0]);
      }
    },
    [64, 64, 65, 67],
  );
  await page.keyboard.press('Escape');

  const summary = page.getByTestId('score-summary');
  await expect(summary).toBeVisible();
  await expect(summary.getByText('弹到 100%')).toBeVisible();
  await expect(summary.getByText('在拍上 100%')).toBeVisible();
  await expect(summary.getByText('漏弹 0')).toBeVisible();
});

test('导入 MIDI 文件；不认识的文件给出提示', async ({ page }) => {
  await page.goto('scores');
  await page.getByTestId('score-file').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await expect(page.getByRole('alert')).toContainText('不认识的文件格式');

  await page.getByTestId('score-file').setInputFiles({
    name: 'Tiny Song.mid',
    mimeType: 'audio/midi',
    buffer: tinyMidi(),
  });
  await expect(page).toHaveURL(/scores\/[\w-]+$/);
  await expect(page.getByRole('heading', { name: 'Tiny Song' })).toBeVisible();
  await expect(page.getByText('MIDI 文件按 16 分音符对齐')).toBeVisible();
  await page.getByRole('radio', { name: '瀑布流' }).click();
  await expect(page.getByTestId('waterfall-view')).toBeVisible();
});
