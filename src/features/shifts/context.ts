import type { Me } from '@/features/auth/session'
import type { Movement, StockLevel } from '@/features/inventory/data'
import type { Sale } from '@/features/sales/data'
import type { Catalog, Location, Truck } from '@/features/setup/data'
import type { Settings } from '@/features/settings/useSettings'
import type { CrewRow, Shift, ShiftCount, TruckPar, WasteLog } from './data'

/** Everything the steps of a shift screen read. All of it is live. */
export type ShiftCtx = {
  shift: Shift
  truck: Truck | undefined
  locations: Location[]
  catalog: Catalog
  settings: Settings | null | undefined
  levels: StockLevel[]
  counts: ShiftCount[]
  moves: Movement[]
  pars: TruckPar[]
  waste: WasteLog[]
  sales: Sale[]
  crew: CrewRow[]
  me: Me
  /** The Lead, or a manager or admin. */
  canLead: boolean
  leadName: string
  name: (userId: string | null) => string
  /** Supplies that matter on this shift. */
  supplyIds: Set<string>
  /** Stock on this truck right now, in base units. */
  onTruck: (supplyId: string) => number
  /** Stock at a place right now, in base units. */
  at: (placeId: string, supplyId: string) => number
}
