import { useMemo, useState } from 'react';
import type { AvoidId, GoalMode, Profile, SkillId } from '../types';
import { AVOID_LABELS, SKILL_LABELS } from '../domain/playbooks';
import { Button, Chip, Field, Progress } from '../components/ui';
import { cx, inputCls } from '../lib/style';
import { addDays, formatJP, todayISO } from '../lib/date';
import { useAppStore } from '../store/useAppStore';

const STEPS = 7;

const AMOUNT_PRESETS = [30000, 50000, 100000, 300000, 500000, 1000000];
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
  const [step, setStep] = useState(0);

  const today = todayISO();
  const [goalAmount, setGoalAmount] = useState(100000);
  const [goalMode, setGoalMode] = useState<GoalMode>('monthly');
  const [deadline, setDeadline] = useState(addDays(today, 90));
  const [weeklyHours, setWeeklyHours] = useState(10);
  const [workdays, setWorkdays] = useState(5);
  const [skills, setSkills] = useState<SkillId[]>([]);
  const [budget, setBudget] = useState(0);
  const [avoid, setAvoid] = useState<AvoidId[]>([]);
  const [note, setNote] = useState('');

  const profile: Profile = useMemo(
    () => ({
      goalAmount,
      goalMode,
      deadline,
      weeklyHours,
      workdaysPerWeek: workdays,
      skills: skills.length ? skills : ['none'],
      budget,
      avoid,
      note,
      startDate: today,
    }),
    [goalAmount, goalMode, deadline, weeklyHours, workdays, skills, budget, avoid, note, today],
  );

  const toggle = <T,>(arr: T[], v: T, set: (x: T[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const canNext = () => {
    if (step === 1) return goalAmount > 0;
    if (step === 2) return deadline > today;
    if (step === 3) return weeklyHours > 0;
    return true;
  };

  const next = () => {
    if (step === STEPS - 1) {
      start(profile);
      onDone();
    } else setStep((s) => s + 1);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-ink-950">
      {/* 進捗バー */}
      {step > 0 && (
        <div className="sticky top-0 z-10 bg-ink-950/95 px-5 pt-4 pb-3 backdrop-blur">
          <Progress value={step / (STEPS - 1)} height={4} />
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="pressable -ml-1 px-1 py-1 text-[13px] font-bold text-ink-400"
            >
              ← 戻る
            </button>
            <span className="text-[12px] font-bold text-ink-500">
              {step} / {STEPS - 1}
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 px-5 pb-40">
        {step === 0 && <Welcome />}

        {step === 1 && (
          <Q
            n="01"
            title="いくら稼ぎたい？"
            lead="ここが曖昧なままだと、何を選んでも続かない。まず金額を決め切る。"
          >
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
            <div className="mb-4 flex items-end gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={goalAmount || ''}
                onChange={(e) => setGoalAmount(Number(e.target.value) || 0)}
                className={cx(inputCls, 'text-[28px] font-extrabold tabular-nums')}
                placeholder="100000"
              />
              <span className="pb-4 text-[16px] font-bold text-ink-400">円</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {AMOUNT_PRESETS.map((v) => (
                <Chip key={v} active={goalAmount === v} onClick={() => setGoalAmount(v)}>
                  {v >= 10000 ? `${v / 10000}万` : v.toLocaleString()}
                </Chip>
              ))}
            </div>
          </Q>
        )}

        {step === 2 && (
          <Q
            n="02"
            title="いつまでに？"
            lead="期限のない目標はただの願望。日付を入れた瞬間に計画になる。"
          >
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

        {step === 3 && (
          <Q
            n="03"
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

        {step === 4 && (
          <Q
            n="04"
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

        {step === 5 && (
          <Q
            n="05"
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

        {step === 6 && (
          <Q
            n="06"
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

      {/* フッター */}
      <div
        className="fixed inset-x-0 bottom-0 border-t border-ink-800 bg-ink-950/95 px-5 pt-3 backdrop-blur"
        style={{ paddingBottom: 'calc(0.75rem + var(--safe-b))' }}
      >
        <Button full size="lg" onClick={next} disabled={!canNext()}>
          {step === 0 ? 'はじめる' : step === STEPS - 1 ? '手段を決めてもらう' : '次へ'}
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
  n: string;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <div key={n} className="animate-rise pt-3">
      <div className="text-[12px] font-extrabold tracking-[0.2em] text-acid-500">Q{n}</div>
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
        「今日何を
        <br />
        すればいいか」で
        <br />
        もう迷わない。
      </h1>
      <p className="mt-5 text-[15px] leading-relaxed text-ink-300">
        目標と条件を6問答えるだけ。
        <br />
        手段は<span className="font-bold text-acid-400">こっちが1つに決め切る</span>。
        <br />
        あとは毎日、その日やることを指示する。
      </p>
      <ul className="mt-8 space-y-3">
        {[
          ['1', '6問ヒアリング', '目標・期限・時間・スキル・予算・NG'],
          ['2', '手段を1つに確定', '選択肢は並べない。理由つきで決め切る'],
          ['3', '毎日タスクを指示', '実行を記録 → 翌日の量を自動調整'],
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
    </div>
  );
}
