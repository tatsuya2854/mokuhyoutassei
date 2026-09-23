import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppState, ChatMessage, DayLog, ParkedTask, Plan, Profile } from '../types';
import { decide, decideWith } from '../domain/decide';
import { buildPlan, computeDailyMinutes, generateTasks } from '../domain/planner';
import { closeDay, computeAdjustment } from '../domain/adjust';
import { computeProgress } from '../domain/progress';
import { BLANK_MEMORY, buildMemory, placeTask } from '../domain/memory';
import type { Memory } from '../domain/memory';
import { todayISO } from '../lib/date';
import type { Cycle, FeatureId, LimitId, PlanId } from '../domain/entitlements';
import { can, effectivePlan, limitOf, startTrial } from '../domain/entitlements';
import { billing } from '../billing';
import { assistant } from '../assistant';

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

  /* --- 課金 --- */
  /** いま実際に使えるプラン。無料期間が切れていれば free に落ちる */
  activePlan: () => PlanId;
  /** その機能が使えるか。画面側はこれしか聞かない */
  entitled: (feature: FeatureId) => boolean;
  /** 上限値を引く */
  limit: (key: LimitId) => number;
  /** 申し込み。外部の決済ページに飛ぶ場合は url が返る */
  subscribe: (planId: PlanId, cycle: Cycle) => Promise<string | null>;
  /** 解約・支払い方法の変更 */
  manageBilling: () => Promise<string | null>;
  /** サーバー側の加入状態を取り直す */
  refreshSubscription: () => Promise<void>;

  /* --- AI秘書 --- */
  /** 話しかける。返事は chat に積まれる */
  ask: (text: string) => Promise<void>;
  clearChat: () => void;
  /** 今日すでに何回話したか（無料枠の判定に使う） */
  chatCountToday: () => number;
}

const empty: AppState = {
  profile: null,
  decision: null,
  plan: null,
  logs: {},
  createdAt: todayISO(),
  sub: null,
  chat: [],
};

export const useAppStore = create<Store>()(
  persist(
    (set, get) => ({
      ...empty,

      start: (profile) => {
        const decision = decide(profile);
        const plan = buildPlan(profile, decision.playbookId, decision.exploreIds);
        const today = todayISO();
        // 始めた瞬間から無料期間。カード登録を先に求めない
        set({
          profile,
          decision,
          plan,
          logs: {},
          chat: [],
          createdAt: today,
          sub: get().sub ?? startTrial(today),
        });
        get().ensureDay(today);
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
        // 見積りの自動補正は有料機能。素の見積りでも計画は回る
        const memory = get().entitled('memoryEstimate') ? buildMemory(logs, date) : BLANK_MEMORY;
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

      /* ----------------------------- 課金 ----------------------------- */

      activePlan: () => effectivePlan(get().sub, todayISO()),

      entitled: (feature) => can(effectivePlan(get().sub, todayISO()), feature),

      limit: (key) => limitOf(effectivePlan(get().sub, todayISO()), key),

      subscribe: async (planId, cycle) => {
        const r = await billing.startCheckout({ planId, cycle });
        if (r.subscription) set({ sub: r.subscription });
        return r.url ?? null;
      },

      manageBilling: async () => {
        const r = await billing.openPortal();
        if (!r.url) {
          // ローカル実装は解約がその場で終わるので、状態を取り直す
          set({ sub: await billing.getSubscription() });
        }
        return r.url ?? null;
      },

      refreshSubscription: async () => {
        try {
          const remote = await billing.getSubscription();
          if (remote) set({ sub: remote });
        } catch {
          // 取りに行けないときは、手元の状態のまま動かす。
          // 課金の都合でアプリが使えなくなる方が損失が大きい。
        }
      },

      /* ---------------------------- AI秘書 ---------------------------- */

      chatCountToday: () => {
        const d = todayISO();
        return get().chat.filter((m) => m.role === 'user' && m.at.slice(0, 10) === d).length;
      },

      ask: async (text) => {
        const { profile, plan, logs, chat } = get();
        if (!profile || !plan || !text.trim()) return;
        const today = todayISO();
        const now = new Date().toISOString();

        const mine: ChatMessage = {
          id: `u${Date.now()}`,
          role: 'user',
          text: text.trim(),
          at: now,
        };
        set({ chat: [...chat, mine] });

        const log = logs[today] ?? null;
        const reply = await assistant.reply({
          text: mine.text,
          ctx: {
            profile,
            plan,
            progress: computeProgress(profile, plan, logs, today),
            memory: buildMemory(logs, today),
            today,
            tasks: log?.tasks ?? [],
            log,
            history: get()
              .chat.slice(-6)
              .map((m) => ({ role: m.role, text: m.text })),
          },
        });

        set({
          chat: [
            ...get().chat,
            {
              id: `a${Date.now()}`,
              role: 'assistant',
              text: reply.text,
              at: new Date().toISOString(),
              actions: reply.actions,
            },
          ],
        });
      },

      clearChat: () => set({ chat: [] }),

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
            sub: data.sub ?? get().sub,
            chat: data.chat ?? [],
          });
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: 'mokuhyou-tassei-v1',
      version: 3,
      // 古い保存データをそのまま読めるようにする（消さない）
      migrate: (persisted, version) => {
        let st = persisted as Partial<AppState>;
        if (!st?.profile) return st as AppState;
        // v1（目標＝金額のみ）→ v2（目標タイプ）
        if (version < 2) {
          const prof = st.profile as Profile & Partial<Pick<Profile, 'anxiety' | 'goalKind'>>;
          st = {
            ...st,
            profile: { ...prof, anxiety: prof.anxiety ?? 'money', goalKind: prof.goalKind ?? 'money' },
          };
        }
        // v2 → v3（課金と会話）。すでに使っている人は無料期間からやり直しにする
        if (version < 3) {
          st = { ...st, sub: st.sub ?? startTrial(todayISO()), chat: st.chat ?? [] };
        }
        return st as AppState;
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
