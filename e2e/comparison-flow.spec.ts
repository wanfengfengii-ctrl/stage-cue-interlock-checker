import { expect, test, type Page } from '@playwright/test';

async function addCard(page: Page, cue: string, actionLabel: string) {
  await page.getByTestId('cue-input').fill(cue);
  await page.getByTestId('action-select').selectOption({ label: actionLabel });
  await page.getByTestId('add-card').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('方案对照：创建副本 → 拖成互锁违规 → 原方案未变 → 修正并采用副本', async ({
  page,
}) => {
  // 1. 录入一条交错的合法序列：
  //    A候场 B候场 A执行 A完成 B执行 B完成
  await addCard(page, 'A', '候场');
  await addCard(page, 'B', '候场');
  await addCard(page, 'A', '执行');
  await addCard(page, 'A', '完成');
  await addCard(page, 'B', '执行');
  await addCard(page, 'B', '完成');
  await expect(page.getByTestId('verdict')).toHaveText('序列合法，可照单执行。');

  // 2. 创建对照副本
  await page.getByTestId('start-comparison').click();
  await expect(page.getByTestId('comparison-bar')).toBeVisible();
  const workingCards = page.getByTestId('cue-card');
  const originalCards = page.getByTestId('original-cue-card');
  await expect(workingCards).toHaveCount(6);
  await expect(originalCards).toHaveCount(6);
  // 刚创建时两方案完全一致
  await expect(page.getByTestId('plans-identical')).toBeVisible();

  // 3. 在副本中把第 5 张「B·执行」拖到第 4 张「A·完成」的位置，
  //    使 B 在 A 执行中时执行，构成互锁违规
  await workingCards.nth(4).dragTo(workingCards.nth(3));
  await expect(workingCards.nth(3)).toContainText('提示「B」');
  await expect(workingCards.nth(3)).toContainText('执行');

  // 4. 差异定位停在第 4 张，差异区直接关联违规卡片、违规前状态与原因
  const difference = page.getByTestId('plan-difference');
  await expect(difference).toBeVisible();
  await expect(difference).toContainText('首个差异位置：第 4 张');
  await expect(difference).toContainText('动作顺序出现差异');
  await expect(workingCards.nth(3)).toContainText('首个差异');
  await expect(workingCards.nth(3)).toContainText('违规');

  const diffViolation = page.getByTestId('difference-violation');
  await expect(diffViolation).toBeVisible();
  await expect(page.getByTestId('difference-reason')).toContainText(
    '任一时刻最多一个提示处于执行中',
  );
  await expect(page.getByTestId('difference-reason')).toContainText('「A」');
  await expect(page.getByTestId('difference-states-before')).toContainText('A：执行中');
  await expect(page.getByTestId('difference-states-before')).toContainText('B：候场中');

  // 副本自身的裁决结果同样停在首个违规，违规前 3 步保留
  await expect(page.getByTestId('violation')).toBeVisible();
  await expect(page.getByTestId('violation')).toContainText('第 4 张卡片');
  await expect(page.getByTestId('step-list').locator('li')).toHaveCount(3);

  // 5. 原方案保持不变：顺序未被拖动覆盖，裁决仍合法且 6 步齐全
  await expect(originalCards.nth(3)).toContainText('提示「A」');
  await expect(originalCards.nth(3)).toContainText('完成');
  await expect(originalCards.nth(4)).toContainText('提示「B」');
  await expect(originalCards.nth(4)).toContainText('执行');
  await expect(page.getByTestId('original-verdict')).toHaveText(
    '序列合法，可照单执行。',
  );
  await expect(page.getByTestId('original-step-list').locator('li')).toHaveCount(6);
  // 原方案只读：不提供删除按钮，也不可拖动
  await expect(originalCards.nth(0).getByRole('button', { name: /删除/ })).toHaveCount(0);

  // 6. 修正副本：把「A·完成」拖回第 4 张的位置，互锁解除
  await workingCards.nth(4).dragTo(workingCards.nth(3));
  await expect(page.getByTestId('verdict')).toHaveText('序列合法，可照单执行。');
  await expect(page.getByTestId('plans-identical')).toBeVisible();

  // 再在副本末尾合法追加一张卡片，使修正后的副本与原方案确实不同
  await addCard(page, 'C', '候场');
  await expect(workingCards).toHaveCount(7);
  await expect(page.getByTestId('plan-difference')).toBeVisible();
  await expect(page.getByTestId('plan-difference')).toContainText('首个差异位置：第 7 张');
  await expect(page.getByTestId('difference-violation')).toHaveCount(0);
  await expect(originalCards).toHaveCount(6);

  // 7. 采用修正副本：退出对照后从首项重新裁决，复制卡片保持原顺序与标识
  await page.getByTestId('adopt-comparison').click();
  await expect(page.getByTestId('comparison-bar')).toHaveCount(0);
  await expect(page.getByTestId('plan-difference')).toHaveCount(0);
  await expect(page.getByTestId('first-diff-flag')).toHaveCount(0);

  const adoptedCards = page.getByTestId('cue-card');
  await expect(adoptedCards).toHaveCount(7);
  await expect(adoptedCards.nth(3)).toContainText('提示「A」');
  await expect(adoptedCards.nth(3)).toContainText('完成');
  await expect(adoptedCards.nth(4)).toContainText('提示「B」');
  await expect(adoptedCards.nth(4)).toContainText('执行');
  await expect(adoptedCards.nth(6)).toContainText('提示「C」');
  await expect(adoptedCards.nth(6)).toContainText('候场');
  await expect(page.getByTestId('verdict')).toHaveText('序列合法，可照单执行。');
  await expect(page.getByTestId('step-list').locator('li')).toHaveCount(7);
  await expect(page.getByTestId('step-list').locator('li').nth(6)).toContainText(
    'C：候场中',
  );
});

test('空序列不能创建对照', async ({ page }) => {
  const startButton = page.getByTestId('start-comparison');
  await expect(startButton).toBeDisabled();
  await expect(page.getByTestId('comparison-empty-hint')).toBeVisible();
});

test('放弃副本后保留原方案，且离开对照模式不残留旧差异标记', async ({ page }) => {
  await addCard(page, '1', '候场');
  await addCard(page, '1', '执行');
  await addCard(page, '1', '完成');

  await page.getByTestId('start-comparison').click();
  const workingCards = page.getByTestId('cue-card');

  // 把「候场」（第 1 张）拖到最后：完成提示后再候场，副本出现违规与差异
  await workingCards.nth(0).dragTo(workingCards.nth(2));
  await expect(page.getByTestId('plan-difference')).toBeVisible();
  await expect(page.getByTestId('violation')).toBeVisible();
  // 工作副本列与原方案列都在差异位置打标记
  await expect(workingCards.nth(0)).toContainText('首个差异');
  await expect(page.getByTestId('original-cue-card').nth(0)).toContainText('首个差异');

  // 放弃副本：原方案恢复展示且合法
  await page.getByTestId('discard-comparison').click();
  await expect(page.getByTestId('comparison-bar')).toHaveCount(0);
  const cards = page.getByTestId('cue-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('候场');
  await expect(cards.nth(1)).toContainText('执行');
  await expect(cards.nth(2)).toContainText('完成');
  await expect(page.getByTestId('verdict')).toHaveText('序列合法，可照单执行。');

  // 旧差异标记全部清除，不留残迹
  await expect(page.getByTestId('plan-difference')).toHaveCount(0);
  await expect(page.getByTestId('first-diff-flag')).toHaveCount(0);
  await expect(page.getByTestId('original-card-list')).toHaveCount(0);
});
