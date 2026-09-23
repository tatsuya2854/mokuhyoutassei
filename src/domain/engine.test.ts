import { describe, expect, it } from 'vitest';
import { decide, decideWith, expectedAt, requiredMonthly, scorePlaybook } from './decide';
import { PLAYBOOKS, getPlaybook } from './playbooks';
import {
  REVIEW_ID,
  buildPlan,
  computeDailyMinutes,
  exploreDaysLeft,
  generateTasks,
  isExploring,
  phaseForDate,
} from './planner';
import { computeWeeklyFocus, loopState } from './weekly';
import { ANXIETIES, ANXIETY_MAP, GOAL_KINDS, filterByGoal, goalKindOf } from './goals';
import { CLEAR_ID } from './planner';
import { closeDay, computeAdjustment } from './adjust';
import { computeProgress, dailyRates, monthlyRevenue, tagBreakdown } from './progress';
import { dayReview, insights, morningBriefing } from './coach';
import { addDays, diffDays, formatJP, rangeDays, toISO, weekKey } from '../lib/date';
import type { DayLog, Plan, Profile } from '../types';

const base: Profile = {
  anxiety: 'money',
  goalKind: 'money',
  goalAmount: 100000,
  goalMode: 'monthly',
  deadline: '2026-12-31',
  weeklyHours: 10,
  workdaysPerWeek: 5,
  skills: ['coding'],
  budget: 0,
  avoid: [],
  note: '',
  startDate: '2026-10-01',
};

const p = (patch: Partial<Profile> = {}): Profile => ({ ...base, ...patch });

/* ------------------------------ date ------------------------------ */
describe('date utils', () => {
  it('addDays / diffDays が月またぎで正しい', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-01-01', '2026-02-01')).toBe(31);
    expect(diffDays('2026-03-01', '2026-01-01')).toBe(-59);
  });

  it('うるう年を扱える', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(diffDays('2028-02-01', '2028-03-01')).toBe(29);
  });

  it('weekKey は月曜始まり', () => {
    // 2026-10-01 は木曜 → 週頭は 2026-09-28(月)
    expect(weekKey('2026-10-01')).toBe('2026-09-28');
    expect(weekKey('2026-09-28')).toBe('2026-09-28');
    expect(weekKey('2026-10-04')).toBe('2026-09-28'); // 日曜は同じ週
    expect(weekKey('2026-10-05')).toBe('2026-10-05'); // 翌月曜で切り替わる
  });

  it('rangeDays は両端を含む', () => {
    expect(rangeDays('2026-10-01', '2026-10-03')).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });

  it('toISO / formatJP', () => {
    expect(toISO(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatJP('2026-10-01')).toBe('10月1日(木)');
  });
});

