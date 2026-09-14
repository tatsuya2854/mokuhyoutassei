import type { DayLog, Plan, Profile } from '../types';
import { addDays, diffDays, weekKey } from '../lib/date';
import { getPlaybook } from './playbooks';
import { EXPLORE_DAYS, filterByGoal, goalKindOf } from './goals';
import { requiredMonthly } from './decide';

/** 立ち上げ後にまわす改善サイクルの出し分けに使う状態 */
export interface LoopState {
  /** 立ち上げステップを消化しきったか */
  launched: boolean;
  /** これまでに確定した収益 */
  revenue: number;
  /** 直近7日の消化率 0-1 */
  recentRate: number;
  /** 直近7日で完了したタスク数 */
  recentDone: number;
}

/** 指定日時点での状態を、ログから素直に読む */
export function loopState(
  profile: Profile,
  plan: Plan,
  logs: Record<string, DayLog>,
  date: string,
): LoopState {
  const pb = getPlaybook(plan.playbookId);
  // 目標タイプで出さないタスクは、立ち上げ完了の分母からも外す
  const eligible = filterByGoal(pb.steps, goalKindOf(profile));
  const past = Object.values(logs).filter((l) => diffDays(l.date, date) >= 0);
  const revenue = past.reduce((a, l) => a + (l.revenue ?? 0), 0);

  let done = 0;
  let all = 0;
  for (let i = 1; i <= 7; i++) {
    const log = logs[addDays(date, -i)];
    if (!log) continue;
    done += log.tasks.filter((t) => t.done).length;
    all += log.tasks.length;
  }

  return {
    launched: plan.consumedStepIds.length >= eligible.length,
    revenue,
    recentRate: all === 0 ? 1 : done / all,
    recentDone: done,
  };
}

export type FocusId =
  | 'start'
  | 'build'
  | 'sell'
  | 'convert'
  | 'raise'
  | 'systemize'
  | 'recover'
  | 'explore'
  | 'make'
  | 'finish'
  | 'show'
  | 'keep';

export interface WeeklyFocus {
  id: FocusId;
  weekKey: string;
  /** 開始週を1とする通し番号 */
  weekNo: number;
  theme: string;
  why: string;
  /** 今週おさえる指標 */
  kpi: string;
  lastWeek: { done: number; total: number; rate: number; revenue: number } | null;
}

function weekStats(logs: Record<string, DayLog>, fromMonday: string) {
  let done = 0;
  let total = 0;
  let revenue = 0;
  let any = false;
  for (let i = 0; i < 7; i++) {
    const log = logs[addDays(fromMonday, i)];
    if (!log) continue;
    any = true;
    done += log.tasks.filter((t) => t.done).length;
    total += log.tasks.length;
    revenue += log.revenue ?? 0;
  }
  if (!any) return null;
  return { done, total, revenue, rate: total === 0 ? 0 : done / total };
}

/**
 * 今週のテーマを決める。
 * 「今週は何を最適化するのか」が1つに定まっていないと、日々のタスクがただの作業になる。
 */
