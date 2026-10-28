import { useLiveQuery } from '@/lib/live'
import { supabase } from '@/lib/supabase'

export type Flag = {
  id: string
  kind: string
  severity: 'info' | 'warning' | 'alert'
  title: string
  details: string | null
  shift_id: string | null
  truck_id: string | null
  created_at: string
}

export function useOpenFlags(limit = 20) {
  return useLiveQuery({
    tables: ['flags'],
    queryKey: ['flags', 'open', limit],
    queryFn: async () => {
      const { data, error } = await supabase.from('flags').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(limit)
      if (error) throw error
      return data as Flag[]
    },
  })
}

export type FlagRow = Flag & { status: 'open' | 'reviewed'; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null }

export function useFlags(status: 'open' | 'reviewed', limit = 200) {
  return useLiveQuery({
    tables: ['flags'],
    queryKey: ['flags', status, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('flags')
        .select('*')
        .eq('status', status)
        .order(status === 'open' ? 'created_at' : 'reviewed_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data as FlagRow[]
    },
  })
}
