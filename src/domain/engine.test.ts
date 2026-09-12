import { describe, expect, it } from 'vitest';
import { decide, decideWith, expectedAt, requiredMonthly, scorePlaybook } from './decide';
import { PLAYBOOKS, getPlaybook } from './playbooks';
import { buildPlan, computeDailyMinutes, generateTasks, phaseForDate } from './planner';
import { closeDay, computeAdjustment } from './adjust';
import { computeProgress, dailyRates, monthlyRevenue, tagBreakdown } from './progress';
import { dayReview, insights, morningBriefing } from './coach';
import { addDays, diffDays, formatJP, rangeDays, toISO, weekKey } from '../lib/date';
import type { DayLog, Plan, Profile } from '../types';

const base: Profile = {
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

  it('全ステップ消化後もルーティンで毎日が埋まる', () => {
    const prof = p();
    const pb = getPlaybook('sns-agency');
    const plan: Plan = {
      ...buildPlan(prof, 'sns-agency'),
      consumedStepIds: pb.steps.map((s) => s.id),
    };
    const tasks = generateTasks({ plan, profile: prof, date: base.startDate, logs: {} });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.kind === 'routine')).toBe(true);
    expect(tasks.some((t) => t.sourceId !== 'review')).toBe(true);
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
        { id: '1', date: base.startDate, sourceId: 'cs1', kind: 'step', phase: 1, title: '', detail: '', estMin: 30, tag: '', done: true },
        { id: '2', date: base.startDate, sourceId: 'cs2', kind: 'step', phase: 1, title: '', detail: '', estMin: 30, tag: '', done: false },
        { id: '3', date: base.startDate, sourceId: 'csR1', kind: 'routine', phase: 1, title: '', detail: '', estMin: 30, tag: '', done: true },
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
    const a = morningBriefing(plan, pr, tasks, '2026-10-05');
    const b = morningBriefing(plan, pr, tasks, '2026-10-05');
    expect(a).toEqual(b);
  });

  it('止まっているときは警告トーンになる', () => {
    const pr = computeProgress(prof, plan, {}, '2026-10-05');
    const stalled = { ...pr, pace: 'stalled' as const, missStreak: 4 };
    const tasks = generateTasks({ plan, profile: prof, date: '2026-10-05', logs: {} });
    const m = morningBriefing(plan, stalled, tasks, '2026-10-05');
    expect(m.tone).toBe('warn');
    expect(m.body).toContain('4日');
  });

  it('全消化なら褒める / ゼロなら詰める', () => {
    const pr = computeProgress(prof, plan, {}, '2026-10-05');
    const mk = (done: boolean): DayLog => ({
      date: '2026-10-05',
      closed: true,
      tasks: [
        { id: '1', date: '2026-10-05', sourceId: 'a', kind: 'step', phase: 1, title: '', detail: '', estMin: 30, tag: '', done },
      ],
    });
    expect(dayReview(mk(true), pr, 'keep').tone).toBe('praise');
    expect(dayReview(mk(false), pr, 'keep').tone).toBe('warn');
  });

  it('締めのフィードバックに翌日の調整理由が入る', () => {
    const pr = computeProgress(prof, plan, {}, '2026-10-05');
    const log: DayLog = { date: '2026-10-05', closed: true, tasks: [] };
    expect(dayReview(log, pr, 'テスト理由').body).toContain('テスト理由');
  });

  it('示唆は必ず1件以上返る', () => {
    const pr = computeProgress(prof, plan, {}, '2026-10-05');
    expect(insights(plan, pr).length).toBeGreaterThan(0);
    expect(insights(plan, { ...pr, allTasks: 50, recentRate: 0.2 }).length).toBeGreaterThan(0);
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
