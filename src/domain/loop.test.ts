import { describe, expect, it } from 'vitest';
import { buildPlan, generateTasks } from './planner';
import { activeTasks, advanceStreak, judgeDay } from './judge';
import { BLANK_MEMORY, DEFER_LIMIT, adjustEstimate, buildMemory, hasPaceSignal, memoryInsights, placeTask, sizeBandOf } from './memory';
import { dayReview } from './coach';
import { computeProgress } from './progress';
import { addDays, diffDays } from '../lib/date';
import type { DayLog, ParkedTask, Priority, Profile, Task } from '../types';

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

const mkTask = (patch: Partial<Task> & { id: string }): Task => ({
  date: base.startDate,
  sourceId: patch.id,
  kind: 'routine',
  phase: 1,
  title: `task ${patch.id}`,
  detail: '',
  estMin: 30,
  tag: '作業',
  priority: 'should' as Priority,
  done: false,
  ...patch,
});

const mkLog = (date: string, tasks: Task[], extra: Partial<DayLog> = {}): DayLog => ({
  date,
  tasks: tasks.map((t) => ({ ...t, date })),
  closed: true,
  ...extra,
});

/* ------------------------- 1個でも前進 ------------------------- */
describe('その日の判定', () => {
  it('3件中1件でも、それが本命なら前進として扱う', () => {
    const j = judgeDay({
      tasks: [
        mkTask({ id: 'a', priority: 'must', done: true }),
        mkTask({ id: 'b', done: false }),
        mkTask({ id: 'c', done: false }),
      ],
    });
    expect(j.verdict).toBe('win');
    expect(j.advanced).toBe(true);
    expect(j.done).toBe(1);
    expect(j.total).toBe(3);
  });

  it('本命が残ったら、動いていても「本命が残った」と言う', () => {
    const j = judgeDay({
      tasks: [
        mkTask({ id: 'a', priority: 'must', done: false }),
        mkTask({ id: 'b', done: true }),
        mkTask({ id: 'c', done: true }),
      ],
    });
    expect(j.verdict).toBe('partial');
    // 動いてはいるので、失敗にはしない
    expect(j.advanced).toBe(true);
    expect(j.why).toContain('task a');
  });

  it('ゼロの日だけが失敗', () => {
    const j = judgeDay({ tasks: [mkTask({ id: 'a' }), mkTask({ id: 'b' })] });
    expect(j.verdict).toBe('miss');
    expect(j.advanced).toBe(false);
  });

  it('全部やれば full', () => {
    const j = judgeDay({ tasks: [mkTask({ id: 'a', done: true })] });
    expect(j.verdict).toBe('full');
  });

  it('自分でパスしたタスクは採点の分母から外れる', () => {
    const j = judgeDay({
      tasks: [
        mkTask({ id: 'a', done: true }),
        mkTask({ id: 'b', deferredTo: '2026-10-03' }),
        mkTask({ id: 'c', deferredTo: '2026-10-04' }),
      ],
    });
    // 1/1 になる。パスは「やらなかった」ではなく「置き直した」
    expect(j.total).toBe(1);
    expect(j.verdict).toBe('full');
    expect(activeTasks(j ? [mkTask({ id: 'x', deferredTo: 'd' })] : []).length).toBe(0);
  });

  it('前進の連続日数は、100%の日だけを数えない', () => {
    const logs: Record<string, DayLog> = {};
    for (const i of [0, 1, 2]) {
      const d = addDays('2026-10-10', -i);
      logs[d] = mkLog(d, [
        mkTask({ id: 'm', priority: 'must', done: true }),
        mkTask({ id: 'x', done: false }),
      ]);
    }
    expect(advanceStreak(logs, '2026-10-10', addDays)).toBe(3);
  });

  it('締めのフィードバックが「1個でも勝ち」を言葉にする', () => {
    const prof = p();
    const plan = buildPlan(prof, 'content-seo');
    const log = mkLog('2026-10-05', [
      mkTask({ id: 'm', priority: 'must', done: true }),
      mkTask({ id: 'x', done: false }),
      mkTask({ id: 'y', done: false }),
    ]);
    const pr = computeProgress(prof, plan, { '2026-10-05': log }, '2026-10-05');
    const rv = dayReview(prof, log, pr, 'keep');
    expect(rv.tone).toBe('praise');
    expect(rv.headline).toContain('勝ち');
  });
});

