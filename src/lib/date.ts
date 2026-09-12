/** 日付ユーティリティ（ローカルタイム基準、YYYY-MM-DD 文字列で扱う） */

export const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** a から b までの日数（b - a）。同日なら 0 */
export function diffDays(a: string, b: string): number {
  const ms = fromISO(b).getTime() - fromISO(a).getTime();
  return Math.round(ms / 86400000);
}

export function diffWeeks(a: string, b: string): number {
  return diffDays(a, b) / 7;
}

/** 月曜始まりの週キー（その週の月曜日のISO） */
export function weekKey(iso: string): string {
  const d = fromISO(iso);
  const dow = (d.getDay() + 6) % 7; // 月曜=0
  d.setDate(d.getDate() - dow);
  return toISO(d);
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function formatJP(iso: string): string {
  const d = fromISO(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
}

export function formatShort(iso: string): string {
  const d = fromISO(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** [from, to] の日付配列（両端含む）。最大 max 件 */
export function rangeDays(from: string, to: string, max = 400): string[] {
  const out: string[] = [];
  let cur = from;
  let i = 0;
  while (diffDays(cur, to) >= 0 && i < max) {
    out.push(cur);
    cur = addDays(cur, 1);
    i++;
  }
  return out;
}

export function clampISO(iso: string, min: string, max: string): string {
  if (diffDays(min, iso) < 0) return min;
  if (diffDays(iso, max) < 0) return max;
  return iso;
}
