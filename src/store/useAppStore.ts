import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppState, DayLog, Plan, Profile } from '../types';
import { decide, decideWith } from '../domain/decide';
import { buildPlan, computeDailyMinutes, generateTasks } from '../domain/planner';
import { closeDay, computeAdjustment } from '../domain/adjust';
import { computeProgress } from '../domain/progress';
import { todayISO } from '../lib/date';

interface Store extends AppState {
  /** ヒアリング完了 → 手段決定 → 計画生成 */
  start: (profile: Profile) => void;
  /** 手段を選び直す */
  switchPlaybook: (playbookId: string) => void;
  /** その日のタスクを用意（未生成なら生成する） */
  ensureDay: (date: string) => void;
  toggleTask: (date: string, taskId: string) => void;
  /** 1日を締める */
  finishDay: (date: string, input: { revenue?: number; memo?: string; actualMin?: number; mood?: 1 | 2 | 3 }) => string;
  /** タスクを1件追加（ユーザー任意） */
  addCustomTask: (date: string, title: string, estMin: number) => void;
  removeTask: (date: string, taskId: string) => void;
  updateProfile: (patch: Partial<Profile>) => void;
  reset: () => void;
  importState: (raw: string) => boolean;
}

const empty: AppState = {
  profile: null,
  decision: null,
  plan: null,
  logs: {},
  createdAt: todayISO(),
};

export const useAppStore = create<Store>()(
  persist(
    (set, get) => ({
      ...empty,

      start: (profile) => {
        const decision = decide(profile);
        const plan = buildPlan(profile, decision.playbookId, decision.exploreIds);
        set({ profile, decision, plan, logs: {}, createdAt: todayISO() });
        get().ensureDay(todayISO());
      },

      switchPlaybook: (playbookId) => {
        const { profile } = get();
        if (!profile) return;
        const decision = decideWith(profile, playbookId);
        // 手段を確定したら探索モードは終わり
        const plan = buildPlan(profile, playbookId);
        // 過去ログは残すが、未締めの今日分は作り直す
        const logs = { ...get().logs };
        const t = todayISO();
        if (logs[t] && !logs[t].closed) delete logs[t];
        set({ decision, plan, logs });
        get().ensureDay(t);
      },

      ensureDay: (date) => {
        const { plan, profile, logs } = get();
        if (!plan || !profile) return;
        if (logs[date]) return;
        const tasks = generateTasks({ plan, profile, date, logs });
        set({ logs: { ...logs, [date]: { date, tasks, closed: false } } });
      },

      toggleTask: (date, taskId) => {
        const logs = { ...get().logs };
        const log = logs[date];
        if (!log) return;
        logs[date] = {
          ...log,
          tasks: log.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)),
        };
        set({ logs });
      },

      addCustomTask: (date, title, estMin) => {
        const logs = { ...get().logs };
        const log = logs[date];
        if (!log) return;
        const id = `${date}_custom_${Date.now()}`;
        logs[date] = {
          ...log,
          tasks: [
            ...log.tasks,
            {
              id,
              date,
              sourceId: id,
              kind: 'routine',
              phase: log.tasks[0]?.phase ?? 1,
              title,
              detail: '自分で追加したタスク',
              estMin,
              tag: '自主',
              done: false,
            },
          ],
        };
        set({ logs });
      },

      removeTask: (date, taskId) => {
        const logs = { ...get().logs };
        const log = logs[date];
        if (!log) return;
        logs[date] = { ...log, tasks: log.tasks.filter((t) => t.id !== taskId) };
        set({ logs });
      },

      finishDay: (date, input) => {
        const { plan, profile, logs } = get();
        if (!plan || !profile) return '';
        const log = logs[date];
        if (!log) return '';

        const closedLog: DayLog = { ...log, ...input, closed: true };
        const nextLogs = { ...logs, [date]: closedLog };

        // ステップ／ルーティンの消化を反映
        let nextPlan: Plan = closeDay(plan, closedLog);

        // 翌日の負荷を自動調整
        const progress = computeProgress(profile, nextPlan, nextLogs, date);
        const adj = computeAdjustment(nextPlan, progress);
        nextPlan = { ...nextPlan, dailyMinutes: adj.dailyMinutes };

        set({ plan: nextPlan, logs: nextLogs });
        return adj.reason;
      },

      updateProfile: (patch) => {
        const { profile, plan } = get();
        if (!profile || !plan) return;
        const next = { ...profile, ...patch };
        const daily = computeDailyMinutes(next);
        set({
          profile: next,
          plan: { ...plan, baseDailyMinutes: daily, dailyMinutes: daily },
        });
      },

      reset: () => set({ ...empty, createdAt: todayISO() }),

      importState: (raw) => {
        try {
          const data = JSON.parse(raw) as AppState;
          if (!data.profile || !data.plan) return false;
          set({
            profile: data.profile,
            decision: data.decision ?? null,
            plan: data.plan,
            logs: data.logs ?? {},
            createdAt: data.createdAt ?? todayISO(),
          });
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: 'mokuhyou-tassei-v1',
      version: 2,
      // v1（目標＝金額のみ）で保存されたデータを読めるようにする
      migrate: (persisted, version) => {
        const st = persisted as Partial<AppState>;
        if (version >= 2 || !st?.profile) return st as AppState;
        const prof = st.profile as Profile & Partial<Pick<Profile, 'anxiety' | 'goalKind'>>;
        return {
          ...st,
          profile: { ...prof, anxiety: prof.anxiety ?? 'money', goalKind: prof.goalKind ?? 'money' },
        } as AppState;
      },
    },
  ),
);

export function exportState(): string {
  const { profile, decision, plan, logs, createdAt } = useAppStore.getState();
  return JSON.stringify({ profile, decision, plan, logs, createdAt }, null, 2);
}

/** 決定エンジンをUIから直接使うためのre-export */
export { decide, decideWith };
