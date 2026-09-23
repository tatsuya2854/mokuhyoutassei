/**
 * 音声の差し込み口。
 *
 * 特定のサービスに固定しない。既定はブラウザ内蔵（Web Speech API）で、
 * 鍵もサーバーもいらない。精度が欲しくなったら、同じ形の実装を足して
 * `voice` の中身を入れ替えるだけでいい。その場合も鍵はサーバーに置く。
 */

export interface VoicePort {
  readonly id: string;
  /** この端末で使えるか */
  readonly supported: boolean;
  /** 聞き取りを始める。戻り値を呼ぶと中断できる */
  listen(handlers: ListenHandlers): () => void;
  /** 読み上げる */
  speak(text: string): void;
  /** 読み上げを止める */
  stopSpeaking(): void;
}

export interface ListenHandlers {
  /** 途中経過（確定前） */
  onPartial?: (text: string) => void;
  /** 確定したテキスト */
  onResult: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

/* ブラウザの型定義に無いので、必要な形だけ最小限で持つ */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechResultEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const hasSynth = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export const webSpeechVoice: VoicePort = {
  id: 'web-speech',
  get supported() {
    return recognitionCtor() !== null;
  },

  listen({ onPartial, onResult, onError, onEnd }: ListenHandlers) {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      onError?.('この端末は音声入力に対応していない');
      onEnd?.();
      return () => {};
    }
    const rec = new Ctor();
    rec.lang = 'ja-JP';
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let finalText = '';
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) finalText += text;
        else partial += text;
      }
      if (partial) onPartial?.(partial);
      if (finalText) onResult(finalText.trim());
    };
    rec.onerror = (e) => onError?.(e.error ?? '聞き取れなかった');
    rec.onend = () => onEnd?.();

    try {
      rec.start();
    } catch {
      onError?.('マイクを起動できなかった');
      onEnd?.();
    }
    return () => rec.abort();
  },

  speak(text: string) {
    if (!hasSynth()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  },

  stopSpeaking() {
    if (hasSynth()) window.speechSynthesis.cancel();
  },
};

/** アプリからはこれしか見えない。差し替えはこの1行 */
export const voice: VoicePort = webSpeechVoice;
