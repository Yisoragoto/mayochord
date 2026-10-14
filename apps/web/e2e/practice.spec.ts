import { expect, type Page, test } from '@playwright/test';
import { installFakeMidi, sendMidi } from './fake-midi';

// 第 11 节参考键位（MIDI 号）
const REF: Record<string, number[]> = {
  c: [48, 60, 64, 67],
  g: [55, 59, 62, 67],
  am: [57, 60, 64, 69],
  f: [53, 60, 65, 69],
  em: [52, 64, 67, 71],
};

test.beforeEach(async ({ page }) => {
  await installFakeMidi(page);
});

async function connect(page: Page) {
  const button = page.getByRole('button', { name: '连接 MIDI 设备' });
  await button.click();
  await expect(button).toBeHidden();
}

const cue = (page: Page) => page.getByTestId('practice-cue');

async function play(page: Page, notes: number[]) {
  await sendMidi(page, ...notes.map((n) => [0x90, n, 90]));
}
async function release(page: Page, notes: number[]) {
  await sendMidi(page, ...notes.map((n) => [0x80, n, 0]));
}

test('看名弹和弦：用 MIDI 完整练一轮，全部答对', async ({ page }) => {
  await page.goto('practice');
  await page.getByText('王道进行（C 调）').click();
  await expect(page.getByRole('radio', { name: '王道进行（C 调）' })).toBeChecked();
  await page.getByRole('radio', { name: '10 题' }).click();
  await page.getByRole('link', { name: '开始练习' }).click();
  await expect(page).toHaveURL(/practice\/session\?/);
  // 专注模式：没有导航栏
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await connect(page);

  for (let i = 1; i <= 10; i++) {
    await expect(page.getByText(`${i}/10`)).toBeVisible();
    await expect(cue(page)).toHaveAttribute('data-trial-status', 'awaiting');
    const id = (await cue(page).getAttribute('data-chord-id')) as string;
    const notes = REF[id] as number[];
    await play(page, notes);
    await expect(cue(page)).toHaveAttribute('data-trial-status', 'done');
    await expect(page.getByRole('status').filter({ hasText: '对了' })).toBeVisible();
    await release(page, notes);
  }

  await expect(page.getByRole('heading', { name: '这一轮结束了' })).toBeVisible();
  await expect(page.getByTestId('summary-accuracy')).toHaveText('100%');
  await expect(page.getByText('共 10 题')).toBeVisible();

  // 回到入口：这一组的卡片已经有学习进度
  await page.getByRole('link', { name: '换一组' }).click();
  await expect(page.getByRole('radio', { name: '王道进行（C 调）' })).toBeVisible();
  await expect(page.getByText(/新 [0-3]/).nth(1)).toBeVisible();
});

test('答错：显示多按/少按与键位提示，弹对后才进入下一题', async ({ page }) => {
  await page.goto('practice/session?groupId=c-g-am-f&drill=name-to-chord&mode=any&length=3');
  await connect(page);
  await expect(cue(page)).toHaveAttribute('data-chord-id', 'c');
  // C 弹成 Cm
  await play(page, [48, 60, 63, 67]);
  await expect(cue(page)).toHaveAttribute('data-trial-status', 'retry');
  const status = page.getByRole('status').filter({ hasText: '少按了' });
  await expect(status).toContainText('少按了 E4');
  await expect(status).toContainText('多按了 E♭4');
  await expect(status).toContainText('照着提示弹一遍再继续');
  await release(page, [48, 60, 63, 67]);
  await play(page, REF.c as number[]);
  await expect(cue(page)).toHaveAttribute('data-trial-status', 'done');
  await release(page, REF.c as number[]);
  await expect(page.getByText('2/3')).toBeVisible();
  // 提前结束
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '这一轮结束了' })).toBeVisible();
  await expect(page.getByTestId('summary-accuracy')).toHaveText('0%');
});

test('和弦切换：先弹"从"和弦，弹稳后计时', async ({ page }) => {
  await page.goto('practice/session?groupId=c-g-am-f&drill=transition&mode=any&length=2');
  await connect(page);
  await expect(cue(page)).toHaveAttribute('data-from-chord-id', 'c');
  await expect(cue(page)).toHaveAttribute('data-trial-status', 'setup');
  await play(page, REF.c as number[]);
  await expect(cue(page)).toHaveAttribute('data-trial-status', 'awaiting');
  await release(page, REF.c as number[]);
  await play(page, REF.g as number[]);
  // 弹对后约 0.65 秒进入下一题；负载高时可能来不及看到 done，所以看题号
  await expect(page.getByText('2/2')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('最慢的切换')).toBeVisible();
});
