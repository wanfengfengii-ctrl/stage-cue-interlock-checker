import { useMemo, useState, type FormEvent } from 'react';
import {
  adjudicate,
  CUE_ACTION_LABELS,
  CUE_STATE_LABELS,
  type CueAction,
  type CueCard,
  type StateSnapshot,
} from './lib/adjudicate';

const ACTIONS: CueAction[] = ['standby', 'execute', 'cancel', 'complete'];

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

export default function App() {
  const [cards, setCards] = useState<CueCard[]>([]);
  const [cueInput, setCueInput] = useState('');
  const [actionInput, setActionInput] = useState<CueAction>('standby');
  const [formError, setFormError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // 每次编辑（新增 / 删除 / 拖动排序）都会从首项重新裁决整条序列。
  const result = useMemo(() => adjudicate(cards), [cards]);

  const violationIndex = result.ok ? null : result.violation.index;

  function addCard(event: FormEvent) {
    event.preventDefault();
    const cueNumber = cueInput.trim();
    if (cueNumber === '') {
      setFormError('提示编号不能为空，请输入后再添加卡片。');
      return;
    }
    setFormError(null);
    setCards((prev) => [
      ...prev,
      { id: crypto.randomUUID(), cueNumber, action: actionInput },
    ]);
    setCueInput('');
  }

  function removeCard(id: string) {
    setCards((prev) => prev.filter((card) => card.id !== id));
  }

  function moveCard(from: number, to: number) {
    setCards((prev) => {
      if (from === to || from < 0 || from >= prev.length || to < 0 || to >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  return (
    <main className="app">
      <h1>舞台提示序列裁决器</h1>
      <p className="intro">
        以事件卡片录入提示编号与动作（候场 / 执行 / 完成 / 取消），可删除或拖动排序。
        每次编辑都会从首项重新裁决：合法时展示各步后的提示状态；非法时停止在首个违规卡片，
        显示违规前状态与唯一原因。
      </p>

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
            添加卡片
          </button>
        </form>
        {formError !== null && (
          <p role="alert" className="form-error" data-testid="form-error">
            {formError}
          </p>
        )}
      </section>

      <section aria-label="卡片序列" className="panel">
        <h2>卡片序列（{cards.length} 张）</h2>
        {cards.length === 0 ? (
          <p className="hint">尚无卡片，请先录入。</p>
        ) : (
          <ol className="card-list" data-testid="card-list">
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
                  data-testid="cue-card"
                  className={`cue-card cue-card-${status} ${
                    dropIndex === index && dragIndex !== index ? 'drop-target' : ''
                  }`}
                  draggable
                  onDragStart={(event) => {
                    setDragIndex(index);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', String(index));
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropIndex(index);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragIndex !== null) {
                      moveCard(dragIndex, index);
                    }
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                >
                  <span className="drag-handle" aria-hidden="true">
                    ⠿
                  </span>
                  <span className="card-index">第 {index + 1} 张</span>
                  <span className="card-cue">提示「{card.cueNumber}」</span>
                  <span className="card-action">{CUE_ACTION_LABELS[card.action]}</span>
                  {status === 'violating' && <span className="card-flag">违规</span>}
                  {status === 'unevaluated' && <span className="card-flag muted">未裁决</span>}
                  <button
                    type="button"
                    className="delete-card"
                    aria-label={`删除第 ${index + 1} 张卡片`}
                    onClick={() => removeCard(card.id)}
                  >
                    删除
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-label="裁决结果" className="panel">
        <h2>裁决结果</h2>
        {cards.length === 0 ? (
          <p className="hint" data-testid="verdict-empty">
            等待录入卡片后从首项开始裁决。
          </p>
        ) : (
          <>
            {result.ok ? (
              <p className="verdict verdict-ok" data-testid="verdict">
                序列合法，可照单执行。
              </p>
            ) : (
              <div className="verdict verdict-bad" data-testid="violation" role="alert">
                <p>
                  序列非法：第 {result.violation.index + 1} 张卡片（提示「
                  {cards[result.violation.index].cueNumber}」·
                  {CUE_ACTION_LABELS[cards[result.violation.index].action]}）违规。
                </p>
                <p data-testid="violation-reason">原因：{result.violation.reason}</p>
                <p>
                  违规前状态：
                  <StateChips states={result.violation.statesBefore} />
                </p>
                <p className="hint">其后的卡片已清除旧结果，不再参与本次裁决。</p>
              </div>
            )}
            {result.steps.length > 0 && (
              <ol className="step-list" data-testid="step-list">
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
        )}
      </section>
    </main>
  );
}
