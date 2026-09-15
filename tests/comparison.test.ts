import { describe, expect, it } from 'vitest';
import { adjudicate, type CueCard } from '../src/lib/adjudicate';
import {
  adoptWorking,
  cloneCards,
  comparePlans,
  discardWorking,
  outcomeAt,
  startComparison,
} from '../src/lib/comparison';

let seq = 0;
function card(cueNumber: string, action: CueCard['action'], id?: string): CueCard {
  seq += 1;
  return { id: id ?? `c${seq}`, cueNumber, action };
}

/** 两条提示各自走完整生命周期的合法序列：A s/e/c, B s/e/c */
function legalSequence(): CueCard[] {
  return [
    card('A', 'standby', 'A-s'),
    card('A', 'execute', 'A-e'),
    card('A', 'complete', 'A-c'),
    card('B', 'standby', 'B-s'),
    card('B', 'execute', 'B-e'),
    card('B', 'complete', 'B-c'),
  ];
}

describe('startComparison：会话创建契约', () => {
  it('空序列不能创建对照', () => {
    expect(() => startComparison([])).toThrowError('空序列不能创建方案对照');
  });

  it('原方案与工作副本都是入参的深拷贝，内容一致且互不共享数组', () => {
    const cards = legalSequence();
    const session = startComparison(cards);
    expect(session.original).toEqual(cards);
    expect(session.working).toEqual(cards);
    expect(session.original).not.toBe(cards);
    expect(session.working).not.toBe(cards);
    expect(session.original).not.toBe(session.working);
    expect(session.original[0]).not.toBe(cards[0]);
  });

  it('对照会话只保存原方案与工作副本两份序列', () => {
    const session = startComparison(legalSequence());
    expect(Object.keys(session).sort()).toEqual(['original', 'working']);
  });
});

describe('cloneCards：复制而来的卡片保持原有标识', () => {
  it('逐张保留 id，只复制对象不复用引用', () => {
    const cards = legalSequence();
    const cloned = cloneCards(cards);
    expect(cloned.map((c) => c.id)).toEqual(cards.map((c) => c.id));
    expect(cloned[0]).not.toBe(cards[0]);
    // 修改副本不影响原序列（深拷贝隔离）
    cloned[0].cueNumber = 'X';
    expect(cards[0].cueNumber).toBe('A');
  });
});

describe('comparePlans：首个差异定位', () => {
  it('两方案完全一致（含裁决结果）时没有差异', () => {
    const original = legalSequence();
    const working = cloneCards(original);
    const comparison = comparePlans(original, working);
    expect(comparison.firstDifferenceIndex).toBeNull();
    expect(comparison.differenceType).toBeNull();
    expect(comparison.originalAdjudication.ok).toBe(true);
    expect(comparison.workingAdjudication.ok).toBe(true);
  });

  it('首个差异处副本即互锁违规：差异区直接关联该卡片、违规前状态和原因', () => {
    // 原方案（合法）：A 候场、B 候场、A 执行、A 完成、B 执行、B 完成
    const original = [
      card('A', 'standby', 'A-s'),
      card('B', 'standby', 'B-s'),
      card('A', 'execute', 'A-e'),
      card('A', 'complete', 'A-c'),
      card('B', 'execute', 'B-e'),
      card('B', 'complete', 'B-c'),
    ];
    // 把「B 执行」拖到「A 完成」之前：前 3 张完全一致，第 4 张（下标 3）
    // 原方案是 A 完成、副本是 B 执行 —— A 仍执行中，互锁违规恰在首个差异处。
    const working = [
      original[0],
      original[1],
      original[2],
      original[4], // B-e
      original[3], // A-c
      original[5],
    ];
    const comparison = comparePlans(original, working);
    expect(comparison.firstDifferenceIndex).toBe(3);
    expect(comparison.differenceType).toBe('action');
    if (comparison.firstDifferenceIndex === null) return;

    expect(comparison.original.card?.id).toBe('A-c');
    expect(comparison.working.card?.id).toBe('B-e');

    // 差异区直接关联该卡片、违规前状态和原因
    expect(comparison.workingViolation).not.toBeNull();
    expect(comparison.workingViolation?.index).toBe(3);
    expect(comparison.workingViolation?.cardId).toBe('B-e');
    expect(comparison.workingViolation?.reason).toContain('A');
    expect(comparison.workingViolation?.reason).toContain('最多一个');
    expect(comparison.workingViolation?.statesBefore).toEqual({
      A: 'executing',
      B: 'standby',
    });

    // 页面分别调用现有裁决器：原方案合法，副本非法
    expect(comparison.originalAdjudication.ok).toBe(true);
    expect(comparison.workingAdjudication.ok).toBe(false);
  });

  it('把「A 完成」拖到末尾：差异处在副本并不违规（违规更靠后），差异区不挂违规', () => {
    const original = legalSequence();
    // A s, A e, B s, B e（此处互锁违规，下标 3）, B c, A c
    const working = [
      original[0],
      original[1],
      original[3], // B-s
      original[4], // B-e：违规
      original[5],
      original[2], // A-c
    ];
    const comparison = comparePlans(original, working);
    expect(comparison.firstDifferenceIndex).toBe(2);
    if (comparison.firstDifferenceIndex === null) return;
    // 差异处（下标 2）副本是 B 候场，合法；违规在下标 3，故差异区不关联违规
    expect(comparison.working.outcome.kind).toBe('step');
    expect(comparison.workingViolation).toBeNull();
    expect(comparison.workingAdjudication.ok).toBe(false);
    if (comparison.workingAdjudication.ok) return;
    expect(comparison.workingAdjudication.violation.index).toBe(3);
  });

  it('删除中间一张卡片：首个差异从被删除的位置开始，原方案该侧卡片保留、副本侧为 null', () => {
    const original = legalSequence();
    const working = original.filter((c) => c.id !== 'A-c');
    const comparison = comparePlans(original, working);
    expect(comparison.firstDifferenceIndex).toBe(2);
    expect(comparison.differenceType).toBe('action');
    if (comparison.firstDifferenceIndex === null) return;
    expect(comparison.original.card?.id).toBe('A-c');
    expect(comparison.working.card?.id).toBe('B-s');
  });

  it('副本在末尾新增卡片：首个差异下标等于原方案长度，原方案该位置没有卡片', () => {
    const original = legalSequence();
    const working = [...original, card('C', 'standby', 'C-s')];
    const comparison = comparePlans(original, working);
    expect(comparison.firstDifferenceIndex).toBe(original.length);
    if (comparison.firstDifferenceIndex === null) return;
    expect(comparison.original.card).toBeNull();
    expect(comparison.original.outcome.kind).toBe('beyond');
    expect(comparison.working.card?.id).toBe('C-s');
    expect(comparison.workingViolation).toBeNull();
  });

  it('删除后副本更短：超出副本长度的位置先在删除点暴露差异', () => {
    const original = legalSequence();
    const working = original.slice(0, 5); // 删掉最后一张 B-c
    const comparison = comparePlans(original, working);
    expect(comparison.firstDifferenceIndex).toBe(5);
    if (comparison.firstDifferenceIndex === null) return;
    expect(comparison.working.card).toBeNull();
    expect(comparison.original.card?.id).toBe('B-c');
  });

  it('两方案裁决结果在同位置不同（裁决兜底）时标记为 verdict 差异', () => {
    // 动作顺序一致但裁决产出不同：直接构造 outcomeAt 层面的差异。
    // 裁决是前缀纯函数，相同卡片前缀裁决必然一致；这里用两段相同 id
    // 但不同动作内容的「同 id 卡片」模拟动作被原地改写而 id 不变的情形。
    const original = legalSequence();
    const working = cloneCards(original);
    working[5] = { ...working[5], action: 'standby' }; // B 执行中改候场：状态机违规
    const comparison = comparePlans(original, working);
    expect(comparison.firstDifferenceIndex).toBe(5);
    if (comparison.firstDifferenceIndex === null) return;
    // id 相同（动作顺序按标识对齐视为未换位），差异首先体现在裁决结果上
    expect(comparison.original.card?.id).toBe(comparison.working.card?.id);
    expect(comparison.differenceType).toBe('verdict');
    expect(comparison.workingViolation?.index).toBe(5);
    expect(comparison.workingViolation?.reason).toContain('候场');
    expect(comparison.workingViolation?.reason).toContain('执行中');
  });
});

