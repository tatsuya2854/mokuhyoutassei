import { useMemo, useState } from 'react';
import type { AnxietyId, AvoidId, GoalMode, Profile, SkillId } from '../types';
import { AVOID_LABELS, SKILL_LABELS } from '../domain/playbooks';
import { ANXIETIES, ANXIETY_MAP, GOAL_KINDS } from '../domain/goals';
import { Button, Chip, Field, Progress } from '../components/ui';
import { cx, inputCls } from '../lib/style';
import { addDays, formatJP, todayISO } from '../lib/date';
import { useAppStore } from '../store/useAppStore';

type StepId = 'welcome' | 'anxiety' | 'target' | 'deadline' | 'time' | 'skills' | 'budget' | 'avoid';

const DEADLINE_PRESETS = [
  { label: '1ヶ月', days: 30 },
  { label: '3ヶ月', days: 90 },
  { label: '6ヶ月', days: 180 },
  { label: '1年', days: 365 },
];
const HOUR_PRESETS = [3, 5, 10, 15, 20, 30];
const BUDGET_PRESETS = [0, 10000, 30000, 50000, 100000, 300000];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const start = useAppStore((s) => s.start);
  const today = todayISO();

  const [anxiety, setAnxiety] = useState<AnxietyId | null>(null);
  const [goalAmount, setGoalAmount] = useState(100000);
  const [goalMode, setGoalMode] = useState<GoalMode>('monthly');
  const [deadline, setDeadline] = useState(addDays(today, 90));
  const [weeklyHours, setWeeklyHours] = useState(10);
  const [workdays, setWorkdays] = useState(5);
  const [skills, setSkills] = useState<SkillId[]>([]);
  const [budget, setBudget] = useState(0);
  const [avoid, setAvoid] = useState<AvoidId[]>([]);
  const [note, setNote] = useState('');
  const [idx, setIdx] = useState(0);

  const goalKind = anxiety ? ANXIETY_MAP[anxiety].goalKind : 'money';
  const kind = GOAL_KINDS[goalKind];

  /**
   * 質問の数は目標タイプで変える。
   * 「続かない」人に予算やスキルまで聞くと、答える前に離脱する。
   */
  const steps = useMemo<StepId[]>(() => {
    const base: StepId[] = ['welcome', 'anxiety', 'target', 'deadline', 'time'];
    if (goalKind === 'habit') return [...base, 'avoid'];
    if (goalKind === 'money') return [...base, 'skills', 'budget', 'avoid'];
    return [...base, 'skills', 'avoid'];
  }, [goalKind]);

  const step = steps[Math.min(idx, steps.length - 1)];
  const qNo = idx; // welcome を 0 とした通し番号
  const lastIdx = steps.length - 1;

  const profile: Profile = useMemo(
    () => ({
      anxiety: anxiety ?? 'money',
      goalKind,
      goalAmount,
      goalMode: goalKind === 'money' ? goalMode : 'total',
      deadline,
      weeklyHours,
      workdaysPerWeek: workdays,
      skills: skills.length ? skills : ['none'],
      budget,
      avoid,
      note,
      startDate: today,
    }),
    [
      anxiety, goalKind, goalAmount, goalMode, deadline, weeklyHours,
      workdays, skills, budget, avoid, note, today,
    ],
  );

  const toggle = <T,>(arr: T[], v: T, set: (x: T[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const canNext = () => {
    if (step === 'anxiety') return anxiety !== null;
    if (step === 'target') return goalAmount > 0;
    if (step === 'deadline') return deadline > today;
    if (step === 'time') return weeklyHours > 0;
    return true;
  };

  const next = () => {
    if (idx === lastIdx) {
      start(profile);
      onDone();
    } else setIdx((i) => i + 1);
  };

  /** 不安を選び直したら、その目標タイプの既定値に入れ替える */
  const chooseAnxiety = (id: AnxietyId) => {
    setAnxiety(id);
    const k = GOAL_KINDS[ANXIETY_MAP[id].goalKind];
    setGoalAmount(k.defaultValue);
    if (ANXIETY_MAP[id].goalKind !== 'money') setGoalMode('total');
  };

  return (
    <div className="flex min-h-dvh flex-col bg-ink-950">
      {idx > 0 && (
        <div className="sticky top-0 z-10 bg-ink-950/95 px-5 pt-4 pb-3 backdrop-blur">
          <Progress value={idx / lastIdx} height={4} />
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              className="pressable -ml-1 px-1 py-1 text-[13px] font-bold text-ink-400"
            >
              ← 戻る
            </button>
            <span className="text-[12px] font-bold text-ink-500">
              {qNo} / {lastIdx}
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 px-5 pb-40">
        {step === 'welcome' && <Welcome />}

        {step === 'anxiety' && (
          <Q
            n={qNo}
            title="いま、何が一番しんどい？"
            lead="ここから始める。金額や計画の話はあと。近いものを1つ選んで。"
          >
            <div className="space-y-2">
              {ANXIETIES.map((a) => (
                <button
                  key={a.id}
                  onClick={() => chooseAnxiety(a.id)}
                  className={cx(
                    'pressable w-full rounded-2xl border px-4 py-3.5 text-left',
                    anxiety === a.id
                      ? 'border-acid-500 bg-acid-500/10'
                      : 'border-ink-600 bg-ink-850',
                  )}
                >
                  <div className="text-[15px] font-bold">{a.label}</div>
                  {anxiety === a.id && (
                    <div className="animate-rise mt-2 border-t border-ink-700 pt-2 text-[13px] leading-relaxed text-ink-300">
                      {a.voice}
                    </div>
                  )}
                </button>
              ))}
            </div>
            {anxiety && (
              <p className="animate-rise mt-5 rounded-2xl bg-ink-850 px-4 py-3 text-[13px] leading-relaxed text-ink-300">
                この不安は「<span className="font-bold text-acid-400">{kind.name}</span>
                」の目標に翻訳する。あと{lastIdx - 1}問で計画を作る。
              </p>
            )}
          </Q>
        )}

        {step === 'target' && (
          <Q n={qNo} title={kind.headline} lead={kind.lead}>
            {goalKind === 'money' && (
              <div className="mb-4 flex gap-2">
                {(
                  [
                    { v: 'monthly', l: '月いくら' },
                    { v: 'total', l: '期限までに合計' },
                  ] as const
                ).map((o) => (
                  <Chip key={o.v} active={goalMode === o.v} onClick={() => setGoalMode(o.v)}>
                    {o.l}
                  </Chip>
                ))}
              </div>
            )}
            <div className="mb-4 flex items-end gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={goalAmount || ''}
                onChange={(e) => setGoalAmount(Number(e.target.value) || 0)}
                className={cx(inputCls, 'text-[28px] font-extrabold tabular-nums')}
              />
              <span className="pb-4 text-[16px] font-bold text-ink-400">{kind.unit}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {kind.presets.map((p) => (
                <Chip
                  key={p.value}
                  active={goalAmount === p.value}
                  onClick={() => setGoalAmount(p.value)}
                >
                  {p.label}
                </Chip>
              ))}
            </div>
            {goalKind === 'skill' && (
              <Field label="どんなスキル？（任意）">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例：LPを1人で作り切れるようになる"
                  className={cx(inputCls, 'mt-1')}
                />
              </Field>
            )}
          </Q>
        )}

        {step === 'deadline' && (
          <Q n={qNo} title="いつまでに？" lead="期限のない目標はただの願望。日付を入れた瞬間に計画になる。">
            <div className="mb-4 flex flex-wrap gap-2">
              {DEADLINE_PRESETS.map((p) => (
                <Chip
                  key={p.days}
                  active={deadline === addDays(today, p.days)}
                  onClick={() => setDeadline(addDays(today, p.days))}
                >
                  {p.label}後
                </Chip>
              ))}
            </div>
            <input
              type="date"
              value={deadline}
              min={addDays(today, 7)}
              onChange={(e) => setDeadline(e.target.value)}
              className={inputCls}
            />
            <p className="mt-3 text-[13px] text-ink-400">
              → <span className="font-bold text-ink-200">{formatJP(deadline)}</span> が締切
            </p>
          </Q>
        )}

        {step === 'time' && (
          <Q
            n={qNo}
            title="週に何時間使える？"
            lead="盛らないで。実際に確保できる時間で組まないと、初週で崩れる。"
          >
            <div className="mb-4 flex items-end gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={weeklyHours || ''}
                onChange={(e) => setWeeklyHours(Number(e.target.value) || 0)}
                className={cx(inputCls, 'text-[28px] font-extrabold tabular-nums')}
              />
              <span className="pb-4 text-[16px] font-bold text-ink-400">時間 / 週</span>
            </div>
            <div className="mb-6 flex flex-wrap gap-2">
              {HOUR_PRESETS.map((v) => (
                <Chip key={v} active={weeklyHours === v} onClick={() => setWeeklyHours(v)}>
                  {v}h
                </Chip>
              ))}
            </div>
            <Field label="週に何日やる？" hint="毎日やる必要はない。続く日数を選ぶ。">
              <div className="flex flex-wrap gap-2">
                {[3, 4, 5, 6, 7].map((d) => (
                  <Chip key={d} active={workdays === d} onClick={() => setWorkdays(d)}>
                    週{d}日
                  </Chip>
                ))}
              </div>
            </Field>
            <p className="mt-4 rounded-2xl bg-ink-850 px-4 py-3 text-[13px] text-ink-300">
              1日あたり約
              <span className="font-extrabold text-acid-400">
                {' '}
                {Math.round((weeklyHours * 60) / workdays)}分{' '}
              </span>
              の作業になる
            </p>
          </Q>
        )}

        {step === 'skills' && (
          <Q
            n={qNo}
            title="使えるスキルは？"
            lead="プロ級じゃなくていい。「やったことがある」「苦じゃない」で選んで。"
          >
            <div className="flex flex-wrap gap-2">
              {SKILL_LABELS.map((s) => (
                <Chip
                  key={s.id}
                  active={skills.includes(s.id)}
                  onClick={() => toggle(skills, s.id, setSkills)}
                >
                  {s.emoji} {s.label}
                </Chip>
              ))}
            </div>
            <p className="mt-4 text-[13px] text-ink-400">
              {skills.length === 0
                ? 'ゼロでも大丈夫。スキル不要の手段を選ぶだけ。'
                : `${skills.length}個選択中`}
            </p>
          </Q>
        )}

        {step === 'budget' && (
          <Q
            n={qNo}
            title="初期費用にいくら出せる？"
            lead="0円でも成立する手段はある。無理して張る必要はない。"
          >
            <div className="mb-4 flex items-end gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={budget === 0 ? '0' : budget}
                onChange={(e) => setBudget(Number(e.target.value) || 0)}
                className={cx(inputCls, 'text-[28px] font-extrabold tabular-nums')}
              />
              <span className="pb-4 text-[16px] font-bold text-ink-400">円</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {BUDGET_PRESETS.map((v) => (
                <Chip key={v} active={budget === v} onClick={() => setBudget(v)}>
                  {v === 0 ? '0円' : v >= 10000 ? `${v / 10000}万` : v.toLocaleString()}
                </Chip>
              ))}
            </div>
          </Q>
        )}

        {step === 'avoid' && (
          <Q
            n={qNo}
            title="やりたくないことは？"
            lead="ここ大事。無理なやり方を選ぶと100%続かない。選んだものは候補から完全に外す。"
          >
            <div className="flex flex-wrap gap-2">
              {AVOID_LABELS.map((a) => (
                <Chip
                  key={a.id}
                  tone="danger"
                  active={avoid.includes(a.id)}
                  onClick={() => toggle(avoid, a.id, setAvoid)}
                >
                  {a.label}
                </Chip>
              ))}
            </div>
            <div className="mt-6">
              <Field label="他に伝えておきたいこと（任意）">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="例：平日は夜しか動けない / 前に物販で失敗した"
                  className={inputCls}
                />
              </Field>
            </div>
          </Q>
        )}
      </div>

      <div
        className="fixed inset-x-0 bottom-0 border-t border-ink-800 bg-ink-950/95 px-5 pt-3 backdrop-blur"
        style={{ paddingBottom: 'calc(0.75rem + var(--safe-b))' }}
      >
        <Button full size="lg" onClick={next} disabled={!canNext()}>
          {step === 'welcome' ? 'はじめる' : idx === lastIdx ? '計画を作ってもらう' : '次へ'}
        </Button>
      </div>
    </div>
  );
}

function Q({
  n,
  title,
  lead,
  children,
}: {
  n: number;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <div key={n} className="animate-rise pt-3">
      <div className="text-[12px] font-extrabold tracking-[0.2em] text-acid-500">
        Q{String(n).padStart(2, '0')}
      </div>
      <h1 className="mt-2 text-[26px] leading-tight font-extrabold">{title}</h1>
      <p className="mt-2.5 mb-7 text-[14px] leading-relaxed text-ink-400">{lead}</p>
      {children}
    </div>
  );
}

function Welcome() {
  return (
    <div className="animate-rise flex min-h-[70dvh] flex-col justify-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-acid-500 text-[28px]">
        🎯
      </div>
      <h1 className="text-[32px] leading-[1.15] font-extrabold">
        先が見えなくて
        <br />
        不安なのは、
        <br />
        今日が空白だから。
      </h1>
      <p className="mt-5 text-[15px] leading-relaxed text-ink-300">
        いま何がしんどいかを選ぶだけ。
        <br />
        そこから<span className="font-bold text-acid-400">3ヶ月後の自分を1つに決めて</span>、
        <br />
        毎日やることを指示する。
      </p>
      <ul className="mt-8 space-y-3">
        {[
          ['1', '不安を目標に翻訳する', 'お金・実績・スキル・継続。何で悩んでるかで変わる'],
          ['2', '手段を1つに確定する', '選択肢は並べない。理由つきで決め切る'],
          ['3', '毎日やることを指示', '実行を記録 → 翌日の量を自動調整'],
        ].map(([n, t, d]) => (
          <li key={n} className="flex gap-3.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-ink-700 text-[12px] font-extrabold text-acid-400">
              {n}
            </span>
            <div>
              <div className="text-[15px] font-bold">{t}</div>
              <div className="text-[13px] text-ink-400">{d}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-[12.5px] leading-relaxed text-ink-500">
        記録はこの端末にだけ保存されます。登録もログインも不要。
      </p>
    </div>
  );
}
