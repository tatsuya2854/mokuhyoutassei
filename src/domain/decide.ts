import { PLAYBOOKS, getPlaybook } from './playbooks';
import { GOAL_KINDS, goalKindOf } from './goals';
import type { Decision, Playbook, Profile } from '../types';
import { diffDays } from '../lib/date';

/** 目標達成に必要な「月あたりの収益」。お金の目標のときだけ意味を持つ */
export function requiredMonthly(profile: Profile): number {
  if (profile.goalKind !== 'money') return 0;
  const days = Math.max(diffDays(profile.startDate, profile.deadline), 1);
  const months = Math.max(days / 30.4, 0.5);
  if (profile.goalMode === 'monthly') return profile.goalAmount;
  return Math.ceil(profile.goalAmount / months);
}

/** 期限までの月数 */
export function horizonMonths(profile: Profile): number {
  return Math.max(diffDays(profile.startDate, profile.deadline) / 30.4, 0.5);
}

/** 経過Nヶ月時点で見込める月収（rampを線形補間） */
export function expectedAt(pb: Playbook, months: number): number {
  const pts: [number, number][] = [
    [0, 0],
    [1, pb.ramp.m1],
    [2, pb.ramp.m2],
    [3, pb.ramp.m3],
    [6, pb.ramp.m6],
  ];
  if (months >= 6) {
    // 6ヶ月以降は緩やかに伸ばし、ceilingで頭打ち
    const extra = (months - 6) * (pb.ramp.m6 - pb.ramp.m3) * 0.25;
    return Math.min(pb.ceiling, pb.ramp.m6 + extra);
  }
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (months <= x1) {
      const t = (months - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return pb.ramp.m6;
}

/** 期限までに積み上がる累計収益の見込み */
export function expectedTotal(pb: Playbook, months: number): number {
  let sum = 0;
  const stepN = Math.max(Math.ceil(months * 4), 1);
  const dm = months / stepN;
  for (let i = 1; i <= stepN; i++) sum += expectedAt(pb, i * dm) * dm;
  return sum;
}

const CRAFT_TAGS = ['制作', '執筆', '設計', '学習', '調査', '準備'];

/** 「手を動かして何かを作る」タスクがどれだけ多い手段か 0-1 */
export function craftRatio(pb: Playbook): number {
  const all = [...pb.steps, ...pb.routines];
  if (all.length === 0) return 0;
  return all.filter((t) => CRAFT_TAGS.includes(t.tag)).length / all.length;
}

export interface ScoreBreakdown {
  playbook: Playbook;
  score: number;
  time: number;
  budget: number;
  skill: number;
  /** お金の目標でだけ使う「期限内の到達見込み」 */
  reach: number;
  craft: number;
  blocked: boolean;
  blockReason: string;
  skillMatched: string[];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function scorePlaybook(pb: Playbook, profile: Profile): ScoreBreakdown {
  const kind = goalKindOf(profile);
  const w = kind.weights;
  const months = horizonMonths(profile);
  const need = requiredMonthly(profile);

  // --- やりたくないこととの衝突 ---
  const conflicts = pb.traits.filter((t) => profile.avoid.includes(t));
  const blocked = conflicts.length > 0;

  const time = clamp01(profile.weeklyHours / pb.minWeeklyHours);
  const budget = pb.minBudget === 0 ? 1 : clamp01(profile.budget / pb.minBudget);

  // --- スキルの適合 ---
  const req = pb.requiredSkills;
  const matchedReq = req.filter((sk) => profile.skills.includes(sk));
  const reqScore = req.length === 0 ? 0.75 : matchedReq.length / req.length;
  const matchedBoost = pb.boostSkills.filter((sk) => profile.skills.includes(sk));
  const boostScore = pb.boostSkills.length === 0 ? 0 : matchedBoost.length / pb.boostSkills.length;
  const skill = clamp01(reqScore * 0.75 + boostScore * 0.35);

  // --- お金の目標：期限内に届くか × 規模の相性 ---
  let reach = 0;
  if (profile.goalKind === 'money') {
    const speed =
      profile.goalMode === 'monthly'
        ? clamp01(expectedAt(pb, months) / Math.max(need, 1))
        : clamp01(expectedTotal(pb, months) / Math.max(profile.goalAmount, 1));
    const scale = clamp01(pb.ceiling / Math.max(need, 1));
    reach = speed * 0.75 + scale * 0.25;
  }

  // --- 作る・学ぶ系の目標：手を動かすタスクの多さ ---
  const craft = clamp01(craftRatio(pb) * 1.6);

  const score =
    time * w.time +
    budget * w.budget +
    skill * w.skill +
    reach * w.reach +
    craft * w.craft -
    (blocked ? 100 : 0);

  return {
    playbook: pb,
    score: Math.round(score * 10) / 10,
    time,
    budget,
    skill,
    reach,
    craft,
    blocked,
    blockReason: blocked ? conflicts.join(',') : '',
    skillMatched: [...matchedReq, ...matchedBoost],
  };
}

const AVOID_LABEL: Record<string, string> = {
  face: '顔出し',
  voice: '声出し',
  stock: '在庫',
  sales: '営業',
  client: '受託の納期',
  daily: '高頻度作業',
  phone: '電話',
  invest: '先行投資',
  meet: '対面',
};

function rejectReason(b: ScoreBreakdown, profile: Profile): string {
  if (b.blocked) {
    const w = b.blockReason
      .split(',')
      .map((k) => AVOID_LABEL[k] ?? k)
      .join('・');
    return `${w}が必須の構造。「やりたくない」に入ってるので除外`;
  }
  if (b.time < 0.6)
    return `週${b.playbook.minWeeklyHours}時間は要る。週${profile.weeklyHours}時間だと回らない`;
  if (b.budget < 0.6)
    return `初期費用が${b.playbook.minBudget.toLocaleString()}円は要る。予算が足りない`;
  if (b.skill < 0.4) return `必要スキルの土台がない。ゼロから覚える時間で期限が溶ける`;
  if (profile.goalKind === 'money' && b.reach < 0.5)
    return `立ち上がりが遅い。この期限だと目標額に届かない`;
  if (profile.goalKind !== 'money' && b.craft < 0.5)
    return `売る作業の比率が高い。いまの目的だと手を動かす時間が足りなくなる`;
  return `悪くないけど、本命より適性か立ち上がりで一段落ちる`;
}

/** 目標タイプごとの達成難易度 */
function judgeFeasibility(profile: Profile, pb: Playbook): Decision['feasibility'] {
  const days = Math.max(diffDays(profile.startDate, profile.deadline), 1);
  const months = horizonMonths(profile);

  if (profile.goalKind === 'money') {
    const need = requiredMonthly(profile);
    const reach =
      profile.goalMode === 'monthly' ? expectedAt(pb, months) : expectedTotal(pb, months);
    const target = profile.goalMode === 'monthly' ? need : profile.goalAmount;
    const ratio = reach / Math.max(target, 1);
    return ratio >= 1.2 ? 'easy' : ratio >= 0.7 ? 'tight' : 'hard';
  }

  if (profile.goalKind === 'habit') {
    const ratio = days / Math.max(profile.goalAmount, 1);
    return ratio >= 1.3 ? 'easy' : ratio >= 1 ? 'tight' : 'hard';
  }

  if (profile.goalKind === 'explore') return 'tight';

  // proof / skill：期間内の総作業時間で判定する
  const totalHours = (days / 7) * profile.weeklyHours;
  const needHours = profile.goalKind === 'proof' ? profile.goalAmount * 20 : 40;
  const ratio = totalHours / Math.max(needHours, 1);
  return ratio >= 1.5 ? 'easy' : ratio >= 0.8 ? 'tight' : 'hard';
}

function buildReasons(
  profile: Profile,
  pb: Playbook,
  top: ScoreBreakdown,
  feasibility: Decision['feasibility'],
): string[] {
  const out: string[] = [];

  if (top.skill >= 0.6) {
    out.push('持ってるスキルがそのまま武器になる。ゼロから覚える時間が要らないのが一番デカい');
  } else if (top.skill >= 0.35) {
    out.push('スキルは完璧じゃないけど、走りながら埋められる範囲。止まって勉強する必要はない');
  } else {
    out.push('特別なスキルが要らない構造なので、今日から手が動かせる');
  }

  if (top.time >= 1) {
    out.push(`週${profile.weeklyHours}時間あれば十分回る。時間が足りなくて詰むパターンを回避できる`);
  } else {
    out.push(`週${profile.weeklyHours}時間だとやや窮屈だけど、タスクを絞れば成立する`);
  }

  if (profile.goalKind === 'money') {
    const need = requiredMonthly(profile);
    if (feasibility === 'easy')
      out.push(`期限までに月${need.toLocaleString()}円のラインは現実的に超えられる`);
    else if (feasibility === 'tight')
      out.push(`期限内に月${need.toLocaleString()}円はギリギリ。打数で押し切る前提`);
    else
      out.push(
        `正直に言うと、この期限で月${need.toLocaleString()}円は厳しい。それでも一番マシなのがこれ`,
      );
  } else if (profile.goalKind === 'proof') {
    out.push(
      feasibility === 'hard'
        ? `${profile.goalAmount}本はこの期間だと重い。まず1本、完成させることに集中する`
        : `手を動かすタスクの比率が高い手段。期間内に「見せられるもの」が残る`,
    );
  } else if (profile.goalKind === 'skill') {
    out.push('売る作業を外して、作る・学ぶタスクだけを出す。「できる」と言い切れる状態を取りにいく');
  } else if (profile.goalKind === 'habit') {
    out.push(
      feasibility === 'hard'
        ? `期限より続けたい日数の方が長い。期限を延ばすか日数を減らすかのどちらかが要る`
        : `1日の量はこっちで調整する。止まったら勝手に軽くなるので、続けることだけ考えればいい`,
    );
  }

  out.push(...pb.why.slice(0, 2));
  return out;
}

/** 探索モードの決定：上位3手段を返す */
function decideExplore(profile: Profile, scored: ScoreBreakdown[]): Decision {
  const n = Math.max(2, Math.min(3, Math.round(profile.goalAmount) || 3));
  const picks = scored.filter((b) => !b.blocked).slice(0, n);
  const chosen = picks.length > 0 ? picks : scored.slice(0, n);
  const names = chosen.map((b) => b.playbook.name);

  return {
    playbookId: chosen[0].playbook.id,
    exploreIds: chosen.map((b) => b.playbook.id),
    score: chosen[0].score,
    reasons: [
      `いま決め切らない。${names.length}つ小さく試して、2週間後に手が動いた方を残す`,
      `試すのは「${names.join('」「')}」。どれも土台づくりだけやる。売る作業は今は出さない`,
      '迷ってる時間が一番もったいない。考えるのをやめて、やってから決める',
      '2週間後に「どれが一番ラクだったか」を聞く。そこで1つに確定する',
    ],
    rejected: scored
      .filter((b) => !chosen.includes(b))
      .slice(0, 4)
      .map((b) => ({
        playbookId: b.playbook.id,
        score: b.score,
        reason: rejectReason(b, profile),
      })),
    verdict: `${names.length}つ試す。決めるのは2週間後でいい`,
    feasibility: 'tight',
    requiredMonthly: 0,
  };
}

export function decide(profile: Profile): Decision {
  const scored = PLAYBOOKS.map((pb) => scorePlaybook(pb, profile)).sort(
    (a, b) => b.score - a.score || a.playbook.id.localeCompare(b.playbook.id),
  );

  if (profile.goalKind === 'explore') return decideExplore(profile, scored);

  const top = scored[0];
  const pb = top.playbook;
  const feasibility = judgeFeasibility(profile, pb);

  const verdictHead =
    feasibility === 'hard'
      ? `${pb.name}でいく。ただし目標が重いから、まず最初の1つを取りにいく`
      : `${pb.name}でいく。迷う時間がもったいないから、もう決めた`;

  return {
    playbookId: pb.id,
    score: top.score,
    reasons: buildReasons(profile, pb, top, feasibility),
    rejected: scored.slice(1, 5).map((b) => ({
      playbookId: b.playbook.id,
      score: b.score,
      reason: rejectReason(b, profile),
    })),
    verdict: verdictHead,
    feasibility,
    requiredMonthly: Math.round(requiredMonthly(profile)),
  };
}

/** 手段を手動で切り替える */
export function decideWith(profile: Profile, playbookId: string): Decision {
  const base = decide(profile);
  if (base.playbookId === playbookId && !base.exploreIds) return base;
  const pb = getPlaybook(playbookId);
  const b = scorePlaybook(pb, profile);
  const rest = [
    { playbookId: base.playbookId, score: base.score, reason: '自動判定ではこっちが本命だった' },
    ...base.rejected.filter((x) => x.playbookId !== playbookId).slice(0, 3),
  ];
  return {
    playbookId,
    score: b.score,
    reasons: ['自分で選んだ手段。決めたなら迷わずやる。', ...pb.why.slice(0, 2)],
    rejected: rest,
    verdict: `${pb.name}でいく。選んだ以上、途中で乗り換えない。`,
    feasibility: judgeFeasibility(profile, pb),
    requiredMonthly: Math.round(requiredMonthly(profile)),
  };
}

export { GOAL_KINDS };