/* ---------------------------- decide ------------------------------ */
describe('手段決定エンジン', () => {
  it('必ず1つに決め切る', () => {
    const d = decide(p());
    expect(d.playbookId).toBeTruthy();
    expect(() => getPlaybook(d.playbookId)).not.toThrow();
    expect(d.verdict.length).toBeGreaterThan(0);
    expect(d.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('同じ入力なら必ず同じ結論（ブレない）', () => {
    const a = decide(p());
    const b = decide(p());
    expect(a.playbookId).toBe(b.playbookId);
    expect(a.score).toBe(b.score);
  });

  it('「やりたくないこと」に該当する手段は選ばれない', () => {
    const prof = p({ avoid: ['stock', 'invest', 'sales', 'client', 'meet', 'voice'] });
    const d = decide(prof);
    const chosen = getPlaybook(d.playbookId);
    for (const t of chosen.traits) expect(prof.avoid).not.toContain(t);
  });

  it('全部NGにしても、破綻せず何かは返す', () => {
    const prof = p({
      avoid: ['face', 'voice', 'stock', 'sales', 'client', 'daily', 'phone', 'invest', 'meet'],
    });
    const d = decide(prof);
    expect(d.playbookId).toBeTruthy();
    expect(d.rejected.length).toBeGreaterThan(0);
  });

  it('在庫NGなら物販は必ず却下理由つきで落ちる', () => {
    const d = decide(p({ avoid: ['stock'] }));
    expect(d.playbookId).not.toBe('resale');
    const b = scorePlaybook(getPlaybook('resale'), p({ avoid: ['stock'] }));
    expect(b.blocked).toBe(true);
  });

  it('予算ゼロだと初期費用の要る手段のスコアが下がる', () => {
    const poor = p({ budget: 0, skills: [] });
    const rich = p({ budget: 300000, skills: [] });
    const a = scorePlaybook(getPlaybook('resale'), poor);
    const b = scorePlaybook(getPlaybook('resale'), rich);
    expect(b.score).toBeGreaterThan(a.score);
  });

  it('週の時間が少ないと重い手段のスコアが下がる', () => {
    const few = scorePlaybook(getPlaybook('web-freelance'), p({ weeklyHours: 2 }));
    const many = scorePlaybook(getPlaybook('web-freelance'), p({ weeklyHours: 20 }));
    expect(many.time).toBeGreaterThan(few.time);
    expect(many.score).toBeGreaterThan(few.score);
  });

  it('スキルが一致すると選ばれやすい', () => {
    const coder = decide(p({ skills: ['coding', 'excel'], weeklyHours: 15 }));
    const writer = decide(p({ skills: ['writing'], weeklyHours: 15 }));
    expect(coder.playbookId).not.toBe(writer.playbookId);
  });

  it('必要月収：合計モードは期間で割る', () => {
    // 2026-10-01 〜 2026-12-31 = 91日 ≒ 3ヶ月
    expect(requiredMonthly(p({ goalMode: 'total', goalAmount: 300000 }))).toBeGreaterThan(90000);
    expect(requiredMonthly(p({ goalMode: 'total', goalAmount: 300000 }))).toBeLessThan(110000);
    expect(requiredMonthly(p({ goalMode: 'monthly', goalAmount: 50000 }))).toBe(50000);
  });

  it('期限が短く目標が高いと hard 判定になる', () => {
    const d = decide(p({ goalAmount: 1000000, deadline: addDays(base.startDate, 30) }));
    expect(d.feasibility).toBe('hard');
  });

  it('目標が小さく期間が長いと easy 判定になる', () => {
    const d = decide(p({ goalAmount: 20000, deadline: addDays(base.startDate, 300), weeklyHours: 20 }));
    expect(d.feasibility).toBe('easy');
  });

  it('却下理由が全件埋まっている', () => {
    const d = decide(p());
    expect(d.rejected.length).toBe(4);
    for (const r of d.rejected) expect(r.reason.length).toBeGreaterThan(5);
  });

  it('ramp は単調増加し ceiling を超えない', () => {
    for (const pb of PLAYBOOKS) {
      let prev = -1;
      for (const m of [0, 1, 2, 3, 6, 12, 24]) {
        const v = expectedAt(pb, m);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v).toBeLessThanOrEqual(pb.ceiling + 1);
        prev = v;
      }
    }
  });

  it('手動切り替えでも決定が成立する', () => {
    const d = decideWith(p(), 'resale');
    expect(d.playbookId).toBe('resale');
    expect(d.rejected.length).toBeGreaterThan(0);
    // 自動判定と同じ手段を指定したら自動判定の結果をそのまま返す
    const auto = decide(p());
    expect(decideWith(p(), auto.playbookId).playbookId).toBe(auto.playbookId);
  });
});

/* ---------------------------- playbooks --------------------------- */
describe('手段カタログの健全性', () => {
  it('IDが一意', () => {
    const ids = PLAYBOOKS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ステップID・ルーティンIDが手段内で一意', () => {
    for (const pb of PLAYBOOKS) {
      const ids = [...pb.steps.map((s) => s.id), ...pb.routines.map((r) => r.id)];
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('全フェーズにステップが存在する', () => {
    for (const pb of PLAYBOOKS) {
      for (const ph of [1, 2, 3, 4]) {
        expect(pb.steps.some((s) => s.phase === ph), `${pb.id} phase${ph}`).toBe(true);
      }
    }
  });

  it('ステップはフェーズ順に並んでいる', () => {
    for (const pb of PLAYBOOKS) {
      const phases = pb.steps.map((s) => s.phase);
      expect(phases).toEqual([...phases].sort((a, b) => a - b));
    }
  });

  it('見積り時間が現実的な範囲に収まっている', () => {
    for (const pb of PLAYBOOKS) {
      for (const s of [...pb.steps, ...pb.routines]) {
        expect(s.estMin).toBeGreaterThanOrEqual(15);
        expect(s.estMin).toBeLessThanOrEqual(240);
        expect(s.title.length).toBeGreaterThan(3);
        expect(s.detail.length).toBeGreaterThan(10);
      }
    }
  });

  it('フェーズ1から使えるルーティンが必ずある', () => {
    for (const pb of PLAYBOOKS) {
      expect(pb.routines.length).toBeGreaterThan(0);
      expect(Math.min(...pb.routines.map((r) => r.phase))).toBeLessThanOrEqual(2);
    }
  });
});

/* ---------------------------- planner ----------------------------- */
describe('計画分解', () => {
  it('フェーズが期間全体を隙間なく覆う', () => {
    const plan = buildPlan(p(), 'content-seo');
    expect(plan.phases.length).toBe(4);
    expect(plan.phases[0].startDate).toBe(base.startDate);
    expect(plan.phases[3].endDate).toBe(base.deadline);
    for (let i = 1; i < 4; i++) {
      expect(plan.phases[i].startDate).toBe(addDays(plan.phases[i - 1].endDate, 1));
    }
  });

  it('極端に短い期限でも4フェーズが壊れない', () => {
    const plan = buildPlan(p({ deadline: addDays(base.startDate, 14) }), 'writing');
    expect(plan.phases.length).toBe(4);
    for (const ph of plan.phases) expect(diffDays(ph.startDate, ph.endDate)).toBeGreaterThanOrEqual(0);
  });

  it('1日の作業分数が週時間から算出される', () => {
    expect(computeDailyMinutes(p({ weeklyHours: 10, workdaysPerWeek: 5 }))).toBe(120);
    expect(computeDailyMinutes(p({ weeklyHours: 3, workdaysPerWeek: 7 }))).toBe(25);
    // 下限20分
    expect(computeDailyMinutes(p({ weeklyHours: 1, workdaysPerWeek: 7 }))).toBe(20);
  });

  it('phaseForDate が日付から正しいフェーズを返す', () => {
    const plan = buildPlan(p(), 'content-seo');
    expect(phaseForDate(plan, base.startDate)).toBe(1);
    expect(phaseForDate(plan, base.deadline)).toBe(4);
    expect(phaseForDate(plan, plan.phases[2].startDate)).toBe(3);
  });

  it('タスクは必ず1件以上生成される', () => {
    const plan = buildPlan(p(), 'ai-automation');
    const tasks = generateTasks({ plan, profile: p(), date: base.startDate, logs: {} });
    expect(tasks.length).toBeGreaterThan(0);
  });

  it('時間の少ないユーザーでもタスクが出る（枠が極小でも空にしない）', () => {
    const prof = p({ weeklyHours: 1, workdaysPerWeek: 7 });
    const plan = buildPlan(prof, 'ai-automation');
    const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs: {} });
    expect(tasks.length).toBeGreaterThan(0);
  });

  it('未完了タスクは翌日に繰り越される', () => {
    const plan = buildPlan(p(), 'content-seo');
    const d1 = base.startDate;
    const t1 = generateTasks({ plan, profile: p(), date: d1, logs: {} });
    const logs: Record<string, DayLog> = {
      [d1]: { date: d1, tasks: t1.map((t) => ({ ...t, done: false })), closed: true },
    };
    const d2 = addDays(d1, 1);
    const t2 = generateTasks({ plan, profile: p(), date: d2, logs });
    expect(t2.some((t) => t.carriedFrom === d1)).toBe(true);
    // 繰越は先頭に来る
    expect(t2[0].carriedFrom).toBe(d1);
  });

  it('消化済みステップは二度と出てこない', () => {
    const prof = p();
    let plan = buildPlan(prof, 'content-seo');
    const d1 = base.startDate;
    const t1 = generateTasks({ plan, profile: prof, date: d1, logs: {} });
    const log: DayLog = { date: d1, tasks: t1.map((t) => ({ ...t, done: true })), closed: true };
    plan = closeDay(plan, log);
    const t2 = generateTasks({ plan, profile: prof, date: addDays(d1, 1), logs: { [d1]: log } });
    const doneStepIds = t1.filter((t) => t.kind === 'step').map((t) => t.sourceId);
    for (const id of doneStepIds) expect(t2.map((t) => t.sourceId)).not.toContain(id);
  });

  it('同じ日に同じタスクが重複しない', () => {
    const prof = p();
    const plan = buildPlan(prof, 'short-video');
    const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs: {} });
    const ids = tasks.map((t) => t.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ルーティンは週あたりの上限を超えて出ない', () => {
    const prof = p();
    const plan: Plan = {
      ...buildPlan(prof, 'content-seo'),
      routineCounts: { [weekKey(base.startDate)]: { csR1: 99, csR2: 99 } },
    };
    const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs: {} });
    expect(tasks.filter((t) => t.sourceId === 'csR1').length).toBe(0);
  });

  it('1日の枠より大きいステップも必ず指示される（枠の分だけ進める）', () => {
    const prof = p({ weeklyHours: 2, workdaysPerWeek: 5 }); // 25分/日
    const plan = buildPlan(prof, 'design-freelance');
    const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs: {} });
    expect(tasks.length).toBeGreaterThan(0);
    const big = tasks.find((t) => t.sourceId === 'df2');
    // df2 は 240分。枠に収まらないので分割されて出るか、先頭ステップが必ず1つは出る
    expect(tasks.some((t) => t.kind === 'step')).toBe(true);
    if (big) {
      expect(big.estMin).toBeLessThanOrEqual(plan.dailyMinutes);
      expect(big.detail).toContain('1日では終わらない量');
    }
  });

  it('ステップの順番を飛ばして先取りしない', () => {
    const prof = p({ weeklyHours: 3, workdaysPerWeek: 5 });
    const plan = buildPlan(prof, 'content-seo');
    const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs: {} });
    const stepIds = tasks.filter((t) => t.kind === 'step').map((t) => t.sourceId);
    const order = getPlaybook('content-seo').steps.map((s) => s.id);
    // 出たステップは必ずカタログの先頭から連続している
    expect(stepIds).toEqual(order.slice(0, stepIds.length));
  });

  it('フェーズ内を消化しきったら次フェーズを前倒しで始める', () => {
    const prof = p();
    const pb = getPlaybook('sns-agency');
    const phase1Ids = pb.steps.filter((s) => s.phase === 1).map((s) => s.id);
    const plan: Plan = { ...buildPlan(prof, 'sns-agency'), consumedStepIds: phase1Ids };
    // フェーズ1期間中にフェーズ1のステップを全消化した状態
    const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs: {} });
    expect(tasks.length).toBeGreaterThan(0);
    // フォールバックの「振り返り」だけで埋まらず、次フェーズの実作業が出る
    expect(tasks.some((t) => t.sourceId !== 'review')).toBe(true);
    expect(tasks.some((t) => t.phase > 1)).toBe(true);
  });

  it('全ステップ消化後もルーティンと改善サイクルで毎日が埋まる', () => {
    const prof = p();
    const pb = getPlaybook('sns-agency');
    const plan: Plan = {
      ...buildPlan(prof, 'sns-agency'),
      consumedStepIds: pb.steps.map((s) => s.id),
    };
    const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs: {} });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.kind === 'routine' || t.kind === 'cycle')).toBe(true);
    // 「振り返るだけの日」で埋まらない
    expect(tasks.some((t) => t.sourceId !== 'fallback-review')).toBe(true);
  });

  it('タスク総量が1日の枠から極端に外れない', () => {
    const prof = p({ weeklyHours: 10, workdaysPerWeek: 5 }); // 120分/日
    const plan = buildPlan(prof, 'content-seo');
    const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs: {} });
    const sum = tasks.reduce((a, t) => a + t.estMin, 0);
    expect(sum).toBeLessThanOrEqual(plan.dailyMinutes * 1.6);
  });
});

