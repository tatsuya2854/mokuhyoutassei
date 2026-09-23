import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { assistant, voice } from '../assistant';
import { PLANS, requiredPlan } from '../domain/entitlements';
import type { ChatAction } from '../types';
import { Button } from '../components/ui';
import { cx, inputCls } from '../lib/style';
import { todayISO } from '../lib/date';
import { IconLock, IconMic } from '../components/icons';

const SUGGESTIONS = [
  '今日は何をやればいい？',
  '時間がない',
  '量が多い',
  'なんでこれをやるの？',
  '進捗どう？',
  '自分の癖を教えて',
];

export default function Chat({ onUpgrade }: { onUpgrade: () => void }) {
  const {
    profile,
    plan,
    chat,
    ask,
    clearChat,
    entitled,
    limit,
    chatCountToday,
    toggleTask,
    moveTask,
  } = useAppStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [speak, setSpeak] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const date = todayISO();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.length, busy]);

  useEffect(() => () => stopRef.current?.(), []);

  if (!profile || !plan) return null;

  const canChat = entitled('chatText');
  const canVoice = entitled('chatVoice');
  const perDay = limit('chatPerDay');
  const usedToday = chatCountToday();
  const outOfQuota = perDay !== Infinity && usedToday >= perDay;

  const send = async (t: string) => {
    if (!t.trim() || busy) return;
    setText('');
    setBusy(true);
    try {
      await ask(t);
      if (speak) {
        const last = useAppStore.getState().chat.at(-1);
        if (last?.role === 'assistant') voice.speak(last.text);
      }
    } finally {
      setBusy(false);
    }
  };

  const onMic = () => {
    if (listening) {
      stopRef.current?.();
      stopRef.current = null;
      setListening(false);
      return;
    }
    setListening(true);
    setPartial('');
    stopRef.current = voice.listen({
      onPartial: setPartial,
      onResult: (t) => {
        setPartial('');
        void send(t);
      },
      onError: () => setPartial(''),
      onEnd: () => {
        setListening(false);
        setPartial('');
        stopRef.current = null;
      },
    });
  };

  const runAction = (a: ChatAction) => {
    if (a.kind === 'done') toggleTask(date, a.taskId);
    else if (a.kind === 'defer') moveTask(date, a.taskId, 'defer');
    else if (a.kind === 'replan') moveTask(date, a.taskId, 'replan');
  };

  /* --- 未加入のときは、機能を隠さずに「何が開くか」を見せる --- */
  if (!canChat) {
    const need = PLANS[requiredPlan('chatText')];
    return (
      <div className="px-4 pb-32" style={{ paddingTop: 'calc(1rem + var(--safe-t))' }}>
        <div className="card border-ink-700 p-5 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-ink-700 text-ink-300">
            <IconLock className="h-5 w-5" />
          </span>
          <h2 className="mt-3 text-[17px] font-extrabold">AI秘書と話す</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-400">
            「時間がない」「量が多い」と打つだけで、今日のぶんを組み直す。
            何をやめて何を残すかを、毎回こっちが決める。
          </p>
          <div className="mt-4 rounded-xl bg-ink-800 px-4 py-3 text-left">
            {SUGGESTIONS.slice(0, 4).map((s) => (
              <div key={s} className="py-1 text-[12.5px] text-ink-300">
                「{s}」
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Button full size="lg" onClick={onUpgrade}>
              {need.name}で開放する
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col px-4 pb-44" style={{ paddingTop: 'calc(1rem + var(--safe-t))' }}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[16px] font-extrabold">AI秘書</div>
          <div className="text-[11px] font-bold text-ink-500">
            {assistant.id === 'local-rules' ? '端末内で処理・外部送信なし' : '接続中'}
            {perDay !== Infinity && ` ・今日 ${usedToday}/${perDay}回`}
          </div>
        </div>
        <div className="flex gap-1.5">
          {canVoice && (
            <button
              onClick={() => {
                if (speak) voice.stopSpeaking();
                setSpeak((v) => !v);
              }}
              className={cx(
                'pressable rounded-lg px-2.5 py-1.5 text-[11.5px] font-extrabold',
                speak ? 'bg-acid-500/20 text-acid-400' : 'bg-ink-800 text-ink-400',
              )}
            >
              読み上げ{speak ? 'ON' : 'OFF'}
            </button>
          )}
          {chat.length > 0 && (
            <button
              onClick={clearChat}
              className="pressable rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11.5px] font-bold text-ink-500"
            >
              消す
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3">
        {chat.length === 0 && (
          <div className="card border-ink-700 p-4">
            <p className="text-[13.5px] leading-relaxed text-ink-300">
              今日のことなら何でも。状況は全部こっちが見てる。
              <br />
              迷ったら「今日は何をやればいい？」でいい。
            </p>
          </div>
        )}

        {chat.map((m) => (
          <div key={m.id} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cx(
                'max-w-[85%] rounded-2xl px-3.5 py-2.5',
                m.role === 'user'
                  ? 'bg-acid-500 text-ink-950'
                  : 'border border-ink-700 bg-ink-850 text-ink-100',
              )}
            >
              <p className="text-[13.5px] leading-relaxed whitespace-pre-line">{m.text}</p>
              {m.actions && m.actions.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-ink-700 pt-2.5">
                  {m.actions.map((a, i) => (
                    <button
                      key={i}
                      onClick={() => runAction(a)}
                      className="pressable rounded-lg bg-ink-700 px-2.5 py-1.5 text-left text-[11.5px] font-extrabold text-ink-100"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-ink-700 bg-ink-850 px-3.5 py-2.5 text-[13px] text-ink-500">
              考えてる…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* 入口を作る。空欄を見せるより、押せる文を並べた方が動き出す */}
      {chat.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="pressable rounded-full border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12px] font-bold text-ink-300"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {outOfQuota ? (
        <button
          onClick={onUpgrade}
          className="pressable mt-4 w-full rounded-2xl border border-ink-700 bg-ink-850 px-4 py-3.5 text-[12.5px] font-bold text-ink-300"
        >
          今日のぶんの{perDay}回を使い切った。Proにすると無制限になる。
        </button>
      ) : (
        <div
          className="fixed inset-x-0 z-30 mx-auto max-w-lg px-4"
          style={{ bottom: 'calc(4.6rem + var(--safe-b))' }}
        >
          <div className="flex items-end gap-2 rounded-2xl border border-ink-700 bg-ink-900/95 p-2 backdrop-blur">
            <textarea
              rows={1}
              value={listening && partial ? partial : text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              placeholder={listening ? '聞いてる…' : '今日のことを書く'}
              className={cx(inputCls, 'max-h-28 min-h-[46px] resize-none py-3')}
            />
            {canVoice && voice.supported && (
              <button
                onClick={onMic}
                aria-label="音声で話す"
                className={cx(
                  'pressable flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl',
                  listening ? 'animate-pop bg-flame-500 text-ink-950' : 'bg-ink-700 text-ink-200',
                )}
              >
                <IconMic className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={() => send(text)}
              disabled={!text.trim() || busy}
              className="pressable flex h-[46px] shrink-0 items-center rounded-xl bg-acid-500 px-4 text-[13px] font-extrabold text-ink-950 disabled:opacity-30"
            >
              送る
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
