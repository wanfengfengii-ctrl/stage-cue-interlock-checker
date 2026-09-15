import { describe, expect, it } from 'vitest';
import { adjudicate, type CueCard } from '../src/lib/adjudicate';

let seq = 0;
function card(cueNumber: string, action: CueCard['action']): CueCard {
  seq += 1;
  return { id: `c${seq}`, cueNumber, action };
}

describe('adjudicate：合法序列', () => {
  it('空序列合法，没有任何步骤', () => {
    const result = adjudicate([]);
    expect(result).toEqual({ ok: true, steps: [], finalStates: {} });
  });

  it('单个提示走完整生命周期：候场 → 执行 → 完成', () => {
    const result = adjudicate([
      card('A', 'standby'),
      card('A', 'execute'),
      card('A', 'complete'),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((s) => s.states['A'])).toEqual([
      'standby',
      'executing',
      'done',
    ]);
    expect(result.finalStates).toEqual({ A: 'done' });
  });

  it('候场中的提示可取消并回到空闲，之后可重新候场', () => {
    const result = adjudicate([
      card('A', 'standby'),
      card('A', 'cancel'),
      card('A', 'standby'),
      card('A', 'execute'),
      card('A', 'complete'),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((s) => s.states['A'])).toEqual([
      'standby',
      'idle',
      'standby',
      'executing',
      'done',
    ]);
  });

  it('多个提示可交错候场，但执行按互锁顺序推进', () => {
    const result = adjudicate([
      card('A', 'standby'),
      card('B', 'standby'),
      card('A', 'execute'),
      card('A', 'complete'),
      card('B', 'execute'),
      card('B', 'complete'),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finalStates).toEqual({ A: 'done', B: 'done' });
    expect(result.steps[2].states).toEqual({ A: 'executing', B: 'standby' });
  });

  it('每一步的状态快照互不影响（快照在记录后不被后续步骤修改）', () => {
    const result = adjudicate([
      card('A', 'standby'),
      card('B', 'standby'),
      card('A', 'execute'),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0].states).toEqual({ A: 'standby' });
    expect(result.steps[1].states).toEqual({ A: 'standby', B: 'standby' });
  });
});

describe('adjudicate：状态机违规', () => {
  it('仅空闲可候场：候场中的提示再次候场即违规', () => {
    const result = adjudicate([card('A', 'standby'), card('A', 'standby')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.index).toBe(1);
    expect(result.violation.reason).toContain('候场');
    expect(result.violation.reason).toContain('A');
    expect(result.violation.statesBefore).toEqual({ A: 'standby' });
  });

  it('仅候场中可执行：空闲提示直接执行即违规', () => {
    const result = adjudicate([card('A', 'execute')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.index).toBe(0);
    expect(result.violation.reason).toContain('执行');
    expect(result.violation.statesBefore).toEqual({});
  });

  it('仅候场中可取消：空闲提示取消即违规', () => {
    const result = adjudicate([card('A', 'cancel')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.reason).toContain('取消');
  });

  it('仅执行中可完成：候场中的提示直接完成即违规', () => {
    const result = adjudicate([card('A', 'standby'), card('A', 'complete')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.index).toBe(1);
    expect(result.violation.reason).toContain('完成');
    expect(result.violation.statesBefore).toEqual({ A: 'standby' });
  });

  it('执行中的提示不能取消', () => {
    const result = adjudicate([
      card('A', 'standby'),
      card('A', 'execute'),
      card('A', 'cancel'),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.index).toBe(2);
    expect(result.violation.reason).toContain('取消');
  });

  it('已完成提示不再接收任何动作', () => {
    const lifecycle = [card('A', 'standby'), card('A', 'execute'), card('A', 'complete')];
    for (const action of ['standby', 'execute', 'cancel', 'complete'] as const) {
      const result = adjudicate([...lifecycle, card('A', action)]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.violation.index).toBe(3);
      expect(result.violation.reason).toContain('已完成');
      expect(result.violation.reason).toContain('不再接收任何动作');
    }
  });
});

describe('adjudicate：执行互锁', () => {
  it('任一时刻最多一个提示执行中：A 执行中时 B 执行即违规', () => {
    const result = adjudicate([
      card('A', 'standby'),
      card('A', 'execute'),
      card('B', 'standby'),
      card('B', 'execute'),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.index).toBe(3);
    expect(result.violation.reason).toContain('A');
    expect(result.violation.reason).toContain('最多一个');
    expect(result.violation.statesBefore).toEqual({ A: 'executing', B: 'standby' });
  });

  it('A 完成后 B 即可执行', () => {
    const result = adjudicate([
      card('A', 'standby'),
      card('A', 'execute'),
      card('A', 'complete'),
      card('B', 'standby'),
      card('B', 'execute'),
    ]);
    expect(result.ok).toBe(true);
  });

  it('A 取消回到空闲后，仍须重新候场才能执行', () => {
    const result = adjudicate([
      card('A', 'standby'),
      card('A', 'cancel'),
      card('A', 'execute'),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.index).toBe(2);
    expect(result.violation.reason).toContain('执行');
  });
});

describe('adjudicate：违规截断语义', () => {
  it('停止在首个违规卡片：违规前的步骤保留，其后的卡片不产生结果', () => {
    const cards = [
      card('A', 'standby'),
      card('A', 'execute'),
      card('A', 'execute'), // 违规：执行中不能再执行
      card('A', 'complete'), // 其后的卡片不再裁决
    ];
    const result = adjudicate(cards);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].cardId).toBe(cards[0].id);
    expect(result.steps[1].cardId).toBe(cards[1].id);
    expect(result.violation.index).toBe(2);
    expect(result.violation.cardId).toBe(cards[2].id);
    expect(result.violation.statesBefore).toEqual({ A: 'executing' });
  });

  it('违规原因唯一：只报告首个违规，不累积多个原因', () => {
    const result = adjudicate([
      card('A', 'execute'), // 违规 1
      card('B', 'complete'), // 若继续也会违规，但不应被报告
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.index).toBe(0);
    expect(result.steps).toHaveLength(0);
  });
});
