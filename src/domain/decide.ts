import { PLAYBOOKS, getPlaybook } from './playbooks';
import type { Decision, Playbook, Profile } from '../types';
import { diffDays } from '../lib/date';

/** 目標達成に必要な「月あたりの収益」を算出する */
export function requiredMonthly(profile: Profile): number {
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

/** 期限までに積み上がる累計収益の見込み（goalMode === 'total' 用） */
export function expectedTotal(pb: Playbook, months: number): number {
  let sum = 0;
  const stepN = Math.max(Math.ceil(months * 4), 1);
  const dm = months / stepN;
  for (let i = 1; i <= stepN; i++) sum += expectedAt(pb, i * dm) * dm;
  return sum;
}

export interface ScoreBreakdown {
  playbook: Playbook;
  score: number;
  time: number;
  budget: number;
  skill: number;
  speed: number;
  scale: number;
  blocked: boolean;
  blockReason: string;
  skillMatched: string[];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function scorePlaybook(pb: Playbook, profile: Profile): ScoreBreakdown {
  const months = horizonMonths(profile);
  const need = requiredMonthly(profile);

  // --- やりたくないこととの衝突 ---
  const conflicts = pb.traits.filter((t) => profile.avoid.includes(t));
  const blocked = conflicts.length > 0;

  // --- 時間の適合 ---
  const time = clamp01(profile.weeklyHours / pb.minWeeklyHours);

  // --- 初期費用の適合 ---
  const budget = pb.minBudget === 0 ? 1 : clamp01(profile.budget / pb.minBudget);

  // --- スキルの適合 ---
  const req = pb.requiredSkills;
  const matchedReq = req.filter((sk) => profile.skills.includes(sk));
  const reqScore = req.length === 0 ? 0.75 : matchedReq.length / req.length;
  const matchedBoost = pb.boostSkills.filter((sk) => profile.skills.includes(sk));
  const boostScore = pb.boostSkills.length === 0 ? 0 : matchedBoost.length / pb.boostSkills.length;
  const skill = clamp01(reqScore * 0.75 + boostScore * 0.35);

  // --- 期限内に届くか（速度） ---
  let speed: number;
  if (profile.goalMode === 'monthly') {
    const reach = expectedAt(pb, months);
    speed = clamp01(reach / Math.max(need, 1));
  } else {
    const reach = expectedTotal(pb, months);
    speed = clamp01(reach / Math.max(profile.goalAmount, 1));
  }

  // --- 目標規模との相性（天井が低い手段で高額目標は無理） ---
  const scale = clamp01(pb.ceiling / Math.max(need, 1));

  const score =
    time * 20 + budget * 10 + skill * 28 + speed * 30 + scale * 12 - (blocked ? 100 : 0);

  return {
    playbook: pb,
    score: Math.round(score * 10) / 10,
    time,
    budget,
    skill,
    speed,
    scale,
    blocked,
    blockReason: blocked ? conflicts.join(',') : '',
    skillMatched: [...matchedReq, ...matchedBoost],
  };
}

function rejectReason(b: ScoreBreakdown, profile: Profile): string {
  if (b.blocked) {
    const labels: Record<string, string> = {
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
    const w = b.blockReason
      .split(',')
      .map((k) => labels[k] ?? k)
      .join('・');
    return `${w}が必須の構造。「やりたくない」に入ってるので除外`;
  }
  if (b.time < 0.6)
    return `週${b.playbook.minWeeklyHours}時間は要る。週${profile.weeklyHours}時間だと回らない`;
  if (b.budget < 0.6) return `初期費用が${b.playbook.minBudget.toLocaleString()}円は要る。予算が足りない`;
  if (b.skill < 0.4) return `必要スキルの土台がない。ゼロから覚える時間で期限が溶ける`;
  if (b.speed < 0.5) return `立ち上がりが遅い。この期限だと目標額に届かない`;
  if (b.scale < 0.6) return `構造的な天井が低い。目標額に対して規模が合わない`;
  return `悪くないけど、本命より立ち上がりか適性で一段落ちる`;
}

export function decide(profile: Profile): Decision {
  const months = horizonMonths(profile);
  const need = requiredMonthly(profile);

  const scored = PLAYBOOKS.map((pb) => scorePlaybook(pb, profile)).sort(
    (a, b) => b.score - a.score || a.playbook.id.localeCompare(b.playbook.id),
  );

  const top = scored[0];
  const pb = top.playbook;

  // --- 達成難易度の判定 ---
  const reach =
    profile.goalMode === 'monthly' ? expectedAt(pb, months) : expectedTotal(pb, months);
  const target = profile.goalMode === 'monthly' ? need : profile.goalAmount;
  const ratio = reach / Math.max(target, 1);
  const feasibility: Decision['feasibility'] = ratio >= 1.2 ? 'easy' : ratio >= 0.7 ? 'tight' : 'hard';

  // --- 選定理由 ---
  const reasons: string[] = [];
  if (top.skill >= 0.6) {
    reasons.push(`持ってるスキルがそのまま武器になる。ゼロから覚える時間が要らないのが一番デカい`);
  } else if (top.skill >= 0.35) {
    reasons.push(`スキルは完璧じゃないけど、走りながら埋められる範囲。止まって勉強する必要はない`);
  } else {
    reasons.push(`特別なスキルが要らない構造なので、今日から手が動かせる`);
  }
  if (top.time >= 1) {
    reasons.push(`週${profile.weeklyHours}時間あれば十分回る。時間が足りなくて詰むパターンを回避できる`);
  } else {
    reasons.push(`週${profile.weeklyHours}時間だとやや窮屈だけど、タスクを絞れば成立する`);
  }
  if (feasibility === 'easy') {
    reasons.push(`期限までに月${Math.round(need).toLocaleString()}円のラインは現実的に超えられる`);
  } else if (feasibility === 'tight') {
    reasons.push(`期限内に月${Math.round(need).toLocaleString()}円はギリギリ。打数で押し切る前提`);
  } else {
    reasons.push(
      `正直に言うと、この期限で月${Math.round(need).toLocaleString()}円は厳しい。それでも一番マシなのがこれ`,
    );
  }
  reasons.push(...pb.why.slice(0, 2));

  const verdictHead =
    feasibility === 'hard'
      ? `${pb.name}でいく。ただし目標設定が重いから、まず「初収益」を取りにいく`
      : `${pb.name}でいく。迷う時間がもったいないから、もう決めた`;

  return {
    playbookId: pb.id,
    score: top.score,
    reasons,
    rejected: scored.slice(1, 5).map((b) => ({
      playbookId: b.playbook.id,
      score: b.score,
      reason: rejectReason(b, profile),
    })),
    verdict: verdictHead,
    feasibility,
    requiredMonthly: Math.round(need),
  };
}

/** 手段を手動で切り替える（同じ理由生成ロジックを流用） */
export function decideWith(profile: Profile, playbookId: string): Decision {
  const base = decide(profile);
  if (base.playbookId === playbookId) return base;
  const pb = getPlaybook(playbookId);
  const b = scorePlaybook(pb, profile);
  const months = horizonMonths(profile);
  const need = requiredMonthly(profile);
  const reach = profile.goalMode === 'monthly' ? expectedAt(pb, months) : expectedTotal(pb, months);
  const target = profile.goalMode === 'monthly' ? need : profile.goalAmount;
  const ratio = reach / Math.max(target, 1);
  const rest = [
    { playbookId: base.playbookId, score: base.score, reason: '自動判定ではこっちが本命だった' },
    ...base.rejected.filter((x) => x.playbookId !== playbookId).slice(0, 3),
  ];
  return {
    playbookId,
    score: b.score,
    reasons: [`自分で選んだ手段。決めたなら迷わずやる。`, ...pb.why.slice(0, 2)],
    rejected: rest,
    verdict: `${pb.name}でいく。選んだ以上、途中で乗り換えない。`,
    feasibility: ratio >= 1.2 ? 'easy' : ratio >= 0.7 ? 'tight' : 'hard',
    requiredMonthly: Math.round(need),
  };
}
