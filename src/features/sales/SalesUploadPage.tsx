import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FileUp } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button, Card, Notice, PageHeader, Select, Spinner } from '@/components/ui'
import { BackLink } from '@/features/setup/BackLink'
import { useModifiers, useProducts, useProductSizes, useTrucks } from '@/features/setup/data'
import { parseCsv } from '@/lib/csv'
import { refreshTables } from '@/lib/live'
import { rpc, supabase } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { useFileFormats, useItemMappings, type ItemMapping } from './data'
import { buildRows, fieldLabels, fields, guessColumns, headersKey, type Columns, type Field } from './salesFile'
import { useDrinkLabel } from './useDrinkLabel'

type Choice = { id: string | null; ignore: boolean } // id is a product size, add on, or truck
type Kind = ItemMapping['kind']
type Result = { added: number; duplicates: number; ignored: number; unmatched: number; no_shift: number; unmatched_names: string[] }

const IGNORE = '__ignore'
const BATCH = 400

/**
 * Upload a sales file from any register. Pick which column is which (once),
 * match item names to drinks (once), then import. The same file twice never
 * counts anything twice, and a whole upload can be undone from the Sales page.
 */
export function SalesUploadPage() {
  const queryClient = useQueryClient()
  const formats = useFileFormats()
  const mappings = useItemMappings()
  const trucks = useTrucks()
  const sizes = useProductSizes()
  const products = useProducts()
  const modifiers = useModifiers()
  const drink = useDrinkLabel()
  const [fileName, setFileName] = useState('')
  const [table, setTable] = useState<string[][] | null>(null)
  const [columns, setColumns] = useState<Columns>({})
  const [truckId, setTruckId] = useState('')
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [result, setResult] = useState<Result | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  const headers = table?.[0] ?? []
  const body = table?.slice(1) ?? []
  const built = table ? buildRows(body, columns) : { rows: [], skipped: [] }
  const activeTrucks = (trucks.data ?? []).filter((t) => t.active)
  const sizeOptions = (sizes.data ?? [])
    .filter((s) => s.active && products.data?.find((p) => p.id === s.product_id)?.active)
    .map((s) => ({ id: s.id, label: drink.size(s.id) }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const readFile = async (file: File | undefined) => {
    if (!file) return
    const rows = parseCsv(await file.text())
    setFileName(file.name)
    setTable(rows)
    setResult(null)
    setChoices({})
    const saved = formats.data?.find((f) => f.headers_key === headersKey(rows[0] ?? []))
    setColumns(saved ? (saved.columns as Columns) : guessColumns(rows[0] ?? []))
    if (saved?.columns.truck_id) setTruckId(String(saved.columns.truck_id))
  }

  // Remembered matches, then a best guess by name.
  const saved = (kind: Kind, key: string) => mappings.data?.find((m) => m.source === 'csv' && m.kind === kind && m.outside_key === key)
  const guess = (kind: Kind, name: string): string | null => {
    const n = name.toLowerCase().replace(/ · /g, ' ')
    if (kind === 'item') {
      const exact = sizeOptions.find((o) => o.label.toLowerCase() === n)
      if (exact) return exact.id
      // "Latte · Large" or "Large Latte" either way around.
      for (const s of sizes.data ?? []) {
        const p = products.data?.find((x) => x.id === s.product_id)
        if (!p) continue
        const a = `${p.name} ${s.name}`.toLowerCase()
        const b = `${s.name} ${p.name}`.toLowerCase()
        if (n === a || n === b) return s.id
        if (n === p.name.toLowerCase() && (sizes.data ?? []).filter((x) => x.product_id === p.id).length === 1) return s.id
      }
      return null
    }
    if (kind === 'modifier') return modifiers.data?.find((m) => m.name.toLowerCase() === n)?.id ?? null
    return activeTrucks.find((t) => t.name.toLowerCase() === n)?.id ?? null
  }
  const choiceFor = (kind: Kind, key: string, name: string): Choice => {
    const local = choices[`${kind}:${key}`]
    if (local) return local
    const m = saved(kind, key)
    if (m) return { id: m.product_size_id ?? m.modifier_id ?? m.truck_id, ignore: m.ignore }
    return { id: guess(kind, name), ignore: false }
  }

  // Everything in the file that needs a match.
  const distinct = (kind: Kind) => {
    const map = new Map<string, { name: string; count: number }>()
    for (const r of built.rows) {
      const entries: [string, string][] =
        kind === 'item'
          ? [[r.item_key, r.item_name]]
          : kind === 'modifier'
            ? r.modifier_keys.map((k) => [k, k])
            : r.truck_key
              ? [[r.truck_key.toLowerCase(), r.truck_key]]
              : []
      for (const [key, name] of entries) {
        const e = map.get(key) ?? { name, count: 0 }
        e.count++
        map.set(key, e)
      }
    }
    return [...map.entries()].map(([key, v]) => ({ key, ...v, choice: choiceFor(kind, key, v.name) }))
  }
  const items = distinct('item')
  const mods = distinct('modifier')
  const truckValues = columns.truck !== undefined ? distinct('truck') : []
  const unresolved = items.filter((i) => !i.choice.id && !i.choice.ignore).length

  const runImport = useAction(async () => {
    if (columns.truck === undefined && !truckId) throw new Error('Pick which truck these sales are from.')
    const changed: Record<string, unknown>[] = []
    for (const [kind, list] of [
      ['item', items],
      ['modifier', mods],
      ['truck', truckValues],
    ] as const) {
      for (const e of list) {
        if (!e.choice.id && !e.choice.ignore) continue
        const m = saved(kind, e.key)
        const same = m && m.ignore === e.choice.ignore && (m.product_size_id ?? m.modifier_id ?? m.truck_id) === e.choice.id
        if (same) continue
        changed.push({
          kind,
          outside_key: e.key,
          outside_name: e.name,
          ignore: e.choice.ignore,
          product_size_id: kind === 'item' ? e.choice.id : null,
          modifier_id: kind === 'modifier' ? e.choice.id : null,
          truck_id: kind === 'truck' ? e.choice.id : null,
        })
      }
    }
    // Remember the columns for next time.
    await supabase
      .from('sales_file_formats')
      .upsert({ headers_key: headersKey(headers), columns: { ...columns, truck_id: truckId || null } }, { onConflict: 'company_id,headers_key' })

    const importId = crypto.randomUUID()
    const total: Result = { added: 0, duplicates: 0, ignored: 0, unmatched: 0, no_shift: 0, unmatched_names: [] }
    for (let i = 0; i < built.rows.length; i += BATCH) {
      setProgress(`Sending ${Math.min(i + BATCH, built.rows.length)} of ${built.rows.length}…`)
      const r = await rpc<Result>('ingest_sales', {
        p: { import_id: importId, file_name: fileName, truck_id: truckId || null, mappings: i === 0 ? changed : [], rows: built.rows.slice(i, i + BATCH) },
      })
      total.added += r.added
      total.duplicates += r.duplicates
      total.ignored += r.ignored
      total.unmatched += r.unmatched
      total.no_shift += r.no_shift
      total.unmatched_names = [...new Set([...total.unmatched_names, ...r.unmatched_names])]
    }
    setProgress(null)
    await refreshTables(queryClient, ['sales', 'sales_imports', 'item_mappings', 'sales_file_formats', 'shift_results', 'flags'])
    setResult(total)
  })

  const setChoice = (kind: Kind, key: string, value: string) =>
    setChoices({ ...choices, [`${kind}:${key}`]: value === IGNORE ? { id: null, ignore: true } : { id: value || null, ignore: false } })

  if (formats.isLoading || mappings.isLoading || trucks.isLoading) return <Spinner />

  if (result) {
    return (
      <div>
        <BackLink to="/sales" label="Sales" />
        <PageHeader title="Upload done" subtitle={fileName} />
        <Card className="space-y-2">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <CheckCircle2 className="size-6 text-emerald-600" aria-hidden /> {result.added} sales added
          </p>
          {result.duplicates > 0 && <p>{result.duplicates} were already in the app, so they were skipped.</p>}
          {result.ignored > 0 && <p>{result.ignored} weren't drinks (you said to skip them).</p>}
          {result.no_shift > 0 && <p>{result.no_shift} didn't match any shift on that truck. They're saved and flagged.</p>}
          {result.unmatched > 0 && (
            <Notice tone="warning">
              {result.unmatched} weren't matched to a drink, so they weren't added: {result.unmatched_names.join(', ')}. Match them and upload the
              same file again. Nothing gets counted twice.
            </Notice>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Link to="/sales" className="inline-flex min-h-12 items-center rounded-xl bg-brand-700 px-4 font-semibold text-white">
              See sales
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                setTable(null)
                setFileName('')
                setResult(null)
              }}
            >
              Upload another file
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <BackLink to="/sales" label="Sales" />
      <PageHeader
        title="Upload a sales file"
        subtitle="Export item sales from your register (Square and most others work) as a CSV file. The app matches each sale to its truck and shift."
      />

      <Card className="mb-4">
        <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 font-semibold text-brand-700 hover:bg-slate-50">
          <FileUp className="size-5" aria-hidden />
          {fileName ? `${fileName} (pick a different file)` : 'Pick a CSV file'}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void readFile(e.target.files?.[0])} />
        </label>
      </Card>

      {table && (
        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold">1. Which column is which?</h2>
            <p className="text-slate-600">We filled in our best guess. Date and Item name are needed. The app remembers this for files like this one.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f: Field) => (
                <Select
                  key={f}
                  label={fieldLabels[f]}
                  value={columns[f] ?? ''}
                  onChange={(e) => setColumns({ ...columns, [f]: e.target.value === '' ? undefined : Number(e.target.value) })}
                >
                  <option value="">{f === 'date' || f === 'item' ? 'Pick a column' : 'Not in this file'}</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </Select>
              ))}
              {columns.truck === undefined && (
                <Select label="These sales are all from" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
                  <option value="">Pick a truck</option>
                  {activeTrucks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <p className="mt-3 text-sm text-slate-500">
              {built.rows.length} sales found
              {built.skipped.length > 0 && `, ${built.skipped.length} rows skipped (refunds or missing a date or item)`}.
            </p>
          </Card>

          {items.length > 0 && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">2. Match items to your drinks</h2>
                {unresolved > 0 ? <Badge tone="amber">{unresolved} to match</Badge> : <Badge tone="green">All matched</Badge>}
              </div>
              <p className="text-slate-600">Only needed once. Next time these match by themselves.</p>
              <MatchList
                kind="item"
                entries={items}
                options={sizeOptions}
                ignoreLabel="Not a drink (skip it)"
                onChange={setChoice}
              />
              {mods.length > 0 && (
                <>
                  <h3 className="mt-4 font-semibold">Add ons</h3>
                  <MatchList
                    kind="modifier"
                    entries={mods}
                    options={(modifiers.data ?? []).filter((m) => m.active).map((m) => ({ id: m.id, label: m.name }))}
                    ignoreLabel="Doesn't change supplies (ignore)"
                    onChange={setChoice}
                  />
                </>
              )}
              {truckValues.length > 0 && (
                <>
                  <h3 className="mt-4 font-semibold">Trucks</h3>
                  <MatchList kind="truck" entries={truckValues} options={activeTrucks.map((t) => ({ id: t.id, label: t.name }))} onChange={setChoice} />
                </>
              )}
            </Card>
          )}

          <Card className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-slate-600">
              {unresolved > 0 ? `${unresolved} item${unresolved === 1 ? '' : 's'} still not matched. Those sales will be left out.` : 'Ready to go.'}
            </span>
            {runImport.error && <Notice tone="error">{runImport.error}</Notice>}
            <Button busy={runImport.busy} disabled={built.rows.length === 0} onClick={() => void runImport.run()}>
              {progress ?? `Import ${built.rows.length} sales`}
            </Button>
          </Card>
        </div>
      )}
    </div>
  )
}

function MatchList({
  kind,
  entries,
  options,
  ignoreLabel,
  onChange,
}: {
  kind: Kind
  entries: { key: string; name: string; count: number; choice: Choice }[]
  options: { id: string; label: string }[]
  ignoreLabel?: string
  onChange: (kind: Kind, key: string, value: string) => void
}) {
  return (
    <ul className="mt-3 divide-y divide-slate-100">
      {entries.map((e) => (
        <li key={e.key} className="grid gap-2 py-3 md:grid-cols-[1fr_20rem] md:items-center">
          <div className="min-w-0">
            <p className="font-medium">{e.name}</p>
            <p className="text-sm text-slate-500">
              {e.count} sale{e.count === 1 ? '' : 's'}
            </p>
          </div>
          <select
            aria-label={`Match for ${e.name}`}
            value={e.choice.ignore ? IGNORE : (e.choice.id ?? '')}
            onChange={(ev) => onChange(kind, e.key, ev.target.value)}
            className={`min-h-12 rounded-xl border bg-white px-3 outline-none focus:border-brand-700 ${
              !e.choice.id && !e.choice.ignore ? 'border-amber-400 ring-2 ring-amber-100' : 'border-slate-300'
            }`}
          >
            <option value="">Pick one</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
            {ignoreLabel && <option value={IGNORE}>{ignoreLabel}</option>}
          </select>
        </li>
      ))}
    </ul>
  )
}
