import { useAppStore } from '../store/useAppStore';
import { Card, Empty } from '../components/ui';
import { cx } from '../lib/style';
import { formatJP } from '../lib/date';

export default function LogList() {
  const { logs } = useAppStore();
  const days = Object.values(logs).sort((a, b) => b.date.localeCompare(a.date));
  const recorded = days.filter((d) => d.tasks.length > 0);

  return (
    <div className="px-4 pb-28" style={{ paddingTop: 'calc(1.25rem + var(--safe-t))' }}>
      <h1 className="text-[22px] font-extrabold">記録</h1>
      <p className="mt-1 text-[13px] text-ink-400">
        やった／やらなかったを残す。ここが改善の材料になる。
      </p>

      <div className="mt-5 space-y-2.5">
        {recorded.length === 0 && (
          <Empty title="まだ記録がない" body="今日のタスクをこなして、1日を締めるとここに残る。" />
        )}
        {recorded.map((d) => {
          const done = d.tasks.filter((t) => t.done).length;
          const total = d.tasks.length;
          const rate = total === 0 ? 0 : done / total;
          return (
            <Card key={d.date}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cx(
                      'flex h-8 w-8 items-center justify-center rounded-xl text-[12px] font-extrabold',
                      rate === 1
                        ? 'bg-acid-500 text-ink-950'
                        : rate >= 0.5
                          ? 'bg-amberx-400/20 text-amberx-400'
                          : done === 0
                            ? 'bg-flame-500/20 text-flame-400'
                            : 'bg-ink-700 text-ink-300',
                    )}
                  >
                    {done}/{total}
                  </span>
                  <div>
                    <div className="text-[14.5px] font-bold">{formatJP(d.date)}</div>
                    <div className="text-[11px] font-bold text-ink-500">
                      {d.closed ? '締め済み' : '未締め'}
                      {d.actualMin ? ` ・ ${d.actualMin}分` : ''}
                    </div>
                  </div>
                </div>
                {d.revenue ? (
                  <span className="text-[14px] font-extrabold tabular-nums text-acid-400">
                    +{d.revenue.toLocaleString()}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 space-y-1">
                {d.tasks.map((t) => (
                  <div key={t.id} className="flex items-start gap-2 text-[12.5px]">
                    <span
                      className={cx(
                        'mt-0.5 shrink-0 font-extrabold',
                        t.done ? 'text-acid-400' : 'text-ink-600',
                      )}
                    >
                      {t.done ? '✓' : '×'}
                    </span>
                    <span className={cx(t.done ? 'text-ink-300' : 'text-ink-500 line-through')}>
                      {t.title}
                    </span>
                  </div>
                ))}
              </div>

              {d.memo && (
                <p className="mt-3 rounded-xl bg-ink-800 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-300">
                  {d.memo}
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
