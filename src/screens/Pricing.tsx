import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  PLANS,
  PLAN_ORDER,
  TRIAL_DAYS,
  freeMonths,
  perMonth,
  priceOf,
  trialDaysLeft,
} from '../domain/entitlements';
import type { Cycle, PlanId } from '../domain/entitlements';
import { Button } from '../components/ui';
import { cx } from '../lib/style';
import { formatJP, todayISO } from '../lib/date';

const yen = (n: number) => `${n.toLocaleString()}円`;

export default function Pricing({ onClose }: { onClose: () => void }) {
  const { sub, activePlan, subscribe, manageBilling } = useAppStore();
  const [cycle, setCycle] = useState<Cycle>('yearly');
  const [busy, setBusy] = useState<PlanId | null>(null);
  const today = todayISO();
  const current = activePlan();
  const left = trialDaysLeft(sub, today);

  const onPick = async (id: PlanId) => {
    setBusy(id);
    try {
      const url = await subscribe(id, cycle);
      if (url) window.location.href = url;
      else onClose();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-950">
      <div
        className="mx-auto max-w-lg px-4 pt-4"
        style={{ paddingBottom: 'calc(2rem + var(--safe-b))' }}
      >
        <div className="flex items-center justify-between">
          <div className="text-[17px] font-extrabold">プラン</div>
          <button onClick={onClose} className="pressable px-2 py-1 text-[13px] font-bold text-ink-400">
            閉じる
          </button>
        </div>

        {/* いまの状態 */}
        <div className="mt-3 rounded-2xl border border-ink-700 bg-ink-850 px-4 py-3">
          {sub?.status === 'trialing' && left > 0 ? (
            <>
              <div className="text-[13.5px] font-extrabold text-acid-400">
                無料期間・残り{left}日
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
                {sub.trialEndsOn ? `${formatJP(sub.trialEndsOn)}まで` : ''}
                Proの機能を全部使える。カード登録はまだ要らない。
              </p>
            </>
          ) : (
            <>
              <div className="text-[13.5px] font-extrabold">
                いまのプラン：{PLANS[current].name}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
                {PLANS[current].lead}
              </p>
            </>
          )}
        </div>

        {/* 月払い / 年払い */}
        <div className="mt-4 flex rounded-2xl border border-ink-700 bg-ink-850 p-1">
          {(['monthly', 'yearly'] as Cycle[]).map((c) => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={cx(
                'pressable flex-1 rounded-xl py-2.5 text-[13px] font-extrabold',
                cycle === c ? 'bg-acid-500 text-ink-950' : 'text-ink-400',
              )}
            >
              {c === 'monthly' ? '月払い' : '年払い（2ヶ月ぶん無料）'}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {PLAN_ORDER.filter((id) => id !== 'free').map((id) => {
            const d = PLANS[id];
            const isCurrent = current === id && sub?.status === 'active';
            return (
              <div
                key={id}
                className={cx(
                  'card p-4',
                  d.recommended ? 'border-acid-500/50 bg-acid-500/5' : 'border-ink-700',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[16px] font-extrabold">{d.name}</span>
                  {d.recommended && (
                    <span className="rounded-md bg-acid-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-acid-400">
                      主力
                    </span>
                  )}
                  {isCurrent && (
                    <span className="rounded-md bg-ink-700 px-1.5 py-0.5 text-[10px] font-extrabold text-ink-300">
                      契約中
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-400">{d.lead}</p>

                <div className="mt-3 flex items-end gap-2">
                  <span className="text-[26px] leading-none font-extrabold tabular-nums">
                    {yen(priceOf(id, cycle))}
                  </span>
                  <span className="pb-0.5 text-[12px] font-bold text-ink-400">
                    /{cycle === 'yearly' ? '年' : '月'}
                  </span>
                </div>
                {cycle === 'yearly' && (
                  <div className="mt-1 text-[11.5px] font-bold text-acid-400">
                    月あたり {yen(perMonth(id, 'yearly'))}（月払いより {yen(d.monthly * 12 - d.yearly)}
                    お得＝{freeMonths(id)}ヶ月ぶん無料）
                  </div>
                )}

                <ul className="mt-3 space-y-1.5 border-t border-ink-700 pt-3">
                  {d.highlights.map((h) => (
                    <li key={h} className="flex gap-2 text-[13px] leading-snug text-ink-200">
                      <span className="mt-px shrink-0 text-acid-400">✓</span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4">
                  <Button
                    full
                    size="lg"
                    variant={d.recommended ? 'primary' : 'soft'}
                    disabled={busy !== null || isCurrent}
                    onClick={() => onPick(id)}
                  >
                    {isCurrent ? '契約中' : busy === id ? '処理中…' : `${d.name}にする`}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* 無料プラン */}
        <div className="mt-3 rounded-2xl border border-dashed border-ink-700 px-4 py-3.5">
          <div className="text-[13.5px] font-extrabold text-ink-300">{PLANS.free.name}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
            {PLANS.free.lead} {PLANS.free.highlights.join('・')}。
          </p>
        </div>

        <p className="mt-4 text-[11.5px] leading-relaxed text-ink-500">
          最初の{TRIAL_DAYS}日間はProの全機能が無料。期間中に解約すれば請求は発生しない。
          決済はいつでも解約でき、残りの期間ぶんはそのまま使える。
        </p>

        {sub?.status === 'active' && (
          <button
            onClick={async () => {
              const url = await manageBilling();
              if (url) window.location.href = url;
            }}
            className="pressable mt-3 w-full py-2 text-[12.5px] font-bold text-ink-500"
          >
            支払い方法の変更・解約
          </button>
        )}
      </div>
    </div>
  );
}
