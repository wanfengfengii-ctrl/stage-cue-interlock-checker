/**
 * 方案对照：从当前可执行序列（原方案）创建一份工作副本（对照方案），
 * 在副本中继续录入、删除、拖动，而不影响原方案；结束时二选一：
 *  - 采用副本：以副本替换当前序列（卡片 id 保持不变，步骤结果按 cardId 关联不会错配）；
 *  - 放弃副本：保留原方案。
 *
 * 本模块只处理对照会话的数据契约与首个差异定位，为纯函数，不依赖界面。
 */

import {
  adjudicate,
  type Adjudication,
  type CueCard,
  type StateSnapshot,
  type Violation,
} from './adjudicate';

/** 对照会话：只保存原方案快照与工作副本，不产生第三份序列 */
export interface ComparisonSession {
  /** 创建对照时的原方案快照（只读，对照期间不被编辑） */
  original: CueCard[];
  /** 工作副本：录入 / 删除 / 拖动都作用于它 */
  working: CueCard[];
}

/** 某条方案在某个序列位置上的裁决产出 */
export type PositionOutcome =
  | { kind: 'step'; states: StateSnapshot }
  | { kind: 'violation'; violation: Violation }
  | { kind: 'unevaluated' }
  | { kind: 'beyond' };

export interface PlanSide {
  /** 该位置的卡片；该方案在此位置已无卡片（序列更短）时为 null */
  card: CueCard | null;
  outcome: PositionOutcome;
}

export interface PlanDifference {
  /** 首个差异下标（从 0 开始）；两方案完全一致时为 null */
  firstDifferenceIndex: number;
  /**
   * 首先出现差异的方面：
   *  - 'action'：该位置的动作顺序不同（卡片不同 / 被拖动 / 新增 / 删除导致缺位）；
   *  - 'verdict'：动作相同，但该位置的裁决产出不同（兜底：裁决为前缀纯函数，
   *    卡片一致时裁决必然一致，正常编辑不会出现，仅作防御）。
   */
  differenceType: 'action' | 'verdict';
  original: PlanSide;
  working: PlanSide;
  /** 副本恰在首个差异位置违规时，直接关联该违规（卡片 / 原因 / 违规前状态） */
  workingViolation: Violation | null;
}

export type PlanComparison =
  | (PlanDifference & {
      firstDifferenceIndex: number;
      originalAdjudication: Adjudication;
      workingAdjudication: Adjudication;
    })
  | {
      firstDifferenceIndex: null;
      differenceType: null;
      originalAdjudication: Adjudication;
      workingAdjudication: Adjudication;
    };

/**
 * 深拷贝卡片序列但保留每张卡片的原有 id。
 * 保留 id 是为了拖动定位（React key）与裁决步骤结果（StepResult.cardId）不错配。
 */
export function cloneCards(cards: readonly CueCard[]): CueCard[] {
  return cards.map((card) => ({ ...card }));
}

/** 从当前序列创建对照会话。空序列不能创建对照。 */
export function startComparison(cards: readonly CueCard[]): ComparisonSession {
  if (cards.length === 0) {
    throw new Error('空序列不能创建方案对照');
  }
  return { original: cloneCards(cards), working: cloneCards(cards) };
}

/** 采用副本：返回工作副本（保留原有卡片标识），随后仍从首项重新裁决。 */
export function adoptWorking(session: ComparisonSession): CueCard[] {
  return cloneCards(session.working);
}

/** 放弃副本：返回原方案快照。 */
export function discardWorking(session: ComparisonSession): CueCard[] {
  return cloneCards(session.original);
}

/** 取一条方案在 index 位置的裁决产出（需要序列长度以区分「未裁决」与「序列之外」） */
export function outcomeAt(
  result: Adjudication,
  index: number,
  length: number,
): PositionOutcome {
  if (index >= length) {
    return { kind: 'beyond' };
  }
  if (result.ok) {
    return { kind: 'step', states: result.steps[index].states };
  }
  if (index < result.violation.index) {
    return { kind: 'step', states: result.steps[index].states };
  }
  if (index === result.violation.index) {
    return { kind: 'violation', violation: result.violation };
  }
  return { kind: 'unevaluated' };
}

function statesEqual(a: StateSnapshot, b: StateSnapshot): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => b[key] === a[key]);
}

function outcomeEqual(a: PositionOutcome, b: PositionOutcome): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'step' && b.kind === 'step') {
    return statesEqual(a.states, b.states);
  }
  if (a.kind === 'violation' && b.kind === 'violation') {
    return (
      a.violation.reason === b.violation.reason &&
      statesEqual(a.violation.statesBefore, b.violation.statesBefore)
    );
  }
  return true; // unevaluated / beyond 同种类即相同
}

/**
 * 分别调用现有裁决器裁决两条方案，逐位对齐比较，标出首个
 *「动作顺序或裁决结果出现差异」的位置。纯函数，不修改入参。
 */
export function comparePlans(
  original: readonly CueCard[],
  working: readonly CueCard[],
): PlanComparison {
  const originalAdjudication = adjudicate(original);
  const workingAdjudication = adjudicate(working);
  const maxLength = Math.max(original.length, working.length);

  for (let index = 0; index < maxLength; index++) {
    const originalCard = original[index] ?? null;
    const workingCard = working[index] ?? null;
    // 按卡片标识对齐：拖动 / 新增 / 删除都会让某个位置换上另一张卡片或缺位。
    const actionChanged = (originalCard?.id ?? null) !== (workingCard?.id ?? null);

    const originalOutcome = outcomeAt(originalAdjudication, index, original.length);
    const workingOutcome = outcomeAt(workingAdjudication, index, working.length);
    const verdictChanged = !outcomeEqual(originalOutcome, workingOutcome);

    if (actionChanged || verdictChanged) {
      return {
        firstDifferenceIndex: index,
        differenceType: actionChanged ? 'action' : 'verdict',
        original: { card: originalCard, outcome: originalOutcome },
        working: { card: workingCard, outcome: workingOutcome },
        workingViolation:
          workingOutcome.kind === 'violation' ? workingOutcome.violation : null,
        originalAdjudication,
        workingAdjudication,
      };
    }
  }

  return {
    firstDifferenceIndex: null,
    differenceType: null,
    originalAdjudication,
    workingAdjudication,
  };
}
