import { useAppStore } from '../store/useAppStore';
import { computeProgress, dailyRates, monthlyRevenue, tagBreakdown } from '../domain/progress';
import { insights } from '../domain/coach';
import { computeWeeklyFocus } from '../domain/weekly';
import { goalKindOf, goalLabel } from '../domain/goals';
import { Card, Empty, Progress, SectionTitle, Stat } from '../components/ui';
import { cx } from '../lib/style';
import { formatShort, todayISO } from '../lib/date';

export default function Stats() {
  const { profile, plan, logs } = useAppStore();
  if (!profile || !plan) return null;

  const today = todayISO();
  const p = computeProgress(profile, plan, logs, today);
  const rates = dailyRates(logs, 14, today);
  const months = monthlyRevenue(logs);
  const tags = tagBreakdown(logs);
  const tips = insights(profile, plan, p);
  const focus = computeWeeklyFocus(profile, plan, logs, today);

  const kind = goalKindOf(profile);
  const paceLabel = {
    ahead: { t: '先行してる', c: 'text-acid-400' },
    onTrack: { t: '想定どおり', c: 'text-ink-100' },
    behind: { t: '遅れてる', c: 'text-amberx-400' },
    stalled: { t: '止まってる', c: 'text-flame-400' },
  }[p.pace];

  return (
    <div className="px-4 pt-5 pb-28">
      <h1 className="text-[22px] font-extrabold">分析</h1>
      <p className="mt-1 text-[13px] text-ink-400">
        ペース判定：<span className={cx('font-extrabold', paceLabel.c)}>{paceLabel.t}</span>
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat
          label={kind.id === 'money' ? '累計収益' : `累計の${kind.outcomeName}`}
          value={
            kind.tracksOutcome ? `${p.totalRevenue.toLocaleString()}${kind.unit}` : `${p.streak}日`
          }
          sub={`目標 ${goalLabel(profile)}`}
          tone={p.totalRevenue > 0 || p.streak > 0 ? 'good' : 'default'}
        />
        <Stat
          label={kind.id === 'money' ? '今月の収益' : '計画の消化'}
          value={
            kind.id === 'money'
              ? `${p.monthRevenue.toLocaleString()}円`
              : `${Math.round(p.planProgress * 100)}%`
          }
          sub={
            kind.id === 'money'
              ? `必要 ${p.needMonthly.toLocaleString()}円/月`
              : `期間の経過 ${Math.round(p.elapsed * 100)}%`
          }
          tone={
            kind.id === 'money'
              ? p.monthRevenue >= p.needMonthly
                ? 'good'
                : 'default'
              : p.planProgress >= p.elapsed
                ? 'good'
                : 'default'
          }
        />
        <Stat
          label="直近7日の消化率"
          value={`${Math.round(p.recentRate * 100)}%`}
          sub={`完了 ${p.recentDone} / ${p.recentAll} タスク`}
          tone={p.recentRate >= 0.7 ? 'good' : p.recentRate < 0.4 ? 'bad' : 'default'}
        />
        <Stat
          label="連続実行"
          value={`${p.streak}日`}
          sub={p.missStreak > 0 ? `直近${p.missStreak}日ゼロ` : '継続中'}
          tone={p.missStreak >= 2 ? 'bad' : 'good'}
        />
      </div>

      <div className="mt-7">
        <SectionTitle right={<span className="text-[11px] text-ink-500">第{focus.weekNo}週</span>}>
          今週のテーマ
        </SectionTitle>
        <Card className="border-acid-500/30 bg-acid-500/5">
          <div className="text-[16px] leading-snug font-extrabold text-acid-400">{focus.theme}</div>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-300">{focus.why}</p>
          <div className="mt-3 border-t border-ink-700 pt-2.5">
            <div className="text-[10.5px] font-extrabold text-ink-400">今週おさえる数字</div>
            <div className="mt-1 text-[13px] font-bold">{focus.kpi}</div>
          </div>
          {focus.lastWeek && (
            <div className="mt-2.5 flex gap-4 border-t border-ink-700 pt-2.5 text-[11.5px]">
              <span className="text-ink-400">
                先週の消化{' '}
                <span className="font-extrabold text-ink-200">
                  {Math.round(focus.lastWeek.rate * 100)}%
                </span>
              </span>
              <span className="text-ink-400">
                先週の収益{' '}
                <span className="font-extrabold text-ink-200">
                  {focus.lastWeek.revenue.toLocaleString()}円
                </span>
              </span>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-7">
        <SectionTitle>上司からの示唆</SectionTitle>
        <div className="space-y-2">
          {tips.map((t, i) => (
            <Card key={i} className="border-ink-700">
              <p className="text-[13.5px] leading-relaxed text-ink-200">{t}</p>
            </Card>
          ))}
        </div>
      </div>

      <div className="mt-7">
        <SectionTitle right={<span className="text-[11px] text-ink-500">直近14日</span>}>
          日次の消化率
        </SectionTitle>
        <Card>
          {p.allTasks === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-400">まだ記録がない</p>
          ) : (
            <>
              <div className="flex h-28 items-end gap-[3px]">
                {rates.map((r, i) => (
                  <div
                    key={r.date}
                    title={`${formatShort(r.date)} ${r.done}/${r.total}`}
                    className={cx(
                      'flex-1 rounded-sm transition-all',
                      // 今日はまだ途中。未達として赤くしない
                      (i === rates.length - 1 && r.done === 0) || r.total === 0
                        ? 'bg-ink-700'
                        : r.rate >= 0.8
                          ? 'bg-acid-500'
                          : r.rate >= 0.4
                            ? 'bg-amberx-400'
                            : r.rate > 0
                              ? 'bg-flame-500'
                              : 'bg-flame-500/40',
                    )}
                    style={{ height: `${Math.max(r.total === 0 ? 4 : r.rate * 100, 5)}%` }}
                  />
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[10px] font-bold text-ink-500">
                <span>{formatShort(rates[0].date)}</span>
                <span>{formatShort(rates[rates.length - 1].date)}</span>
              </div>
            </>
          )}
        </Card>
      </div>

      <div className={cx('mt-7', kind.id !== 'money' && 'hidden')}>
        <SectionTitle>収益の推移</SectionTitle>
        {months.length === 0 ? (
          <Empty
            title="まだ1円も記録されてない"
            body="作業だけ進んでも意味がない。売る行為をタスクに入れて、1円目を取りにいこう。"
          />
        ) : (
          <Card>
            <div className="space-y-3">
              {months.map((m) => (
                <div key={m.month}>
                  <div className="flex justify-between text-[12px] font-bold">
                    <span className="text-ink-300">{m.month.replace('-', '/')}</span>
                    <span className="tabular-nums text-ink-100">
                      {m.amount.toLocaleString()}円
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Progress
                      value={m.amount / Math.max(p.needMonthly, 1)}
                      color={m.amount >= p.needMonthly ? 'acid' : 'amber'}
                      height={6}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t border-ink-700 pt-2.5 text-[11px] text-ink-500">
              バーは必要月収 {p.needMonthly.toLocaleString()}円 に対する達成度
            </p>
          </Card>
        )}
      </div>

      {tags.length > 0 && (
        <div className="mt-7">
          <SectionTitle>何に時間を使ってるか</SectionTitle>
          <Card>
            <div className="space-y-2.5">
              {tags.slice(0, 7).map((t) => (
                <div key={t.tag}>
                  <div className="flex justify-between text-[12px] font-bold">
                    <span className="text-ink-300">{t.tag}</span>
                    <span className="tabular-nums text-ink-400">{t.done}回</span>
                  </div>
                  <div className="mt-1">
                    <Progress value={t.done / tags[0].done} height={5} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