describe('outcomeAt：位置裁决产出', () => {
  it('合法序列各位置都是 step，越界为 beyond', () => {
    const cards = legalSequence();
    const result = comparePlans(cards, cards).workingAdjudication;
    expect(outcomeAt(result, 0, cards.length).kind).toBe('step');
    expect(outcomeAt(result, 5, cards.length).kind).toBe('step');
    expect(outcomeAt(result, 6, cards.length).kind).toBe('beyond');
  });

  it('非法序列：违规位为 violation，其后为 unevaluated', () => {
    const working = [
      card('A', 'standby', 'A-s'),
      card('A', 'execute', 'A-e'),
      card('B', 'execute', 'B-e'), // 下标 2：互锁违规
      card('B', 'standby', 'B-s'),
    ];
    const result = comparePlans(working, working).workingAdjudication;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(outcomeAt(result, 1, working.length).kind).toBe('step');
    const atViolation = outcomeAt(result, 2, working.length);
    expect(atViolation.kind).toBe('violation');
    if (atViolation.kind !== 'violation') return;
    expect(atViolation.violation.cardId).toBe('B-e');
    expect(outcomeAt(result, 3, working.length).kind).toBe('unevaluated');
  });
});

describe('采用 / 放弃：结束对照的数据契约', () => {
  it('采用副本：返回工作副本内容，卡片保持原有标识（含复制卡与新增卡）', () => {
    const original = legalSequence();
    const session = startComparison(original);
    // 在副本中把 B-e 拖到 A-c 之前，再新增一张 C 候场
    session.working = [
      session.working[0],
      session.working[1],
      session.working[4],
      session.working[2],
      session.working[3],
      session.working[5],
      card('C', 'standby', 'C-s'),
    ];
    const adopted = adoptWorking(session);
    expect(adopted.map((c) => c.id)).toEqual([
      'A-s',
      'A-e',
      'B-e',
      'A-c',
      'B-s',
      'B-c',
      'C-s',
    ]);
    // 采用后仍从首项裁决：非法副本被原样采用，裁决器在新序列上仍报同一首个违规
    expect(adopted).not.toBe(session.working);
  });

  it('放弃副本：无论副本怎么改，都返回原方案内容', () => {
    const original = legalSequence();
    const session = startComparison(original);
    session.working = [session.working[0], card('Z', 'cancel', 'Z-x')];
    const kept = discardWorking(session);
    expect(kept.map((c) => c.id)).toEqual(original.map((c) => c.id));
    expect(kept).toEqual(original);
    expect(kept).not.toBe(session.original);
  });

  it('修正后的副本采用后从首项裁决为合法序列', () => {
    const original = legalSequence();
    const session = startComparison(original);
    // 末尾追加 C 候场：合法且与原方案不同
    session.working = [...session.working, card('C', 'standby', 'C-s')];
    const adopted = adoptWorking(session);
    const result = adjudicate(adopted);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(7);
    expect(result.finalStates).toEqual({ A: 'done', B: 'done', C: 'standby' });
  });
});
