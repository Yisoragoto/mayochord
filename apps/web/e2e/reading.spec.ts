import { expect, type Page, test } from '@playwright/test';
import { installFakeMidi, sendMidi } from './fake-midi';

test.beforeEach(async ({ page }) => {
  await installFakeMidi(page);
});

const PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** 'staffnote:treble:fs4@g' → 66 */
function staffNoteMidi(cardId: string): number {
  const m = /^staffnote:(?:treble|bass):([a-g])(s|b)?(-?\d)/.exec(cardId);
  if (!m) throw new Error(cardId);
  const alter = m[2] === 's' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + (PC[m[1] as string] as number) + alter;
}

async function skipToCheck(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole('button', { name: '我已经会了，直接检查' }).click();
  await page.getByRole('button', { name: '开始', exact: true }).click();
}

test('看谱认音：谱表上的音弹对八度才算对；通过掌握检查', async ({ page }) => {
  test.setTimeout(60_000);
  await skipToCheck(page, 'learn/treble-notes');
  await page.getByRole('button', { name: '连接 MIDI 设备' }).click();
  const cue = page.getByTestId('practice-cue');
  await expect(cue.getByRole('img', { name: '谱表上的一个音' })).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await expect(cue).toHaveAttribute('data-trial-status', 'awaiting');
    const id = (await cue.getAttribute('data-card-id')) as string;
    const note = staffNoteMidi(id);
    await sendMidi(page, [0x90, note, 90]);
    await expect(cue).not.toHaveAttribute('data-trial-status', 'awaiting');
    await sendMidi(page, [0x80, note, 0]);
  }
  await expect(page.getByTestId('lesson-result')).toHaveText('掌握了：高音谱表认音');
});

test('看谱认音：弹错八度判错', async ({ page }) => {
  await skipToCheck(page, 'learn/treble-notes');
  await page.getByRole('button', { name: '连接 MIDI 设备' }).click();
  const cue = page.getByTestId('practice-cue');
  await expect(cue).toHaveAttribute('data-trial-status', 'awaiting');
  const note = staffNoteMidi((await cue.getAttribute('data-card-id')) as string);
  await sendMidi(page, [0x90, note + 12, 90]);
  // 掌握检查里弹错：直接判错（不是"OCTAVE/TRANSPOSE 可能被改动"的提示）
  await expect(page.getByRole('status').filter({ hasText: '不对' })).toBeVisible();
  await expect(page.getByText(/OCTAVE/)).toHaveCount(0);
});

/**
 * 等到这一张节奏卡开始（data-start-t 出现），在每个起点（扣掉 offset）上按一下键。
 * 全部在页面里计时，避免测试进程轮询带来的延迟。
 */
async function tapRhythm(page: Page, index: number) {
  await page.evaluate(async (index) => {
    const send = (window as unknown as { __fakeMidiSend: (b: number[]) => void }).__fakeMidiSend;
    let el: Element | null = null;
    for (;;) {
      el = document.querySelector('[data-testid="rhythm-card"][data-start-t]');
      const progress = document.querySelector('[role="progressbar"]');
      if (el && progress && Number(progress.getAttribute('aria-valuenow')) === index) break;
      await new Promise((r) => requestAnimationFrame(r));
    }
    const startT = Number(el.getAttribute('data-start-t'));
    const beatMs = Number(el.getAttribute('data-beat-ms'));
    const onsets = (el.getAttribute('data-onsets') ?? '').split(' ').map(Number);
    for (const tick of onsets) {
      const t = startT + (tick / 960) * beatMs;
      await new Promise((r) => setTimeout(r, Math.max(0, t - performance.now() - 4)));
      while (performance.now() < t) {
        /* 忙等到起点 */
      }
      send([0x90, 60, 90]);
      setTimeout(() => send([0x80, 60, 0]), 60);
    }
  }, index);
}

test('节奏读谱：预备一小节后按出每个音的起点；通过掌握检查', async ({ page }) => {
  test.setTimeout(120_000);
  await skipToCheck(page, 'learn/note-values');
  await page.getByRole('button', { name: '连接 MIDI 设备' }).click();
  const card = page.getByTestId('rhythm-card');
  await expect(card).toBeVisible();
  for (let i = 1; i <= 6; i++) {
    await tapRhythm(page, i);
    await expect(page.getByTestId('rhythm-status')).toContainText('全部在拍上', {
      timeout: 10_000,
    });
  }
  await expect(page.getByTestId('lesson-result')).toHaveText('掌握了：音符时值与休止符', {
    timeout: 15_000,
  });
});
