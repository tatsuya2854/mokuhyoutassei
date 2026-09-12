import type { DayLog, Plan, Profile, Task } from '../types';
import type { Progress } from './progress';
import { getPlaybook } from './playbooks';
import { PHASE_META, phaseForDate, phaseInfo } from './planner';
import { diffDays, formatJP } from '../lib/date';

export interface CoachMessage {
  headline: string;
  body: string;
  tone: 'push' | 'warn' | 'praise' | 'calm';
}

const yen = (n: number) => `${Math.round(n).toLocaleString()}円`;

/** 日付から決定的に1つ選ぶ（同じ日は同じ言葉＝上司がブレない） */
function pick<T>(arr: T[], seedStr: string): T {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

/** 今日の朝、最初に見せる指示 */
export function morningBriefing(
  plan: Plan,
  progress: Progress,
  tasks: Task[],
  date: string,
): CoachMessage {
  const pb = getPlaybook(plan.playbookId);
  const phase = phaseForDate(plan, date);
  const info = phaseInfo(plan, phase);
  const totalMin = tasks.reduce((a, t) => a + t.estMin, 0);
  const carried = tasks.filter((t) => t.carriedFrom).length;
  const first = tasks[0];
  const daysLeftInPhase = Math.max(diffDays(date, info.endDate), 0);

  const openers = {
    push: ['今日やることはこれ。', 'はい、今日の分。', '今日はこれだけ。'],
    warn: ['ちょっと正直に言うね。', '一回止めて聞いて。', 'ここ、まずい。'],
    praise: ['いい流れ来てる！', 'おけ、順調！', 'この調子！'],
    calm: ['今日のぶん、置いとくね。', '今日はこれ。', '淡々といこう。'],
  };

  let tone: CoachMessage['tone'] = 'push';
  let lead = '';

  if (progress.pace === 'stalled') {
    tone = 'warn';
    lead = `${progress.missStreak}日止まってる。責める気はないけど、このままだと計画がただの飾りになる。今日は${first ? `「${first.title}」` : '1個'}だけでいい、それだけやって。`;
  } else if (progress.pace === 'behind') {
    tone = 'warn';
    lead = `進捗${Math.round(progress.planProgress * 100)}%に対して、期間は${Math.round(progress.elapsed * 100)}%消化してる。遅れてる。今日で1個詰めよう。`;
  } else if (progress.pace === 'ahead') {
    tone = 'praise';
    lead =
      progress.streak >= 2
        ? `進捗が期間より先行してる。${progress.streak}日連続で動けてるのがデカい。この貯金は絶対に効いてくる。`
        : `進捗が期間より先行してる。この貯金は後で効いてくるから、ペースを落とさずにいこう。`;
  } else if (progress.allTasks > 0 && progress.doneTasks === 0 && progress.elapsed < 0.05) {
    tone = 'push';
    lead = `スタート地点。ここで一番大事なのは、完璧にやることじゃなくて${first ? `「${first.title}」` : '1個目'}を今日中に終わらせること。`;
  } else {
    tone = progress.streak >= 3 ? 'praise' : 'calm';
    lead =
      progress.streak >= 3
        ? `${progress.streak}日連続。ペースは掴めてる。`
        : `フェーズ${phase}「${info.name}」の期間。${PHASE_META[phase].goal}——これが今の全て。`;
  }

  const carryNote =
    carried > 0 ? `昨日の残りを${carried}件、先頭に持ってきた。まずそれを潰して。` : '';

  const body = [
    lead,
    carryNote,
    `今日の総量は${totalMin}分。${tasks.length}件。`,
    daysLeftInPhase <= 3 && phase < 4
      ? `フェーズ「${info.name}」は残り${daysLeftInPhase}日。ここまでに${PHASE_META[phase].goal.replace(/。$/, '')}を終わらせる。`
      : '',
    progress.daysLeft <= 14
      ? `期限まで残り${progress.daysLeft}日。${pb.name}で${yen(progress.needMonthly)}/月のラインを取りにいってる。`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { headline: pick(openers[tone], date + tone), body, tone };
}

/** 1日を締めたときのフィードバック */
export function dayReview(
  log: DayLog,
  progress: Progress,
  adjustReason: string,
  revenue?: number,
): CoachMessage {
  const done = log.tasks.filter((t) => t.done).length;
  const total = log.tasks.length;
  const rate = total === 0 ? 0 : done / total;

  let headline: string;
  let tone: CoachMessage['tone'];
  let lead: string;

  if (rate === 1) {
    tone = 'praise';
    headline = '全部消化。おつかれ！';
    lead = `${total}件、全部やり切った。この日が積み上がると数字は勝手についてくる。`;
  } else if (rate >= 0.5) {
    tone = 'calm';
    headline = `${done}/${total}。悪くない。`;
    lead = `完璧じゃなくていい。ゼロじゃない日を続けることの方が10倍大事。残りは明日の先頭に回す。`;
  } else if (done > 0) {
    tone = 'push';
    headline = `${done}/${total}。ちょっと足りない。`;
    lead = `動いたのは評価する。ただ今日の量は残った。原因は時間が無かったのか、タスクが重かったのか、そこだけはっきりさせよう。`;
  } else {
    tone = 'warn';
    headline = '今日はゼロ。';
    lead = `理由は聞かない。ただ、ゼロの日が続くと計画が崩れるんじゃなくて「やれない自分」が固定されるのが怖い。明日は1個だけでいい。`;
  }

  const revNote =
    revenue && revenue > 0
      ? `\n今日 ${yen(revenue)} 確定。累計 ${yen(progress.totalRevenue)}。数字が動いたのが一番の事実。`
      : '';

  const streakNote = progress.streak >= 5 ? `\n${progress.streak}日連続。ここまで来たら止めない方が得。` : '';

  return {
    headline,
    tone,
    body: `${lead}${revNote}${streakNote}\n\n【明日の調整】${adjustReason}`,
  };
}

/** 分析画面に出す示唆 */
export function insights(plan: Plan, progress: Progress): string[] {
  const pb = getPlaybook(plan.playbookId);
  const out: string[] = [];

  if (progress.allTasks < 5) {
    out.push('データがまだ少ない。1週間回してからここを見ると、改善点が数字で見えるようになる。');
    return out;
  }

  const gap = progress.planProgress - progress.elapsed;
  if (progress.planProgress >= 1) {
    out.push(
      `立ち上げのステップは全部終わってる → ここから先は反復のフェーズ。新しいことを探すより、${pb.name}の「売る動き」を今の倍に増やす方が効く。`,
    );
  } else if (gap < -0.15) {
    out.push(
      `期間は${Math.round(progress.elapsed * 100)}%消化、計画は${Math.round(progress.planProgress * 100)}%。${Math.round(Math.abs(gap) * 100)}ポイント遅れてる → タスクを減らすか、可処分時間を増やすかの二択。精神論では埋まらない。`,
    );
  } else if (gap > 0.1) {
    out.push(
      `計画が期間より${Math.round(gap * 100)}ポイント先行してる → 前倒しできてるので、フェーズ${Math.min(4, plan.phases.length)}の仕込みを早めに始めていい。`,
    );
  }

  if (progress.recentRate < 0.5) {
    out.push(
      `直近7日の消化率が${Math.round(progress.recentRate * 100)}% → 1日の量が可処分時間と合ってない。負荷を落として「毎日ゼロじゃない」を優先した方が結果的に速い。`,
    );
  } else if (progress.recentRate >= 0.85) {
    out.push(
      `消化率${Math.round(progress.recentRate * 100)}%で安定 → 余力がある。週の作業時間を1〜2時間増やすと、期限に対する余裕が生まれる。`,
    );
  }

  if (progress.totalRevenue === 0 && progress.elapsed > 0.3) {
    out.push(
      `期間を3割超えて収益ゼロ → 作業はしてるけど「売る行為」が足りてない可能性が高い。${pb.name}なら、まず提案・出品・告知の数を今週の最優先にする。`,
    );
  }

  if (progress.totalRevenue > 0) {
    const pace = progress.monthRevenue;
    const need = progress.needMonthly;
    if (pace >= need)
      out.push(`今月 ${yen(pace)} で必要ラインの ${yen(need)} を超えてる → 次は再現性。何が効いたかを言語化して固定する。`);
    else
      out.push(
        `今月 ${yen(pace)} / 必要 ${yen(need)}（達成率${Math.round((pace / Math.max(need, 1)) * 100)}%）→ 不足分は ${yen(need - pace)}。単価を上げるか件数を増やすか、どっちで埋めるかを今週決める。`,
      );
  }

  if (progress.daysLeft <= 30 && progress.revenueProgress < 0.5) {
    out.push(
      `残り${progress.daysLeft}日で達成率${Math.round(progress.revenueProgress * 100)}% → 目標を下方修正するか期限を延ばすかを、感情抜きで判断するタイミング。設定を変えるのは逃げじゃない。`,
    );
  }

  if (out.length === 0) out.push('大きな異常なし。今のループを止めないことが最大の打ち手。');
  return out;
}

/** 診断結果画面で使う、期限と目標へのツッコミ */
export function goalCritique(profile: Profile, needMonthly: number, feasibility: string): string | null {
  if (profile.weeklyHours <= 3 && needMonthly >= 100000) {
    return `週${profile.weeklyHours}時間で月${yen(needMonthly)}は、正直かなり無理がある。時間を増やすか、目標を下げるか、期限を延ばすか——どれか1つは動かした方がいい。それでも走るなら止めないけど、事実として言っておく。`;
  }
  if (feasibility === 'hard') {
    return `この条件だと期限内の月${yen(needMonthly)}は厳しい。ただ「達成できないから意味がない」わけじゃない。まず初収益を取る。そこまで行けば景色が変わるし、期限は後から延ばせる。`;
  }
  if (feasibility === 'easy' && needMonthly < 30000) {
    return `目標、ちょっと低くない？この条件なら十分届く。届く目標は達成感が薄いから、1.5倍に上げてもいいと思う。`;
  }
  return null;
}

export function deadlineLabel(profile: Profile): string {
  return formatJP(profile.deadline);
}