/* --------------------------- 長期記憶 --------------------------- */
describe('長期記憶', () => {
  it('記録が無ければ補正しない', () => {
    expect(adjustEstimate(60, '作業', BLANK_MEMORY)).toBe(60);
    expect(hasPaceSignal(BLANK_MEMORY)).toBe(false);
  });

  it('見積りより時間がかかる人には、以降の見積りを増やす', () => {
    const logs: Record<string, DayLog> = {};
    for (let i = 1; i <= 5; i++) {
      const d = addDays('2026-10-10', -i);
      logs[d] = mkLog(d, [mkTask({ id: 'a', estMin: 60, done: true })], { actualMin: 90 });
    }
    const mem = buildMemory(logs, '2026-10-10');
    expect(mem.paceSamples).toBe(5);
    expect(mem.paceRatio).toBeCloseTo(1.5, 1);
    expect(hasPaceSignal(mem)).toBe(true);
    expect(adjustEstimate(60, '作業', mem)).toBe(90);
    expect(memoryInsights(mem).join(' ')).toContain('多く時間がかかってる');
  });

  it('締めていない日は記憶に入らない', () => {
    const logs: Record<string, DayLog> = {
      '2026-10-09': mkLog('2026-10-09', [mkTask({ id: 'a', done: true })], {
        closed: false,
        actualMin: 200,
      }),
    };
    expect(buildMemory(logs, '2026-10-10').days).toBe(0);
  });

  it('未来の記録は今日の記憶に混ざらない', () => {
    const logs: Record<string, DayLog> = {
      '2026-10-20': mkLog('2026-10-20', [mkTask({ id: 'a', done: true })]),
    };
    expect(buildMemory(logs, '2026-10-10').days).toBe(0);
  });

  it('タグ別の癖は、その日がそのタグに偏っていたときだけ学ぶ', () => {
    const logs: Record<string, DayLog> = {};
    for (let i = 1; i <= 4; i++) {
      const d = addDays('2026-10-10', -i);
      logs[d] = mkLog(d, [mkTask({ id: 'a', estMin: 60, tag: '執筆', done: true })], {
        actualMin: 120,
      });
    }
    const mem = buildMemory(logs, '2026-10-10');
    expect(mem.tagRatio['執筆'].samples).toBe(4);
    // 執筆だけ2倍。他のタグは全体ペースに従う
    expect(adjustEstimate(30, '執筆', mem)).toBe(60);
  });

  it('重さのバンド分けが境界で壊れない', () => {
    expect(sizeBandOf(30)).toBe('small');
    expect(sizeBandOf(31)).toBe('medium');
    expect(sizeBandOf(75)).toBe('medium');
    expect(sizeBandOf(76)).toBe('large');
  });
});

/* --------------------------- 賢い再配置 --------------------------- */
describe('置き直し', () => {
  const task = { estMin: 60, baseMin: 60, priority: 'should' as Priority, sourceId: 's1' };

  it('記録が無ければ翌日に置く', () => {
    const pl = placeTask(task, BLANK_MEMORY, '2026-10-05', '2026-12-31', {
      workdaysPerWeek: 5,
      deferCount: 0,
    });
    expect(pl.date).toBe('2026-10-06');
    expect(pl.drop).toBeFalsy();
  });

  it('消化できている曜日に寄せる', () => {
    const mem = { ...BLANK_MEMORY, weekdayRate: { ...BLANK_MEMORY.weekdayRate } };
    // 月〜金は低調、土曜(6)だけ高い
    for (const dow of [0, 1, 2, 3, 4, 5]) mem.weekdayRate[dow] = { done: 1, total: 10, rate: 0.1 };
    mem.weekdayRate[6] = { done: 10, total: 10, rate: 1 };
    const pl = placeTask(task, mem, '2026-10-05', '2026-12-31', {
      workdaysPerWeek: 5,
      deferCount: 0,
    });
    // 2026-10-10 が土曜
    expect(pl.date).toBe('2026-10-10');
    expect(pl.reason).toContain('土曜');
  });

  it('期限を越える先には置かない', () => {
    const pl = placeTask(task, BLANK_MEMORY, '2026-10-05', '2026-10-07', {
      workdaysPerWeek: 5,
      deferCount: 0,
    });
    expect(diffDays(pl.date, '2026-10-07')).toBeGreaterThanOrEqual(0);
  });

  it('逃げ続けたら「捨てるか」を問う', () => {
    const pl = placeTask(task, BLANK_MEMORY, '2026-10-05', '2026-12-31', {
      workdaysPerWeek: 5,
      deferCount: DEFER_LIMIT - 1,
    });
    expect(pl.drop).toBe(true);
    expect(pl.reason).toContain('先送り');
  });
});

