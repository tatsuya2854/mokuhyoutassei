import type { AnxietyId, GoalKind, Profile } from '../types';

/**
 * 不安を目標に翻訳する。
 * 「何がやりたいか分からない」人に金額から聞くと、最初の画面で手が止まる。
 * だから金額の前に「いま何が一番しんどいか」を聞いて、そこから目標の型を決める。
 */
export interface AnxietyDef {
  id: AnxietyId;
  label: string;
  /** 選んだ直後に上司が返す言葉 */
  voice: string;
  goalKind: GoalKind;
}

export const ANXIETIES: AnxietyDef[] = [
  {
    id: 'money',
    label: 'お金が足りない・将来が不安',
    voice: 'いちばん具体的な不安。具体的な不安は、具体的な数字にすれば課題に変わる。',
    goalKind: 'money',
  },
  {
    id: 'career',
    label: '就職・進路が決まらない',
    voice: '足りないのは「やる気」じゃなくて、人に見せられるものが1つも無いこと。作れば終わる。',
    goalKind: 'proof',
  },
  {
    id: 'lost',
    label: '何がやりたいか分からない',
    voice: '考えても出てこない。やってみないと分からないから、小さく試す期間を作る。',
    goalKind: 'explore',
  },
  {
    id: 'behind',
    label: '周りより遅れてる気がする',
    voice: 'その比較、勝てない相手とやってる。比べる相手を「過去の自分」に変える。',
    goalKind: 'habit',
  },
  {
    id: 'nocontinue',
    label: '何をやっても続かない',
    voice: '意志の問題じゃない。1日の量が多すぎるだけ。量をこっちで管理する。',
    goalKind: 'habit',
  },
  {
    id: 'noskill',
    label: '武器になるスキルがない',
    voice: '「何も無い」は思い込みのことが多い。無いなら、3ヶ月で1つ作ればいい。',
    goalKind: 'skill',
  },
];

export const ANXIETY_MAP: Record<AnxietyId, AnxietyDef> = Object.fromEntries(
  ANXIETIES.map((a) => [a.id, a]),
) as Record<AnxietyId, AnxietyDef>;

/* ------------------------------------------------------------------ */

export interface GoalKindDef {
  id: GoalKind;
  /** 設定画面などで出す短い名前 */
  name: string;
  /** ヒアリングQ01の見出し */
  headline: string;
  lead: string;
  /** 目標の数値の単位 */
  unit: string;
  presets: { value: number; label: string }[];
  defaultValue: number;
  /** 目標の表示文（例：「月10万円」「実績3本」） */
  format: (value: number, monthly: boolean) => string;
  /**
   * この目標では出さないタスクのタグ。
   * 例：就職が不安な人に「営業DMを5件送る」を出しても不安は減らない。
   * ただし絞った結果タスクが枯れる場合は planner 側で無視する。
   */
  denyTags: string[];
  /** 日次で成果の数値を記録するか（お金・実績） */
  tracksOutcome: boolean;
  /** 成果入力欄のラベル */
  outcomeLabel: string;
  /** 進捗画面での成果の呼び方 */
  outcomeName: string;
  /** 決定エンジンの重み */
  weights: { time: number; budget: number; skill: number; reach: number; craft: number };
}

const yen = (n: number) => `${n.toLocaleString()}円`;

/** 売る側の動き。作る・学ぶが目的のときは出さない */
const SELLING = ['営業', '販売', '出品', '仕入', '運用', '実施'];
const SPREADING = ['集客', '投稿', '拡大', '仕組み'];

