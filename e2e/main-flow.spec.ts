import { expect, test, type Page } from '@playwright/test';

async function addCard(page: Page, cue: string, actionLabel: string) {
  await page.getByTestId('cue-input').fill(cue);
  await page.getByTestId('action-select').selectOption({ label: actionLabel });
  await page.getByTestId('add-card').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('空编号提交时在页面明确反馈错误', async ({ page }) => {
  await page.getByTestId('add-card').click();
  await expect(page.getByTestId('form-error')).toBeVisible();
  await expect(page.getByTestId('form-error')).toContainText('提示编号不能为空');
  // 修正输入后错误消失，卡片正常录入
  await page.getByTestId('cue-input').fill('灯光-1');
  await page.getByTestId('add-card').click();
  await expect(page.getByTestId('form-error')).toHaveCount(0);
  await expect(page.getByTestId('cue-card')).toHaveCount(1);
});

test('主流程：录入合法序列，拖动打乱后出现首个违规，拖回并删除后恢复合法', async ({
  page,
}) => {
  // 1. 录入一条合法序列：提示 1 与提示 2 各自走完 候场 → 执行 → 完成
  await addCard(page, '1', '候场');
  await addCard(page, '1', '执行');
  await addCard(page, '1', '完成');
  await addCard(page, '2', '候场');
  await addCard(page, '2', '执行');
  await addCard(page, '2', '完成');

  await expect(page.getByTestId('verdict')).toHaveText('序列合法，可照单执行。');
  await expect(page.getByTestId('step-list').locator('li')).toHaveCount(6);
  // 每一步之后都展示各提示的状态
  await expect(page.getByTestId('step-list').locator('li').nth(1)).toContainText(
    '1：执行中',
  );
  await expect(page.getByTestId('step-list').locator('li').nth(5)).toContainText(
    '2：已完成',
  );

  // 2. 把第 3 张卡片（提示 1 · 完成）拖到最后，使提示 2 在提示 1 执行中时就执行
  const cards = page.getByTestId('cue-card');
  await cards.nth(2).dragTo(cards.nth(5));

  // 拖动后顺序变为：1候场 1执行 2候场 2执行 2完成 1完成
  await expect(cards.nth(3)).toContainText('提示「2」');
  await expect(cards.nth(3)).toContainText('执行');
  await expect(cards.nth(5)).toContainText('提示「1」');
  await expect(cards.nth(5)).toContainText('完成');

  // 3. 裁决停止在首个违规卡片（第 4 张），给出唯一原因与违规前状态
  await expect(page.getByTestId('violation')).toBeVisible();
  await expect(page.getByTestId('violation')).toContainText('第 4 张卡片');
  await expect(page.getByTestId('violation-reason')).toContainText(
    '任一时刻最多一个提示处于执行中',
  );
  await expect(page.getByTestId('violation-reason')).toContainText('「1」');
  await expect(page.getByTestId('violation')).toContainText('1：执行中');
  await expect(page.getByTestId('violation')).toContainText('2：候场中');

  // 4. 违规前的步骤保留，其后的旧结果被清除
  await expect(page.getByTestId('step-list').locator('li')).toHaveCount(3);
  await expect(cards.nth(3)).toContainText('违规');
  await expect(cards.nth(4)).toContainText('未裁决');
  await expect(cards.nth(5)).toContainText('未裁决');

  // 5. 把「提示 1 · 完成」拖回第 3 张的位置，从首项重新裁决后恢复合法
  await cards.nth(5).dragTo(cards.nth(2));
  await expect(page.getByTestId('verdict')).toHaveText('序列合法，可照单执行。');
  await expect(page.getByTestId('step-list').locator('li')).toHaveCount(6);

  // 6. 删除末尾的「提示 2 · 完成」，剩余序列依然合法并重新裁决
  await cards.nth(5).getByRole('button', { name: '删除' }).click();
  await expect(page.getByTestId('cue-card')).toHaveCount(5);
  await expect(page.getByTestId('verdict')).toHaveText('序列合法，可照单执行。');
  await expect(page.getByTestId('step-list').locator('li')).toHaveCount(5);
  await expect(page.getByTestId('step-list').locator('li').nth(4)).toContainText(
    '2：执行中',
  );
});

test('取消让提示回到空闲，可重新候场；拖动调整顺序后裁决随之更新', async ({ page }) => {
  await addCard(page, 'A', '候场');
  await addCard(page, 'A', '取消');
  await addCard(page, 'A', '候场');
  await addCard(page, 'A', '执行');
  await addCard(page, 'A', '完成');
  await expect(page.getByTestId('verdict')).toHaveText('序列合法，可照单执行。');
  await expect(page.getByTestId('step-list').locator('li').nth(1)).toContainText(
    'A：空闲',
  );

  // 把「执行」（第 4 张）拖到最前面：空闲提示直接执行即违规
  const cards = page.getByTestId('cue-card');
  await cards.nth(3).dragTo(cards.nth(0));
  await expect(page.getByTestId('violation')).toBeVisible();
  await expect(page.getByTestId('violation')).toContainText('第 1 张卡片');
  await expect(page.getByTestId('violation-reason')).toContainText('仅「候场中」的提示可执行');
  await expect(page.getByTestId('step-list').locator('li')).toHaveCount(0);
});