/* ------------------------ タスク生成との接続 ------------------------ */
describe('生成との接続', () => {
  const prof = p();

  it('1日に本命はひとつだけ', () => {
    const plan = buildPlan(prof, 'content-seo');
    for (const i of [0, 1, 2, 3, 7, 14]) {
      const d = addDays(prof.startDate, i);
      const tasks = generateTasks({ plan, profile: prof, date: d, logs: {} });
      expect(tasks.filter((t) => t.priority === 'must').length).toBeLessThanOrEqual(1);
    }
  });

  it('原則5件を超えない', () => {
    const plan = buildPlan(p({ weeklyHours: 40 }), 'content-seo');
    const tasks = generateTasks({ plan, profile: prof, date: prof.startDate, logs: {} });
    expect(tasks.length).toBeLessThanOrEqual(5);
  });

  it('置き直したタスクは、その日まで出ないで、その日に戻ってくる', () => {
    const plan = buildPlan(prof, 'content-seo');
    const due = addDays(prof.startDate, 3);
    const parked: ParkedTask = {
      sourceId: 'parked-1',
      kind: 'routine',
      phase: 1,
      title: '置き直したタスク',
      detail: '',
      estMin: 30,
      baseMin: 30,
      tag: '作業',
      priority: 'should',
      dueOn: due,
      deferCount: 1,
      from: prof.startDate,
      reason: '木曜に置く',
    };
    const withParked = { ...plan, parked: [parked] };

    const before = generateTasks({
      plan: withParked,
      profile: prof,
      date: addDays(prof.startDate, 1),
      logs: {},
    });
    expect(before.some((t) => t.sourceId === 'parked-1')).toBe(false);

    const onDay = generateTasks({ plan: withParked, profile: prof, date: due, logs: {} });
    const back = onDay.find((t) => t.sourceId === 'parked-1');
    expect(back).toBeTruthy();
    // 一度逃げたものは先頭に戻す
    expect(back!.priority).toBe('must');
    expect(onDay[0].sourceId).toBe('parked-1');
  });

  it('「もうやらない」にしたタスクは二度と出てこない', () => {
    const plan = buildPlan(prof, 'content-seo');
    const first = generateTasks({ plan, profile: prof, date: prof.startDate, logs: {} });
    const victim = first[0].sourceId;
    const dropped = { ...plan, droppedIds: [victim] };
    for (const i of [0, 1, 2, 5]) {
      const tasks = generateTasks({
        plan: dropped,
        profile: prof,
        date: addDays(prof.startDate, i),
        logs: {},
      });
      expect(tasks.some((t) => t.sourceId === victim)).toBe(false);
    }
  });

  it('パスしたタスクは、その日までは繰越にも出ない', () => {
    const plan = buildPlan(prof, 'content-seo');
    const d0 = prof.startDate;
    const first = generateTasks({ plan, profile: prof, date: d0, logs: {} });
    const target = first[first.length - 1];
    const logs: Record<string, DayLog> = {
      [d0]: {
        date: d0,
        closed: true,
        tasks: first.map((t) =>
          t.id === target.id ? { ...t, deferredTo: addDays(d0, 3), deferCount: 1 } : t,
        ),
      },
    };
    const next = generateTasks({ plan, profile: prof, date: addDays(d0, 1), logs });
    expect(next.some((t) => t.sourceId === target.sourceId)).toBe(false);
  });

  it('記憶が溜まると、生成される見積りが実測に寄る', () => {
    const plan = buildPlan(prof, 'content-seo');
    const plain = generateTasks({ plan, profile: prof, date: prof.startDate, logs: {} });

    const logs: Record<string, DayLog> = {};
    for (let i = 1; i <= 5; i++) {
      const d = addDays(prof.startDate, -i);
      logs[d] = mkLog(d, [mkTask({ id: `a${i}`, estMin: 60, done: true })], { actualMin: 120 });
    }
    const mem = buildMemory(logs, prof.startDate);
    const adjusted = generateTasks({ plan, profile: prof, date: prof.startDate, logs: {}, memory: mem });

    const pick = adjusted.find((t) => t.sourceId === plain[0].sourceId);
    expect(pick).toBeTruthy();
    expect(pick!.estMin).toBeGreaterThan(plain[0].estMin);
    // 元の見積りは残しておく（次の学習の基準になる）
    expect(pick!.baseMin).toBe(plain[0].estMin);
  });
});
