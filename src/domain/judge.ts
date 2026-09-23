import type { DayLog, Task } from '../types';

/**
 * その日をどう評価するか。
 *
 * 大前提：**未完了は失敗ではない**。
 * 3件中1件しか終わらなくても、その1件が最重要なら「前進」として扱う。
 * 消化率だけで採点すると、人は「できなかった日」を数えるようになって止まる。
 */
export type Verdict = 'full' | 'win' | 'partial' | 'miss' | 'empty';

export interface DayJudgement {
  verdict: Verdict;
  /** 前進として扱うか（＝この日を失敗にしないか） */
  advanced: boolean;
  done: number;
  total: number;
  hasMust: boolean;
  mustDone: boolean;
  /** 見出し。UIでも締めのFBでも同じ言葉を使う */
  label: string;
  /** なぜその判定なのか。1行 */
  why: string;
}

const isMust = (t: Task) => t.priority === 'must';

/**
 * 採点の対象になるタスク。
 * 自分で「今日はパス」を選んで未来に置き直したものは、やらなかったのではなく
 * 置き場所を変えただけ。ここで数えると、判断したことが減点になってしまう。
 */
export function activeTasks<T extends Pick<Task, 'deferredTo'>>(tasks: T[]): T[] {
  return tasks.filter((t) => !t.deferredTo);
}

export function judgeDay(log: Pick<DayLog, 'tasks'>): DayJudgement {
  const tasks = activeTasks(log.tasks);
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  const musts = tasks.filter(isMust);
  const hasMust = musts.length > 0;
  const mustDone = hasMust && musts.every((t) => t.done);

  const base = { done, total, hasMust, mustDone };

  if (total === 0) {
    return {
      ...base,
      verdict: 'empty',
      advanced: false,
      label: '今日はタスクなし',
      why: '予定が入っていない日。休みなら休みでいい。',
    };
  }

  if (done === total) {
    return {
      ...base,
      verdict: 'full',
      advanced: true,
      label: '全部消化',
      why: `${total}件すべて完了。`,
    };
  }

  if (hasMust && mustDone) {
    return {
      ...base,
      verdict: 'win',
      advanced: true,
      label: '今日は前進',
      why: `${done}/${total}件だけど、一番大事な1個を押さえた。これで十分。`,
    };
  }

  if (done === 0) {
    return {
      ...base,
      verdict: 'miss',
      advanced: false,
      label: '今日はゼロ',
      why: '1件も動いていない。明日は1個だけでいい。',
    };
  }

  if (hasMust && !mustDone) {
    return {
      ...base,
      verdict: 'partial',
      advanced: true,
      label: '動いたけど本命が残った',
      why: `${done}件やったのは事実。ただ最重要の「${musts[0].title}」が残ってる。`,
    };
  }

  // must が無い日は、半分やれば前進扱い
  return {
    ...base,
    verdict: done / total >= 0.5 ? 'win' : 'partial',
    advanced: true,
    label: done / total >= 0.5 ? '今日は前進' : '少し進んだ',
    why: `${done}/${total}件。ゼロじゃない日を続けることの方が大事。`,
  };
}

/** 連続で「前進」した日数。消化率100%の日だけを数えない */
export function advanceStreak(
  logs: Record<string, DayLog>,
  today: string,
  addDays: (d: string, n: number) => string,
): number {
  let n = 0;
  for (let i = 0; i < 120; i++) {
    const log = logs[addDays(today, -i)];
    if (!log) {
      if (i === 0) continue;
      break;
    }
    const j = judgeDay(log);
    if (j.advanced) n++;
    else if (i > 0) break;
  }
  return n;
}
