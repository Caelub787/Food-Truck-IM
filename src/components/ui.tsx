import { Loader2, X } from 'lucide-react'
import { useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  busy?: boolean
  full?: boolean
}

export function Button({ variant = 'primary', busy, full, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition disabled:cursor-not-allowed',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60',
        variant === 'primary' && 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-800',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 active:bg-slate-100',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700 active:bg-red-700',
        variant === 'ghost' && 'text-brand-700 hover:bg-brand-50 active:bg-brand-50',
        full && 'w-full',
        className,
      )}
    >
      {busy && <Loader2 className="size-5 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }

export function Field({ label, hint, error, className, ...rest }: FieldProps) {
  const id = useId()
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-hint` : undefined}
        className={cx(
          'min-h-12 rounded-xl border bg-white px-3.5 text-base outline-none transition',
          'focus:border-brand-700 focus:ring-2 focus:ring-brand-100',
          error ? 'border-red-500' : 'border-slate-300',
        )}
      />
      {(error || hint) && (
        <p id={`${id}-hint`} className={cx('text-sm', error ? 'text-red-600' : 'text-slate-500')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; children: ReactNode }

export function Select({ label, hint, className, children, ...rest }: SelectProps) {
  const id = useId()
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        {...rest}
        className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
      >
        {children}
      </select>
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
    </div>
  )
}

/** A white box. Use flush for lists whose rows bring their own padding. */
export function Card({ children, className, flush }: { children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <div className={cx('rounded-2xl border border-slate-200 bg-white shadow-sm', flush ? 'overflow-hidden' : 'p-4', className)}>
      {children}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'warning' | 'error'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'rounded-xl border px-4 py-3 text-sm',
        tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-800',
      )}
    >
      {children}
    </div>
  )
}

export function Badge({ tone = 'gray', children }: { tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue'; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        tone === 'gray' && 'bg-slate-100 text-slate-700',
        tone === 'green' && 'bg-emerald-100 text-emerald-800',
        tone === 'amber' && 'bg-amber-100 text-amber-800',
        tone === 'red' && 'bg-red-100 text-red-700',
        tone === 'blue' && 'bg-sky-100 text-sky-800',
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-slate-500" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{label}…</span>
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-slate-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/** A panel that slides up from the bottom on phones and sits in the middle on bigger screens. */
export function Sheet({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-slate-900/40" aria-label="Close" onClick={onClose} />
      <div className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-md sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 active:bg-slate-100" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
