/**
 * 舞台提示序列裁决逻辑。
 *
 * 每个提示（按提示编号区分）初始为「空闲」，状态机如下：
 *   空闲 --候场--> 候场中 --执行--> 执行中 --完成--> 已完成
 *     ^                |
 *     |----取消---------|
 *
 * 约束：
 *  - 仅空闲可候场；仅候场中可执行或取消；取消回到空闲；
 *  - 仅执行中可完成；已完成不再接收任何动作；
 *  - 任一时刻最多一个提示处于执行中。
 *
 * 裁决始终从首项开始顺序进行：合法时记录每一步之后各提示的状态；
 * 遇到首个违规卡片即停止，报告违规前状态与唯一原因，其后的卡片不再产生结果。
 */

export type CueState = 'idle' | 'standby' | 'executing' | 'done';

export type CueAction = 'standby' | 'execute' | 'cancel' | 'complete';

export interface CueCard {
  /** 卡片唯一 id（用于界面渲染与拖动排序） */
  id: string;
  /** 提示编号（同一编号的多张卡片构成该提示的动作序列） */
  cueNumber: string;
  action: CueAction;
}

export const CUE_STATE_LABELS: Record<CueState, string> = {
  idle: '空闲',
  standby: '候场中',
  executing: '执行中',
  done: '已完成',
};

export const CUE_ACTION_LABELS: Record<CueAction, string> = {
  standby: '候场',
  execute: '执行',
  cancel: '取消',
  complete: '完成',
};

/** 合法的状态迁移：动作 -> { 允许的前置状态, 迁移后的状态 } */
const TRANSITIONS: Record<CueAction, { from: readonly CueState[]; to: CueState }> = {
  standby: { from: ['idle'], to: 'standby' },
  execute: { from: ['standby'], to: 'executing' },
  cancel: { from: ['standby'], to: 'idle' },
  complete: { from: ['executing'], to: 'done' },
};

/** 各提示编号在某一步之后的状态快照 */
export type StateSnapshot = Record<string, CueState>;

export interface StepResult {
  /** 产生本步结果的卡片 id */
  cardId: string;
  /** 本步之后所有已出现提示的状态 */
  states: StateSnapshot;
}

export interface Violation {
  /** 违规卡片在序列中的下标（从 0 开始） */
  index: number;
  cardId: string;
  /** 唯一违规原因 */
  reason: string;
  /** 违规卡片执行之前各提示的状态 */
  statesBefore: StateSnapshot;
}

export type Adjudication =
  | { ok: true; steps: StepResult[]; finalStates: StateSnapshot }
  | { ok: false; steps: StepResult[]; violation: Violation };

/**
 * 提示编号是任意用户输入，可能恰好等于 Object.prototype 上的属性名
 * （如 __proto__、constructor、toString）。若用普通对象字面量保存状态表，
 * 读取会命中继承成员（把 toString 函数误当作状态），写入 __proto__ 甚至会
 * 修改对象原型。因此状态表一律使用无原型对象。
 */
function createStateMap(): StateSnapshot {
  return Object.create(null) as StateSnapshot;
}

function copyStates(states: StateSnapshot): StateSnapshot {
  return Object.assign(createStateMap(), states);
}

/**
 * 从首项开始顺序裁决整条卡片序列。
 * 纯函数：不修改入参，相同输入恒有相同输出。
 */
export function adjudicate(cards: readonly CueCard[]): Adjudication {
  const states: StateSnapshot = createStateMap();
  const steps: StepResult[] = [];

  for (let index = 0; index < cards.length; index++) {
    const card = cards[index];
    const cue = card.cueNumber;
    const current: CueState = states[cue] ?? 'idle';

    const fail = (reason: string): Adjudication => ({
      ok: false,
      steps,
      violation: {
        index,
        cardId: card.id,
        reason,
        statesBefore: copyStates(states),
      },
    });

    // 已完成的提示不再接收任何动作。
    if (current === 'done') {
      return fail(`提示「${cue}」已完成，不再接收任何动作`);
    }

    const transition = TRANSITIONS[card.action];
    if (!transition.from.includes(current)) {
      const allowed = transition.from.map((s) => `「${CUE_STATE_LABELS[s]}」`).join('或');
      return fail(
        `仅${allowed}的提示可${CUE_ACTION_LABELS[card.action]}，` +
          `而提示「${cue}」当前为「${CUE_STATE_LABELS[current]}」`,
      );
    }

    // 执行前检查互锁：任一时刻最多一个提示处于执行中。
    if (card.action === 'execute') {
      const busyCue = Object.keys(states).find((key) => states[key] === 'executing');
      if (busyCue !== undefined && busyCue !== cue) {
        return fail(`提示「${busyCue}」正在执行中，任一时刻最多一个提示处于执行中`);
      }
    }

    states[cue] = transition.to;
    steps.push({ cardId: card.id, states: copyStates(states) });
  }

  return { ok: true, steps, finalStates: copyStates(states) };
}
