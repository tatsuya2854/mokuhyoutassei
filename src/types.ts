/** アプリ全体の型定義 */

export type SkillId =
  | 'writing'
  | 'design'
  | 'coding'
  | 'video'
  | 'sns'
  | 'sales'
  | 'marketing'
  | 'photo'
  | 'speaking'
  | 'excel'
  | 'lang'
  | 'none';

export type AvoidId =
  | 'face' // 顔出し
  | 'voice' // 声出し
  | 'stock' // 在庫を持つ
  | 'sales' // 営業・商談
  | 'client' // クライアント対応（納期に縛られる）
  | 'daily' // 毎日投稿のような高頻度作業
  | 'phone' // 電話・通話
  | 'invest' // 初期投資を張る
  | 'meet'; // 人と会う

export type GoalMode = 'monthly' | 'total';

/** ヒアリング結果 */
export interface Profile {
  goalAmount: number;
  goalMode: GoalMode;
  deadline: string; // YYYY-MM-DD
  weeklyHours: number;
  workdaysPerWeek: number;
  skills: SkillId[];
  budget: number;
  avoid: AvoidId[];
  note: string;
  startDate: string; // YYYY-MM-DD
}

export type PhaseNo = 1 | 2 | 3 | 4;

export interface StepTemplate {
  id: string;
  phase: PhaseNo;
  title: string;
  detail: string;
  estMin: number;
  tag: string;
}

export interface RoutineTemplate {
  id: string;
  phase: PhaseNo;
  title: string;
  detail: string;
  estMin: number;
  perWeek: number;
  tag: string;
}

export interface Playbook {
  id: string;
  name: string;
  tagline: string;
  model: string; // 収益モデルの一言説明
  minWeeklyHours: number;
  minBudget: number;
  /** 開始からNヶ月時点で見込める月収の目安（円） */
  ramp: { m1: number; m2: number; m3: number; m6: number };
  requiredSkills: SkillId[];
  boostSkills: SkillId[];
  traits: AvoidId[]; // この手段が構造的に含む要素
  ceiling: number; // 現実的な月収の上限目安
  why: string[];
  risks: string[];
  steps: StepTemplate[];
  routines: RoutineTemplate[];
}

export interface PhaseInfo {
  no: PhaseNo;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
}

export interface Decision {
  playbookId: string;
  score: number;
  reasons: string[];
  rejected: { playbookId: string; score: number; reason: string }[];
  verdict: string; // 「これでいく」の断言文
  feasibility: 'easy' | 'tight' | 'hard';
  requiredMonthly: number;
}

/** 生成された1タスク */
export interface Task {
  id: string;
  date: string; // YYYY-MM-DD
  sourceId: string; // step / routine のテンプレID
  kind: 'step' | 'routine';
  phase: PhaseNo;
  title: string;
  detail: string;
  estMin: number;
  tag: string;
  done: boolean;
  carriedFrom?: string; // 繰越元の日付
}

export interface DayLog {
  date: string;
  tasks: Task[];
  actualMin?: number;
  revenue?: number; // その日に確定した収益
  memo?: string;
  closed: boolean; // 一日を締めたか
  mood?: 1 | 2 | 3;
}

export interface Plan {
  playbookId: string;
  phases: PhaseInfo[];
  /** 消化済みステップID（順番に消費する） */
  consumedStepIds: string[];
  /** 週キー -> ルーティンID -> 消化回数 */
  routineCounts: Record<string, Record<string, number>>;
  /** 1日あたりの作業分数（調整で増減する） */
  dailyMinutes: number;
  baseDailyMinutes: number;
}

export interface AppState {
  profile: Profile | null;
  decision: Decision | null;
  plan: Plan | null;
  logs: Record<string, DayLog>;
  createdAt: string;
}
