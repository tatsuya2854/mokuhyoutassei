import type { AssistantContext, AssistantPort, AssistantReply } from './port';
import type { ChatAction, Task } from '../types';
import { judgeDay } from '../domain/judge';
import { hasPaceSignal, memoryInsights } from '../domain/memory';
import { goalKindOf, goalLabel } from '../domain/goals';
import { phaseForDate, phaseInfo } from '../domain/planner';
import { getPlaybook } from '../domain/playbooks';
import { ANXIETY_MAP } from '../domain/goals';

/**
 * 端末の中だけで動く秘書。
 *
 * 外部APIを呼ばない＝鍵がいらない・無料・オフラインで動く・
 * 同じ状況なら同じことを言う（上司がブレない）。
 * 賢さは足りないが、「今日どれをやるか」の判断に必要な材料は
 * すべて手元のデータにある。
 */

type Intent =
  | 'today'
  | 'tired'
  | 'heavy'
  | 'done'
  | 'why'
  | 'progress'
  | 'quit'
  | 'tomorrow'
  | 'me'
  | 'plan'
  | 'unknown';

const RULES: { intent: Intent; words: string[] }[] = [
  { intent: 'today', words: ['今日', 'なにやる', '何やる', 'やること', 'タスク', '何すれば', 'どれから'] },
  { intent: 'tired', words: ['疲れ', 'しんど', 'つら', 'ムリ', '無理', '時間ない', '時間がない', '眠い', 'やる気'] },
  { intent: 'heavy', words: ['重い', '多い', '減らし', '多すぎ', '終わらな', 'きつい'] },
  { intent: 'done', words: ['終わった', 'できた', 'やった', '完了', 'done'] },
  { intent: 'why', words: ['なんで', 'なぜ', '意味', 'どうして', '理由'] },
  { intent: 'progress', words: ['進捗', '調子', 'どんな感じ', '間に合', '状況', 'ペース'] },
  { intent: 'quit', words: ['やめ', '向いてな', '諦め', 'あきらめ', '無駄', '意味ある'] },
  { intent: 'tomorrow', words: ['明日', 'あした', '来週', '次は'] },
  { intent: 'me', words: ['自分', '僕', '私', '癖', '傾向', '分かった'] },
  { intent: 'plan', words: ['計画', '手段', 'プラン', '全体', 'ゴール', '目標'] },
];

function detect(text: string): Intent {
  const t = text.toLowerCase();
  let best: { intent: Intent; hits: number } = { intent: 'unknown', hits: 0 };
  for (const r of RULES) {
    const hits = r.words.filter((w) => t.includes(w)).length;
    if (hits > best.hits) best = { intent: r.intent, hits };
  }
  return best.intent;
}

const min = (t: Task) => `${t.estMin}分`;

function listTasks(tasks: Task[]): string {
  return tasks
    .map((t, i) => `${i + 1}. ${t.priority === 'must' ? '【本命】' : ''}${t.title}（${min(t)}）`)
    .join('\n');
}

function actionsFor(tasks: Task[], kind: 'defer' | 'replan' | 'done'): ChatAction[] {
  const label = { defer: '今日はパス', replan: '再計画', done: '完了にする' }[kind];
  return tasks.slice(0, 3).map((t) => ({ kind, taskId: t.id, label: `${label}：${t.title}` }));
}

