import { ImageIcon } from 'lucide-react'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge } from '@/components/ui'
import { usePeopleNames } from '@/features/inventory/data'
import type { Named } from '@/features/setup/data'
import type { WasteLog } from '@/features/shifts/data'
import { useRows } from '@/lib/data'
import { usePhotoUrl } from '@/lib/photos'
import { formatMoney } from '@/lib/units'
import { useWasteLabel } from './useWasteLabel'

export function WasteList({ rows, showCost, placeName }: { rows: WasteLog[]; showCost: boolean; placeName?: (id: string) => string }) {
  const label = useWasteLabel()
  const who = usePeopleNames()
  const reasons = useRows<Named>('waste_reasons', { order: 'sort,name' })
  const reason = (w: WasteLog) => reasons.data?.find((r) => r.id === w.reason_id)?.name ?? 'No reason'
  const when = (w: WasteLog) => new Date(w.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  return (
    <ResponsiveList
      rows={rows}
      rowKey={(w) => w.id}
      title={label}
      subtitle={(w) => [reason(w), placeName?.(w.place_id), who(w.created_by), when(w)].filter(Boolean).join(' · ')}
      badge={(w) => (
        <span className="flex items-center gap-2">
          {w.photo_path && <PhotoLink path={w.photo_path} />}
          {showCost && <Badge tone="red">{formatMoney(Number(w.cost))}</Badge>}
        </span>
      )}
      columns={[
        { label: 'When', cell: when, className: 'whitespace-nowrap' },
        { label: 'What', cell: (w) => <span className="font-medium">{label(w)}</span> },
        { label: 'Why', cell: (w) => [reason(w), w.note].filter(Boolean).join(': ') },
        ...(placeName ? [{ label: 'Where', cell: (w: WasteLog) => placeName(w.place_id) }] : []),
        { label: 'Who', cell: (w) => who(w.created_by) },
        ...(showCost ? [{ label: 'Cost', cell: (w: WasteLog) => formatMoney(Number(w.cost)) }] : []),
        { label: 'Photo', cell: (w) => (w.photo_path ? <PhotoLink path={w.photo_path} /> : null) },
      ]}
    />
  )
}

function PhotoLink({ path }: { path: string }) {
  const url = usePhotoUrl(path)
  if (!url.data) return <ImageIcon className="size-5 text-slate-300" aria-label="Photo loading" />
  return (
    <a href={url.data} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block">
      <img src={url.data} alt="Waste photo" className="size-10 rounded-lg object-cover" />
    </a>
  )
}
