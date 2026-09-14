import { useAppStore } from '../store/useAppStore';
import { getPlaybook } from '../domain/playbooks';
import { computeProgress } from '../domain/progress';
import { phaseForDate } from '../domain/planner';
import { Card, Progress, SectionTitle } from '../components/ui';
import { cx } from '../lib/style';
import { diffDays, formatJP, todayISO } from '../lib/date';

export default function Plan() {
  const { profile, plan, decision, logs } = useAppStore();
  if (!profile || !plan || !decision) return null;

  const pb = getPlaybook(plan.playbookId);
  const today = todayISO();
  const progress = computeProgress(profile, plan, logs, today);
  const currentPhase = phaseForDate(plan, today);
  const consumed = new Set(plan.consumedStepIds);

  return (
    <div className="px-4 pt-5 pb-28">
      <h1 className="text-[22px] font-extrabold">計画</h1>
      <p className="mt-1 text-[13px] text-ink-400">
        {pb.name} ／ {formatJP(profile.startDate)} 〜 {formatJP(profile.deadline)}
      </p>

      <Card className="mt-4">
        <div className="flex justify-between text-[12px] font-bold text-ink-400">
          <span>ステップ消化</span>
          <span className="tabular-nums text-ink-200">
            {plan.consumedStepIds.length} / {pb.steps.length}
          </span>
        </div>
        <div className="mt-2">
          <Progress value={progress.planProgress} marker={progress.elapsed} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-ink-700 pt-3 text-center">
          <KV label="残り" value={`${progress.daysLeft}日`} />
          <KV label="1日の量" value={`${plan.dailyMinutes}分`} />
          <KV label="必要月収" value={`${Math.round(progress.needMonthly / 1000)}k`} />
        </div>
      </Card>

      <div className="mt-7">
        <SectionTitle>フェーズ</SectionTitle>
        <div className="space-y-2.5">
          {plan.phases.map((ph) => {
            const state =
              ph.no < currentPhase ? 'past' : ph.no === currentPhase ? 'now' : 'future';
            const stepsOfPhase = pb.steps.filter((s) => s.phase === ph.no);
            const doneCount = stepsOfPhase.filter((s) => consumed.has(s.id)).length;
            return (
              <div
                key={ph.no}
                className={cx(
                  'card p-4',
                  state === 'now' && 'border-acid-500/40 bg-acid-500/5',
                  state === 'past' && 'opacity-60',
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cx(
                        'flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-extrabold',
                        state === 'now' ? 'bg-acid-500 text-ink-950' : 'bg-ink-700 text-ink-300',
                      )}
                    >
                      {ph.no}
                    </span>
                    <span className="text-[15px] font-extrabold">{ph.name}</span>
                  </div>
                  {state === 'now' && (
                    <span className="rounded-full bg-acid-500/20 px-2 py-0.5 text-[10px] font-extrabold text-acid-400">
                      進行中
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-300">{ph.goal}</p>
                <div className="mt-2.5 flex items-center justify-between text-[11.5px] font-bold text-ink-500">
                  <span>
                    {formatJP(ph.startDate)} 〜 {formatJP(ph.endDate)}
                  </span>
                  <span className="tabular-nums">
                    {doneCount}/{stepsOfPhase.length} 完了
                  </span>
                </div>
                {state === 'now' && (
                  <div className="mt-2">
                    <Progress
                      value={stepsOfPhase.length ? doneCount / stepsOfPhase.length : 0}
                      height={5}
                    />
                    <div className="mt-1.5 text-[11px] text-ink-500">
                      このフェーズ残り {Math.max(diffDays(today, ph.endDate), 0)} 日
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-7">
        <SectionTitle right={<span className="text-[11px] text-ink-500">上から順に指示される</span>}>
          全ステップ
        </SectionTitle>
        <div className="space-y-1.5">
          {pb.steps.map((s) => {
            const isDone = consumed.has(s.id);
            return (
              <div
                key={s.id}
                className={cx('card px-3.5 py-3', isDone && 'border-acid-500/25 bg-acid-500/5')}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={cx(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-extrabold',
                      isDone ? 'bg-acid-500 text-ink-950' : 'bg-ink-700 text-ink-400',
                    )}
                  >
                    {isDone ? '✓' : s.phase}
                  </span>
                  <div className="min-w-0">
                    <div
                      className={cx(
                        'text-[14px] leading-snug font-bold',
                        isDone && 'text-ink-400 line-through',
                      )}
                    >
                      {s.title}
                    </div>
                    <div className="mt-0.5 text-[11.5px] font-bold text-ink-500">
                      {s.tag} ・ {s.estMin}分
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-7">
        <SectionTitle>くり返すこと（週あたり）</SectionTitle>
        <div className="space-y-1.5">
          {pb.routines.map((r) => (
            <div key={r.id} className="card flex items-center justify-between px-3.5 py-3">
              <div className="min-w-0 pr-3">
                <div className="text-[14px] font-bold">{r.title}</div>
                <div className="mt-0.5 text-[11.5px] font-bold text-ink-500">
                  フェーズ{r.phase}〜 ・ {r.estMin}分
                </div>
              </div>
              <span className="shrink-0 rounded-lg bg-ink-700 px-2.5 py-1 text-[12px] font-extrabold text-acid-400">
                週{r.perWeek}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] font-bold text-ink-400">{label}</div>
      <div className="mt-0.5 text-[15px] font-extrabold tabular-nums">{value}</div>
    </div>
  );
}