/* ----------------------------- adjust ----------------------------- */
describe('翌日の自動調整', () => {
  const plan = { ...buildPlan(p(), 'content-seo'), dailyMinutes: 120, baseDailyMinutes: 120 };
  const prog = (patch: Partial<ReturnType<typeof computeProgress>>) =>
    ({
      elapsed: 0.3,
      planProgress: 0.3,
      revenueProgress: 0,
      totalRevenue: 0,
      monthRevenue: 0,
      target: 100000,
      pace: 'onTrack',
      recentRate: 0.8,
      streak: 2,
      missStreak: 0,
      daysLeft: 60,
      needMonthly: 100000,
      doneTasks: 10,
      allTasks: 12,
      ...patch,
    }) as ReturnType<typeof computeProgress>;

  it('3日連続ゼロなら量を大幅に減らす', () => {
    const a = computeAdjustment(plan, prog({ missStreak: 3 }));
    expect(a.mode).toBe('reduce');
    expect(a.dailyMinutes).toBeLessThan(120);
    expect(a.dailyMinutes).toBeGreaterThanOrEqual(20);
    expect(a.reason).toContain('削る');
  });

  it('消化率が低いと少し減らす', () => {
    const a = computeAdjustment(plan, prog({ recentRate: 0.3, allTasks: 10 }));
    expect(a.mode).toBe('reduce');
    expect(a.dailyMinutes).toBe(95);
  });

  it('連続で完走してると増やす', () => {
    const a = computeAdjustment(plan, prog({ recentRate: 1, streak: 5 }));
    expect(a.mode).toBe('increase');
    expect(a.dailyMinutes).toBeGreaterThan(120);
  });

  it('増やしすぎない（基準の1.6倍が上限）', () => {
    let cur = plan;
    for (let i = 0; i < 30; i++) {
      const a = computeAdjustment(cur, prog({ recentRate: 1, streak: 10 }));
      cur = { ...cur, dailyMinutes: a.dailyMinutes };
    }
    expect(cur.dailyMinutes).toBeLessThanOrEqual(120 * 1.6);
  });

  it('減らしすぎない（下限20分）', () => {
    let cur = plan;
    for (let i = 0; i < 30; i++) {
      const a = computeAdjustment(cur, prog({ missStreak: 5 }));
      cur = { ...cur, dailyMinutes: a.dailyMinutes };
    }
    expect(cur.dailyMinutes).toBeGreaterThanOrEqual(20);
  });

  it('普通のペースなら維持する', () => {
    const a = computeAdjustment(plan, prog({}));
    expect(a.mode).toBe('keep');
    expect(a.dailyMinutes).toBe(120);
  });

  it('closeDay は完了分だけを消化に記録する', () => {
    const log: DayLog = {
      date: base.startDate,
      closed: true,
      tasks: [
        { id: '1', date: base.startDate, sourceId: 'cs1', kind: 'step', phase: 1, title: '', detail: '', estMin: 30, tag: '', priority: 'must', done: true },
        { id: '2', date: base.startDate, sourceId: 'cs2', kind: 'step', phase: 1, title: '', detail: '', estMin: 30, tag: '', priority: 'should', done: false },
        { id: '3', date: base.startDate, sourceId: 'csR1', kind: 'routine', phase: 1, title: '', detail: '', estMin: 30, tag: '', priority: 'should', done: true },
      ],
    };
    const next = closeDay(buildPlan(p(), 'content-seo'), log);
    expect(next.consumedStepIds).toEqual(['cs1']);
    expect(next.routineCounts[weekKey(base.startDate)].csR1).toBe(1);
  });
});

/* ---------------------------- progress ---------------------------- */
describe('進捗計算', () => {
  const mkLogs = (days: { date: string; done: number; total: number; revenue?: number }[]) => {
    const logs: Record<string, DayLog> = {};
    for (const d of days) {
      logs[d.date] = {
        date: d.date,
        closed: true,
        revenue: d.revenue,
        tasks: Array.from({ length: d.total }, (_, i) => ({
          id: `${d.date}-${i}`,
          date: d.date,
          sourceId: `s${i}`,
          kind: 'routine' as const,
          phase: 1 as const,
          title: 't',
          detail: '',
          estMin: 30,
          tag: 'x',
          priority: 'should' as const,
          done: i < d.done,
        })),
      };
    }
    return logs;
  };

  it('収益を累計・月次で集計する', () => {
    const logs = mkLogs([
      { date: '2026-10-01', done: 1, total: 1, revenue: 5000 },
      { date: '2026-10-02', done: 1, total: 1, revenue: 3000 },
      { date: '2026-11-01', done: 1, total: 1, revenue: 10000 },
    ]);
    const r = computeProgress(p(), buildPlan(p(), 'content-seo'), logs, '2026-11-02');
    expect(r.totalRevenue).toBe(18000);
    expect(r.monthRevenue).toBe(10000);
    expect(monthlyRevenue(logs)).toEqual([
      { month: '2026-10', amount: 8000 },
      { month: '2026-11', amount: 10000 },
    ]);
  });

  it('連続実行日数を数える', () => {
    const logs = mkLogs([
      { date: '2026-10-01', done: 1, total: 2 },
      { date: '2026-10-02', done: 2, total: 2 },
      { date: '2026-10-03', done: 1, total: 2 },
    ]);
    const r = computeProgress(p(), buildPlan(p(), 'content-seo'), logs, '2026-10-03');
    expect(r.streak).toBe(3);
  });

  it('連続ゼロ日を数え、止まっていると判定する', () => {
    const logs = mkLogs([
      { date: '2026-10-01', done: 0, total: 2 },
      { date: '2026-10-02', done: 0, total: 2 },
      { date: '2026-10-03', done: 0, total: 2 },
    ]);
    const r = computeProgress(p(), buildPlan(p(), 'content-seo'), logs, '2026-10-04');
    expect(r.missStreak).toBe(3);
    expect(r.pace).toBe('stalled');
  });

  it('進捗が期間を上回れば ahead', () => {
    const prof = p();
    const plan = buildPlan(prof, 'content-seo');
    const pb = getPlaybook('content-seo');
    const full: Plan = { ...plan, consumedStepIds: pb.steps.map((s) => s.id) };
    const r = computeProgress(prof, full, {}, '2026-10-10');
    expect(r.pace).toBe('ahead');
    expect(r.planProgress).toBe(1);
  });

  it('何もしてなければ behind', () => {
    const r = computeProgress(p(), buildPlan(p(), 'content-seo'), {}, '2026-12-01');
    expect(r.pace).toBe('behind');
  });

  it('直近7日の消化率が正しい', () => {
    const logs = mkLogs([
      { date: '2026-10-05', done: 1, total: 2 },
      { date: '2026-10-06', done: 2, total: 2 },
    ]);
    const r = computeProgress(p(), buildPlan(p(), 'content-seo'), logs, '2026-10-06');
    expect(r.recentRate).toBeCloseTo(3 / 4);
  });

  it('dailyRates / tagBreakdown が壊れない', () => {
    const logs = mkLogs([{ date: '2026-10-06', done: 1, total: 2 }]);
    expect(dailyRates(logs, 7, '2026-10-06').length).toBe(7);
    expect(tagBreakdown(logs)[0]).toEqual({ tag: 'x', done: 1 });
    expect(dailyRates({}, 3, '2026-10-06').every((d) => d.rate === 0)).toBe(true);
  });

  it('残り日数は負にならない', () => {
    const r = computeProgress(p(), buildPlan(p(), 'content-seo'), {}, '2027-06-01');
    expect(r.daysLeft).toBe(0);
    expect(r.elapsed).toBe(1);
  });
});

