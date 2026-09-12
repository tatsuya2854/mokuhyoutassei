import { getPlaybook } from './playbooks';
import type { DayLog, PhaseInfo, PhaseNo, Plan, Profile, Task } from '../types';
import { addDays, clampISO, diffDays, todayISO, weekKey } from '../lib/date';
import { computeWeeklyFocus, loopState, weeklyReviewTask } from './weekly';

/** 週次レビュータスクの固定ID */
export const REVIEW_ID = 'weekly-review';

/** 今週のぶんを消化しきった日に出すタスクの固定ID */
export const CLEAR_ID = 'week-cleared';

export const PHASE_META: Record<PhaseNo, { name: string; goal: string; ratio: number }> = {
  1: { name: '土台づくり', goal: '何で・誰に・いくらで売るかを確定させる', ratio: 0.18 },
  2: { name: '立ち上げ', goal: '売り物と入口を用意して、世に出す', ratio: 0.28 },
  3: { name: '初収益', goal: '1円目を取りにいく。売れる型を見つける', ratio: 0.32 },
  4: { name: '拡大・仕組み化', goal: '当たった型に寄せて、作業を減らしながら増やす', ratio: 0.22 },
};

/** 1日あたりの作業分数 */
export function computeDailyMinutes(profile: Profile): number {
  const perDay = (profile.weeklyHours * 60) / Math.max(profile.workdaysPerWeek, 1);
  return Math.max(20, Math.round(perDay / 5) * 5);
}

export function buildPlan(profile: Profile, playbookId: string): Plan {
  // 開始日・期限を両端に含めた日数
  const span = Math.max(diffDays(profile.startDate, profile.deadline) + 1, 8);
  const minLen = span >= 16 ? 3 : 1;
  const phases: PhaseInfo[] = [];
  let cursor = 0;
  ([1, 2, 3, 4] as PhaseNo[]).forEach((no, i) => {
    const meta = PHASE_META[no];
    const len = i === 3 ? span - cursor : Math.max(minLen, Math.round(span * meta.ratio));
    const startIdx = Math.min(cursor, span - 1);
    const endIdx = i === 3 ? span - 1 : Math.min(Math.max(cursor + len - 1, startIdx), span - 1);
    phases.push({
      no,
      name: meta.name,
      goal: meta.goal,
      startDate: addDays(profile.startDate, startIdx),
      endDate: addDays(profile.startDate, endIdx),
    });
    cursor += len;
  });

  const daily = computeDailyMinutes(profile);
  return {
    playbookId,
    phases,
    consumedStepIds: [],
    routineCounts: {},
    dailyMinutes: daily,
    baseDailyMinutes: daily,
  };
}

/** 指定日が属するフェーズ番号 */
export function phaseForDate(plan: Plan, date: string): PhaseNo {
  for (const p of plan.phases) {
    if (diffDays(p.startDate, date) >= 0 && diffDays(date, p.endDate) >= 0) return p.no;
  }
  return diffDays(date, plan.phases[0].startDate) > 0 ? 1 : 4;
}

export function phaseInfo(plan: Plan, no: PhaseNo): PhaseInfo {
  return plan.phases.find((p) => p.no === no) ?? plan.phases[0];
}

let seq = 0;
const taskId = (date: string, sourceId: string) => `${date}_${sourceId}_${seq++}`;

export interface GenerateInput {
  plan: Plan;
  profile: Profile;
  date: string;
  logs: Record<string, DayLog>;
}

/**
 * その日のタスクを生成する。優先順位は上から。
 * 1. 前日までの未完了タスク（繰越）
 * 2. 未消化のステップ（計画の背骨。順番を飛ばさない）
 * 3. 週次レビュー（週の初回稼働日のみ）
 * 4. ルーティン（週あたりの残回数があるもの）
 * 5. 改善サイクル（立ち上げ完了後。収益や消化率の状況で出し分ける）
 * これらを、その日の作業分数の枠に収まるまで詰める。
 */
