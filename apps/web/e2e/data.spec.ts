import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const SAMPLE = fileURLToPath(new URL('./fixtures/sample-backup.json', import.meta.url));
const SHOTS = process.env.MAYOCHORD_SHOTS;

test('导入备份 → 统计页显示图表 → 导出备份与 CSV', async ({ page }) => {
  await page.goto('settings#data');
  await expect(page.getByTestId('log-count')).toHaveText('0');
  await page.getByTestId('import-file').setInputFiles(SAMPLE);
  const dialog = page.getByRole('alertdialog', { name: '确认导入' });
  await expect(dialog).toContainText('360 条作答记录');
  await dialog.getByRole('button', { name: '替换并导入' }).click();
  await expect(page.getByText('已导入，正在重新加载')).toBeVisible();
  // 重新加载后
  await expect(page.getByTestId('log-count')).toHaveText('360', { timeout: 10_000 });

  // 不是备份文件
  await page.getByTestId('import-file').setInputFiles({
    name: 'x.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"kind":"midi-monitor-capture"}'),
  });
  await expect(page.getByText('这不是 MayoChord 的备份文件。')).toBeVisible();

  // 导出
  const [json] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出备份（JSON）' }).click(),
  ]);
  expect(json.suggestedFilename()).toMatch(/^mayochord-backup-.*\.json$/);
  const exported = JSON.parse(readFileSync(await json.path(), 'utf-8'));
  expect(exported.tables.reviewLogs).toHaveLength(360);
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出作答日志（CSV）' }).click(),
  ]);
  expect(readFileSync(await csv.path(), 'utf-8').split('\r\n')).toHaveLength(362);

  await page.goto('stats');
  await expect(page.getByRole('heading', { name: '统计', level: 1 })).toBeVisible();
  await expect(page.getByText('360', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', { name: /^反应时间折线图：(?=.*C)(?=.*G)(?=.*Am)(?=.*F)/ }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: /^切换热力图，共 4 个切换/ })).toBeVisible();
  await expect(page.getByText(/共 80 个和弦，标准差/)).toBeVisible();
  // 图表画出来了（SVG 渲染）
  await expect.poll(() => page.locator('[role="img"] svg path').count()).toBeGreaterThan(30);
  if (SHOTS) {
    await page.waitForTimeout(800);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((th) => {
        document.documentElement.dataset.theme = th;
      }, theme);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/stats-${theme}.png`, fullPage: true });
    }
  }
});

test('界面语言：切换到英文后界面和课程内容都是英文，刷新后保持', async ({ page }) => {
  await page.goto('settings');
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.goto('');
  await expect(page.getByRole('heading', { name: "Today's tasks" })).toBeVisible();
  await expect(page.getByTestId('task').first()).toContainText('New lesson · Keys and note names');
  await page.goto('learn/thirds');
  await expect(page.getByTestId('explain-text')).toContainText('A major third is 4 semitones');
  await page.goto('settings');
  await page.getByRole('radio', { name: '中文' }).click();
  await expect(page.getByRole('heading', { name: '设置', level: 1 })).toBeVisible();
});