/* ------------------------------ coach ----------------------------- */
describe('上司の発話', () => {
  const prof = p();
  const plan = buildPlan(prof, 'content-seo');

  it('同じ日・同じ状況なら同じことを言う（ブレない）', () => {
    const pr = computeProgress(prof, plan, {}, '2026-10-05');
    const tasks = generateTasks({ plan, profile: prof, date: '2026-10-05', logs: {} });
    const a = morningBriefing(prof, plan, pr, tasks, '2026-10-05');
    const b = morningBriefing(prof, plan, pr, tasks, '2026-10-05');
    expect(a).toEqual(b);
  });

  it('止まっているときは警告トーンになる', () => {
    const pr = computeProgress(prof, plan, {}, '2026-10-05');
    const stalled = { ...pr, pace: 'stalled' as const, missStreak: 4 };
    const tasks = generateTasks({ plan, profile: prof, date: '2026-10-05', logs: {} });
    const m = morningBriefing(prof, plan, stalled, tasks, '2026-10-05');
    expect(m.tone).toBe('warn');
    expect(m.body).toContain('4日');
  });

  it('全消化なら褒める / ゼロなら詰める', () => {
    const pr = computeProgress(prof, plan, {}, '2026-10-05');
    const mk = (done: boolean): DayLog => ({
      date: '2026-10-05',
      closed: true,
      tasks: [
        { id: '1', date: '2026-10-05', sourceId: 'a', kind: 'step', phase: 1, title: '', detail: '', estMin: 30, tag: '', priority: 'must', done },
      ],
    });
    expect(dayReview(prof, mk(true), pr, 'keep').tone).toBe('praise');
    expect(dayReview(prof, mk(false), pr, 'keep').tone).toBe('warn');
  });

  it('締めのフィードバックに翌日の調整理由が入る', () => {
    const pr = computeProgress(prof, plan, {}, '2026-10-05');
    const log: DayLog = { date: '2026-10-05', closed: true, tasks: [] };
    expect(dayReview(prof, log, pr, 'テスト理由').body).toContain('テスト理由');
  });

  it('示唆は必ず1件以上返る', () => {
    const pr = computeProgress(prof, plan, {}, '2026-10-05');
    expect(insights(prof, plan, pr).length).toBeGreaterThan(0);
    expect(insights(prof, plan, { ...pr, allTasks: 50, recentRate: 0.2 }).length).toBeGreaterThan(0);
  });
});

/* ------------------------ 立ち上げ後の反復フェーズ ------------------------ */
describe('改善サイクル', () => {
  const launched = (id: string, prof = p()): Plan => ({
    ...buildPlan(prof, id),
    consumedStepIds: getPlaybook(id).steps.map((s) => s.id),
  });

  const logsWith = (revenue: number, date = base.startDate): Record<string, DayLog> => ({
    [addDays(date, -1)]: {
      date: addDays(date, -1),
      closed: true,
      revenue,
      tasks: [
        {
          id: 'x', date: addDays(date, -1), sourceId: 'x', kind: 'routine', phase: 1,
          title: 't', detail: '', estMin: 30, tag: 'x', priority: 'should', done: true,
        },
      ],
    },
  });

  it('全プレイブックが改善サイクルを持っている', () => {
    for (const pb of PLAYBOOKS) {
      expect(pb.cycles.length, pb.id).toBeGreaterThanOrEqual(5);
      const ids = pb.cycles.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      // 状況に依存しない汎用サイクルが必ずある（何も当てはまらない日を作らない）
      expect(pb.cycles.some((c) => c.when === 'always')).toBe(true);
      for (const c of pb.cycles) {
        expect(c.estMin).toBeGreaterThanOrEqual(15);
        expect(c.estMin).toBeLessThanOrEqual(180);
        expect(c.detail.length).toBeGreaterThan(10);
      }
    }
  });

  it('ステップIDとサイクルIDが衝突しない', () => {
    for (const pb of PLAYBOOKS) {
      const ids = [
        ...pb.steps.map((s) => s.id),
        ...pb.routines.map((r) => r.id),
        ...pb.cycles.map((c) => c.id),
      ];
      expect(new Set(ids).size, pb.id).toBe(ids.length);
    }
  });

  it('立ち上げ前はサイクルが出ない', () => {
    const tasks = generateTasks({
      plan: buildPlan(p(), 'content-seo'),
      profile: p(),
      date: base.startDate,
      logs: {},
    });
    expect(tasks.some((t) => t.kind === 'cycle')).toBe(false);
  });

  it('立ち上げ後はサイクルで日が埋まる（同じ4件の無限ループにならない）', () => {
    const plan = launched('content-seo');
    const tasks = generateTasks({ plan, profile: p(), date: base.startDate, logs: {} });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some((t) => t.kind === 'cycle')).toBe(true);
  });

  it('収益ゼロなら「売る量を増やす」系、収益ありなら「単価・仕組み」系が出る', () => {
    const plan = launched('content-seo');
    const pb = getPlaybook('content-seo');
    const noRev = generateTasks({ plan, profile: p(), date: base.startDate, logs: {} });
    const hasRev = generateTasks({
      plan, profile: p(), date: base.startDate, logs: logsWith(50000),
    });
    const kindOf = (ts: typeof noRev) =>
      ts.filter((t) => t.kind === 'cycle').map((t) => pb.cycles.find((c) => c.id === t.sourceId)?.when);
    expect(kindOf(noRev)).not.toContain('hasRevenue');
    expect(kindOf(hasRev)).not.toContain('noRevenue');
    expect(kindOf(hasRev).length).toBeGreaterThan(0);
  });

  it('同じサイクルは同じ週に2回出ない', () => {
    const prof = p();
    let plan = launched('content-seo', prof);
    const logs: Record<string, DayLog> = {};
    const seen: string[] = [];
    // 月曜から金曜まで
    for (const date of rangeDays('2026-10-05', '2026-10-09')) {
      const tasks = generateTasks({ plan, profile: prof, date, logs });
      for (const t of tasks) if (t.kind === 'cycle') seen.push(t.sourceId);
      const log: DayLog = { date, closed: true, tasks: tasks.map((t) => ({ ...t, done: true })) };
      logs[date] = log;
      plan = closeDay(plan, log);
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('週が変わるとサイクルがまた回ってくる', () => {
    const prof = p();
    let plan = launched('content-seo', prof);
    const logs: Record<string, DayLog> = {};
    const byWeek: Record<string, string[]> = {};
    for (const date of rangeDays('2026-10-05', '2026-10-16')) {
      const tasks = generateTasks({ plan, profile: prof, date, logs });
      const wk = weekKey(date);
      byWeek[wk] = [...(byWeek[wk] ?? []), ...tasks.filter((t) => t.kind === 'cycle').map((t) => t.sourceId)];
      const log: DayLog = { date, closed: true, tasks: tasks.map((t) => ({ ...t, done: true })) };
      logs[date] = log;
      plan = closeDay(plan, log);
    }
    const weeks = Object.keys(byWeek).filter((w) => byWeek[w].length > 0);
    expect(weeks.length).toBeGreaterThanOrEqual(2);
  });

  it('スランプ明け（繰越は消えたが消化率が低い）は軽いサイクルから出る', () => {
    const prof = p();
    const plan = launched('content-seo', prof);
    const logs: Record<string, DayLog> = {};
    const mk = (d: string, n: number, done: boolean) => ({
      date: d,
      closed: true,
      tasks: Array.from({ length: n }, (_, j) => ({
        id: `${d}-${j}`, date: d, sourceId: `s${d}${j}`, kind: 'routine' as const,
        phase: 1 as const, title: 't', detail: '', estMin: 30, tag: 'x', priority: 'should' as const, done,
      })),
    });
    // 5〜7日前は全滅、直近4日は完走（＝繰越は無いが7日の消化率は低い）
    for (const i of [7, 6, 5]) logs[addDays(base.startDate, -i)] = mk(addDays(base.startDate, -i), 3, false);
    for (const i of [4, 3, 2, 1]) logs[addDays(base.startDate, -i)] = mk(addDays(base.startDate, -i), 1, true);

    const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs });
    expect(tasks.some((t) => t.carriedFrom)).toBe(false);
    const cycles = tasks.filter((t) => t.kind === 'cycle');
    expect(cycles.length).toBeGreaterThan(0);
    // 出てくる順が軽い順になっている
    const mins = cycles.map((c) => c.estMin);
    expect(mins).toEqual([...mins].sort((a, b) => a - b));
    // 「止まったとき用」の軽いサイクルが候補に入る
    const pb = getPlaybook('content-seo');
    const lowOnes = pb.cycles.filter((c) => c.when === 'lowRate').map((c) => c.id);
    expect(tasks.some((t) => lowOnes.includes(t.sourceId))).toBe(true);
  });
});

