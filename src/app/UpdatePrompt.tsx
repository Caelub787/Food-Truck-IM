import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '@/components/ui'

/** Shows a bar when a new version of the app is ready, so nobody is stuck on an old one. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm">
      <span>A new version of the app is ready.</span>
      <Button variant="primary" className="min-h-10 px-3 text-sm" onClick={() => updateServiceWorker(true)}>
        Update
      </Button>
    </div>
  )
}
