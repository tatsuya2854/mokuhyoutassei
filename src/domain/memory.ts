import type { DayLog, Task } from '../types';
import { addDays, diffDays, fromISO } from '../lib/date';

/**
 * ユーザーの行動から作る長期記憶。
 *
 * 別ストレージは持たない。日次ログがそのまま記憶なので、
 * 「記録」と「記憶」がズレることが原理的に起きない。
 */
export interface Memory {
  /** 見積りの何倍かかる人か。1.0 = 見積りどおり */
  paceRatio: number;
  /** paceRatio の根拠になったサンプル日数 */
  paceSamples: number;
  /** タグ別の倍率（サンプルが溜まったものだけ） */
  tagRatio: Record<string, { ratio: number; samples: number }>;
  /** 曜日別の消化率（0=日曜） */
  weekdayRate: Record<number, { done: number; total: number; rate: number }>;
  /** タスクの重さ別の完了率 */
  sizeRate: Record<SizeBand, { done: number; total: number; rate: number }>;
  /** sourceId ごとに何回先送りされたか */
  deferCounts: Record<string, number>;
  /** 最重要タスクを終えられた日の割合 */
  mustHitRate: number;
  /** 記憶の元になった日数 */
  days: number;
}

export type SizeBand = 'small' | 'medium' | 'large';

/** タスクの重さを3段階に丸める */
export function sizeBandOf(min: number): SizeBand {
  if (min <= 30) return 'small';
  if (min <= 75) return 'medium';
  return 'large';
}

const EMPTY_RATE = { done: 0, total: 0, rate: 0 };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** 記憶がまだ薄い状態（初日など）の既定値 */
export const BLANK_MEMORY: Memory = {
  paceRatio: 1,
  paceSamples: 0,
  tagRatio: {},
  weekdayRate: {},
  sizeRate: {
    small: { ...EMPTY_RATE },
    medium: { ...EMPTY_RATE },
    large: { ...EMPTY_RATE },
  },
  deferCounts: {},
  mustHitRate: 0,
  days: 0,
};

/** 見積りと実績のズレを学習するのに必要な最低サンプル数 */
const MIN_PACE_SAMPLES = 3;
const MIN_TAG_SAMPLES = 3;

export function buildMemory(logs: Record<string, DayLog>, today?: string): Memory {
  const entries = Object.values(logs)
    .filter((l) => (today ? diffDays(l.date, today) >= 0 : true))
    .filter((l) => l.closed)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (entries.length === 0) return { ...BLANK_MEMORY };

  const mem: Memory = {
    ...BLANK_MEMORY,
    tagRatio: {},
    weekdayRate: {},
    sizeRate: {
      small: { ...EMPTY_RATE },
      medium: { ...EMPTY_RATE },
      large: { ...EMPTY_RATE },
    },
    deferCounts: {},
    days: entries.length,
  };

  // --- 見積りと実績のズレ ---
  const ratios: number[] = [];
  const tagAcc: Record<string, number[]> = {};

  for (const log of entries) {
    const doneTasks = log.tasks.filter((t) => t.done);
    const estimated = doneTasks.reduce((a, t) => a + t.estMin, 0);
    if (log.actualMin && log.actualMin > 0 && estimated > 0) {
      // 極端な値は学習を壊すので丸める
      const r = clamp(log.actualMin / estimated, 0.4, 3);
      ratios.push(r);

      // その日が1つのタグに偏っていたら、そのタグの倍率として記録する
      const byTag: Record<string, number> = {};
      for (const t of doneTasks) byTag[t.tag] = (byTag[t.tag] ?? 0) + t.estMin;
      for (const [tag, min] of Object.entries(byTag)) {
        if (min / estimated >= 0.7) (tagAcc[tag] ??= []).push(r);
      }
    }

    // --- 曜日別の消化率 ---
    const dow = fromISO(log.date).getDay();
    const w = (mem.weekdayRate[dow] ??= { ...EMPTY_RATE });
    w.done += doneTasks.length;
    w.total += log.tasks.length;

    // --- 重さ別の完了率 ---
    for (const t of log.tasks) {
      const band = mem.sizeRate[sizeBandOf(t.baseMin ?? t.estMin)];
      band.total += 1;
      if (t.done) band.done += 1;
    }

    // --- 先送り回数 ---
    for (const t of log.tasks) {
      if (t.deferredTo) mem.deferCounts[t.sourceId] = (mem.deferCounts[t.sourceId] ?? 0) + 1;
    }
  }

  if (ratios.length >= MIN_PACE_SAMPLES) {
    mem.paceRatio = clamp(ratios.reduce((a, b) => a + b, 0) / ratios.length, 0.6, 2.5);
    mem.paceSamples = ratios.length;
  }
  for (const [tag, arr] of Object.entries(tagAcc)) {
    if (arr.length >= MIN_TAG_SAMPLES) {
      mem.tagRatio[tag] = {
        ratio: clamp(arr.reduce((a, b) => a + b, 0) / arr.length, 0.6, 2.5),
        samples: arr.length,
      };
    }
  }

  for (const k of Object.keys(mem.weekdayRate)) {
    const w = mem.weekdayRate[Number(k)];
    w.rate = w.total === 0 ? 0 : w.done / w.total;
  }
  for (const band of ['small', 'medium', 'large'] as SizeBand[]) {
    const b = mem.sizeRate[band];
    b.rate = b.total === 0 ? 0 : b.done / b.total;
  }

  // --- 最重要タスクを終えられた日の割合 ---
  const daysWithMust = entries.filter((l) => l.tasks.some((t) => t.priority === 'must'));
  const hit = daysWithMust.filter((l) => l.tasks.some((t) => t.priority === 'must' && t.done));
  mem.mustHitRate = daysWithMust.length === 0 ? 0 : hit.length / daysWithMust.length;

  return mem;
}

