import { as, createCompany, sql, type Company, type User } from './helpers'

export type Json = Record<string, unknown>

/** A business with its warehouse, one truck, and a way to add supplies. */
export async function stockSetup(company?: Company) {
  const c = company ?? (await createCompany())
  const [warehouse] = await sql<{ id: string }>(`select id from public.locations where company_id = $1`, [c.id])
  const [truck] = await as(c.admin, (q) => q<{ id: string }>(`insert into public.trucks (name) values ('Truck 1') returning id`))
  const supply = async (name: string, extra: Json = {}) => {
    const [{ id }] = (await as(c.admin, (q) =>
      q(`select public.save_supply($1) as id`, [JSON.stringify({ name, base_unit: 'oz', cost_per_base: 0.05, ...extra })]),
    )) as [{ id: string }]
    return id
  }
  return { c, warehouse: warehouse!.id, truck: truck!.id, supply }
}

export const level = async (place: string, supply: string) =>
  Number((await sql(`select quantity from public.stock_levels where place_id = $1 and supply_id = $2`, [place, supply]))[0]?.quantity ?? 0)

export const call = (who: User, fn: string, p: Json) => as(who, (q) => q(`select public.${fn}($1) as r`, [JSON.stringify(p)]))


export type Row = { id: string } & Json

/** Adds a row as a person, through the normal security rules. */
export async function insertAs<T extends Json = Row>(who: User, table: string, row: Json): Promise<T> {
  const cols = Object.keys(row)
  const [created] = await as(who, (q) =>
    q<T>(
      `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
      Object.values(row),
    ),
  )
  return created!
}
