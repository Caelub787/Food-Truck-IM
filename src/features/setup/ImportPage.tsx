import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { useState } from 'react'
import { Segmented } from '@/components/forms'
import { Button, Card, Notice, PageHeader } from '@/components/ui'
import { csvObjects, downloadCsv } from '@/lib/csv'
import { refreshAllLive } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { BackLink } from './BackLink'

type Kind = 'supplies' | 'products'

const templates: Record<Kind, { required: string; columns: string[]; examples: string[][]; help: string[] }> = {
  supplies: {
    required: 'name',
    columns: [
      'name', 'category', 'base_unit', 'count_unit', 'count_unit_size', 'purchase_unit', 'purchase_unit_size', 'cost', 'cost_per',
      'reorder_level', 'order_up_to', 'supplier', 'supplier_email', 'truck_type', 'group', 'tracks_expiration', 'shelf_life_days',
      'whole_only', 'count_check',
    ],
    examples: [
      ['Whole milk', 'Milk', 'oz', 'half gallon', '64', 'case', '6', '19.20', 'purchase', '6', '24', 'Dairy Co', 'orders@dairy.example', 'Coffee', '', 'yes', '10', 'no', 'no'],
      ['Large cup', 'Cups', 'each', 'sleeve', '50', 'case', '20', '45', 'purchase', '10', '40', 'Paper Supply', '', '', '', 'no', '', 'no', 'yes'],
      ['Cherry syrup', 'Syrup', 'oz', 'gallon', '128', 'case', '4', '60', 'purchase', '2', '8', '', '', 'Shaved ice', 'Syrups', 'no', '', 'no', 'no'],
    ],
    help: [
      'base_unit is the smallest unit recipes use (oz, g, each).',
      'count_unit is what drivers count in. count_unit_size is how many base units are in one.',
      'purchase_unit is how you buy it. purchase_unit_size is how many count units are in one.',
      'cost_per says which unit the cost is for: base, count, or purchase (the default).',
      'reorder_level and order_up_to are in count units.',
      'Yes or no columns take yes, no, or leave blank.',
    ],
  },
  products: {
    required: 'product',
    columns: ['product', 'category', 'truck_type', 'size', 'price', 'supply', 'amount', 'unit'],
    examples: [
      ['Latte', 'Espresso drinks', 'Coffee', 'Large', '5.50', 'Whole milk', '14', 'oz'],
      ['Latte', 'Espresso drinks', 'Coffee', 'Large', '', 'Espresso beans', '3', 'shot'],
      ['Latte', 'Espresso drinks', 'Coffee', 'Large', '', 'Large cup', '1', ''],
      ['Shaved ice', 'Shaved ice', 'Shaved ice', 'Small', '4', 'Syrups', '2', 'oz'],
    ],
    help: [
      'One row per recipe line. Rows with the same product and size make one recipe.',
      'supply can be a supply name or a supply group name. Import supplies first.',
      'unit can be any unit that supply has, or leave it blank for the base unit.',
      'Saving a recipe that changed starts a new version. Old reports keep the old one.',
    ],
  },
}

export function ImportPage() {
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<Kind>('supplies')
  const [file, setFile] = useState<{ name: string; rows: Record<string, string>[] } | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number; errors: { row: number; name: string; message: string }[] } | null>(null)
  const template = templates[kind]

  const read = useAction(async (f: File) => {
    setResult(null)
    const rows = csvObjects(await f.text())
    if (rows.length === 0) throw new Error('That file has no rows.')
    if (!(template.required in rows[0]!)) {
      throw new Error(`That file has no "${template.required}" column. Download the template to see the columns.`)
    }
    setFile({ name: f.name, rows })
  })

  const run = useAction(async () => {
    const r = await rpc<NonNullable<typeof result>>(kind === 'supplies' ? 'import_supplies' : 'import_products', { p_rows: file!.rows })
    setResult(r)
    setFile(null)
    await refreshAllLive(queryClient)
  })

  const known = new Set(template.columns)
  const columns = file ? Object.keys(file.rows[0] ?? {}) : []
  const unknown = columns.filter((c) => !known.has(c))

  return (
    <div>
      <BackLink />
      <PageHeader title="Import a spreadsheet" subtitle="Add or update lots of supplies or products at once from a CSV file." />
      <div className="mb-4">
        <Segmented
          label="What to import"
          value={kind}
          onChange={(k) => {
            setKind(k)
            setFile(null)
            setResult(null)
          }}
          options={[
            { value: 'supplies', label: 'Supplies' },
            { value: 'products', label: 'Products and recipes' },
          ]}
        />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">1. Get the template</h2>
          <p className="mt-1 text-slate-600">
            Open it in Excel or Google Sheets, fill it in, and save it as CSV. Rows are matched by name, so importing again updates instead of
            making copies.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
            {template.help.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <Button variant="secondary" className="mt-4" onClick={() => downloadCsv(`${kind}-template.csv`, [template.columns, ...template.examples])}>
            <Download className="size-5" aria-hidden /> Download template
          </Button>
        </Card>
        <Card>
          <h2 className="font-semibold">2. Pick your file</h2>
          <label className="mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-4 text-center hover:bg-slate-50">
            <Upload className="size-6 text-slate-400" aria-hidden />
            <span className="font-medium text-brand-700">Choose a CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void read.run(f)
                e.target.value = ''
              }}
            />
          </label>
          {read.error && (
            <div className="mt-3">
              <Notice tone="error">{read.error}</Notice>
            </div>
          )}
        </Card>
      </div>

      {file && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">3. Check and import</h2>
              <p className="text-slate-600">
                {file.name}: {file.rows.length} row{file.rows.length === 1 ? '' : 's'}
              </p>
            </div>
            <Button busy={run.busy} onClick={() => void run.run()}>
              Import {file.rows.length} row{file.rows.length === 1 ? '' : 's'}
            </Button>
          </div>
          {unknown.length > 0 && (
            <div className="mt-3">
              <Notice tone="warning">These columns will be skipped because the app doesn't know them: {unknown.join(', ')}.</Notice>
            </div>
          )}
          {run.error && (
            <div className="mt-3">
              <Notice tone="error">{run.error}</Notice>
            </div>
          )}
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  {columns.filter((c) => known.has(c)).map((c) => (
                    <th key={c} className="px-3 py-2 whitespace-nowrap">
                      {c.replaceAll('_', ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {file.rows.slice(0, 25).map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-slate-400">{i + 2}</td>
                    {columns.filter((c) => known.has(c)).map((c) => (
                      <td key={c} className="px-3 py-2 whitespace-nowrap">
                        {r[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {file.rows.length > 25 && <p className="mt-2 text-sm text-slate-500">Showing the first 25 rows.</p>}
        </Card>
      )}

      {result && (
        <Card className="mt-4">
          <h2 className="font-semibold">Done</h2>
          <p className="mt-1 text-slate-700">
            {result.created} added, {result.updated} updated.
          </p>
          {result.errors.length > 0 && (
            <>
              <Notice tone="warning">
                {result.errors.length} row{result.errors.length === 1 ? '' : 's'} had a problem and were skipped. Fix them in the spreadsheet and
                import again.
              </Notice>
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {result.errors.map((e, i) => (
                  <li key={i} className="py-2">
                    <strong>Row {e.row + 1}</strong>
                    {e.name ? ` (${e.name})` : ''}: {e.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  )
}
