import { describe, expect, it } from 'vitest';
import {
  PLANS,
  PLAN_ORDER,
  TRIAL_DAYS,
  UNLIMITED,
  can,
  effectivePlan,
  freeMonths,
  limitOf,
  perMonth,
  priceOf,
  requiredPlan,
  startTrial,
  trialDaysLeft,
  yearlySaving,
} from './entitlements';
import type { FeatureId, PlanId } from './entitlements';
import { localAssistant } from '../assistant/local';
import { BLANK_MEMORY } from './memory';
import { buildPlan } from './planner';
import { computeProgress } from './progress';
import { decide } from './decide';
import { addDays } from '../lib/date';
import type { Profile } from '../types';

const prof: Profile = {
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

describe('料金', () => {
  it('年払いはどのプランもちょうど2ヶ月ぶん無料', () => {
    for (const id of ['basic', 'pro', 'premium'] as PlanId[]) {
      expect(freeMonths(id)).toBe(2);
      expect(yearlySaving(id)).toBe(PLANS[id].monthly * 2);
    }
  });

  it('提示している金額が仕様どおり', () => {
    expect([priceOf('basic', 'monthly'), priceOf('basic', 'yearly')]).toEqual([980, 9800]);
    expect([priceOf('pro', 'monthly'), priceOf('pro', 'yearly')]).toEqual([1980, 19800]);
    expect([priceOf('premium', 'monthly'), priceOf('premium', 'yearly')]).toEqual([3980, 39800]);
  });

  it('年払いの実質月額は月払いより安い', () => {
    for (const id of ['basic', 'pro', 'premium'] as PlanId[]) {
      expect(perMonth(id, 'yearly')).toBeLessThan(perMonth(id, 'monthly'));
    }
  });

  it('主力はProひとつだけ', () => {
    expect(PLAN_ORDER.filter((id) => PLANS[id].recommended)).toEqual(['pro']);
  });
});

describe('機能解放', () => {
  it('上位プランは下位の機能を必ず含む', () => {
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      const lower = PLANS[PLAN_ORDER[i - 1]].features;
      const upper = PLANS[PLAN_ORDER[i]].features;
      for (const f of lower) expect(upper).toContain(f);
    }
  });

  it('上限が0でない機能は、プランの features にも入っている（表示と実体のズレ防止）', () => {
    for (const id of PLAN_ORDER) {
      const chatty = limitOf(id, 'chatPerDay') > 0;
      expect(can(id, 'chatText')).toBe(chatty);
    }
  });

  it('宣伝文句と実際に開く機能が食い違っていない', () => {
    // Basic は「1日10回までAI秘書と話せる」と書いてある
    expect(can('basic', 'chatText')).toBe(true);
    expect(limitOf('basic', 'chatPerDay')).toBe(10);
    // Basic では音声は開かない
    expect(can('basic', 'chatVoice')).toBe(false);
  });

  it('上限も上位プランほど緩い', () => {
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      for (const k of ['goals', 'historyDays', 'chatPerDay'] as const) {
        expect(limitOf(PLAN_ORDER[i], k)).toBeGreaterThanOrEqual(limitOf(PLAN_ORDER[i - 1], k));
      }
    }
  });

  it('無料でも「毎日のタスク」と「締める」は止めない', () => {
    expect(can('free', 'dailyTasks')).toBe(true);
    expect(can('free', 'closeDay')).toBe(true);
  });

  it('音声と外部連携の解放段階', () => {
    expect(requiredPlan('chatVoice')).toBe('pro');
    expect(requiredPlan('integrations')).toBe('premium');
    expect(requiredPlan('smartReplan')).toBe('basic');
    expect(requiredPlan('chatText')).toBe('basic');
  });

  it('Premiumは全機能', () => {
    const all: FeatureId[] = [
      'dailyTasks',
      'closeDay',
      'smartReplan',
      'memoryEstimate',
      'memoryInsights',
      'weeklyFocus',
      'chatText',
      'chatVoice',
      'exportData',
      'integrations',
      'automation',
    ];
    for (const f of all) expect(can('premium', f)).toBe(true);
    expect(limitOf('premium', 'goals')).toBe(UNLIMITED);
  });
});

