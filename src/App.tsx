import { useEffect, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import Onboarding from './screens/Onboarding';
import Verdict from './screens/Verdict';
import Today from './screens/Today';
import Plan from './screens/Plan';
import Stats from './screens/Stats';
import LogList from './screens/LogList';
import Settings from './screens/Settings';
import Chat from './screens/Chat';
import Pricing from './screens/Pricing';
import { cx } from './lib/style';
import { IconBook, IconChart, IconChat, IconGear, IconMap, IconTarget } from './components/icons';
import { todayISO } from './lib/date';

type Tab = 'today' | 'chat' | 'plan' | 'log' | 'stats' | 'settings';

const TABS: { id: Tab; label: string; Icon: (p: { className?: string }) => React.ReactElement }[] = [
  { id: 'today', label: '今日', Icon: IconTarget },
  { id: 'chat', label: '秘書', Icon: IconChat },
  { id: 'plan', label: '計画', Icon: IconMap },
  { id: 'log', label: '記録', Icon: IconBook },
  { id: 'stats', label: '分析', Icon: IconChart },
  { id: 'settings', label: '設定', Icon: IconGear },
];

export default function App() {
  const { profile, plan, ensureDay, refreshSubscription } = useAppStore();
  const [stage, setStage] = useState<'onboarding' | 'verdict' | 'app'>(
    profile && plan ? 'app' : 'onboarding',
  );
  const [tab, setTab] = useState<Tab>('today');
  const [pricing, setPricing] = useState(false);

  // 起動時・日付またぎで当日分を用意する
  useEffect(() => {
    if (stage !== 'app' || !plan) return;
    ensureDay(todayISO());
    const id = setInterval(() => ensureDay(todayISO()), 60_000);
    return () => clearInterval(id);
  }, [stage, plan, ensureDay]);

  // 決済サーバーがある場合だけ意味を持つ。無ければ手元の状態のまま動く
  useEffect(() => {
    if (stage === 'app') void refreshSubscription();
  }, [stage, refreshSubscription]);

  if (stage === 'onboarding' && (!profile || !plan))
    return <Onboarding onDone={() => setStage('verdict')} />;

  if (stage === 'verdict') return <Verdict onConfirm={() => setStage('app')} />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <main className="flex-1">
        {tab === 'today' && <Today onUpgrade={() => setPricing(true)} />}
        {tab === 'chat' && <Chat onUpgrade={() => setPricing(true)} />}
        {tab === 'plan' && <Plan />}
        {tab === 'log' && <LogList />}
        {tab === 'stats' && <Stats />}
        {tab === 'settings' && (
          <Settings
            onUpgrade={() => setPricing(true)}
            onReset={() => {
              setStage('onboarding');
              setTab('today');
            }}
          />
        )}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-lg border-t border-ink-800 bg-ink-900/95 backdrop-blur"
        style={{ paddingBottom: 'var(--safe-b)' }}
      >
        <div className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'pressable flex flex-1 flex-col items-center gap-1 py-2.5',
                tab === t.id ? 'text-acid-400' : 'text-ink-500',
              )}
            >
              <t.Icon className="h-[21px] w-[21px]" />
              <span className="text-[10.5px] font-extrabold">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {pricing && <Pricing onClose={() => setPricing(false)} />}
    </div>
  );
}
