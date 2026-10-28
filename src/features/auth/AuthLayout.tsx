import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { APP_NAME } from '@/lib/config'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-8 md:my-12 md:min-h-0 md:rounded-3xl md:border md:border-slate-200 md:bg-white md:p-10 md:shadow-sm">
      <Link to="/" className="mb-8 flex items-center gap-2 self-start">
        <img src="/favicon.svg" alt="" className="size-9" />
        <span className="text-lg font-bold text-brand-700">{APP_NAME}</span>
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <div className="mt-2 text-slate-600">{subtitle}</div>}
      <div className="mt-6">{children}</div>
    </div>
  )
}
