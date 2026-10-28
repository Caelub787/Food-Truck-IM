import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'

type DemoApi = { switchUser: (id: string) => void; resetDemo: () => void; currentUser: () => string }
const api = () => (window as unknown as { __truckstockDemo?: DemoApi }).__truckstockDemo

const roles = [
  { id: 'u-admin', label: 'Sam (admin)' },
  { id: 'u-m1', label: 'Maria (manager)' },
  { id: 'u-d1', label: 'Jake (driver)' },
]

/** Only in the demo: says it's sample data, and switches who you're looking as. */
export function DemoBar() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [current, setCurrent] = useState(() => api()?.currentUser() ?? 'u-admin')
  const viewAs = (id: string) => {
    api()?.switchUser(id)
    setCurrent(id)
    void queryClient.invalidateQueries()
    navigate('/')
  }
  return (
    <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
      <p>
        <strong>Demo with made up sample data.</strong> Try anything. Changes stay on this page and start over when you reload. Downloads (like CSV files) don't work here.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="View the app as">
        <span className="font-medium">View as:</span>
        {roles.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={current === r.id}
            onClick={() => viewAs(r.id)}
            className={`min-h-10 rounded-full px-3 font-medium ${current === r.id ? 'bg-violet-700 text-white' : 'bg-white ring-1 ring-violet-200 hover:bg-violet-100'}`}
          >
            {r.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            api()?.resetDemo()
            void queryClient.invalidateQueries()
            navigate('/')
          }}
          className="min-h-10 rounded-full px-3 font-medium text-violet-800 underline"
        >
          Start over
        </button>
      </div>
    </div>
  )
}