/**
 * 記憶をもとに見積りを補正する。
 * 「この人の90分は実質130分」をタスク生成の時点で織り込む。
 */
export function adjustEstimate(baseMin: number, tag: string, mem: Memory): number {
  const tagR = mem.tagRatio[tag];
  const ratio = tagR ? tagR.ratio : mem.paceRatio;
  if (Math.abs(ratio - 1) < 0.08) return baseMin;
  return Math.max(10, Math.round((baseMin * ratio) / 5) * 5);
}

/** 補正が効いているかどうか（UIで説明を出すのに使う） */
export function hasPaceSignal(mem: Memory): boolean {
  return mem.paceSamples >= MIN_PACE_SAMPLES && Math.abs(mem.paceRatio - 1) >= 0.15;
}

/* ------------------------------------------------------------------ */
/*  賢い再配置                                                          */
/* ------------------------------------------------------------------ */

export interface Placement {
  /** 置き直した先の日付 */
  date: string;
  /** なぜその日か */
  reason: string;
  /** もう捨てた方がいいと判断した場合 */
  drop?: boolean;
}

/** 先送りを何回まで許すか。これを超えたら「本当にやる？」と問う */
export const DEFER_LIMIT = 3;

/**
 * 先送り／再計画されたタスクを、いつに置き直すか決める。
 *
 * 単純に翌日へずらさない。残りの期限・重さ・曜日の得手不得手・
 * これまで何回逃げたかを見て、いちばん終わりそうな日に置く。
 */
