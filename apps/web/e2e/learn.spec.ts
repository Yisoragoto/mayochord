import { expect, type Page, test } from '@playwright/test';
import { installFakeMidi, sendMidi } from './fake-midi';

const NOTE_PC: Record<string, number> = {
  c: 0,
  cs: 1,
  d: 2,
  eb: 3,
  e: 4,
  f: 5,
  fs: 6,
  g: 7,
  ab: 8,
  a: 9,
  bb: 10,
  b: 11,
};

test.beforeEach(async ({ page }) => {
  await installFakeMidi(page);
});

const cue = (page: Page) => page.getByTestId('practice-cue');

/** 按题面弹出音名题的答案（中央 C 那个八度） */
async function answerNote(page: Page) {
  const cardId = (await cue(page).getAttribute('data-card-id')) as string;
  const note = 60 + (NOTE_PC[cardId.replace('note:', '')] as number);
  await sendMidi(page, [0x90, note, 90]);
  await expect(cue(page)).toHaveAttribute('data-trial-status', 'done');
  await sendMidi(page, [0x80, note, 0]);
}

test('今天 → 第一节课：讲解、引导、独立练习、掌握检查，通过后解锁下一个主题', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('');
  await expect(page.getByRole('heading', { name: '今天的任务' })).toBeVisible();
  const task = page.getByTestId('task').first();
  await expect(task).toContainText('新课 · 认识键盘与音名');
  await task.getByRole('link', { name: '开始' }).click();

  // 讲解与示范（专注模式：没有导航）
  await expect(page.getByRole('heading', { name: '认识键盘与音名' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '开始引导练习' }).click();
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await page.getByRole('button', { name: '连接 MIDI 设备' }).click();

  // 按得太短（判定前就松开）：不算作答，提示按住一下
  await expect(cue(page)).toHaveAttribute('data-trial-status', 'awaiting');
  await sendMidi(page, [0x90, 61, 90]);
  await sendMidi(page, [0x80, 61, 0]);
  await expect(page.getByTestId('short-tap')).toBeVisible();
  await expect(cue(page)).toHaveAttribute('data-trial-status', 'awaiting');

  // 引导练习 6 题：每题都显示键位
  for (let i = 0; i < 6; i++) {
    await expect(cue(page)).toHaveAttribute('data-trial-status', 'awaiting');
    await expect(page.getByText('照着键位弹一遍')).toBeVisible();
    await answerNote(page);
  }
  // 独立练习：首次答对 12 题
  await expect(page.getByText('独立练习', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始', exact: true }).click();
  for (let i = 0; i < 12; i++) {
    await expect(cue(page)).toHaveAttribute('data-trial-status', 'awaiting');
    await answerNote(page);
  }
  // 掌握检查：12 题，不能看提示
  await expect(page.getByText('掌握检查', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await expect(page.getByRole('button', { name: '提示' })).toHaveCount(0);
  for (let i = 0; i < 12; i++) {
    await expect(cue(page)).toHaveAttribute('data-trial-status', 'awaiting');
    await answerNote(page);
  }
  await expect(page.getByTestId('lesson-result')).toHaveText('掌握了：认识键盘与音名');

  // 回到今天：任务完成，可以继续学解锁的主题
  await page.getByRole('link', { name: '回到今天' }).click();
  await expect(page.getByText('今天的任务都完成了')).toBeVisible();
  await expect(page.getByTestId('task').first()).toHaveAttribute('data-task-status', 'done');
  await expect(page.getByRole('link', { name: '半音与全音' })).toBeVisible();

  // 图谱：已掌握、可学习、未解锁
  await page.goto('graph');
  await expect(page.getByRole('button', { name: '认识键盘与音名，已掌握' })).toBeVisible();
  await expect(page.getByRole('button', { name: '半音与全音，可学习' })).toBeVisible();
  await expect(page.getByRole('button', { name: '大三度与小三度，未解锁' })).toBeVisible();
});

test('图谱：点击节点看详情；未解锁的主题提示先修', async ({ page }) => {
  await page.goto('graph');
  await expect(page.getByRole('heading', { name: '知识图谱', level: 1 })).toBeVisible();
  const node = page.getByRole('button', { name: '丸サ進行，未解锁' });
  await node.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: '丸サ進行' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('先学会：II – V – I');
  await panel.getByRole('button', { name: 'II – V – I' }).click();
  const next = page.getByRole('complementary', { name: 'II – V – I' });
  await expect(next).toBeVisible();
  await next.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('complementary')).toHaveCount(0);

  await page.getByRole('button', { name: '认识键盘与音名，可学习' }).click();
  await page.getByRole('link', { name: '开始课程' }).click();
  await expect(page).toHaveURL(/learn\/keyboard-names/);
});
