import { getPlaybook } from './playbooks';
import { filterByGoal, goalKindOf } from './goals';
import { requiredMonthly } from './decide';
import type { DayLog, Plan, Profile } from '../types';
import { addDays, diffDays, monthKey, todayISO } from '../lib/date';

export interface Progress {
  /** 期間の経過率 0-1 */
  elapsed: number;
  /** ステップ消化率 0-1 */
  planProgress: number;
  /** 収益の達成率 0-1 */
  revenueProgress: number;
  /** 累計収益 */
  totalRevenue: number;
  /** 今月の収益 */
  monthRevenue: number;
  /** 目標（total なら総額、monthly なら月額） */
  target: number;
  /** ペース判定 */
  pace: 'ahead' | 'onTrack' | 'behind' | 'stalled';
  /** 直近7日の消化率 0-1 */
  recentRate: number;
  /** 直近7日の完了タスク数 */
  recentDone: number;
  /** 直近7日の生成タスク数 */
  recentAll: number;
  /** 連続実行日数 */
  streak: number;
  /** 直近の連続未達日数 */
  missStreak: number;
  /** 残り日数 */
  daysLeft: number;
  /** 必要な月収 */
  needMonthly: number;
  /** 完了タスク総数 */
  doneTasks: number;
  /** 総タスク数（生成済み） */
  allTasks: number;
}

export function computeProgress(
  profile: Profile,
  plan: Plan,
  logs: Record<string, DayLog>,
  today = todayISO(),
): Progress {
  const totalDays = Math.max(diffDays(profile.startDate, profile.deadline), 1);
  const passed = Math.max(diffDays(profile.startDate, today), 0);
  const elapsed = Math.min(passed / totalDays, 1);

  const stepsTotal = filterByGoal(getPlaybook(plan.playbookId).steps, goalKindOf(profile)).length;
  const planProgress = Math.min(plan.consumedStepIds.length / Math.max(stepsTotal, 1), 1);

  // 先読みで生成された未来日のタスクは実績に数えない
  const entries = Object.values(logs).filter((l) => diffDays(l.date, today) >= 0);
  const totalRevenue = entries.reduce((a, l) => a + (l.revenue ?? 0), 0);
  const mk = monthKey(today);
  const monthRevenue = entries
    .filter((l) => monthKey(l.date) === mk)
    .reduce((a, l) => a + (l.revenue ?? 0), 0);

  const needMonthly = requiredMonthly(profile);
  const target = profile.goalMode === 'monthly' ? profile.goalAmount : profile.goalAmount;
  const revenueProgress =
    profile.goalMode === 'monthly'
      ? Math.min(monthRevenue / Math.max(target, 1), 1)
      : Math.min(totalRevenue / Math.max(target, 1), 1);

  // --- 直近7日の消化率 ---
  let rDone = 0;
  let rAll = 0;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, -i + 1);
    const log = logs[d];
    if (!log) continue;
    rDone += log.tasks.filter((t) => t.done).length;
    rAll += log.tasks.length;
  }
  const recentRate = rAll === 0 ? 0 : rDone / rAll;

  // --- streak / missStreak ---
  let streak = 0;
  for (let i = 0; i < 120; i++) {
    const d = addDays(today, -i);
    const log = logs[d];
    if (!log) {
      if (i === 0) continue; // 今日はまだ未記録でもOK
      break;
    }
    if (log.tasks.some((t) => t.done)) streak++;
    else if (i > 0) break;
  }
  let missStreak = 0;
  for (let i = 1; i < 60; i++) {
    const d = addDays(today, -i);
    const log = logs[d];
    if (!log) break;
    const done = log.tasks.filter((t) => t.done).length;
    if (done === 0 && log.tasks.length > 0) missStreak++;
    else break;
  }

  const doneTasks = entries.reduce((a, l) => a + l.tasks.filter((t) => t.done).length, 0);
  const allTasks = entries.reduce((a, l) => a + l.tasks.length, 0);

  // --- ペース判定：計画進捗と収益進捗の良い方を経過率と比較 ---
  const achieved = Math.max(planProgress, revenueProgress);
  const noActivity = doneTasks === 0 && totalRevenue === 0 && planProgress === 0;
  let pace: Progress['pace'];
  if (missStreak >= 3) pace = 'stalled';
  // 開始直後は実績ゼロでも「先行」にはならない。褒めるのは動いてからでいい
  else if (noActivity) pace = elapsed > 0.15 ? 'behind' : 'onTrack';
  else if (achieved >= elapsed * 1.15) pace = 'ahead';
  else if (achieved >= elapsed * 0.8) pace = 'onTrack';
  else pace = 'behind';

  return {
    elapsed,
    recentDone: rDone,
    recentAll: rAll,
    planProgress,
    revenueProgress,
    totalRevenue,
    monthRevenue,
    target,
    pace,
    recentRate,
    streak,
    missStreak,
    daysLeft: Math.max(diffDays(today, profile.deadline), 0),
    needMonthly,
    doneTasks,
    allTasks,
  };
}

/** 月別の収益集計 */
export function monthlyRevenue(logs: Record<string, DayLog>): { month: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const l of Object.values(logs)) {
    if (!l.revenue) continue;
    const k = monthKey(l.date);
    map.set(k, (map.get(k) ?? 0) + l.revenue);
  }
  return [...map.entries()].sort().map(([month, amount]) => ({ month, amount }));
}

/** 直近N日の日次消化率 */
export function dailyRates(
  logs: Record<string, DayLog>,
  days: number,
  today = todayISO(),
): { date: string; rate: number; done: number; total: number }[] {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const log = logs[date];
    const total = log?.tasks.length ?? 0;
    const done = log?.tasks.filter((t) => t.done).length ?? 0;
    out.push({ date, total, done, rate: total === 0 ? 0 : done / total });
  }
  return out;
}

/** タグ別の実行分布 */
export function tagBreakdown(logs: Record<string, DayLog>): { tag: string; done: number }[] {
  const map = new Map<string, number>();
  for (const l of Object.values(logs)) {
    for (const t of l.tasks) {
      if (!t.done) continue;
      map.set(t.tag, (map.get(t.tag) ?? 0) + 1);
    }
  }
  return [...map.entries()].map(([tag, done]) => ({ tag, done })).sort((a, b) => b.done - a.done);
}
