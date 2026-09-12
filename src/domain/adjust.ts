import type { DayLog, Plan } from '../types';
import { addDays, weekKey } from '../lib/date';
import type { Progress } from './progress';

export interface Adjustment {
  /** 調整後の1日あたり作業分数 */
  dailyMinutes: number;
  /** 変化量（分） */
  delta: number;
  /** 調整理由（上司の言葉） */
  reason: string;
  mode: 'reduce' | 'keep' | 'increase';
}

const MIN_DAILY = 20;

/**
 * その日の実績をもとに、翌日の負荷を自動調整する。
 * - 3日連続で未着手 → 大幅に減らして「1個だけやる」状態に戻す
 * - 直近の消化率が低い → 少し減らす
 * - 高い消化率が続く → 少し増やす
 */
export function computeAdjustment(plan: Plan, progress: Progress): Adjustment {
  const base = plan.baseDailyMinutes;
  const cur = plan.dailyMinutes;
  const round = (n: number) => Math.max(MIN_DAILY, Math.round(n / 5) * 5);

  if (progress.missStreak >= 3) {
    const next = round(Math.min(cur, base) * 0.5);
    return {
      dailyMinutes: next,
      delta: next - cur,
      reason: `3日止まってる。量が多すぎるのが原因だから、明日は${next}分だけに削る。まず1個やって流れを戻そう`,
      mode: 'reduce',
    };
  }
  if (progress.recentRate < 0.45 && progress.allTasks >= 4) {
    const next = round(cur * 0.8);
    if (next < cur)
      return {
        dailyMinutes: next,
        delta: next - cur,
        reason: `消化率が${Math.round(progress.recentRate * 100)}%。積み残しが増えると自己嫌悪ループに入るから、明日は${next}分に減らす`,
        mode: 'reduce',
      };
  }
  if (progress.recentRate >= 0.9 && progress.streak >= 3) {
    const next = round(Math.min(cur * 1.15, base * 1.6));
    if (next > cur)
      return {
        dailyMinutes: next,
        delta: next - cur,
        reason: `${progress.streak}日連続で消化しきってる。余力あるね。明日から${next}分に増やす`,
        mode: 'increase',
      };
  }
  return {
    dailyMinutes: cur,
    delta: 0,
    reason: 'ペースは悪くない。量はこのままでいく',
    mode: 'keep',
  };
}

/** 1日を締めて、プランの消化状態を更新する */
export function closeDay(plan: Plan, log: DayLog): Plan {
  const consumed = new Set(plan.consumedStepIds);
  const wk = weekKey(log.date);
  const counts = { ...(plan.routineCounts[wk] ?? {}) };

  for (const t of log.tasks) {
    if (!t.done) continue;
    if (t.kind === 'step') consumed.add(t.sourceId);
    else counts[t.sourceId] = (counts[t.sourceId] ?? 0) + 1;
  }

  return {
    ...plan,
    consumedStepIds: [...consumed],
    routineCounts: { ...plan.routineCounts, [wk]: counts },
  };
}

/** 翌日の日付 */
export const nextDay = (date: string) => addDays(date, 1);