export function generateTasks({ plan, profile, date, logs }: GenerateInput): Task[] {
  const pb = getPlaybook(plan.playbookId);
  const phase = phaseForDate(plan, date);
  const budget = plan.dailyMinutes;
  const out: Task[] = [];
  let used = 0;

  const push = (t: Omit<Task, 'id' | 'done'>) => {
    out.push({ ...t, id: taskId(date, t.sourceId), done: false });
    used += t.estMin;
  };

  // --- 1. 繰越 ---
  const prevDates = Object.keys(logs)
    .filter((d) => diffDays(d, date) > 0)
    .sort();
  const carried: Task[] = [];
  for (const d of prevDates.slice(-4)) {
    for (const t of logs[d].tasks) {
      if (!t.done && !carried.some((c) => c.sourceId === t.sourceId)) {
        carried.push({ ...t, carriedFrom: t.carriedFrom ?? d });
      }
    }
  }
  for (const t of carried) {
    if (used + t.estMin > budget * 1.25 && out.length >= 1) break;
    push({
      date,
      sourceId: t.sourceId,
      kind: t.kind,
      phase: t.phase,
      title: t.title,
      detail: t.detail,
      estMin: t.estMin,
      tag: t.tag,
      carriedFrom: t.carriedFrom,
    });
  }

  const already = new Set(out.map((t) => t.sourceId));

  // --- 2. ステップ（計画の背骨。順番を飛ばさない） ---
  const consumed = new Set(plan.consumedStepIds);
  const pickSteps = (maxPhase: number) =>
    pb.steps.filter((st) => !consumed.has(st.id) && !already.has(st.id) && st.phase <= maxPhase);
  // 現フェーズ分を消化しきったら、次フェーズを前倒しで始める
  const steps = pickSteps(phase).length > 0 ? pickSteps(phase) : pickSteps(4);
  const MIN_SLOT = 20;
  for (const st of steps) {
    if (out.length >= 5) break;
    const remaining = budget - used;
    // 残り枠が細切れすぎるなら翌日に回す（ただし1件も無い日は必ず出す）
    if (remaining < MIN_SLOT && out.length > 0) break;
    const fits = st.estMin <= remaining;
    // 1日の枠に収まらないステップは、残り枠の分だけ進める。
    // チェックを入れるまで消化扱いにならないので、翌日も先頭に出続ける。
    const estMin = fits ? st.estMin : Math.max(MIN_SLOT, remaining);
    push({
      date,
      sourceId: st.id,
      kind: 'step',
      phase: st.phase,
      title: st.title,
      detail: fits
        ? st.detail
        : `${st.detail}\n\n※ 1日では終わらない量（全体で約${st.estMin}分）。今日は時間の範囲まで進めて、終わったらチェックを入れて。`,
      estMin,
      tag: st.tag,
    });
    already.add(st.id);
    if (!fits) break; // 分割した日はそこで打ち切る
  }

  const wk = weekKey(date);
  const counts = plan.routineCounts[wk] ?? {};

  // --- 3. 週次レビュー（週の初回稼働日に1回だけ差し込む） ---
  const state = loopState(plan, logs, date);
  const isFirstRunOfWeek = (counts[REVIEW_ID] ?? 0) === 0;
  const secondWeekOrLater = diffDays(weekKey(plan.phases[0].startDate), wk) >= 7;
  if (isFirstRunOfWeek && secondWeekOrLater && !already.has(REVIEW_ID) && out.length < 5) {
    const focus = computeWeeklyFocus(profile, plan, logs, date);
    const t = weeklyReviewTask(focus);
    push({
      date,
      sourceId: REVIEW_ID,
      kind: 'review',
      phase,
      title: t.title,
      detail: t.detail,
      estMin: t.estMin,
      tag: t.tag,
    });
    already.add(REVIEW_ID);
  }

  // --- 4-5. ルーティンと改善サイクルを交互に配る ---
  // 順番待ちにすると、重いルーティン（例：記事を1本書く=120分）が枠を食い尽くして
  // サイクルが永久に出てこない。立ち上げ後は「反復の手」と「改善の手」を1日に混ぜる。
  const pickRoutines = (maxPhase: number) =>
    pb.routines
      .filter((r) => r.phase <= maxPhase)
      // 立ち上げ作業そのもののルーティンは、立ち上がったら出さない
      .filter((r) => !(r.untilLaunch && state.launched))
      .filter((r) => (counts[r.id] ?? 0) < r.perWeek)
      .filter((r) => !already.has(r.id))
      // 残回数が多い（＝遅れている）ものを優先
      .sort((a, b) => b.perWeek - (counts[b.id] ?? 0) - (a.perWeek - (counts[a.id] ?? 0)));
  // ステップを前倒しで進めている日は、ルーティンも先のフェーズから引っぱる
  const routines = pickRoutines(phase).length > 0 ? pickRoutines(phase) : pickRoutines(4);

  // 立ち上げ完了後だけ、状況に合った改善サイクルを候補に入れる
  const cycles = state.launched
    ? pb.cycles
        .filter((cy) => !already.has(cy.id))
        .filter((cy) => (counts[cy.id] ?? 0) === 0)
        .filter((cy) => {
          if (cy.when === 'always') return true;
          if (cy.when === 'lowRate') return state.recentRate < 0.5;
          if (cy.when === 'noRevenue') return state.revenue === 0;
          return state.revenue > 0;
        })
    : [];

  // 手が止まっている日は、軽いものから出して着手のハードルを下げる
  const ordered =
    state.recentRate < 0.5 ? [...cycles].sort((a, b) => a.estMin - b.estMin) : cycles;

  type Candidate = { kind: 'routine' | 'cycle'; id: string; title: string; detail: string; estMin: number; tag: string; phase: PhaseNo };
  const rq: Candidate[] = routines.map((r) => ({
    kind: 'routine', id: r.id, title: r.title, detail: r.detail, estMin: r.estMin, tag: r.tag, phase: r.phase,
  }));
  const cq: Candidate[] = ordered.map((cy) => ({
    kind: 'cycle', id: cy.id, title: cy.title, detail: cy.detail, estMin: cy.estMin, tag: cy.tag, phase: 4,
  }));

  // 改善サイクルを先頭に、以降は交互。どちらかが尽きたら残りをそのまま続ける
  const merged: Candidate[] = [];
  for (let i = 0; i < Math.max(rq.length, cq.length); i++) {
    if (cq[i]) merged.push(cq[i]);
    if (rq[i]) merged.push(rq[i]);
  }

  for (const cand of merged) {
    if (out.length >= 5) break;
    if (used + cand.estMin > budget) continue; // 入らないものは飛ばして、入るものを詰める
    push({
      date,
      sourceId: cand.id,
      kind: cand.kind,
      phase: cand.phase,
      title: cand.title,
      detail: cand.detail,
      estMin: cand.estMin,
      tag: cand.tag,
    });
    already.add(cand.id);
  }

  // --- 何も出せなかった場合 ---
  // 週のぶんを全部やり切った日。無理にタスクをでっち上げない。
  if (out.length === 0) {
    const generic = state.launched
      ? pb.cycles
          .filter((x) => x.when === 'always')
          .filter((x) => (counts[x.id] ?? 0) === 0 && !already.has(x.id))
          .sort((a, b) => a.estMin - b.estMin)[0]
      : undefined;
    if (generic) {
      push({
        date,
        sourceId: generic.id,
        kind: 'cycle',
        phase: 4,
        title: generic.title,
        detail: generic.detail,
        estMin: generic.estMin,
        tag: generic.tag,
      });
    } else {
      // ここに来る＝今週のぶんを全部やり切った日。無理に作業をでっち上げない。
      push({
        date,
        sourceId: CLEAR_ID,
        kind: 'review',
        phase,
        title: '今週のぶんは終わってる。休むか、前倒しするか決める',
        detail:
          '今週やるべきことは全部消化済み。ここで無理に作業を足しても質が落ちるだけ。\n\n休むなら休む、進めるなら「＋追加」で来週やる予定のものを1つ前倒しする——どっちでもいい。決めたらチェックを入れて。\n\n計画は崩れてない。',
        estMin: 10,
        tag: '余白',
      });
    }
  }

  // 繰越を先頭に、あとは見積り時間の短い順（着手のハードルを下げる）
  return out.sort((a, b) => {
    if (!!a.carriedFrom !== !!b.carriedFrom) return a.carriedFrom ? -1 : 1;
    return a.estMin - b.estMin;
  });
}

/** 総ステップ数（進捗率の分母） */
export function totalSteps(playbookId: string): number {
  return getPlaybook(playbookId).steps.length;
}

/** 今日の日付をプラン期間内にクランプ */
export function activeDate(plan: Plan): string {
  const first = plan.phases[0].startDate;
  const last = plan.phases[plan.phases.length - 1].endDate;
  return clampISO(todayISO(), first, last);
}
