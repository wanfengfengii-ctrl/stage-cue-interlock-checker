import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import {
  adjudicate,
  CUE_ACTION_LABELS,
  CUE_STATE_LABELS,
  type Adjudication,
  type CueAction,
  type CueCard,
  type StateSnapshot,
} from './lib/adjudicate';
import {
  adoptWorking,
  comparePlans,
  discardWorking,
  startComparison,
  type ComparisonSession,
  type PlanComparison,
} from './lib/comparison';

const ACTIONS: CueAction[] = ['standby', 'execute', 'cancel', 'complete'];

const MAIN_SEQUENCE_TESTIDS = {
  list: 'card-list',
  card: 'cue-card',
} as const;

const ORIGINAL_SEQUENCE_TESTIDS = {
  list: 'original-card-list',
  card: 'original-cue-card',
} as const;

const MAIN_VERDICT_TESTIDS = {
  ok: 'verdict',
  bad: 'violation',
  reason: 'violation-reason',
  steps: 'step-list',
  empty: 'verdict-empty',
} as const;

const ORIGINAL_VERDICT_TESTIDS = {
  ok: 'original-verdict',
  bad: 'original-violation',
  reason: 'original-violation-reason',
  steps: 'original-step-list',
  empty: 'original-verdict-empty',
} as const;

function StateChips({ states }: { states: StateSnapshot }) {
  const entries = Object.entries(states);
  if (entries.length === 0) {
    return <span className="state-empty">（尚无提示被登记）</span>;
  }
  return (
    <span className="state-chips">
      {entries.map(([cue, state]) => (
        <span key={cue} className={`state-chip state-${state}`}>
          {cue}：{CUE_STATE_LABELS[state]}
        </span>
      ))}
    </span>
  );
}

interface CardSequenceProps {
  cards: CueCard[];
  result: Adjudication;
  editable: boolean;
  /** 首个差异下标：在该位置的卡片上打标记（离开对照模式后由调用方传 null，不残留） */
  diffIndex: number | null;
  testIds: { list: string; card: string };
  dragIndex: number | null;
  dropIndex: number | null;
  onRemove: (id: string) => void;
  onCardDragStart: (index: number, event: DragEvent<HTMLLIElement>) => void;
  onCardDragOver: (index: number, event: DragEvent<HTMLLIElement>) => void;
  onCardDrop: (index: number, event: DragEvent<HTMLLIElement>) => void;
  onCardDragEnd: () => void;
}