describe('無料期間', () => {
  it('開始直後はProが全部使える', () => {
    const sub = startTrial('2026-10-01');
    expect(effectivePlan(sub, '2026-10-01')).toBe('pro');
    expect(trialDaysLeft(sub, '2026-10-01')).toBe(TRIAL_DAYS);
    expect(can(effectivePlan(sub, '2026-10-03'), 'chatVoice')).toBe(true);
  });

  it('期限を過ぎたらFreeに落ちる', () => {
    const sub = startTrial('2026-10-01');
    const after = addDays('2026-10-01', TRIAL_DAYS + 1);
    expect(effectivePlan(sub, after)).toBe('free');
    expect(trialDaysLeft(sub, after)).toBe(0);
  });

  it('支払いが止まっていたらFree扱い', () => {
    expect(effectivePlan({ planId: 'pro', cycle: 'monthly', status: 'past_due' }, '2026-10-01')).toBe('free');
    expect(effectivePlan({ planId: 'pro', cycle: 'monthly', status: 'canceled' }, '2026-10-01')).toBe('free');
    expect(effectivePlan(null, '2026-10-01')).toBe('free');
  });
});

describe('AI秘書（端末内ルール実装）', () => {
  const plan = buildPlan(prof, decide(prof).playbookId);
  const ctx = {
    profile: prof,
    plan,
    progress: computeProgress(prof, plan, {}, prof.startDate),
    memory: BLANK_MEMORY,
    today: prof.startDate,
    tasks: [
      {
        id: 't1',
        date: prof.startDate,
        sourceId: 's1',
        kind: 'step' as const,
        phase: 1 as const,
        title: '売るものを1つに決める',
        detail: '決め切る',
        estMin: 45,
        tag: '準備',
        priority: 'must' as const,
        done: false,
      },
      {
        id: 't2',
        date: prof.startDate,
        sourceId: 's2',
        kind: 'routine' as const,
        phase: 1 as const,
        title: '提案を3件送る',
        detail: '',
        estMin: 90,
        tag: '営業',
        priority: 'should' as const,
        done: false,
      },
    ],
    log: null,
    history: [],
  };

  const ask = (text: string) => localAssistant.reply({ text, ctx });

  it('「今日なにやる？」には本命を名指しで返す', async () => {
    const r = await ask('今日は何をやればいい？');
    expect(r.text).toContain('売るものを1つに決める');
    expect(r.actions?.[0].kind).toBe('done');
  });

  it('「時間がない」には1個に絞って、残りを置き直す手を出す', async () => {
    const r = await ask('時間がない、疲れた');
    expect(r.text).toContain('1個だけ');
    expect(r.actions?.some((a) => a.kind === 'defer')).toBe(true);
  });

  it('「量が多い」には重い順と再計画を返す', async () => {
    const r = await ask('量が多すぎる');
    // 重い順なので90分のタスクが先
    expect(r.text.indexOf('提案を3件送る')).toBeLessThan(r.text.indexOf('売るものを1つに決める'));
    expect(r.actions?.some((a) => a.kind === 'replan')).toBe(true);
  });

  it('「なんで？」にはフェーズの狙いで答える', async () => {
    const r = await ask('なんでこれをやるの？');
    expect(r.text).toContain('売るものを1つに決める');
    expect(r.text).toContain('決め切る');
  });

  it('分からないときは適当に喋らず、聞き返す', async () => {
    const r = await ask('あqwerty');
    expect(r.text).toContain('聞きたいのはどれ');
  });

  it('同じ問いには同じ答え（上司がブレない）', async () => {
    const a = await ask('進捗どう？');
    const b = await ask('進捗どう？');
    expect(a.text).toBe(b.text);
  });
});
