import { ChevronLeft } from 'lucide-react'
import { Link } from 'react-router'

export function BackLink({ to = '/setup', label = 'Setup' }: { to?: string; label?: string }) {
  return (
    <Link to={to} className="mb-3 inline-flex min-h-10 items-center gap-1 rounded-lg pr-2 font-medium text-brand-700 hover:bg-brand-50">
      <ChevronLeft className="size-5" aria-hidden /> {label}
    </Link>
  )
}
