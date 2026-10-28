import { useLiveQuery } from '@/lib/live'
import { supabase } from '@/lib/supabase'

export type Settings = {
  company_id: string
  scheduling_enabled: boolean
  count_checks_enabled: boolean
  count_check_blind: boolean
  count_check_manager_wins: boolean
  expiration_tracking: boolean
  loading_checklist_enabled: boolean
  sales_reporters: 'drivers' | 'managers' | 'both' | 'none'
  sales_source_order: ('file' | 'manager' | 'driver')[]
  diff_percent: number
  diff_min_dollars: number
  shift_dollar_limit: number
  par_cushion_percent: number
  par_lookback_shifts: number
  par_auto_update: boolean
  expiration_warning_days: number
  morning_hour: number
  daily_report_hour: number
  weekly_report_day: number
  summary_hour: number
  start_reminder_minutes: number
  shift_reminder_hours: number
  shift_alert_hours: number
  count_check_reminder_hours: number
  waste_pattern_factor: number
  photo_retention_days: number
}

/** The business's settings and feature switches, kept live. */
export function useSettings() {
  return useLiveQuery({
    tables: ['company_settings'],
    queryKey: ['settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('company_settings').select('*').maybeSingle()
      if (error) throw error
      return data as Settings | null
    },
  })
}
