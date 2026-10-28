import { APP_NAME } from '@/lib/config'

/** Shown when the app was built without its Supabase settings. */
export function SetupNeeded() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <img src="/favicon.svg" alt="" className="size-12" />
      <h1 className="text-2xl font-bold">{APP_NAME} isn't connected yet</h1>
      <p className="text-slate-600">
        The app needs its Supabase settings (<code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>).
        Follow <code>docs/SETUP.md</code> to add them, then build the app again.
      </p>
    </div>
  )
}
