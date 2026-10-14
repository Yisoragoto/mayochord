import { expect, type Page, test } from '@playwright/test';
import { installFakeMidi } from './fake-midi';

test.beforeEach(async ({ page }) => {
  await installFakeMidi(page);
});

const C = [48, 60, 64, 67];
const G = [55, 59, 62, 67];
const AM = [57, 60, 64, 69];
const F = [53, 60, 65, 69];
const SEQ = [C, G, AM, F];

/**
 * 等界面进入第 k 步，再在这一步的拍点（data-step-t，performance.now() 域）上
 * 松开上一个和弦、按下 notes。全部在页面里等待和计时，避免测试进程轮询带来的延迟。
 */
async function playOnBeat(page: Page, k: number, prev: number[], notes: number[]) {
  await page.evaluate(
    async ({ k, prev, notes }) => {
      const send = (window as unknown as { __fakeMidiSend: (b: number[]) => void }).__fakeMidiSend;
      let el: Element | null = null;
      while (!el) {
        el = document.querySelector(`[data-testid="run-step"][data-k="${k}"]`);
        if (!el) await new Promise((r) => requestAnimationFrame(r));
      }
      const t = Number(el.getAttribute('data-step-t'));
      await new Promise((r) => setTimeout(r, Math.max(0, t - performance.now() - 4)));
      while (performance.now() < t) {
        /* 忙等到拍点 */
      }
      for (const n of prev) send([0x80, n, 0]);
      for (const n of notes) send([0x90, n, 90]);
    },
    { k, prev, notes },
  );
}

test('跟拍弹进行：预备拍后按拍点弹，记下对错和节拍偏差，结束后显示总结', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('practice/progression');
  await expect(page.getByRole('heading', { name: '跟拍弹进行', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '连接 MIDI 设备' }).click();
  await page.getByRole('radio', { name: 'C – G – Am – F', exact: true }).check();
  await page.getByRole('radio', { name: '1 拍' }).click();
  await page.getByRole('radio', { name: '2 遍' }).click();
  // 声部进行预览
  await expect(page.getByRole('img', { name: /^声部进行：/ }).first()).toBeVisible();
  await page.getByRole('link', { name: '开始' }).click();

  // 预备拍
  await expect(page.getByTestId('count-in')).toBeVisible();
  let prev: number[] = [];
  for (let k = 0; k < 8; k++) {
    // 第 7 个和弦（Am）故意弹错：E 换成 E♭
    const notes = k === 6 ? [57, 60, 63, 69] : (SEQ[k % 4] as number[]);
    await playOnBeat(page, k, prev, notes);
    prev = notes;
    if (k === 1) {
      await expect(page.getByTestId('step-chip')).toContainText('在拍上');
    }
  }

  await expect(page.getByRole('heading', { name: '这一遍的结果' })).toBeVisible({
    timeout: 10_000,
  });
  // 8 个和弦里 7 个干净
  await expect(page.getByTestId('run-clean-rate')).toHaveText('88%');
  await expect(page.getByText('弹了 8 个和弦 · ♩ = 72')).toBeVisible();
  await expect(page.getByText('各个切换')).toBeVisible();
});

test('设置：延迟校准面板', async ({ page }) => {
  await page.goto('settings');
  await expect(page.getByRole('heading', { name: '延迟校准' })).toBeVisible();
  await expect(page.getByTestId('latency-value')).toHaveText('未校准');
  await expect(page.getByRole('button', { name: '开始校准' })).toBeVisible();
});
