import { useLiveQuery } from '@/lib/live'
import { rpc } from '@/lib/supabase'

export type Progress = Record<'locations' | 'trucks' | 'suppliers' | 'supplies' | 'products' | 'recipes' | 'people', number>

export function useSetupProgress() {
  return useLiveQuery({
    tables: ['locations', 'trucks', 'suppliers', 'supplies', 'products', 'recipe_versions', 'profiles'],
    queryKey: ['setup-progress'],
    queryFn: () => rpc<Progress>('setup_progress'),
  })
}

