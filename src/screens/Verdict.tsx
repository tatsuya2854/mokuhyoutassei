import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { PLAYBOOKS, getPlaybook } from '../domain/playbooks';
import { Button, Card } from '../components/ui';
import { cx } from '../lib/style';
import { goalCritique } from '../domain/coach';
import { diffDays, formatJP, todayISO } from '../lib/date';

export default function Verdict({ onConfirm }: { onConfirm: () => void }) {
  const { profile, decision, plan, switchPlaybook } = useAppStore();
  const [showOthers, setShowOthers] = useState(false);

  if (!profile || !decision || !plan) return null;
  const pb = getPlaybook(decision.playbookId);
  const critique = goalCritique(profile, decision.requiredMonthly, decision.feasibility);

  const feas = {
    easy: { label: '達成可能', cls: 'text-acid-400 bg-acid-500/15 border-acid-500/30' },
    tight: { label: 'ギリギリ', cls: 'text-amberx-400 bg-amberx-400/15 border-amberx-400/30' },
    hard: { label: '正直きつい', cls: 'text-flame-400 bg-flame-500/15 border-flame-500/30' },
  }[decision.feasibility];

  return (
    <div className="min-h-dvh bg-ink-950 px-5 pb-40" style={{ paddingTop: 'calc(2rem + var(--safe-t))' }}>
      <div className="animate-rise">
        <div className="text-[12px] font-extrabold tracking-[0.2em] text-acid-500">結論</div>
        <h1 className="mt-3 text-[27px] leading-[1.25] font-extrabold">{decision.verdict}</h1>

        <Card className="mt-6 border-acid-500/30 bg-acid-500/5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[20px] font-extrabold text-acid-400">{pb.name}</div>
              <div className="mt-1 text-[13px] text-ink-300">{pb.tagline}</div>
            </div>
            <span
              className={cx(
                'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-extrabold',
                feas.cls,
              )}
            >
              {feas.label}
            </span>
          </div>
          <p className="mt-3 border-t border-ink-700 pt-3 text-[13px] leading-relaxed text-ink-300">
            {pb.model}
          </p>
        </Card>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Mini label="目標" value={`${(profile.goalAmount / 10000).toLocaleString()}万`} sub={profile.goalMode === 'monthly' ? '毎月' : '合計'} />
          <Mini label="期限" value={formatJP(profile.deadline).replace(/\(.\)/, '')} sub={`残り${Math.max(0, diffDays(todayISO(), profile.deadline))}日`} />
          <Mini
            label="必要な月収"
            value={`${Math.round(decision.requiredMonthly / 1000).toLocaleString()}k`}
            sub="月のライン"
          />
        </div>

        <h2 className="mt-8 mb-3 text-[15px] font-extrabold">なぜこれに決めたか</h2>
        <ul className="space-y-2.5">
          {decision.reasons.map((r, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-acid-500" />
              <span className="text-[14px] leading-relaxed text-ink-200">{r}</span>
            </li>
          ))}
        </ul>

        {pb.risks.length > 0 && (
          <Card className="mt-5 border-flame-500/25 bg-flame-500/5">
            <div className="text-[13px] font-extrabold text-flame-400">先に言っておくリスク</div>
            <ul className="mt-2 space-y-1.5">
              {pb.risks.map((r, i) => (
                <li key={i} className="text-[13px] leading-relaxed text-ink-300">
                  ・{r}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {critique && (
          <Card className="mt-4 border-ink-600">
            <div className="text-[13px] font-extrabold text-amberx-400">ひとこと言わせて</div>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-200">{critique}</p>
          </Card>
        )}

        <button
          onClick={() => setShowOthers((v) => !v)}
          className="pressable mt-6 w-full rounded-2xl border border-ink-700 px-4 py-3 text-[13px] font-bold text-ink-300"
        >
          {showOthers ? '閉じる' : '他の手段を却下した理由を見る'}
        </button>

        {showOthers && (
          <div className="animate-rise mt-3 space-y-2">
            {decision.rejected.map((r) => {
              const p = getPlaybook(r.playbookId);
              return (
                <div key={r.playbookId} className="card px-4 py-3">
                  <div className="text-[14px] font-bold text-ink-200">{p.name}</div>
                  <div className="mt-1 text-[12.5px] leading-relaxed text-ink-400">{r.reason}</div>
                </div>
              );
            })}
            <details className="card px-4 py-3">
              <summary className="cursor-pointer text-[13px] font-bold text-ink-400">
                どうしても別の手段にしたい
              </summary>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-400">
                変えてもいいけど、変えたら二度と迷わないこと。乗り換え続けるのが一番時間を溶かす。
              </p>
              <div className="mt-3 space-y-1.5">
                {PLAYBOOKS.filter((p) => p.id !== decision.playbookId).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => switchPlaybook(p.id)}
                    className="pressable w-full rounded-xl border border-ink-700 px-3 py-2.5 text-left text-[13px] font-bold text-ink-300"
                  >
                    {p.name} に変更
                  </button>
                ))}
              </div>
            </details>
          </div>
        )}

        <h2 className="mt-8 mb-3 text-[15px] font-extrabold">ここまでの道のり</h2>
        <div className="space-y-2">
          {plan.phases.map((ph) => (
            <div key={ph.no} className="card flex gap-3.5 px-4 py-3.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink-700 text-[12px] font-extrabold text-acid-400">
                {ph.no}
              </span>
              <div className="min-w-0">
                <div className="text-[14.5px] font-bold">{ph.name}</div>
                <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-400">{ph.goal}</div>
                <div className="mt-1 text-[11.5px] font-bold text-ink-500">
                  {formatJP(ph.startDate)} 〜 {formatJP(ph.endDate)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 border-t border-ink-800 bg-ink-950/95 px-5 pt-3 backdrop-blur"
        style={{ paddingBottom: 'calc(0.75rem + var(--safe-b))' }}
      >
        <Button full size="lg" onClick={onConfirm}>
          これでいく。今日のタスクを見る
        </Button>
      </div>
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card px-3 py-2.5 text-center">
      <div className="text-[10.5px] font-bold text-ink-400">{label}</div>
      <div className="mt-0.5 text-[16px] font-extrabold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10.5px] text-ink-500">{sub}</div>
    </div>
  );
}