describe('反復フェーズの誠実さ', () => {
  it('立ち上げ作業そのもののルーティンは、立ち上がったら出さない', () => {
    const prof = p();
    const pb = getPlaybook('digital-product');
    const untilLaunch = pb.routines.filter((r) => r.untilLaunch).map((r) => r.id);
    expect(untilLaunch.length).toBeGreaterThan(0);
    const plan: Plan = {
      ...buildPlan(prof, 'digital-product'),
      consumedStepIds: pb.steps.map((x) => x.id),
    };
    const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs: {} });
    for (const id of untilLaunch) expect(tasks.map((t) => t.sourceId)).not.toContain(id);
  });

  it('週のぶんを消化しきった日は、作業をでっち上げず正直に伝える', () => {
    const prof = p();
    const pb = getPlaybook('content-seo');
    const wk = weekKey(base.startDate);
    const full: Record<string, number> = {};
    for (const r of pb.routines) full[r.id] = r.perWeek;
    for (const c of pb.cycles) full[c.id] = 1;
    full[REVIEW_ID] = 1;
    const plan: Plan = {
      ...buildPlan(prof, 'content-seo'),
      consumedStepIds: pb.steps.map((x) => x.id),
      routineCounts: { [wk]: full },
    };
    const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs: {} });
    expect(tasks.length).toBe(1);
    expect(tasks[0].sourceId).toBe(CLEAR_ID);
    expect(tasks[0].title).toContain('今週のぶんは終わってる');
  });

  it('180日回しても同じタスクが週の上限を超えて出ない', () => {
    const prof = p({ deadline: addDays(base.startDate, 180) });
    const pb = getPlaybook('content-seo');
    let plan = buildPlan(prof, 'content-seo');
    const logs: Record<string, DayLog> = {};
    const perWeek: Record<string, Record<string, number>> = {};
    for (const date of rangeDays(prof.startDate, prof.deadline)) {
      const tasks = generateTasks({ plan, profile: prof, date, logs });
      const wk = weekKey(date);
      perWeek[wk] ??= {};
      for (const t of tasks) perWeek[wk][t.sourceId] = (perWeek[wk][t.sourceId] ?? 0) + 1;
      const log: DayLog = { date, closed: true, tasks: tasks.map((t) => ({ ...t, done: true })) };
      logs[date] = log;
      plan = closeDay(plan, log);
    }
    for (const [, counts] of Object.entries(perWeek)) {
      for (const [id, n] of Object.entries(counts)) {
        if (id === CLEAR_ID) continue; // 空いた日ぶんだけ出る
        const r = pb.routines.find((x) => x.id === id);
        const c = pb.cycles.find((x) => x.id === id);
        if (r) expect(n, `${id}`).toBeLessThanOrEqual(r.perWeek);
        if (c) expect(n, `${id}`).toBeLessThanOrEqual(1);
        if (id === REVIEW_ID) expect(n).toBeLessThanOrEqual(1);
      }
    }
  });

  it('立ち上げ後も指示が散る（ルーティンの繰り返しに戻らない）', () => {
    const prof = p({ deadline: addDays(base.startDate, 180) });
    for (const pb of PLAYBOOKS) {
      let plan = buildPlan(prof, pb.id);
      const logs: Record<string, DayLog> = {};
      const titles: string[] = [];
      rangeDays(prof.startDate, prof.deadline).forEach((date, i) => {
        const tasks = generateTasks({ plan, profile: prof, date, logs });
        if (plan.consumedStepIds.length >= pb.steps.length) tasks.forEach((t) => titles.push(t.title));
        const log: DayLog = {
          date, closed: true,
          tasks: tasks.map((t) => ({ ...t, done: true })),
          revenue: i > 40 && i % 7 === 0 ? 20000 : undefined,
        };
        logs[date] = log;
        plan = closeDay(plan, log);
      });
      const kinds = new Set(titles).size;
      // ルーティンだけの無限ループに戻っていないこと（改善サイクルが実際に効いている）
      expect(kinds, pb.id).toBeGreaterThan(pb.routines.length + 2);
      expect(kinds, pb.id).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('週次レビューとテーマ', () => {
  it('初週には振り返りを出さない（振り返る対象がない）', () => {
    const tasks = generateTasks({
      plan: buildPlan(p(), 'content-seo'), profile: p(), date: base.startDate, logs: {},
    });
    expect(tasks.some((t) => t.sourceId === REVIEW_ID)).toBe(false);
  });

  it('2週目以降は週に1回だけ振り返りが入る', () => {
    const prof = p();
    let plan = buildPlan(prof, 'content-seo');
    const logs: Record<string, DayLog> = {};
    const reviewDays: string[] = [];
    for (const date of rangeDays(base.startDate, addDays(base.startDate, 20))) {
      const tasks = generateTasks({ plan, profile: prof, date, logs });
      if (tasks.some((t) => t.sourceId === REVIEW_ID)) reviewDays.push(date);
      const log: DayLog = { date, closed: true, tasks: tasks.map((t) => ({ ...t, done: true })) };
      logs[date] = log;
      plan = closeDay(plan, log);
    }
    expect(reviewDays.length).toBeGreaterThanOrEqual(2);
    // 同じ週に2回入らない
    expect(new Set(reviewDays.map(weekKey)).size).toBe(reviewDays.length);
  });

  it('振り返りタスクに今週のテーマと先週の数字が入る', () => {
    const prof = p();
    const plan = buildPlan(prof, 'content-seo');
    const date = addDays(base.startDate, 8);
    const logs: Record<string, DayLog> = {
      [addDays(base.startDate, 1)]: {
        date: addDays(base.startDate, 1), closed: true, revenue: 3000,
        tasks: [{ id: 'z', date: addDays(base.startDate, 1), sourceId: 'z', kind: 'routine', phase: 1, title: 't', detail: '', estMin: 30, tag: 'x', priority: 'should', done: true }],
      },
    };
    const tasks = generateTasks({ plan, profile: prof, date, logs });
    const rv = tasks.find((t) => t.sourceId === REVIEW_ID);
    expect(rv).toBeDefined();
    expect(rv!.detail).toContain('今週のテーマ');
    expect(rv!.detail).toContain('先週');
  });

  it('状況に応じてテーマが変わる', () => {
    const prof = p();
    const pbId = 'content-seo';
    const fresh = buildPlan(prof, pbId);
    const launchedPlan: Plan = {
      ...fresh,
      consumedStepIds: getPlaybook(pbId).steps.map((s) => s.id),
    };
    const d = addDays(base.startDate, 10);

    // 立ち上げ前 → 土台/立ち上げ
    expect(['start', 'build']).toContain(computeWeeklyFocus(prof, fresh, {}, d).id);

    // 立ち上げ済み・収益ゼロ → 売る量
    expect(computeWeeklyFocus(prof, launchedPlan, {}, d).id).toBe('sell');

    // 収益はあるが必要額に遠い → 勝ち筋の特定
    const some: Record<string, DayLog> = {
      [addDays(d, -3)]: { date: addDays(d, -3), closed: true, revenue: 10000, tasks: [] },
    };
    expect(computeWeeklyFocus(prof, launchedPlan, some, d).id).toBe('convert');

    // 必要額に近い → 単価 or 件数
    const near: Record<string, DayLog> = {
      [addDays(d, -3)]: { date: addDays(d, -3), closed: true, revenue: 70000, tasks: [] },
    };
    expect(computeWeeklyFocus(prof, launchedPlan, near, d).id).toBe('raise');

    // 達成 → 仕組み化
    const over: Record<string, DayLog> = {
      [addDays(d, -3)]: { date: addDays(d, -3), closed: true, revenue: 150000, tasks: [] },
    };
    expect(computeWeeklyFocus(prof, launchedPlan, over, d).id).toBe('systemize');
  });

  it('手が止まっている週は、何より先に「量を絞る」テーマになる', () => {
    const prof = p();
    const plan = buildPlan(prof, 'content-seo');
    const d = '2026-10-12'; // 月曜
    const logs: Record<string, DayLog> = {};
    for (const date of rangeDays('2026-10-05', '2026-10-11')) {
      logs[date] = {
        date, closed: true,
        tasks: [1, 2].map((n) => ({
          id: `${date}-${n}`, date, sourceId: `s${n}`, kind: 'routine' as const, phase: 1 as const,
          title: 't', detail: '', estMin: 30, tag: 'x', priority: 'should' as const, done: false,
        })),
      };
    }
    const f = computeWeeklyFocus(prof, plan, logs, d);
    expect(f.id).toBe('recover');
    expect(f.kpi).toContain('ゼロの日');
  });

  it('週番号が開始日から数えて正しい', () => {
    const prof = p({ startDate: '2026-10-01' });
    const plan = buildPlan(prof, 'content-seo');
    expect(computeWeeklyFocus(prof, plan, {}, '2026-10-01').weekNo).toBe(1);
    expect(computeWeeklyFocus(prof, plan, {}, '2026-10-04').weekNo).toBe(1); // 同じ週の日曜
    expect(computeWeeklyFocus(prof, plan, {}, '2026-10-05').weekNo).toBe(2); // 次の月曜
    expect(computeWeeklyFocus(prof, plan, {}, '2026-10-19').weekNo).toBe(4);
  });

  it('loopState が立ち上げ完了と収益を正しく読む', () => {
    const prof = p();
    const pb = getPlaybook('content-seo');
    const fresh = buildPlan(prof, 'content-seo');
    expect(loopState(prof, fresh, {}, base.startDate).launched).toBe(false);
    const done: Plan = { ...fresh, consumedStepIds: pb.steps.map((s) => s.id) };
    expect(loopState(prof, done, {}, base.startDate).launched).toBe(true);
    const logs: Record<string, DayLog> = {
      [addDays(base.startDate, -1)]: { date: addDays(base.startDate, -1), closed: true, revenue: 5000, tasks: [] },
      // 未来の収益は数えない
      [addDays(base.startDate, 5)]: { date: addDays(base.startDate, 5), closed: true, revenue: 99999, tasks: [] },
    };
    expect(loopState(prof, done, logs, base.startDate).revenue).toBe(5000);
  });
});

/* ------------------------ 不安 → 目標タイプ ------------------------ */
describe('不安から目標への翻訳', () => {
  it('全ての不安が目標タイプに紐づいている', () => {
    expect(ANXIETIES.length).toBeGreaterThanOrEqual(5);
    for (const a of ANXIETIES) {
      expect(GOAL_KINDS[a.goalKind], a.id).toBeDefined();
      expect(a.voice.length).toBeGreaterThan(10);
      expect(ANXIETY_MAP[a.id]).toBe(a);
    }
    // お金以外の逃げ道が必ず用意されている
    expect(new Set(ANXIETIES.map((a) => a.goalKind)).size).toBeGreaterThanOrEqual(4);
  });

  it('目標タイプの定義が揃っている', () => {
    for (const k of Object.values(GOAL_KINDS)) {
      expect(k.presets.length).toBeGreaterThan(0);
      expect(k.presets.some((x) => x.value === k.defaultValue) || k.defaultValue > 0).toBe(true);
      expect(k.headline.length).toBeGreaterThan(3);
      expect(k.format(k.defaultValue, true).length).toBeGreaterThan(2);
      const sum = Object.values(k.weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThan(80);
    }
    // お金以外は reach（収益の到達見込み）を使わない
    for (const id of ['proof', 'skill', 'habit', 'explore'] as const) {
      expect(GOAL_KINDS[id].weights.reach).toBe(0);
    }
  });

  it('お金以外の目標では requiredMonthly が 0 になる', () => {
    expect(requiredMonthly(p({ goalKind: 'proof', goalAmount: 3 }))).toBe(0);
    expect(requiredMonthly(p({ goalKind: 'habit', goalAmount: 30 }))).toBe(0);
    expect(requiredMonthly(p({ goalKind: 'money' }))).toBe(100000);
  });

  it('目標タイプで選ばれる手段が変わる', () => {
    const money = decide(p({ goalKind: 'money', skills: ['writing', 'sns'] }));
    const skill = decide(p({ goalKind: 'skill', goalAmount: 1, skills: ['writing', 'sns'] }));
    expect(money.playbookId).toBeTruthy();
    expect(skill.playbookId).toBeTruthy();
    // スキル目的では「売る」より「作る」比率の高い手段が上がる
    const ms = scorePlaybook(getPlaybook(money.playbookId), p({ goalKind: 'skill' }));
    const ss = scorePlaybook(getPlaybook(skill.playbookId), p({ goalKind: 'skill' }));
    expect(ss.score).toBeGreaterThanOrEqual(ms.score);
  });
});

describe('目標タイプによるタスクの絞り込み', () => {
  const sell = ['営業', '販売', '出品', '仕入', '運用', '実施'];

  it('実績づくりの目標では営業・販売タスクを出さない', () => {
    const prof = p({ goalKind: 'proof', goalAmount: 3, skills: ['design'] });
    const d = decide(prof);
    let plan = buildPlan(prof, d.playbookId);
    const logs: Record<string, DayLog> = {};
    const seen: string[] = [];
    for (const date of rangeDays(prof.startDate, addDays(prof.startDate, 45))) {
      const tasks = generateTasks({ plan, profile: prof, date, logs });
      tasks.forEach((t) => seen.push(t.tag));
      const log: DayLog = { date, closed: true, tasks: tasks.map((t) => ({ ...t, done: true })) };
      logs[date] = log;
      plan = closeDay(plan, log);
    }
    expect(seen.length).toBeGreaterThan(10);
    for (const tag of sell) expect(seen, tag).not.toContain(tag);
  });

  it('お金の目標では営業タスクが出る', () => {
    const prof = p({ goalKind: 'money', skills: ['writing'] });
    const d = decide(prof);
    let plan = buildPlan(prof, d.playbookId);
    const logs: Record<string, DayLog> = {};
    const seen: string[] = [];
    for (const date of rangeDays(prof.startDate, addDays(prof.startDate, 45))) {
      const tasks = generateTasks({ plan, profile: prof, date, logs });
      tasks.forEach((t) => seen.push(t.tag));
      const log: DayLog = { date, closed: true, tasks: tasks.map((t) => ({ ...t, done: true })) };
      logs[date] = log;
      plan = closeDay(plan, log);
    }
    expect(seen.some((t) => sell.includes(t))).toBe(true);
  });

  it('絞り込んでもタスクが枯れない（全目標タイプ × 全手段）', () => {
    for (const kindId of ['money', 'proof', 'skill', 'habit'] as const) {
      for (const pb of PLAYBOOKS) {
        const prof = p({ goalKind: kindId, goalAmount: kindId === 'money' ? 100000 : 3 });
        let plan = buildPlan(prof, pb.id);
        const logs: Record<string, DayLog> = {};
        for (const date of rangeDays(prof.startDate, addDays(prof.startDate, 30))) {
          const tasks = generateTasks({ plan, profile: prof, date, logs });
          expect(tasks.length, `${kindId}/${pb.id}/${date}`).toBeGreaterThan(0);
          const log: DayLog = { date, closed: true, tasks: tasks.map((t) => ({ ...t, done: true })) };
          logs[date] = log;
          plan = closeDay(plan, log);
        }
      }
    }
  });

  it('絞り込みで候補がゼロになる場合は絞らない（安全弁）', () => {
    const kind = GOAL_KINDS.skill;
    const onlySales = [{ tag: '営業' }, { tag: '販売' }];
    expect(filterByGoal(onlySales, kind)).toEqual(onlySales);
    const mixed = [{ tag: '営業' }, { tag: '制作' }];
    expect(filterByGoal(mixed, kind)).toEqual([{ tag: '制作' }]);
  });

  it('絞り込んだ分は「立ち上げ完了」の分母からも外れる', () => {
    const prof = p({ goalKind: 'skill', goalAmount: 1 });
    const pb = getPlaybook('web-freelance');
    const eligible = filterByGoal(pb.steps, goalKindOf(prof));
    expect(eligible.length).toBeLessThan(pb.steps.length);
    const plan: Plan = {
      ...buildPlan(prof, 'web-freelance'),
      consumedStepIds: eligible.map((s) => s.id),
    };
    // 出さないステップが残っていても launched になる
    expect(loopState(prof, plan, {}, base.startDate).launched).toBe(true);
    expect(computeProgress(prof, plan, {}, base.startDate).planProgress).toBe(1);
  });
});

describe('探索モード', () => {
  const prof = () => p({ goalKind: 'explore', goalAmount: 3, skills: ['writing'] });

  it('決め切らずに複数の手段を返す', () => {
    const d = decide(prof());
    expect(d.exploreIds?.length).toBe(3);
    expect(d.exploreIds?.[0]).toBe(d.playbookId);
    expect(new Set(d.exploreIds).size).toBe(3);
    expect(d.verdict).toContain('2週間');
    expect(d.requiredMonthly).toBe(0);
  });

  it('やりたくないことに触れる手段は探索候補にも入らない', () => {
    const d = decide(p({ goalKind: 'explore', goalAmount: 3, avoid: ['stock', 'sales'] }));
    for (const id of d.exploreIds ?? []) {
      const pb = getPlaybook(id);
      for (const t of pb.traits) expect(['stock', 'sales']).not.toContain(t);
    }
  });

  it('探索中は複数手段の土台タスクが混ざり、手段名が付く', () => {
    const prf = prof();
    const d = decide(prf);
    const plan = buildPlan(prf, d.playbookId, d.exploreIds);
    const names = new Set<string>();
    const logs: Record<string, DayLog> = {};
    let pl = plan;
    for (const date of rangeDays(prf.startDate, addDays(prf.startDate, 6))) {
      const tasks = generateTasks({ plan: pl, profile: prf, date, logs });
      for (const t of tasks) {
        const m = t.title.match(/^【(.+?)】/);
        if (m) names.add(m[1]);
      }
      const log: DayLog = { date, closed: true, tasks: tasks.map((t) => ({ ...t, done: true })) };
      logs[date] = log;
      pl = closeDay(pl, log);
    }
    expect(names.size).toBeGreaterThanOrEqual(2);
  });

  it('探索中は反復タスクを出さない（試すことに集中させる）', () => {
    const prf = prof();
    const d = decide(prf);
    const plan = buildPlan(prf, d.playbookId, d.exploreIds);
    const tasks = generateTasks({ plan, profile: prf, date: prf.startDate, logs: {} });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.kind === 'step')).toBe(true);
  });

  it('14日で探索期間が終わる', () => {
    const prf = prof();
    const d = decide(prf);
    const plan = buildPlan(prf, d.playbookId, d.exploreIds);
    expect(isExploring(plan, prf.startDate)).toBe(true);
    expect(isExploring(plan, addDays(prf.startDate, 13))).toBe(true);
    expect(isExploring(plan, addDays(prf.startDate, 14))).toBe(false);
    expect(exploreDaysLeft(plan, prf.startDate)).toBe(14);
    expect(exploreDaysLeft(plan, addDays(prf.startDate, 20))).toBe(0);
  });

  it('手段を1つに確定すると探索は終わる', () => {
    const prf = prof();
    const plan = buildPlan(prf, 'content-seo');
    expect(isExploring(plan, prf.startDate)).toBe(false);
  });
});

describe('目標タイプ別のフェーズと週テーマ', () => {
  it('フェーズ名が目標タイプで変わる（売る前提の言葉を出さない）', () => {
    const money = buildPlan(p({ goalKind: 'money' }), 'content-seo');
    const proof = buildPlan(p({ goalKind: 'proof', goalAmount: 3 }), 'content-seo');
    const habit = buildPlan(p({ goalKind: 'habit', goalAmount: 30 }), 'content-seo');
    expect(money.phases[0].goal).toContain('売る');
    expect(proof.phases.map((x) => x.goal).join('')).not.toContain('いくらで売る');
    expect(habit.phases.map((x) => x.goal).join('')).not.toContain('いくらで売る');
    // フェーズは常に4つで、期間を覆う
    for (const pl of [money, proof, habit]) {
      expect(pl.phases.length).toBe(4);
      expect(pl.phases[3].endDate).toBe(base.deadline);
    }
  });

  it('週テーマがお金以外でも金銭の話にならない', () => {
    const d = addDays(base.startDate, 10);
    for (const [kindId, amount] of [
      ['proof', 3],
      ['skill', 1],
      ['habit', 30],
    ] as const) {
      const prof = p({ goalKind: kindId, goalAmount: amount });
      const pb = getPlaybook('content-seo');
      const plan: Plan = {
        ...buildPlan(prof, 'content-seo'),
        consumedStepIds: filterByGoal(pb.steps, goalKindOf(prof)).map((x) => x.id),
      };
      const f = computeWeeklyFocus(prof, plan, {}, d);
      const text = `${f.theme}${f.why}${f.kpi}`;
      expect(text, kindId).not.toContain('単価');
      expect(text, kindId).not.toContain('円');
      expect(['make', 'finish', 'show', 'keep'], kindId).toContain(f.id);
    }
  });

  it('探索中の週テーマは「比べること」になる', () => {
    const prof = p({ goalKind: 'explore', goalAmount: 3 });
    const dec = decide(prof);
    const plan = buildPlan(prof, dec.playbookId, dec.exploreIds);
    const f = computeWeeklyFocus(prof, plan, {}, addDays(base.startDate, 3));
    expect(f.id).toBe('explore');
    expect(f.theme).toContain('触ってみる');
    // 探索が終われば通常のテーマに戻る
    const after = computeWeeklyFocus(prof, plan, {}, addDays(base.startDate, 20));
    expect(after.id).not.toBe('explore');
  });
});

describe('目標タイプ別の上司の言葉', () => {
  const kinds = ['money', 'proof', 'skill', 'habit'] as const;

  it('どの目標タイプでも指示と示唆が壊れない', () => {
    for (const k of kinds) {
      const prof = p({ goalKind: k, goalAmount: k === 'money' ? 100000 : 30 });
      const d = decide(prof);
      const plan = buildPlan(prof, d.playbookId);
      const pr = computeProgress(prof, plan, {}, addDays(base.startDate, 5));
      const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs: {} });
      const m = morningBriefing(prof, plan, pr, tasks, base.startDate);
      expect(m.body.length, k).toBeGreaterThan(10);
      const tips = insights(prof, plan, { ...pr, allTasks: 30 });
      expect(tips.length, k).toBeGreaterThan(0);
      const log: DayLog = { date: base.startDate, closed: true, tasks: [] };
      expect(dayReview(prof, log, pr, 'keep').body.length).toBeGreaterThan(10);
    }
  });

  it('お金以外の目標では「収益」という言葉を使わない', () => {
    const prof = p({ goalKind: 'proof', goalAmount: 3 });
    const d = decide(prof);
    const plan = buildPlan(prof, d.playbookId);
    const pr = computeProgress(prof, plan, {}, addDays(base.startDate, 40));
    const tips = insights(prof, plan, { ...pr, allTasks: 30, totalRevenue: 2 });
    expect(tips.join('')).not.toContain('収益');
    const log: DayLog = { date: base.startDate, closed: true, tasks: [], revenue: 2 };
    const rv = dayReview(prof, log, { ...pr, totalRevenue: 2 }, 'keep', 2);
    expect(rv.body).toContain('本');
    expect(rv.body).not.toContain('円');
  });

  it('習慣の目標では連続日数を突きつける', () => {
    const prof = p({ goalKind: 'habit', goalAmount: 30 });
    const d = decide(prof);
    const plan = buildPlan(prof, d.playbookId);
    const pr = computeProgress(prof, plan, {}, base.startDate);
    const tips = insights(prof, plan, { ...pr, allTasks: 30, streak: 12 });
    expect(tips.join('')).toContain('30日');
  });
});

