import { Package } from 'lucide-react'

const sizes = { sm: 'size-10', md: 'size-14', lg: 'size-24' }

/** A supply's picture, or a plain box when it has none (or it's still loading). */
export function SupplyPhoto({ url, size = 'sm' }: { url?: string | null; size?: keyof typeof sizes }) {
  const box = `${sizes[size]} shrink-0 rounded-lg bg-slate-100`
  if (url) return <img src={url} alt="" loading="lazy" className={`${box} object-cover`} />
  return (
    <span aria-hidden className={`${box} grid place-items-center text-slate-300`}>
      <Package className="size-1/2" />
    </span>
  )
}