export function computeWeeklyFocus(
  profile: Profile,
  plan: Plan,
  logs: Record<string, DayLog>,
  date: string,
): WeeklyFocus {
  const wk = weekKey(date);
  const weekNo = Math.floor(diffDays(weekKey(profile.startDate), wk) / 7) + 1;
  const lastWeek = weekStats(logs, addDays(wk, -7));
  const st = loopState(profile, plan, logs, date);
  const need = requiredMonthly(profile);
  const pb = getPlaybook(plan.playbookId);

  const base = { weekKey: wk, weekNo, lastWeek };

  // 探索中は「比べること」だけが今週の仕事
  const exploring =
    (plan.exploreIds?.length ?? 0) >= 2 &&
    diffDays(plan.phases[0].startDate, date) < EXPLORE_DAYS;
  if (exploring) {
    return {
      ...base,
      id: 'explore',
      theme: `${plan.exploreIds!.length}つを実際に触ってみる`,
      why: '考えて決めようとしても出てこない。今週は結論を出さなくていい。手を動かして「どれがラクだったか」だけ集める。',
      kpi: '試す手段それぞれに最低1回は手をつける',
    };
  }

  // 手が止まっているなら、何より先に流れを戻す
  if (lastWeek && lastWeek.total >= 3 && lastWeek.rate < 0.4) {
    return {
      ...base,
      id: 'recover',
      theme: '量を絞って、毎日ゼロをなくす',
      why: `先週の消化率は${Math.round(lastWeek.rate * 100)}%。増やすより、まず「毎日ちょっとやる」に戻す方が結果的に速い。`,
      kpi: '1日1件でいいから、7日間ゼロの日を作らない',
    };
  }

  if (!st.launched) {
    const phase1Done = plan.consumedStepIds.length > 0;
    const ph = plan.phases[phase1Done ? 1 : 0];
    const remaining = filterByGoal(pb.steps, goalKindOf(profile)).length - plan.consumedStepIds.length;
    return {
      ...base,
      id: phase1Done ? 'build' : 'start',
      theme: ph.name === '決める' && phase1Done ? ph.goal : `${ph.name}：${ph.goal}`,
      why: phase1Done
        ? 'まだ形になってない状態。ここを越えないと、どれだけ作業しても外からは何も見えない。'
        : 'ここが決まらないと全部の作業がブレる。今週で確定させて、来週から前に進む。',
      kpi: `立ち上げのステップを今週中に${Math.max(1, Math.min(5, remaining))}個進める`,
    };
  }

  // お金以外の目標は、ここから先の「売る／単価」の話に入らない
  if (profile.goalKind !== 'money') {
    if (profile.goalKind === 'habit') {
      const streakGoal = profile.goalAmount;
      return {
        ...base,
        id: 'keep',
        theme: 'ゼロの日を作らない',
        why: `目標は${streakGoal}日つづけること。量を増やすことじゃない。1日1件でも触れば、その日は勝ち。`,
        kpi: '7日間、毎日1件以上チェックを入れる',
      };
    }
    if (profile.goalKind === 'skill') {
      return {
        ...base,
        id: 'make',
        theme: '読むのをやめて、手を動かす',
        why: '「分かった」と「できる」は別物。インプットを止めて、手を動かした時間だけを今週の成果とみなす。',
        kpi: '手を動かすタスクを週5回。調べるだけの日を作らない',
      };
    }
    // proof：完成させて、外に出すまでが一区切り
    const madeAny = st.revenue > 0;
    if (!madeAny) {
      return {
        ...base,
        id: 'finish',
        theme: '粗くていいから、1つ完成させる',
        why: '未完成が増えるのが一番まずい。完成度60%でも「完成」は完成。未完成は0点。',
        kpi: '今週中に1つ「できました」と言える状態にする',
      };
    }
    return {
      ...base,
      id: 'show',
      theme: '作ったものを、人が見られる場所に置く',
      why: `${st.revenue}つ形になってる。ただ置いてないものは無いのと同じ。見せて初めて実績になる。`,
      kpi: '完成したものを1つ、外から見えるところに公開する',
    };
  }

  if (st.revenue === 0) {
    return {
      ...base,
      id: 'sell',
      theme: '「売る動き」の回数を今の倍にする',
      why: '立ち上げは終わってるのに1円も動いてない。原因はほぼ量。作る時間を削って、出す・送る・声をかける回数に振る。',
      kpi: '提案・出品・告知など、外に向けた行動を週15回',
    };
  }

  const month = Object.values(logs)
    .filter((l) => l.date.slice(0, 7) === date.slice(0, 7))
    .reduce((a, l) => a + (l.revenue ?? 0), 0);

  if (month < need * 0.5) {
    return {
      ...base,
      id: 'convert',
      theme: '当たった型を特定して、そこに寄せる',
      why: `今月${month.toLocaleString()}円。必要ラインの${need.toLocaleString()}円まで距離がある。売れた1件と売れなかった分の差を言語化して、勝ち筋に集中する。`,
      kpi: '成約した経路を1つ特定して、そのやり方だけを週5回繰り返す',
    };
  }

  if (month < need) {
    return {
      ...base,
      id: 'raise',
      theme: '単価を上げるか、件数を増やすか決める',
      why: `今月${month.toLocaleString()}円で必要ラインまで残り${(need - month).toLocaleString()}円。両方追うと中途半端になる。今週はどっちで埋めるかを決めて、それだけやる。`,
      kpi: '値上げ交渉か新規獲得、選んだ方を week 内に3件実行する',
    };
  }

  return {
    ...base,
    id: 'systemize',
    theme: '再現性をつくる。作業を減らしながら維持する',
    why: `今月${month.toLocaleString()}円で必要ラインを超えてる。次は「何が効いたか」を固定して、自分が動かなくても回る形にすること。`,
    kpi: '手作業を1つテンプレ化 or 外注化する',
  };
}

/** 週次レビューを促すタスクの中身（週の初回稼働日に差し込む） */
export function weeklyReviewTask(focus: WeeklyFocus) {
  const last = focus.lastWeek;
  const lastLine = last
    ? `先週は${last.done}/${last.total}件（${Math.round(last.rate * 100)}%）、収益${last.revenue.toLocaleString()}円。`
    : '先週の記録はまだない。';
  return {
    title: `先週を振り返って、今週の的を1つに絞る`,
    detail: `${lastLine}\n\n今週のテーマは「${focus.theme}」。\n${focus.why}\n\n① 先週いちばん効いた行動を1つ書く\n② いちばん無駄だった時間を1つ書く\n③ 今週やらないことを1つ決める\n\n${focus.kpi}`,
    estMin: 25,
    tag: '振り返り',
  };
}