function answer(text: string, ctx: AssistantContext): AssistantReply {
  const { profile, plan, progress, memory, tasks, today } = ctx;
  const open = tasks.filter((t) => !t.done && !t.deferredTo);
  const must = open.find((t) => t.priority === 'must');
  const rest = open.filter((t) => t !== must);
  const kind = goalKindOf(profile);
  const info = phaseInfo(plan, phaseForDate(plan, today));
  const j = ctx.log ? judgeDay(ctx.log) : null;

  switch (detect(text)) {
    case 'today': {
      if (open.length === 0) {
        return {
          text: '今日のぶんは終わってる。無理に足さなくていい。\n休むか、明日のぶんを前倒しするか、どっちか決めて。',
        };
      }
      return {
        text: `今日はこれ。\n\n${listTasks(open)}\n\n${
          must
            ? `迷ったら「${must.title}」から。これさえ終われば、残りが消えても今日は前進扱いでいい。`
            : '上から順でいい。全部やらなくていいから、1個は必ず終わらせて。'
        }`,
        actions: must ? [{ kind: 'done', taskId: must.id, label: `完了にする：${must.title}` }] : undefined,
      };
    }

    case 'tired': {
      if (open.length === 0) return { text: '今日はもう終わってる。休んでいい。' };
      const lightest = [...open].sort((a, b) => a.estMin - b.estMin)[0];
      return {
        text: `了解。今日はそういう日ってだけ。\n\nやるのは「${
          (must ?? lightest).title
        }」の1個だけでいい。${min(must ?? lightest)}。\n残りは置き直すから、気にしなくていい。\n\nゼロと1は全然ちがう。1にしてから寝よう。`,
        actions: actionsFor(rest.length > 0 ? rest : [], 'defer'),
      };
    }

    case 'heavy': {
      const heavy = [...open].sort((a, b) => b.estMin - a.estMin);
      const note = hasPaceSignal(memory)
        ? `ちなみに見積りは、あなたの実測（${Math.round(memory.paceRatio * 100)}%）で補正済み。それでも重いなら量の問題。`
        : '見積りが合ってない可能性もある。締めるとき「実際の作業時間」を入れると、次から合ってくる。';
      return {
        text: `重い順はこれ。\n\n${listTasks(heavy)}\n\n上の1〜2個を置き直すのが早い。${note}`,
        actions: actionsFor(heavy.filter((t) => t !== must), 'replan'),
      };
    }

    case 'done': {
      if (open.length === 0) {
        return { text: `おつかれ。${j ? j.why : ''}\n締めて記録に残すところまでやっておいて。` };
      }
      return {
        text: `おけ！どれが終わった？タップで反映する。\n\n${listTasks(open)}`,
        actions: actionsFor(open, 'done'),
      };
    }

    case 'why': {
      const t = must ?? open[0];
      if (!t) return { text: `いまは「${info.name}」の期間。${info.goal}` };
      return {
        text: `「${t.title}」をやる理由はこれ。\n\nいまは「${info.name}」の期間で、狙いは${info.goal}\nこのタスクはその${t.tag}にあたる。ここを飛ばすと、後の作業が全部ブレる。\n\n${t.detail}`,
      };
    }

    case 'progress': {
      const pace = {
        ahead: '先行してる',
        onTrack: '想定どおり',
        behind: '遅れてる',
        stalled: '止まってる',
      }[progress.pace];
      const money =
        kind.id === 'money'
          ? `\n今月 ${progress.monthRevenue.toLocaleString()}円 / 必要 ${progress.needMonthly.toLocaleString()}円。`
          : `\n目標は「${goalLabel(profile)}」。いま${progress.totalRevenue}${kind.unit}。`;
      return {
        text: `ペースは${pace}。\n\n期間の経過${Math.round(progress.elapsed * 100)}%に対して、計画の消化は${Math.round(
          progress.planProgress * 100,
        )}%。直近7日の消化率は${Math.round(progress.recentRate * 100)}%、連続${progress.streak}日。${money}\n\n${
          progress.pace === 'behind' || progress.pace === 'stalled'
            ? '埋めるのは精神論じゃなくて量の調整。タスクを減らすか、時間を増やすか、期限を動かすかの三択。'
            : 'この流れは止めない方が得。'
        }`,
      };
    }

    case 'quit': {
      return {
        text: `${ANXIETY_MAP[profile.anxiety]?.voice ?? ''}\n\nやめたくなるのは、たいてい「やる意味が消えた」んじゃなくて「今日やることが重すぎる」だけ。\n${
          must ? `今日は「${must.title}」の1個でいい。${min(must)}だけ。` : '今日は1個でいい。'
        }\n\nここまで${progress.doneTasks}件やってる。それは消えない。`,
        actions: must ? [{ kind: 'done', taskId: must.id, label: `完了にする：${must.title}` }] : undefined,
      };
    }

    case 'tomorrow': {
      return {
        text: `明日のぶんは、今日を締めた時点で組み直す。\n今日の結果と、あなたの曜日ごとの癖を見て置き直すから、いま考えなくていい。\n\n${
          open.length > 0 ? `残ってるぶん（${open.length}件）は、明日以降のいちばん終わりそうな日に回す。` : '今日のぶんは片付いてる。'
        }`,
        actions: [{ kind: 'goto', tab: 'plan', label: '計画を見る' }],
      };
    }

    case 'me': {
      return { text: memoryInsights(memory).join('\n\n') };
    }

    case 'plan': {
      const pb = getPlaybook(plan.playbookId);
      return {
        text: `手段は「${pb.name}」。${pb.model}\n\nいまは「${info.name}」の期間（${info.startDate}〜${info.endDate}）。${info.goal}\n\n全体の消化は${Math.round(
          progress.planProgress * 100,
        )}%、残り${progress.daysLeft}日。`,
        actions: [{ kind: 'goto', tab: 'plan', label: '計画の全体を見る' }],
      };
    }

    default: {
      // 分からないときは、こちらから聞き返して的を絞る。適当に喋らない。
      return {
        text: `そこは分からないから、決められる形にさせて。\n\n聞きたいのはどれ？\n・今日やること\n・いまの進捗\n・このタスクをやる理由\n・量が多い／時間がない\n\n${
          must ? `ちなみに今日の本命は「${must.title}」。` : ''
        }`,
      };
    }
  }
}

export const localAssistant: AssistantPort = {
  id: 'local-rules',
  ready: true,
  async reply({ text, ctx }) {
    return answer(text, ctx);
  },
};
