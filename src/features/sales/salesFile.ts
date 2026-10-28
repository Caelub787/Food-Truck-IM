// Reading sales files from any register or POS (Square exports work out of the
// box). People pick which column is which once, and the app remembers.

export const fields = ['date', 'time', 'item', 'size', 'modifiers', 'quantity', 'price', 'order', 'truck', 'event'] as const
export type Field = (typeof fields)[number]
export type Columns = Partial<Record<Field, number>>

export const fieldLabels: Record<Field, string> = {
  date: 'Date (or date and time)',
  time: 'Time',
  item: 'Item name',
  size: 'Size or variation',
  modifiers: 'Add ons (modifiers)',
  quantity: 'Quantity',
  price: 'Amount paid (net sales)',
  order: 'Order or transaction id',
  truck: 'Truck or location',
  event: 'Payment or refund',
}

// Header names to look for, best first. Square's "Item Sales" export is covered.
const guesses: Record<Field, RegExp[]> = {
  date: [/^date$/, /^(sale|order|transaction|created) ?date/, /date/],
  time: [/^time$/, /^(sale|order) time/],
  item: [/^item$/, /^item ?name$/, /^product( name)?$/, /^name$/, /description/],
  size: [/price point/, /variation/, /^size$/],
  modifiers: [/modifiers? applied/, /modifier/, /add ?ons?/, /options/],
  quantity: [/^qty$/, /^quantity$/, /^count$/, /qty|quantity/],
  price: [/^net sales$/, /^net (total|amount)$/, /^net$/, /^gross sales$/, /^(line )?total$/, /^amount$/, /^price$/],
  order: [/^transaction id$/, /^order (id|number)$/, /^order$/, /receipt|ticket/],
  truck: [/^location$/, /truck/, /^device name$/, /^device$/],
  event: [/^event type$/],
}

export function guessColumns(headers: string[]): Columns {
  const lower = headers.map((h) => h.trim().toLowerCase())
  const used = new Set<number>()
  const out: Columns = {}
  for (const field of fields) {
    for (const pattern of guesses[field]) {
      const i = lower.findIndex((h, idx) => !used.has(idx) && pattern.test(h))
      if (i >= 0) {
        out[field] = i
        used.add(i)
        break
      }
    }
  }
  return out
}

/** Recognizes the same kind of file next time. */
export const headersKey = (headers: string[]) => headers.map((h) => h.trim().toLowerCase()).join('|')

/** "$1,234.50" → 1234.5, "(4.00)" → -4, "" → null */
export function parseMoney(text: string | undefined): number | null {
  if (!text) return null
  const t = text.trim()
  if (!t) return null
  const negative = /^\(.*\)$/.test(t) || t.startsWith('-')
  const n = Number(t.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * A sale's time from a date cell and maybe a time cell. Times with a time zone
 * come back as an exact moment (at). Plain times come back as local time
 * (local), read in the business's time zone by the database.
 */
export function parseWhen(dateText: string | undefined, timeText?: string): { at?: string; local?: string } | null {
  const d = (dateText ?? '').trim()
  if (!d) return null
  // Already exact, like 2026-10-28T14:05:00Z or 2026-10-28T14:05:00-05:00.
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(d)) {
    const at = new Date(d)
    return Number.isNaN(at.getTime()) ? null : { at: at.toISOString() }
  }
  const [datePart, ...rest] = d.split(/[ T]+/)
  let y: number, m: number, day: number
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(datePart!)
  if (match) [y, m, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(datePart!))) {
    ;[m, day, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
    if (y < 100) y += 2000
  } else return null
  if (m < 1 || m > 12 || day < 1 || day > 31) return null

  const t = (timeText?.trim() || rest.join(' ')).trim()
  let hh = 12
  let mm = 0
  let ss = 0
  if (t) {
    const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(t)
    if (!tm) return null
    hh = Number(tm[1])
    mm = Number(tm[2])
    ss = Number(tm[3] ?? 0)
    const ampm = tm[4]?.toLowerCase().replace(/\./g, '')
    if (ampm === 'pm' && hh < 12) hh += 12
    if (ampm === 'am' && hh === 12) hh = 0
  }
  return { local: `${y}-${pad(m)}-${pad(day)} ${pad(hh)}:${pad(mm)}:${pad(ss)}` }
}

/** "Oat Milk, Extra Shot" → ["Oat Milk", "Extra Shot"] */
export function splitModifiers(text: string | undefined) {
  return (text ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** How an item is matched: name and size together, lowercased. */
export function itemKey(item: string, size?: string) {
  const i = item.trim()
  const s = (size ?? '').trim()
  return (s && s.toLowerCase() !== 'regular' ? `${i} · ${s}` : i).toLowerCase()
}
export function itemName(item: string, size?: string) {
  const s = (size ?? '').trim()
  return s && s.toLowerCase() !== 'regular' ? `${item.trim()} · ${s}` : item.trim()
}

export type FileRow = {
  ref: string
  sold_at?: string
  sold_local?: string
  item_key: string
  item_name: string
  modifier_keys: string[]
  quantity: number
  price: number | null
  is_free: boolean
  truck_key?: string
}

/**
 * Turns file rows into sales. Each sale gets an id made from the file itself,
 * so uploading the same file twice never counts anything twice.
 */
export function buildRows(rows: string[][], columns: Columns) {
  const out: FileRow[] = []
  const skipped: { line: number; why: string }[] = []
  const seen = new Map<string, number>()
  const cell = (r: string[], f: Field) => (columns[f] === undefined ? '' : (r[columns[f]!] ?? '').trim())

  rows.forEach((r, i) => {
    const line = i + 2 // the header is line 1
    if (/refund|void/i.test(cell(r, 'event'))) return skipped.push({ line, why: 'refund' })
    const item = cell(r, 'item')
    if (!item) return skipped.push({ line, why: 'no item' })
    const when = parseWhen(cell(r, 'date'), columns.time === undefined ? undefined : cell(r, 'time'))
    if (!when) return skipped.push({ line, why: 'no date' })
    const qtyText = cell(r, 'quantity')
    const quantity = qtyText ? Number(qtyText.replace(/[^0-9.-]/g, '')) : 1
    if (!Number.isFinite(quantity) || quantity <= 0) return skipped.push({ line, why: 'refund' })
    const price = columns.price === undefined ? null : parseMoney(cell(r, 'price'))
    const size = cell(r, 'size')
    const mods = splitModifiers(cell(r, 'modifiers'))
    const key = itemKey(item, size)
    const base = cell(r, 'order')
      ? `${cell(r, 'order')}:${key}:${mods.join(',').toLowerCase()}`
      : `${when.at ?? when.local}|${key}|${mods.join(',').toLowerCase()}|${quantity}|${price ?? ''}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    out.push({
      ref: `${base}#${n}`.slice(0, 300),
      sold_at: when.at,
      sold_local: when.local,
      item_key: key,
      item_name: itemName(item, size),
      modifier_keys: mods.map((m) => m.toLowerCase()),
      quantity,
      price,
      is_free: price !== null && price === 0,
      truck_key: cell(r, 'truck') || undefined,
    })
  })
  return { rows: out, skipped }
}