export function placeTask(
  task: Pick<Task, 'estMin' | 'baseMin' | 'priority' | 'sourceId'>,
  mem: Memory,
  from: string,
  deadline: string,
  opts: { workdaysPerWeek: number; deferCount: number },
): Placement {
  const { deferCount } = opts;

  // 逃げ続けているタスクは、置き直すより「捨てるか決める」方が健全
  if (deferCount + 1 >= DEFER_LIMIT) {
    return {
      date: addDays(from, 1),
      reason: `${deferCount + 1}回目の先送り。明日の先頭に戻すけど、やらないなら消した方がいい`,
      drop: true,
    };
  }

  const daysLeft = Math.max(diffDays(from, deadline), 1);
  const band = sizeBandOf(task.baseMin ?? task.estMin);

  // 候補は明日から最大7日先まで。期限は越えない
  const horizon = Math.min(7, daysLeft);
  const candidates: { date: string; score: number; why: string }[] = [];

  for (let i = 1; i <= horizon; i++) {
    const d = addDays(from, i);
    const dow = fromISO(d).getDay();
    const w = mem.weekdayRate[dow];

    // 曜日の得意・不得意（記録が薄い曜日は中立）
    const dowScore = w && w.total >= 3 ? w.rate : 0.5;
    // 近い日ほど良い。ただし重いタスクは少し先でもいい
    const soonScore = 1 - (i - 1) / horizon;
    // 最重要は先送りしない。翌日に戻す
    const priorityPull = task.priority === 'must' ? (i === 1 ? 0.5 : 0) : 0;
    // 重いタスクを落としがちな人なら、重いものは得意な曜日に寄せる
    const sizePenalty =
      band === 'large' && mem.sizeRate.large.total >= 3 && mem.sizeRate.large.rate < 0.5
        ? dowScore < 0.6
          ? -0.35
          : 0.15
        : 0;

    const score = dowScore * 0.5 + soonScore * 0.35 + priorityPull + sizePenalty;
    const why =
      w && w.total >= 3 && w.rate >= 0.7
        ? `${WD[dow]}曜はよく消化できてる日`
        : i === 1
          ? '明日の先頭に置く'
          : `${WD[dow]}曜に置く`;
    candidates.push({ date: d, score, why });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] ?? { date: addDays(from, 1), why: '明日に回す', score: 0 };

  const extra =
    band === 'large' && mem.sizeRate.large.total >= 3 && mem.sizeRate.large.rate < 0.5
      ? '。重いタスクを落としがちだから、余裕のある日に寄せた'
      : '';

  return { date: best.date, reason: `${best.why}${extra}` };
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];

/** 記憶から読み取れることを、言葉にして返す（分析画面で出す） */
export function memoryInsights(mem: Memory): string[] {
  const out: string[] = [];
  if (mem.days < 5) {
    out.push(`まだ${mem.days}日分しか記録がない。1週間まわすと、あなたの癖が見えてくる。`);
    return out;
  }

  if (hasPaceSignal(mem)) {
    const pct = Math.round((mem.paceRatio - 1) * 100);
    out.push(
      pct > 0
        ? `見積りより${pct}%多く時間がかかってる → 以降の見積りを${pct}%増しで出すようにした。盛ってるんじゃなくて、あなたの実測。`
        : `見積りより${-pct}%速い → 以降の見積りを${-pct}%減らした。もう少し詰め込める。`,
    );
  }

  const wd = Object.entries(mem.weekdayRate)
    .filter(([, w]) => w.total >= 3)
    .map(([k, w]) => ({ dow: Number(k), ...w }))
    .sort((a, b) => b.rate - a.rate);
  if (wd.length >= 3) {
    const best = wd[0];
    const worst = wd[wd.length - 1];
    if (best.rate - worst.rate >= 0.25) {
      out.push(
        `${WD[best.dow]}曜の消化率${Math.round(best.rate * 100)}%に対して${WD[worst.dow]}曜は${Math.round(worst.rate * 100)}% → 重いタスクは${WD[best.dow]}曜に寄せる。${WD[worst.dow]}曜は軽くする。`,
      );
    }
  }

  const large = mem.sizeRate.large;
  const small = mem.sizeRate.small;
  if (large.total >= 3 && small.total >= 3 && small.rate - large.rate >= 0.3) {
    out.push(
      `短いタスクは${Math.round(small.rate * 100)}%終わるのに、長いタスクは${Math.round(large.rate * 100)}% → 大きい塊が苦手。分割して出す方が前に進む。`,
    );
  }

  const repeated = Object.entries(mem.deferCounts)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1]);
  if (repeated.length > 0) {
    out.push(
      `${repeated.length}件のタスクを2回以上先送りしてる → 避けてるものは、たいてい分からないか気が重いかのどちらか。理由を1行書くと動ける。`,
    );
  }

  if (mem.mustHitRate > 0) {
    out.push(
      mem.mustHitRate >= 0.7
        ? `最重要タスクの達成率${Math.round(mem.mustHitRate * 100)}% → 一番大事なものはちゃんと押さえてる。全部やろうとしなくていい。`
        : `最重要タスクの達成率${Math.round(mem.mustHitRate * 100)}% → 「一番大事な1個」を朝いちばんに片付ける形に変えた方がいい。`,
    );
  }

  if (out.length === 0) out.push('いまのところ大きな癖は見当たらない。素直に回せてる。');
  return out;
}
