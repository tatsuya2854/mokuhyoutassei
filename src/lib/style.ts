/** className の結合ヘルパー */
export const cx = (...v: (string | false | null | undefined)[]) => v.filter(Boolean).join(' ');

/** 入力欄の共通スタイル */
export const inputCls =
  'w-full rounded-2xl border border-ink-600 bg-ink-850 px-4 py-3.5 text-ink-100 outline-none focus:border-acid-500 placeholder:text-ink-500';
