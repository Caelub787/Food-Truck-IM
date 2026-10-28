import { useRows } from '@/lib/data'

export type PurchaseOrder = {
  id: string
  supplier_id: string
  status: 'draft' | 'approved' | 'sent' | 'received' | 'cancelled'
  edited: boolean
  note: string | null
  estimated_total: number
  created_at: string
  approved_at: string | null
  sent_at: string | null
  received_at: string | null
}
export type OrderLine = { order_id: string; supply_id: string; quantity: number; unit_cost: number }

export const useOrders = () => useRows<PurchaseOrder>('purchase_orders', { order: 'created_at desc' })
export const useOrderLines = () => useRows<OrderLine>('purchase_order_lines', { order: 'order_id' })