export const GOAL_KINDS: Record<GoalKind, GoalKindDef> = {
  money: {
    id: 'money',
    name: 'お金',
    headline: 'いくら稼ぎたい？',
    lead: 'ここが曖昧なままだと、何を選んでも続かない。まず金額を決め切る。',
    unit: '円',
    presets: [
      { value: 30000, label: '3万' },
      { value: 50000, label: '5万' },
      { value: 100000, label: '10万' },
      { value: 300000, label: '30万' },
      { value: 500000, label: '50万' },
      { value: 1000000, label: '100万' },
    ],
    defaultValue: 100000,
    format: (v, monthly) => (monthly ? `月${yen(v)}` : `合計${yen(v)}`),
    denyTags: [],
    tracksOutcome: true,
    outcomeLabel: '今日確定した収益（円）',
    outcomeName: '収益',
    weights: { time: 20, budget: 10, skill: 28, reach: 30, craft: 12 },
  },

  proof: {
    id: 'proof',
    name: '実績',
    headline: '人に見せられるものを、いくつ作る？',
    lead: '「がんばりました」は伝わらない。作ったものだけが伝わる。数を決める。',
    unit: '本',
    presets: [
      { value: 1, label: '1本' },
      { value: 2, label: '2本' },
      { value: 3, label: '3本' },
      { value: 5, label: '5本' },
    ],
    defaultValue: 3,
    format: (v) => `見せられるもの${v}本`,
    denyTags: SELLING,
    tracksOutcome: true,
    outcomeLabel: '今日完成した数（本）',
    outcomeName: '完成',
    weights: { time: 20, budget: 10, skill: 40, reach: 0, craft: 30 },
  },

  skill: {
    id: 'skill',
    name: 'スキル',
    headline: '何ができるようになりたい？',
    lead: '「勉強する」はゴールじゃない。「これができる」と言い切れる状態を1つ決める。',
    unit: '個',
    presets: [
      { value: 1, label: '1つに集中' },
      { value: 2, label: '2つ' },
    ],
    defaultValue: 1,
    format: (v) => `言い切れるスキル${v}つ`,
    denyTags: [...SELLING, ...SPREADING],
    tracksOutcome: false,
    outcomeLabel: '',
    outcomeName: '習得',
    weights: { time: 15, budget: 5, skill: 45, reach: 0, craft: 35 },
  },

  habit: {
    id: 'habit',
    name: '継続',
    headline: '何日続ける？',
    lead: '量より回数。まずは「ゼロの日を作らない」だけを目標にする。',
    unit: '日',
    presets: [
      { value: 14, label: '14日' },
      { value: 30, label: '30日' },
      { value: 60, label: '60日' },
      { value: 100, label: '100日' },
    ],
    defaultValue: 30,
    format: (v) => `${v}日つづける`,
    denyTags: [],
    tracksOutcome: false,
    outcomeLabel: '',
    outcomeName: '実行日',
    weights: { time: 30, budget: 10, skill: 40, reach: 0, craft: 20 },
  },

  explore: {
    id: 'explore',
    name: '探索',
    headline: 'いくつ試してみる？',
    lead: '考えても答えは出ない。小さく試して、手が動いた方を選ぶ。決めるのは2週間後でいい。',
    unit: '案',
    presets: [
      { value: 2, label: '2つ' },
      { value: 3, label: '3つ' },
    ],
    defaultValue: 3,
    format: (v) => `${v}つ試して1つに絞る`,
    denyTags: [...SELLING, ...SPREADING],
    tracksOutcome: false,
    outcomeLabel: '',
    outcomeName: '試行',
    weights: { time: 25, budget: 10, skill: 35, reach: 0, craft: 30 },
  },
};

export const goalKindOf = (p: Profile): GoalKindDef => GOAL_KINDS[p.goalKind] ?? GOAL_KINDS.money;

/**
 * 目標タイプに合わないタグのタスクを落とす。
 * 絞った結果ゼロになる手段では元のまま返す（タスクが枯れて日が空くのを防ぐ）。
 */
export function filterByGoal<T extends { tag: string }>(items: T[], kind: GoalKindDef): T[] {
  if (kind.denyTags.length === 0) return items;
  const deny = new Set(kind.denyTags);
  const kept = items.filter((x) => !deny.has(x.tag));
  return kept.length > 0 ? kept : items;
}

/** 目標の表示文 */
export function goalLabel(p: Profile): string {
  return goalKindOf(p).format(p.goalAmount, p.goalMode === 'monthly');
}

/** 探索モードの期間（日） */
export const EXPLORE_DAYS = 14;

export const isExploreGoal = (p: Profile) => p.goalKind === 'explore';

/** その目標タイプで日次の成果入力を出すか */
export const tracksOutcome = (p: Profile) => goalKindOf(p).tracksOutcome;