/* --------------------------- 統合シミュレーション --------------------------- */
describe('計画→実行→記録→調整のループ（90日シミュレーション）', () => {
  const simulate = (prof: Profile, completion: (day: number) => number) => {
    const decision = decide(prof);
    let plan = buildPlan(prof, decision.playbookId);
    const logs: Record<string, DayLog> = {};
    const seenStepOnDay: string[] = [];

    const days = rangeDays(prof.startDate, prof.deadline, 400);
    days.forEach((date, i) => {
      const tasks = generateTasks({ plan, profile: prof, date, logs });
      expect(tasks.length, `day ${i} (${date}) にタスクが出ていない`).toBeGreaterThan(0);
      const rate = completion(i);
      const log: DayLog = {
        date,
        closed: true,
        tasks: tasks.map((t, j) => ({ ...t, done: j / tasks.length < rate })),
        revenue: i % 10 === 0 ? 5000 : undefined,
      };
      logs[date] = log;
      for (const t of log.tasks) if (t.kind === 'step' && t.done) seenStepOnDay.push(t.sourceId);
      plan = closeDay(plan, log);
      const pr = computeProgress(prof, plan, logs, date);
      plan = { ...plan, dailyMinutes: computeAdjustment(plan, pr).dailyMinutes };
    });
    return { plan, logs, decision, seenStepOnDay, days };
  };

  it('全力で走ると全ステップを消化しきる', () => {
    const prof = p({ deadline: addDays(base.startDate, 90), weeklyHours: 15 });
    const { plan, decision, seenStepOnDay } = simulate(prof, () => 1);
    const pb = getPlaybook(decision.playbookId);
    expect(plan.consumedStepIds.length).toBe(pb.steps.length);
    // 完了したステップが重複して指示されていない
    expect(new Set(seenStepOnDay).size).toBe(seenStepOnDay.length);
  });

  it('全く動かなくても毎日タスクは出続け、量は減っていく', () => {
    const prof = p({ deadline: addDays(base.startDate, 60) });
    const { plan, logs } = simulate(prof, () => 0);
    expect(plan.dailyMinutes).toBeLessThan(plan.baseDailyMinutes);
    expect(plan.dailyMinutes).toBeGreaterThanOrEqual(20);
    expect(Object.keys(logs).length).toBe(61);
  });

  it('サボりと挽回が混ざっても破綻しない', () => {
    const prof = p({ deadline: addDays(base.startDate, 90), weeklyHours: 8 });
    const { plan, logs } = simulate(prof, (d) => (d % 7 < 2 ? 0 : 1));
    const last = logs[addDays(base.startDate, 90)];
    expect(last.tasks.length).toBeGreaterThan(0);
    expect(plan.dailyMinutes).toBeGreaterThanOrEqual(20);
    const pr = computeProgress(prof, plan, logs, prof.deadline);
    expect(pr.totalRevenue).toBeGreaterThan(0);
    expect(Number.isFinite(pr.planProgress)).toBe(true);
  });

  it('どの手段を選んでも90日回し切れる', () => {
    for (const pb of PLAYBOOKS) {
      const prof = p({ deadline: addDays(base.startDate, 90) });
      let plan = buildPlan(prof, pb.id);
      const logs: Record<string, DayLog> = {};
      for (const date of rangeDays(prof.startDate, prof.deadline)) {
        const tasks = generateTasks({ plan, profile: prof, date, logs });
        expect(tasks.length, `${pb.id} / ${date}`).toBeGreaterThan(0);
        const log: DayLog = { date, closed: true, tasks: tasks.map((t) => ({ ...t, done: true })) };
        logs[date] = log;
        plan = closeDay(plan, log);
      }
      expect(plan.consumedStepIds.length).toBe(pb.steps.length);
    }
  });

  it('週が変わるとルーティンの消化枠がリセットされる', () => {
    const prof = p();
    let plan = buildPlan(prof, 'content-seo');
    const logs: Record<string, DayLog> = {};
    for (const date of rangeDays('2026-10-01', '2026-10-14')) {
      const tasks = generateTasks({ plan, profile: prof, date, logs });
      const log: DayLog = { date, closed: true, tasks: tasks.map((t) => ({ ...t, done: true })) };
      logs[date] = log;
      plan = closeDay(plan, log);
    }
    const weeks = Object.keys(plan.routineCounts);
    expect(weeks.length).toBeGreaterThanOrEqual(2);
    for (const wk of weeks) {
      for (const [rid, n] of Object.entries(plan.routineCounts[wk])) {
        const r = getPlaybook('content-seo').routines.find((x) => x.id === rid);
        if (r) expect(n).toBeLessThanOrEqual(r.perWeek);
      }
    }
  });
});
