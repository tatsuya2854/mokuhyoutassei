import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppState, DayLog, ParkedTask, Plan, Profile } from '../types';
import { decide, decideWith } from '../domain/decide';
import { buildPlan, computeDailyMinutes, generateTasks } from '../domain/planner';
import { closeDay, computeAdjustment } from '../domain/adjust';
import { computeProgress } from '../domain/progress';
import { buildMemory, placeTask } from '../domain/memory';
import type { Memory } from '../domain/memory';
import { todayISO } from '../lib/date';

/** 「今日はパス」と「再計画」の違い。どちらも未来に置き直すが、言い方と置き方が変わる */
export type MoveMode = 'defer' | 'replan';

/** 置き直した結果。UIでそのまま上司の言葉として出す */
export interface MoveResult {
  date: string;
  reason: string;
  /** 逃げ続けているので「捨てるか」を問うべき状態 */
  askDrop: boolean;
}

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
  /** 「今日はパス」／「再計画」。記憶を見ていちばん終わりそうな日に置き直す */
  moveTask: (date: string, taskId: string, mode: MoveMode) => MoveResult | null;
  /** 置き直しを取り消して今日に戻す */
  undoMove: (date: string, taskId: string) => void;
  /** 「もうやらない」。以降このタスクは生成されない */
  dropTask: (date: string, taskId: string) => void;
  /** 捨てたタスクを復活させる */
  undropTask: (sourceId: string) => void;
  /** 行動データから作る長期記憶 */
  memory: (date?: string) => Memory;
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
        const memory = buildMemory(logs, date);
        const tasks = generateTasks({ plan, profile, date, logs, memory });
        // その日に呼び戻したぶんは、置き場（parked）から外す
        const shown = new Set(tasks.map((t) => t.sourceId));
        const parked = (plan.parked ?? []).filter((pk) => !(pk.dueOn <= date && shown.has(pk.sourceId)));
        set({
          plan: parked.length === (plan.parked ?? []).length ? plan : { ...plan, parked },
          logs: { ...logs, [date]: { date, tasks, closed: false } },
        });
      },

      memory: (date) => buildMemory(get().logs, date ?? todayISO()),

      moveTask: (date, taskId, mode) => {
        const { plan, profile, logs } = get();
        if (!plan || !profile) return null;
        const log = logs[date];
        const task = log?.tasks.find((t) => t.id === taskId);
        if (!log || !task) return null;

        const deferCount = task.deferCount ?? 0;
        const pl = placeTask(task, buildMemory(logs, date), date, profile.deadline, {
          workdaysPerWeek: profile.workdaysPerWeek,
          deferCount,
        });

        const reason = mode === 'replan' ? `組み直した：${pl.reason}` : pl.reason;
        const entry: ParkedTask = {
          sourceId: task.sourceId,
          kind: task.kind,
          phase: task.phase,
          title: task.title,
          detail: task.detail,
          estMin: task.estMin,
          baseMin: task.baseMin ?? task.estMin,
          tag: task.tag,
          priority: task.priority,
          dueOn: pl.date,
          deferCount: deferCount + 1,
          from: task.carriedFrom ?? date,
          reason,
        };

        // 同じタスクが二重に置かれないようにする
        const parked = [...(plan.parked ?? []).filter((p) => p.sourceId !== task.sourceId), entry];

        set({
          plan: { ...plan, parked },
          logs: {
            ...logs,
            [date]: {
              ...log,
              tasks: log.tasks.map((t) =>
                t.id === taskId
                  ? { ...t, deferredTo: pl.date, deferCount: deferCount + 1, replanNote: reason }
                  : t,
              ),
            },
          },
        });

        return { date: pl.date, reason, askDrop: !!pl.drop };
      },

      undoMove: (date, taskId) => {
        const { plan, logs } = get();
        const log = logs[date];
        const task = log?.tasks.find((t) => t.id === taskId);
        if (!plan || !log || !task) return;
        set({
          plan: { ...plan, parked: (plan.parked ?? []).filter((p) => p.sourceId !== task.sourceId) },
          logs: {
            ...logs,
            [date]: {
              ...log,
              tasks: log.tasks.map((t) =>
                t.id === taskId
                  ? {
                      ...t,
                      deferredTo: undefined,
                      replanNote: undefined,
                      deferCount: Math.max((t.deferCount ?? 1) - 1, 0),
                    }
                  : t,
              ),
            },
          },
        });
      },

      dropTask: (date, taskId) => {
        const { plan, logs } = get();
        const log = logs[date];
        const task = log?.tasks.find((t) => t.id === taskId);
        if (!plan || !log || !task) return;
        const dropped = new Set(plan.droppedIds ?? []);
        dropped.add(task.sourceId);
        set({
          plan: {
            ...plan,
            droppedIds: [...dropped],
            parked: (plan.parked ?? []).filter((p) => p.sourceId !== task.sourceId),
          },
          logs: {
            ...logs,
            [date]: { ...log, tasks: log.tasks.filter((t) => t.id !== taskId) },
          },
        });
      },

      undropTask: (sourceId) => {
        const { plan } = get();
        if (!plan) return;
        set({ plan: { ...plan, droppedIds: (plan.droppedIds ?? []).filter((id) => id !== sourceId) } });
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
              priority: 'should',
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
