import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { installFakeMidi, sendMidi } from './fake-midi';

/**
 * README 用的截图（docs/screenshots/）。平时跳过；需要更新截图时运行：
 *   MAYOCHORD_SCREENSHOTS=../../docs/screenshots pnpm --filter @mayochord/web exec playwright test screenshots
 */
const OUT = process.env.MAYOCHORD_SCREENSHOTS;
const SAMPLE = fileURLToPath(new URL('./fixtures/sample-backup.json', import.meta.url));

test.skip(!OUT, '只在生成截图时运行');
test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });

test('README 截图', async ({ page }) => {
  test.setTimeout(120_000);
  await installFakeMidi(page);
  const shot = async (name: string) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };

  await page.goto('settings#data');
  await page.getByTestId('import-file').setInputFiles(SAMPLE);
  await page.getByRole('button', { name: '替换并导入' }).click();
  await expect(page.getByTestId('log-count')).toHaveText('360', { timeout: 10_000 });

  await page.goto('');
  await expect(page.getByRole('heading', { name: '今天的任务' })).toBeVisible();
  await shot('today');

  await page.goto('graph');
  await expect(page.getByRole('heading', { name: '知识图谱', level: 1 })).toBeVisible();
  await shot('graph');

  await page.goto('chords/am7');
  await expect(page.getByRole('heading', { name: /Am7/ })).toBeVisible();
  await shot('chord');

  await page.goto('practice/session?groupId=marusa&drill=name-to-chord&mode=any&length=10');
  await expect(page.getByTestId('practice-cue')).toBeVisible();
  await shot('practice');

  await page.goto('practice/progression');
  await page.getByRole('radio', { name: '丸サ進行' }).check({ force: true });
  await page.getByRole('link', { name: '开始' }).click();
  await expect(page.getByTestId('run-step')).toBeVisible({ timeout: 15_000 });
  await shot('progression');
  await page.keyboard.press('Escape');

  await page.goto('scores');
  await page.getByRole('button', { name: '添加示例：欢乐颂' }).click();
  await page.getByRole('radio', { name: '右手' }).click();
  await page.getByRole('button', { name: '连接 MIDI 设备' }).click();
  await page.getByTestId('score-start').click();
  await expect(page.getByTestId('play-status')).toHaveText('第 1 小节');
  for (const n of [64, 64, 65, 67, 67, 66, 65]) {
    await sendMidi(page, [0x90, n, 90], [0x80, n, 0]);
    await page.waitForTimeout(120);
  }
  await shot('scores');
  await page.keyboard.press('Escape');

  await page.goto('stats');
  await expect(page.locator('[role="img"] svg path').first()).toBeAttached();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/stats.png`, fullPage: false });
});
