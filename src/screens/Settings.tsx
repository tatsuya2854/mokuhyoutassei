import { useRef, useState } from 'react';
import { exportState, useAppStore } from '../store/useAppStore';
import { PLAYBOOKS, getPlaybook } from '../domain/playbooks';
import { Button, Card, Field, SectionTitle } from '../components/ui';
import { cx, inputCls } from '../lib/style';
import { Sheet } from './Today';
import { formatJP } from '../lib/date';

export default function Settings({ onReset }: { onReset: () => void }) {
  const { profile, plan, decision, updateProfile, switchPlaybook, reset, importState } =
    useAppStore();
  const [sheet, setSheet] = useState<'none' | 'edit' | 'switch' | 'danger'>('none');
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState(String(profile?.goalAmount ?? ''));
  const [deadline, setDeadline] = useState(profile?.deadline ?? '');
  const [hours, setHours] = useState(String(profile?.weeklyHours ?? ''));
  const [days, setDays] = useState(String(profile?.workdaysPerWeek ?? ''));

  if (!profile || !plan || !decision) return null;
  const pb = getPlaybook(plan.playbookId);

  const download = () => {
    const blob = new Blob([exportState()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yarukoto-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('バックアップを書き出した');
  };

  const onFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const ok = importState(String(reader.result));
      setMsg(ok ? '読み込んだ' : 'ファイルが壊れてる');
    };
    reader.readAsText(f);
  };

  return (
    <div className="px-4 pt-5 pb-28">
      <h1 className="text-[22px] font-extrabold">設定</h1>

      <div className="mt-5">
        <SectionTitle>いまの条件</SectionTitle>
        <Card>
          <Row label="手段" value={pb.name} />
          <Row
            label="目標"
            value={`${profile.goalAmount.toLocaleString()}円 ${profile.goalMode === 'monthly' ? '/ 月' : '（合計）'}`}
          />
          <Row label="期限" value={formatJP(profile.deadline)} />
          <Row label="時間" value={`週${profile.weeklyHours}時間 / 週${profile.workdaysPerWeek}日`} />
          <Row label="1日の量" value={`${plan.dailyMinutes}分（自動調整中）`} last />
        </Card>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => setSheet('edit')}>
            条件を変える
          </Button>
          <Button variant="ghost" onClick={() => setSheet('switch')}>
            手段を変える
          </Button>
        </div>
      </div>

      <div className="mt-7">
        <SectionTitle>データ</SectionTitle>
        <Card>
          <p className="text-[13px] leading-relaxed text-ink-400">
            記録はこの端末のブラウザだけに保存される。サーバーには何も送らない。端末を変えるときは書き出して移す。
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="soft" size="sm" onClick={download}>
              書き出す
            </Button>
            <Button variant="soft" size="sm" onClick={() => fileRef.current?.click()}>
              読み込む
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
          {msg && <p className="mt-2.5 text-[12px] font-bold text-acid-400">{msg}</p>}
        </Card>
      </div>

      <div className="mt-7">
        <SectionTitle>やり直す</SectionTitle>
        <Card className="border-flame-500/25">
          <p className="text-[13px] leading-relaxed text-ink-400">
            全部消してヒアリングからやり直す。記録も消える。
          </p>
          <div className="mt-3">
            <Button variant="danger" size="sm" onClick={() => setSheet('danger')}>
              最初からやり直す
            </Button>
          </div>
        </Card>
      </div>

      <p className="mt-8 text-center text-[11px] text-ink-600">ヤルコト v1.0</p>

      {sheet === 'edit' && (
        <Sheet onClose={() => setSheet('none')} title="条件を変える">
          <div className="space-y-4">
            <Field label="目標金額（円）">
              <input
                type="number"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="期限">
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="週の時間">
                <input
                  type="number"
                  inputMode="numeric"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="週の稼働日">
                <input
                  type="number"
                  inputMode="numeric"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
            <p className="text-[12px] leading-relaxed text-ink-400">
              条件を緩めるのは逃げじゃない。達成できない計画を抱え続ける方が損。
            </p>
            <Button
              full
              size="lg"
              onClick={() => {
                updateProfile({
                  goalAmount: Number(amount) || profile.goalAmount,
                  deadline,
                  weeklyHours: Number(hours) || profile.weeklyHours,
                  workdaysPerWeek: Math.min(7, Math.max(1, Number(days) || profile.workdaysPerWeek)),
                });
                setSheet('none');
              }}
            >
              更新する
            </Button>
          </div>
        </Sheet>
      )}

      {sheet === 'switch' && (
        <Sheet onClose={() => setSheet('none')} title="手段を変える">
          <p className="mb-4 text-[13px] leading-relaxed text-ink-400">
            変えると計画は作り直しになる（記録は残る）。乗り換え続けるのが一番時間を溶かすから、変えるなら最後にして。
          </p>
          <div className="space-y-1.5">
            {PLAYBOOKS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  switchPlaybook(p.id);
                  setSheet('none');
                }}
                className={cx(
                  'pressable w-full rounded-2xl border px-4 py-3 text-left',
                  p.id === plan.playbookId
                    ? 'border-acid-500 bg-acid-500/10'
                    : 'border-ink-700',
                )}
              >
                <div className="text-[14.5px] font-bold">{p.name}</div>
                <div className="mt-0.5 text-[12px] text-ink-400">{p.tagline}</div>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {sheet === 'danger' && (
        <Sheet onClose={() => setSheet('none')} title="本当に消す？">
          <p className="text-[13.5px] leading-relaxed text-ink-300">
            計画も記録も全部消える。戻せない。心配なら先に「書き出す」でバックアップを取って。
          </p>
          <div className="mt-5 space-y-2">
            <Button
              full
              variant="danger"
              size="lg"
              onClick={() => {
                reset();
                setSheet('none');
                onReset();
              }}
            >
              消してやり直す
            </Button>
            <Button full variant="ghost" onClick={() => setSheet('none')}>
              やめる
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className={cx(
        'flex items-center justify-between py-2.5',
        !last && 'border-b border-ink-700',
      )}
    >
      <span className="text-[13px] font-bold text-ink-400">{label}</span>
      <span className="text-[13.5px] font-bold">{value}</span>
    </div>
  );
}
