import type { ReactNode } from 'react';
import { cx } from '../lib/style';

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  full,
  size = 'md',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'soft';
  disabled?: boolean;
  full?: boolean;
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
}) {
  const base =
    'pressable inline-flex items-center justify-center gap-2 rounded-2xl font-bold disabled:opacity-35 disabled:pointer-events-none';
  const sizes = {
    sm: 'px-3 py-2 text-[13px]',
    md: 'px-4 py-3 text-[15px]',
    lg: 'px-5 py-4 text-[16px]',
  }[size];
  const variants = {
    primary: 'bg-acid-500 text-ink-950 active:bg-acid-600',
    soft: 'bg-ink-700 text-ink-100 active:bg-ink-600',
    ghost: 'border border-ink-600 text-ink-200 active:bg-ink-800',
    danger: 'bg-flame-500/15 text-flame-400 border border-flame-500/30',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(base, sizes, variants, full && 'w-full')}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cx('card p-4', onClick && 'pressable cursor-pointer', className)}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between px-1">
      <h2 className="text-[13px] font-bold tracking-wider text-ink-400">{children}</h2>
      {right}
    </div>
  );
}

export function Progress({
  value,
  color = 'acid',
  height = 8,
  marker,
}: {
  value: number;
  color?: 'acid' | 'flame' | 'amber';
  height?: number;
  marker?: number;
}) {
  const c = { acid: 'bg-acid-500', flame: 'bg-flame-500', amber: 'bg-amberx-400' }[color];
  return (
    <div
      className="relative w-full overflow-hidden rounded-full bg-ink-700"
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cx('h-full rounded-full transition-[width] duration-500', c)}
        style={{ width: `${Math.min(Math.max(value, 0), 1) * 100}%` }}
      />
      {marker !== undefined && (
        <div
          className="absolute top-0 h-full w-0.5 bg-ink-200/70"
          style={{ left: `${Math.min(Math.max(marker, 0), 1) * 100}%` }}
        />
      )}
    </div>
  );
}

export function Chip({
  children,
  active,
  onClick,
  tone = 'default',
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  tone?: 'default' | 'danger';
}) {
  const activeCls =
    tone === 'danger'
      ? 'border-flame-500 bg-flame-500/15 text-flame-400'
      : 'border-acid-500 bg-acid-500/15 text-acid-400';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'pressable rounded-full border px-3.5 py-2 text-[14px] font-semibold',
        active ? activeCls : 'border-ink-600 text-ink-300',
      )}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[14px] font-bold text-ink-200">{label}</span>
      {hint && <span className="mb-2 block text-[12px] leading-relaxed text-ink-400">{hint}</span>}
      {children}
    </label>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'good' | 'bad';
}) {
  const c = { default: 'text-ink-100', good: 'text-acid-400', bad: 'text-flame-400' }[tone];
  return (
    <div className="card px-3.5 py-3">
      <div className="text-[11px] font-bold tracking-wide text-ink-400">{label}</div>
      <div className={cx('mt-1 text-[20px] leading-tight font-extrabold tabular-nums', c)}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-400">{sub}</div>}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="card px-5 py-10 text-center">
      <div className="text-[15px] font-bold text-ink-200">{title}</div>
      <div className="mt-2 text-[13px] leading-relaxed text-ink-400">{body}</div>
    </div>
  );
}
