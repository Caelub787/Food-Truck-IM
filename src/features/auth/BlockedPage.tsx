import { useQueryClient } from '@tanstack/react-query'
import { Button, Card } from '@/components/ui'
import { APP_NAME } from '@/lib/config'
import { supabase } from '@/lib/supabase'

const messages = {
  turned_off: {
    title: 'Your account is turned off',
    body: 'Someone in your business turned off your account. Talk to your manager if you think this is a mistake.',
  },
  declined: {
    title: "Your sign up wasn't approved",
    body: `${APP_NAME} wasn't able to approve your business. Reply to the email you got if you have questions.`,
  },
  suspended: {
    title: 'Your business is paused',
    body: 'Your business has been paused, so nobody can log in right now. Your data is safe.',
  },
  error: {
    title: "We couldn't load your account",
    body: 'Check your connection and try again.',
  },
}

export function BlockedPage({ reason, note }: { reason: keyof typeof messages; note?: string | null }) {
  const queryClient = useQueryClient()
  const message = messages[reason]
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
      <Card className="space-y-4 p-6">
        <h1 className="text-xl font-bold">{message.title}</h1>
        <p className="text-slate-600">{message.body}</p>
        {note && <p className="rounded-xl bg-slate-50 p-3 text-slate-700">Note: {note}</p>}
        <div className="flex flex-col gap-2">
          {reason === 'error' && (
            <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['me'] })}>Try again</Button>
          )}
          <Button variant="secondary" onClick={() => supabase.auth.signOut()}>
            Log out
          </Button>
        </div>
      </Card>
    </div>
  )
}
