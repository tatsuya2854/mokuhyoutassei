/**
 * プランごとの機能解放（Feature Entitlement）。
 *
 * 料金も上限もここ1か所にしか書かない。
 * 値上げ・値下げ・上限変更をしても、アプリ側のコードは
 * 「can(plan, 'chatText') か？」としか聞かないので壊れない。
 */

import { addDays, diffDays } from '../lib/date';

export type PlanId = 'free' | 'basic' | 'pro' | 'premium';
export type Cycle = 'monthly' | 'yearly';

export type FeatureId =
  /** 毎日のタスク生成 */
  | 'dailyTasks'
  /** 1日を締めて翌日を自動調整する */
  | 'closeDay'
  /** 「今日はパス」「再計画」で賢く置き直す */
  | 'smartReplan'
  /** 見積りを実績で補正する */
  | 'memoryEstimate'
  /** 「あなたについて分かったこと」 */
  | 'memoryInsights'
  /** 週次レビューと今週のテーマ */
  | 'weeklyFocus'
  /** テキストでAI秘書と話す */
  | 'chatText'
  /** 音声で話す */
  | 'chatVoice'
  /** データの書き出し */
  | 'exportData'
  /** 外部サービス連携（カレンダー等） */
  | 'integrations'
  /** 高度な自動化 */
  | 'automation';

export type LimitId =
  /** 同時に走らせられる目標の数 */
  | 'goals'
  /** さかのぼって見られる日数 */
  | 'historyDays'
  /** 1日に話せる回数 */
  | 'chatPerDay';

export interface PlanDef {
  id: PlanId;
  name: string;
  /** 誰向けか。1行 */
  lead: string;
  /** 税込・月額（円）。0 は無料 */
  monthly: number;
  /** 税込・年額（円）。0 は無料 */
  yearly: number;
  features: FeatureId[];
  limits: Record<LimitId, number>;
  /** プラン表に出す「これができる」 */
  highlights: string[];
  /** 主力として推すプラン */
  recommended?: boolean;
}

/** 上限なしを表す値 */
export const UNLIMITED = Infinity;

/** 無料で全機能を試せる日数 */
export const TRIAL_DAYS = 7;

const ALL: FeatureId[] = [
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

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: 'free',
    name: 'Free',
    lead: '無料期間が終わったあと。記録は消えないし、今日のタスクは出続ける。',
    monthly: 0,
    yearly: 0,
    features: ['dailyTasks', 'closeDay'],
    limits: { goals: 1, historyDays: 14, chatPerDay: 0 },
    highlights: ['毎日のタスク生成', '1日を締めて記録する', '直近14日の記録'],
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    lead: 'まず「毎日ゼロをなくす」ところまで。ループを回しきるための最小構成。',
    monthly: 980,
    yearly: 9800,
    features: [
      'dailyTasks',
      'closeDay',
      'smartReplan',
      'memoryEstimate',
      'weeklyFocus',
      'chatText',
      'exportData',
    ],
    limits: { goals: 1, historyDays: 90, chatPerDay: 10 },
    highlights: [
      'スワイプで「今日はパス」「再計画」',
      '実績から見積りを自動補正',
      '週次レビューと今週のテーマ',
      '1日10回までAI秘書と話せる',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    lead: '本命。AI秘書が癖まで覚えて、毎日の組み直しを全部やる。',
    monthly: 1980,
    yearly: 19800,
    features: [
      'dailyTasks',
      'closeDay',
      'smartReplan',
      'memoryEstimate',
      'memoryInsights',
      'weeklyFocus',
      'chatText',
      'chatVoice',
      'exportData',
    ],
    limits: { goals: 3, historyDays: UNLIMITED, chatPerDay: UNLIMITED },
    highlights: [
      'Basicの全部',
      '「あなたについて分かったこと」',
      'AI秘書と回数無制限で話せる',
      '音声で話しかけられる',
      '目標を3つまで並行',
      '記録は全期間ずっと残る',
    ],
    recommended: true,
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    lead: '外部サービスとつないで、手を動かす前に予定まで埋める。',
    monthly: 3980,
    yearly: 39800,
    features: ALL,
    limits: { goals: UNLIMITED, historyDays: UNLIMITED, chatPerDay: UNLIMITED },
    highlights: [
      'Proの全部',
      'カレンダー等の外部連携',
      '高度な自動化（予定の自動確保・自動リマインド）',
      '目標は無制限',
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'basic', 'pro', 'premium'];

/** そのプランでその機能が使えるか。アプリ側はこれしか聞かない */
export function can(plan: PlanId, feature: FeatureId): boolean {
  return PLANS[plan].features.includes(feature);
}

export function limitOf(plan: PlanId, key: LimitId): number {
  return PLANS[plan].limits[key];
}

/** 年払いにすると何円浮くか */
export function yearlySaving(plan: PlanId): number {
  const d = PLANS[plan];
  return d.monthly * 12 - d.yearly;
}

/** 年払いの割引は「何ヶ月ぶん無料」か。端数は丸めずに月数で見せる */
export function freeMonths(plan: PlanId): number {
  const d = PLANS[plan];
  if (d.monthly === 0) return 0;
  return Math.round(yearlySaving(plan) / d.monthly);
}

/** 月あたりいくらになるか（年払い時の実質月額） */
export function perMonth(plan: PlanId, cycle: Cycle): number {
  const d = PLANS[plan];
  return cycle === 'yearly' ? Math.round(d.yearly / 12) : d.monthly;
}

export function priceOf(plan: PlanId, cycle: Cycle): number {
  return cycle === 'yearly' ? PLANS[plan].yearly : PLANS[plan].monthly;
}

/* ------------------------------------------------------------------ */
/*  加入状態                                                            */
/* ------------------------------------------------------------------ */

export type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'none';

export interface Subscription {
  planId: PlanId;
  cycle: Cycle;
  status: SubStatus;
  /** 無料期間の終わり（YYYY-MM-DD）。trialing のときだけ意味を持つ */
  trialEndsOn?: string;
  /** 次の請求日（YYYY-MM-DD） */
  renewsOn?: string;
  /** 決済側の顧客ID。フロントに鍵は置かないので、これ以上は持たない */
  customerRef?: string;
}

/** 初回。7日間はProを全部使える */
export function startTrial(today: string): Subscription {
  const endsOn = addDays(today, TRIAL_DAYS);
  return { planId: 'pro', cycle: 'monthly', status: 'trialing', trialEndsOn: endsOn, renewsOn: endsOn };
}

/**
 * 実際に使えるプラン。
 * 無料期間が切れていたら Free に落ちる。支払い遅延も同じ扱い。
 */
export function effectivePlan(sub: Subscription | null, today: string): PlanId {
  if (!sub) return 'free';
  if (sub.status === 'trialing') {
    return sub.trialEndsOn && today > sub.trialEndsOn ? 'free' : sub.planId;
  }
  if (sub.status === 'active') return sub.planId;
  return 'free';
}

/** 無料期間の残り日数。切れていたら0 */
export function trialDaysLeft(sub: Subscription | null, today: string): number {
  if (!sub || sub.status !== 'trialing' || !sub.trialEndsOn) return 0;
  return Math.max(diffDays(today, sub.trialEndsOn), 0);
}

/** その機能を使うのに最低限必要なプラン。案内文に使う */
export function requiredPlan(feature: FeatureId): PlanId {
  return PLAN_ORDER.find((id) => can(id, feature)) ?? 'premium';
}
