import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { computeProgress } from '../domain/progress';
import { dayReview, morningBriefing } from '../domain/coach';
import { getPlaybook } from '../domain/playbooks';
import { PHASE_META, phaseForDate } from '../domain/planner';
import { Button, Card, Progress, SectionTitle } from '../components/ui';
import { cx, inputCls } from '../lib/style';
import { addDays, formatJP, todayISO } from '../lib/date';
import type { Task } from '../types';
import { IconFire, IconHand, IconTarget } from '../components/icons';

export default function Today() {
  const { profile, plan, logs, ensureDay, toggleTask, finishDay, addCustomTask, removeTask } =
    useAppStore();
  const [date, setDate] = useState(todayISO());
  const [sheet, setSheet] = useState<'none' | 'close' | 'result' | 'add'>('none');
  const [revenue, setRevenue] = useState('');
  const [memo, setMemo] = useState('');
  const [actualMin, setActualMin] = useState('');
  const [reviewText, setReviewText] = useState<{ headline: string; body: string; tone: string } | null>(
    null,
  );
  const [newTitle, setNewTitle] = useState('');
  const [newMin, setNewMin] = useState('30');

  useEffect(() => {
    ensureDay(date);
  }, [date, ensureDay]);

  const log = logs[date];
  const progress = useMemo(
    () => (profile && plan ? computeProgress(profile, plan, logs, date) : null),
    [profile, plan, logs, date],
  );

  if (!profile || !plan || !log || !progress) return null;

  const pb = getPlaybook(plan.playbookId);
  const phase = phaseForDate(plan, date);
  const brief = morningBriefing(plan, progress, log.tasks, date);
  const done = log.tasks.filter((t) => t.done).length;
  const total = log.tasks.length;
  const totalMin = log.tasks.reduce((a, t) => a + t.estMin, 0);
  const doneMin = log.tasks.filter((t) => t.done).reduce((a, t) => a + t.estMin, 0);
  const isToday = date === todayISO();

  const toneCls = {
    push: 'border-acid-500/30 bg-acid-500/5',
    warn: 'border-flame-500/30 bg-flame-500/5',
    praise: 'border-acid-500/40 bg-acid-500/10',
    calm: 'border-ink-700 bg-ink-850',
  }[brief.tone];

  const onClose = () => {
    const reason = finishDay(date, {
      revenue: revenue ? Number(revenue) : undefined,
      memo: memo || undefined,
      actualMin: actualMin ? Number(actualMin) : undefined,
    });
    const p2 = computeProgress(profile, useAppStore.getState().plan!, useAppStore.getState().logs, date);
    const rv = dayReview(useAppStore.getState().logs[date], p2, reason, revenue ? Number(revenue) : undefined);
    setReviewText(rv);
    setSheet('result');
    // 翌日分を先に用意しておく
    useAppStore.getState().ensureDay(addDays(date, 1));
  };

  return (
    <div className="px-4 pt-4 pb-32">
      {/* 日付ナビ */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => setDate(addDays(date, -1))}
          className="pressable rounded-xl px-2 py-1.5 text-[13px] font-bold text-ink-400"
        >
          ‹ 前日
        </button>
        <div className="text-center">
          <div className="text-[15px] font-extrabold">{isToday ? '今日' : formatJP(date)}</div>
          <div className="text-[11px] font-bold text-ink-500">
            フェーズ{phase}・{PHASE_META[phase].name}
          </div>
        </div>
        <button
          onClick={() => setDate(addDays(date, 1))}
          disabled={date >= todayISO()}
          className="pressable rounded-xl px-2 py-1.5 text-[13px] font-bold text-ink-400 disabled:opacity-25"
        >
          翌日 ›
        </button>
      </div>

      {/* 上司の指示 */}
      <div className={cx('animate-rise card border p-4', toneCls)}>
        <div className="flex items-center gap-2">
          <span
            className={cx(
              'flex h-7 w-7 items-center justify-center rounded-lg bg-ink-700',
              brief.tone === 'warn' ? 'text-flame-400' : 'text-acid-400',
            )}
          >
            {brief.tone === 'warn' ? (
              <IconFire className="h-[15px] w-[15px]" />
            ) : brief.tone === 'praise' ? (
              <IconHand className="h-[15px] w-[15px]" />
            ) : (
              <IconTarget className="h-[15px] w-[15px]" />
            )}
          </span>
          <span className="text-[14px] font-extrabold">{brief.headline}</span>
        </div>
        <p className="mt-2.5 text-[14px] leading-relaxed whitespace-pre-line text-ink-200">
          {brief.body}
        </p>
      </div>

      {/* 今日の進み具合 */}
      <div className="mt-4 card p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[11px] font-bold text-ink-400">今日の消化</div>
            <div className="mt-0.5 text-[24px] leading-none font-extrabold tabular-nums">
              {done}
              <span className="text-[15px] text-ink-400"> / {total}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold text-ink-400">作業時間</div>
            <div className="mt-0.5 text-[16px] font-extrabold tabular-nums">
              {doneMin}
              <span className="text-[12px] text-ink-400">/{totalMin}分</span>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Progress value={total === 0 ? 0 : done / total} />
        </div>
      </div>

      {/* タスク */}
      <div className="mt-6">
        <SectionTitle
          right={
            !log.closed && (
              <button
                onClick={() => setSheet('add')}
                className="pressable text-[12px] font-bold text-acid-400"
              >
                ＋ 追加
              </button>
            )
          }
        >
          今日やること
        </SectionTitle>
        <div className="space-y-2">
          {log.tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              locked={log.closed}
              onToggle={() => toggleTask(date, t.id)}
              onRemove={() => removeTask(date, t.id)}
            />
          ))}
        </div>
      </div>

      {/* 締め */}
      <div className="mt-6">
        {log.closed ? (
          <Card className="border-ink-700">
            <div className="text-[13px] font-extrabold text-ink-300">この日は締め済み</div>
            {log.revenue ? (
              <div className="mt-1.5 text-[13px] text-acid-400">
                収益 {log.revenue.toLocaleString()}円
              </div>
            ) : null}
            {log.memo ? <p className="mt-1.5 text-[13px] text-ink-400">{log.memo}</p> : null}
          </Card>
        ) : (
          <Button full size="lg" variant={done === total && total > 0 ? 'primary' : 'soft'} onClick={() => setSheet('close')}>
            {done === total && total > 0 ? '全部やった。1日を締める' : '1日を締めて翌日の指示をもらう'}
          </Button>
        )}
      </div>

      {/* 全体進捗 */}
      <div className="mt-6">
        <SectionTitle>{pb.name}・全体</SectionTitle>
        <Card>
          <div className="flex justify-between text-[12px] font-bold text-ink-400">
            <span>{progress.planProgress >= 1 ? '立ち上げ完了・反復フェーズ' : '計画の消化'}</span>
            <span className="tabular-nums text-ink-200">
              {Math.round(progress.planProgress * 100)}%
            </span>
          </div>
          <div className="mt-2">
            <Progress value={progress.planProgress} marker={progress.elapsed} />
          </div>
          <div className="mt-1.5 text-[11px] text-ink-500">
            白線＝期間の経過（{Math.round(progress.elapsed * 100)}%）。線より右にいれば前倒し
          </div>
          <div className="mt-3 flex gap-4 border-t border-ink-700 pt-3 text-[12px]">
            <div>
              <span className="text-ink-400">残り </span>
              <span className="font-extrabold tabular-nums">{progress.daysLeft}日</span>
            </div>
            <div>
              <span className="text-ink-400">連続 </span>
              <span className="font-extrabold tabular-nums text-acid-400">{progress.streak}日</span>
            </div>
            <div>
              <span className="text-ink-400">累計 </span>
              <span className="font-extrabold tabular-nums">
                {progress.totalRevenue.toLocaleString()}円
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* シート：締め入力 */}
      {sheet === 'close' && (
        <Sheet onClose={() => setSheet('none')} title="今日の実績を記録">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-bold text-ink-200">
                今日確定した収益（円）
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
                placeholder="0"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-bold text-ink-200">
                実際の作業時間（分）
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={actualMin}
                onChange={(e) => setActualMin(e.target.value)}
                placeholder={String(doneMin)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-bold text-ink-200">
                気づき・詰まったこと
              </label>
              <textarea
                rows={3}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="例：提案文のテンプレが弱い。返信ゼロだった。"
                className={inputCls}
              />
            </div>
            <Button full size="lg" onClick={onClose}>
              締めて、明日の指示を受け取る
            </Button>
          </div>
        </Sheet>
      )}

      {/* シート：締めた結果 */}
      {sheet === 'result' && reviewText && (
        <Sheet
          onClose={() => {
            setSheet('none');
            setRevenue('');
            setMemo('');
            setActualMin('');
          }}
          title=""
        >
          <div className="pb-2">
            <div className="text-[22px] leading-tight font-extrabold">{reviewText.headline}</div>
            <p className="mt-3 mb-6 text-[14px] leading-relaxed whitespace-pre-line text-ink-200">
              {reviewText.body}
            </p>
            <Button
              full
              size="lg"
              onClick={() => {
                setSheet('none');
                setRevenue('');
                setMemo('');
                setActualMin('');
                if (date < todayISO()) setDate(addDays(date, 1));
              }}
            >
              わかった
            </Button>
          </div>
        </Sheet>
      )}

      {/* シート：タスク追加 */}
      {sheet === 'add' && (
        <Sheet onClose={() => setSheet('none')} title="自分でタスクを足す">
          <div className="space-y-4">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="やること"
              className={inputCls}
            />
            <input
              type="number"
              inputMode="numeric"
              value={newMin}
              onChange={(e) => setNewMin(e.target.value)}
              placeholder="所要（分）"
              className={inputCls}
            />
            <Button
              full
              size="lg"
              disabled={!newTitle.trim()}
              onClick={() => {
                addCustomTask(date, newTitle.trim(), Number(newMin) || 30);
                setNewTitle('');
                setNewMin('30');
                setSheet('none');
              }}
            >
              追加する
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onRemove,
  locked,
}: {
  task: Task;
  onToggle: () => void;
  onRemove: () => void;
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cx(
        'card overflow-hidden transition-colors',
        task.done && 'border-acid-500/30 bg-acid-500/5',
      )}
    >
      <div className="flex items-start gap-3 p-3.5">
        <button
          onClick={locked ? undefined : onToggle}
          aria-label={task.done ? '完了を取り消す' : '完了にする'}
          className={cx(
            'pressable mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 text-[13px] font-extrabold',
            task.done
              ? 'animate-pop border-acid-500 bg-acid-500 text-ink-950'
              : 'border-ink-500 text-transparent',
            locked && 'opacity-60',
          )}
        >
          ✓
        </button>
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            {task.carriedFrom && (
              <span className="rounded-md bg-flame-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-flame-400">
                繰越
              </span>
            )}
            <span className="rounded-md bg-ink-700 px-1.5 py-0.5 text-[10px] font-bold text-ink-300">
              {task.tag}
            </span>
            <span className="text-[11px] font-bold text-ink-500">{task.estMin}分</span>
          </div>
          <div
            className={cx(
              'mt-1 text-[15px] leading-snug font-bold',
              task.done && 'text-ink-400 line-through',
            )}
          >
            {task.title}
          </div>
          {open && (
            <p className="animate-rise mt-2 text-[13px] leading-relaxed text-ink-400">
              {task.detail}
            </p>
          )}
        </button>
        {open && !locked && (
          <button
            onClick={onRemove}
            className="pressable mt-0.5 shrink-0 px-1 text-[11px] font-bold text-ink-500"
          >
            削除
          </button>
        )}
      </div>
    </div>
  );
}

export function Sheet({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
      <div
        className="animate-rise relative max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-t border-ink-700 bg-ink-900 px-5 pt-4"
        style={{ paddingBottom: 'calc(1.5rem + var(--safe-b))' }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink-600" />
        {title && <h3 className="mb-4 text-[17px] font-extrabold">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
