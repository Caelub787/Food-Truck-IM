import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from './ui'

export type Column<T> = { label: string; cell: (row: T) => ReactNode; className?: string }

/**
 * A list that shows as tappable cards on phones and as a table on bigger
 * screens. Rows open with onSelect.
 */
export function ResponsiveList<T>({
  rows,
  rowKey,
  title,
  subtitle,
  badge,
  columns,
  onSelect,
  actionLabel = 'Edit',
  dimmed,
}: {
  rows: T[]
  rowKey: (row: T) => string
  title: (row: T) => ReactNode
  subtitle?: (row: T) => ReactNode
  badge?: (row: T) => ReactNode
  columns: Column<T>[]
  onSelect?: (row: T) => void
  actionLabel?: string
  dimmed?: (row: T) => boolean
}) {
  return (
    <>
      <Card flush className="divide-y divide-slate-100 md:hidden">
        {rows.map((row) => {
          const content = (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{title(row)}</p>
                {subtitle && <div className="truncate text-sm text-slate-500">{subtitle(row)}</div>}
              </div>
              {badge?.(row)}
              {onSelect && <ChevronRight className="size-5 shrink-0 text-slate-300" aria-hidden />}
            </>
          )
          const className = `flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left ${dimmed?.(row) ? 'opacity-60' : ''}`
          return onSelect ? (
            <button key={rowKey(row)} onClick={() => onSelect(row)} className={`${className} active:bg-slate-50`}>
              {content}
            </button>
          ) : (
            <div key={rowKey(row)} className={className}>
              {content}
            </div>
          )
        })}
      </Card>

      <Card flush className="hidden md:block">
        {/* relative keeps hidden screen reader labels inside the scroll box */}
        <div className="relative overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-slate-200 bg-slate-50 text-sm text-slate-500">
              <tr>
                {columns.map((c) => (
                  <th key={c.label} className={`px-4 py-3 font-medium ${c.className ?? ''}`}>
                    {c.label}
                  </th>
                ))}
                {onSelect && (
                  <th className="px-4 py-3">
                    <span className="sr-only">{actionLabel}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onSelect ? () => onSelect(row) : undefined}
                  className={`${onSelect ? 'cursor-pointer hover:bg-slate-50' : ''} transition ${dimmed?.(row) ? 'text-slate-400' : ''}`}
                >
                  {columns.map((c) => (
                    <td key={c.label} className={`px-4 py-3 ${c.className ?? ''}`}>
                      {c.cell(row)}
                    </td>
                  ))}
                  {onSelect && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelect(row)
                        }}
                        className="rounded-lg px-3 py-1.5 font-medium text-brand-700 hover:bg-brand-50"
                      >
                        {actionLabel}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
