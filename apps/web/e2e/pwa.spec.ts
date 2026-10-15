import { expect, test } from '@playwright/test';

test('PWA：有清单；Service Worker 缓存后离线也能打开', async ({ page, context }) => {
  await page.goto('');
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
    return href ? (await fetch(href)).json() : null;
  });
  expect(manifest).toMatchObject({ name: 'MayoChord', display: 'standalone' });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toContain('512x512');

  // 等 Service Worker 接管并完成预缓存
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.state;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '今天的任务' })).toBeVisible();

  await context.setOffline(true);
  await page.goto('chords');
  await expect(page.getByRole('heading', { name: '和弦库' })).toBeVisible();
  await page.goto('stats');
  await expect(page.getByRole('heading', { name: '统计', level: 1 })).toBeVisible();
  await context.setOffline(false);
});