function CardSequence({
  cards,
  result,
  editable,
  diffIndex,
  testIds,
  dragIndex,
  dropIndex,
  onRemove,
  onCardDragStart,
  onCardDragOver,
  onCardDrop,
  onCardDragEnd,
}: CardSequenceProps) {
  const violationIndex = result.ok ? null : result.violation.index;
  return (
    <ol className="card-list" data-testid={testIds.list}>
      {cards.map((card, index) => {
        const status =
          violationIndex === null
            ? 'evaluated'
            : index < violationIndex
              ? 'evaluated'
              : index === violationIndex
                ? 'violating'
                : 'unevaluated';
        return (
          <li
            key={card.id}
            data-testid={testIds.card}
            className={`cue-card cue-card-${status} ${
              dropIndex === index && dragIndex !== index ? 'drop-target' : ''
            } ${index === diffIndex ? 'cue-card-first-diff' : ''} ${
              editable ? '' : 'cue-card-readonly'
            }`}
            draggable={editable}
            onDragStart={
              editable
                ? (event) => onCardDragStart(index, event)
                : undefined
            }
            onDragOver={editable ? (event) => onCardDragOver(index, event) : undefined}
            onDrop={editable ? (event) => onCardDrop(index, event) : undefined}
            onDragEnd={editable ? onCardDragEnd : undefined}
          >
            <span className="drag-handle" aria-hidden="true">
              {editable ? '⠿' : '🔒'}
            </span>
            <span className="card-index">第 {index + 1} 张</span>
            <span className="card-cue">提示「{card.cueNumber}」</span>
            <span className="card-action">{CUE_ACTION_LABELS[card.action]}</span>
            {index === diffIndex && (
              <span className="card-flag diff" data-testid="first-diff-flag">
                首个差异
              </span>
            )}
            {status === 'violating' && <span className="card-flag">违规</span>}
            {status === 'unevaluated' && <span className="card-flag muted">未裁决</span>}
            {editable && (
              <button
                type="button"
                className="delete-card"
                aria-label={`删除第 ${index + 1} 张卡片`}
                onClick={() => onRemove(card.id)}
              >
                删除
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface VerdictPanelProps {
  cards: CueCard[];
  result: Adjudication;
  testIds: {
    ok: string;
    bad: string;
    reason: string;
    steps: string;
    empty: string;
  };
}

function VerdictPanel({ cards, result, testIds }: VerdictPanelProps) {
  if (cards.length === 0) {
    return (
      <p className="hint" data-testid={testIds.empty}>
        等待录入卡片后从首项开始裁决。
      </p>
    );
  }
  return (
    <>
      {result.ok ? (
        <p className="verdict verdict-ok" data-testid={testIds.ok}>
          序列合法，可照单执行。
        </p>
      ) : (
        <div className="verdict verdict-bad" data-testid={testIds.bad} role="alert">
          <p>
            序列非法：第 {result.violation.index + 1} 张卡片（提示「
            {cards[result.violation.index].cueNumber}」·
            {CUE_ACTION_LABELS[cards[result.violation.index].action]}）违规。
          </p>
          <p data-testid={testIds.reason}>原因：{result.violation.reason}</p>
          <p>
            违规前状态：
            <StateChips states={result.violation.statesBefore} />
          </p>
          <p className="hint">其后的卡片已清除旧结果，不再参与本次裁决。</p>
        </div>
      )}
      {result.steps.length > 0 && (
        <ol className="step-list" data-testid={testIds.steps}>
          {result.steps.map((step, index) => {
            const card = cards[index];
            return (
              <li key={step.cardId}>
                <span className="step-title">
                  第 {index + 1} 步：提示「{card.cueNumber}」·
                  {CUE_ACTION_LABELS[card.action]}
                </span>
                <StateChips states={step.states} />
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function DifferenceSideCard({
  title,
  card,
}: {
  title: string;
  card: CueCard | null;
}) {
  return (
    <p className="difference-side">
      <span className="difference-side-title">{title}：</span>
      {card === null ? (
        <span className="difference-missing">（此位置没有卡片）</span>
      ) : (
        <span>
          提示「{card.cueNumber}」·{CUE_ACTION_LABELS[card.action]}
        </span>
      )}
    </p>
  );
}

function DifferencePanel({ comparison }: { comparison: PlanComparison }) {
  if (comparison.firstDifferenceIndex === null) {
    return (
      <p className="plans-identical" data-testid="plans-identical">
        两方案当前完全一致：动作顺序与各位置的裁决结果都没有差异。
      </p>
    );
  }

  const {
    firstDifferenceIndex,
    differenceType,
    original,
    working,
    workingViolation,
  } = comparison;

  return (
    <div className="plan-difference" data-testid="plan-difference">
      <p className="difference-head">
        首个差异位置：<strong>第 {firstDifferenceIndex + 1} 张</strong>
        （{differenceType === 'action' ? '动作顺序出现差异' : '裁决结果出现差异'}）
      </p>
      <DifferenceSideCard title="原方案" card={original.card} />
      <DifferenceSideCard title="对照方案" card={working.card} />
      {workingViolation !== null && (
        <div
          className="difference-violation"
          data-testid="difference-violation"
          role="alert"
        >
          <p>
            对照方案在首个差异处即违规，关联卡片：第 {workingViolation.index + 1}{' '}
            张（提示「{working.card?.cueNumber ?? ''}」·
            {working.card !== null ? CUE_ACTION_LABELS[working.card.action] : ''}）。
          </p>
          <p data-testid="difference-reason">原因：{workingViolation.reason}</p>
          <p data-testid="difference-states-before">
            违规前状态：
            <StateChips states={workingViolation.statesBefore} />
          </p>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [cards, setCards] = useState<CueCard[]>([]);
  // 对照会话只保存原方案与工作副本；为 null 时处于普通单序列模式。
  const [comparison, setComparison] = useState<ComparisonSession | null>(null);
  const [cueInput, setCueInput] = useState('');
  const [actionInput, setActionInput] = useState<CueAction>('standby');
  const [formError, setFormError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // 普通模式下每次编辑都从首项重新裁决整条序列。
  const result = useMemo(() => adjudicate(cards), [cards]);

  // 对照模式下分别裁决原方案与工作副本，并定位首个差异。
  const planComparison = useMemo<PlanComparison | null>(
    () =>
      comparison === null
        ? null
        : comparePlans(comparison.original, comparison.working),
    [comparison],
  );

  const inComparison = comparison !== null;
  const displayedCards = inComparison ? comparison.working : cards;
  const displayedResult = inComparison
    ? (planComparison as PlanComparison).workingAdjudication
    : result;
  const originalResult = inComparison
    ? (planComparison as PlanComparison).originalAdjudication
    : null;
  const diffIndex =
    inComparison && planComparison !== null
      ? planComparison.firstDifferenceIndex
      : null;

  function addCard(event: FormEvent) {
    event.preventDefault();
    const cueNumber = cueInput.trim();
    if (cueNumber === '') {
      setFormError('提示编号不能为空，请输入后再添加卡片。');
      return;
    }
    setFormError(null);
    const newCard: CueCard = {
      id: crypto.randomUUID(),
      cueNumber,
      action: actionInput,
    };
    if (inComparison) {
      setComparison((prev) =>
        prev === null ? prev : { ...prev, working: [...prev.working, newCard] },
      );
    } else {
      setCards((prev) => [...prev, newCard]);
    }
    setCueInput('');
  }

  function removeCard(id: string) {
    if (inComparison) {
      setComparison((prev) =>
        prev === null
          ? prev
          : { ...prev, working: prev.working.filter((card) => card.id !== id) },
      );
    } else {
      setCards((prev) => prev.filter((card) => card.id !== id));
    }
  }

  function moveCard(from: number, to: number) {
    const applyMove = (prev: CueCard[]): CueCard[] => {
      if (
        from === to ||
        from < 0 ||
        from >= prev.length ||
        to < 0 ||
        to >= prev.length
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    };
    if (inComparison) {
      setComparison((prev) =>
        prev === null ? prev : { ...prev, working: applyMove(prev.working) },
      );
    } else {
      setCards(applyMove);
    }
  }

  function handleStartComparison() {
    // 空序列不能创建对照（按钮同时禁用，这里再守一道）。
    if (cards.length === 0) {
      return;
    }
    setComparison(startComparison(cards));
    setDragIndex(null);
    setDropIndex(null);
  }

  function handleAdoptWorking() {
    if (comparison === null) {
      return;
    }
    // 采用副本：卡片保持原有标识；随后仍从首项重新裁决。
    setCards(adoptWorking(comparison));
    setComparison(null);
    setDragIndex(null);
    setDropIndex(null);
  }

  function handleDiscardWorking() {
    if (comparison === null) {
      return;
    }
    // 放弃副本：保留原方案。
    setCards(discardWorking(comparison));
    setComparison(null);
    setDragIndex(null);
    setDropIndex(null);
  }

  return (
    <main className="app">
      <h1>舞台提示序列裁决器</h1>
      <p className="intro">
        以事件卡片录入提示编号与动作（候场 / 执行 / 完成 / 取消），可删除或拖动排序。
        每次编辑都会从首项重新裁决：合法时展示各步后的提示状态；非法时停止在首个违规卡片，
        显示违规前状态与唯一原因。也可以从当前序列创建「方案对照」副本，先试排调整方案而不覆盖当前序列。
      </p>

      {inComparison ? (
        <section aria-label="方案对照会话" className="panel comparison-bar" data-testid="comparison-bar">
          <h2>方案对照进行中</h2>
          <p className="hint">
            录入、删除与拖动只作用于<strong>对照方案（工作副本）</strong>；原方案保持不变。
            结束对照时二选一：采用副本（复制的卡片保持原有标识，并从首项重新裁决）或放弃副本、保留原方案。
          </p>
          <div className="comparison-actions">
            <button
              type="button"
              className="primary-action"
              data-testid="adopt-comparison"
              onClick={handleAdoptWorking}
            >
              采用对照副本
            </button>
            <button
              type="button"
              className="secondary-action"
              data-testid="discard-comparison"
              onClick={handleDiscardWorking}
            >
              放弃副本，保留原方案
            </button>
          </div>
        </section>
      ) : (
        <section aria-label="方案对照" className="panel">
          <h2>方案对照</h2>
          <p className="hint">
            从当前序列创建对照副本，在副本中继续录入、删除、拖动；两方案并排各自裁决，
            并标出首个动作顺序或裁决结果出现差异的位置。对照期间原方案不会被试验性调整覆盖。
          </p>
          {cards.length === 0 && (
            <p className="hint" data-testid="comparison-empty-hint">
              空序列不能创建对照，请先录入卡片。
            </p>
          )}
          <button
            type="button"
            data-testid="start-comparison"
            disabled={cards.length === 0}
            onClick={handleStartComparison}
          >
            创建对照副本
          </button>
        </section>
      )}

      <section aria-label="录入卡片" className="panel">
        <form onSubmit={addCard} className="card-form">
          <label>
            提示编号
            <input
              data-testid="cue-input"
              value={cueInput}
              onChange={(event) => {
                setCueInput(event.target.value);
                setFormError(null);
              }}
              placeholder="如：灯光-1"
            />
          </label>
          <label>
            动作
            <select
              data-testid="action-select"
              value={actionInput}
              onChange={(event) => setActionInput(event.target.value as CueAction)}
            >
              {ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {CUE_ACTION_LABELS[action]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" data-testid="add-card">
            {inComparison ? '添加到对照副本' : '添加卡片'}
          </button>
        </form>
        {inComparison && (
          <p className="hint form-target-hint" data-testid="form-target-hint">
            当前处于方案对照：新卡片加入对照方案，原方案不变。
          </p>
        )}
        {formError !== null && (
          <p role="alert" className="form-error" data-testid="form-error">
            {formError}
          </p>
        )}
      </section>

      {inComparison && planComparison !== null && originalResult !== null ? (
        <>
          <section aria-label="差异定位" className="panel">
            <h2>两方案差异</h2>
            <DifferencePanel comparison={planComparison} />
          </section>

          <div className="comparison-grid">
            <section aria-label="原方案" className="panel plan-panel">
              <h2>原方案（只读，{comparison.original.length} 张）</h2>
              {comparison.original.length === 0 ? (
                <p className="hint">尚无卡片。</p>
              ) : (
                <CardSequence
                  cards={comparison.original}
                  result={originalResult}
                  editable={false}
                  diffIndex={diffIndex}
                  testIds={ORIGINAL_SEQUENCE_TESTIDS}
                  dragIndex={null}
                  dropIndex={null}
                  onRemove={() => undefined}
                  onCardDragStart={() => undefined}
                  onCardDragOver={() => undefined}
                  onCardDrop={() => undefined}
                  onCardDragEnd={() => undefined}
                />
              )}
              <h3 className="verdict-title">裁决结果</h3>
              <VerdictPanel
                cards={comparison.original}
                result={originalResult}
                testIds={ORIGINAL_VERDICT_TESTIDS}
              />
            </section>

            <section aria-label="对照方案" className="panel plan-panel">
              <h2>对照方案（工作副本，{comparison.working.length} 张）</h2>
              {comparison.working.length === 0 ? (
                <p className="hint" data-testid="working-empty-hint">
                  副本中的卡片已全部删除，可继续录入。
                </p>
              ) : (
                <CardSequence
                  cards={comparison.working}
                  result={displayedResult}
                  editable
                  diffIndex={diffIndex}
                  testIds={MAIN_SEQUENCE_TESTIDS}
                  dragIndex={dragIndex}
                  dropIndex={dropIndex}
                  onRemove={removeCard}
                  onCardDragStart={(index, event) => {
                    setDragIndex(index);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', String(index));
                  }}
                  onCardDragOver={(index, event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropIndex(index);
                  }}
                  onCardDrop={(index, event) => {
                    event.preventDefault();
                    if (dragIndex !== null) {
                      moveCard(dragIndex, index);
                    }
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                  onCardDragEnd={() => {
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                />
              )}
              <h3 className="verdict-title">裁决结果</h3>
              <VerdictPanel
                cards={displayedCards}
                result={displayedResult}
                testIds={MAIN_VERDICT_TESTIDS}
              />
            </section>
          </div>
        </>
      ) : (
        <>
          <section aria-label="卡片序列" className="panel">
            <h2>卡片序列（{cards.length} 张）</h2>
            {cards.length === 0 ? (
              <p className="hint">尚无卡片，请先录入。</p>
            ) : (
              <CardSequence
                cards={cards}
                result={result}
                editable
                diffIndex={null}
                testIds={MAIN_SEQUENCE_TESTIDS}
                dragIndex={dragIndex}
                dropIndex={dropIndex}
                onRemove={removeCard}
                onCardDragStart={(index, event) => {
                  setDragIndex(index);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(index));
                }}
                onCardDragOver={(index, event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropIndex(index);
                }}
                onCardDrop={(index, event) => {
                  event.preventDefault();
                  if (dragIndex !== null) {
                    moveCard(dragIndex, index);
                  }
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                onCardDragEnd={() => {
                  setDragIndex(null);
                  setDropIndex(null);
                }}
              />
            )}
          </section>

          <section aria-label="裁决结果" className="panel">
            <h2>裁决结果</h2>
            <VerdictPanel cards={cards} result={result} testIds={MAIN_VERDICT_TESTIDS} />
          </section>
        </>
      )}
    </main>
  );
}
