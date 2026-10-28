import type { RealtimeChannel } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useMe } from '@/features/auth/session'
import { createSignalBatcher, refreshAllLive, refreshTables, setLiveStatus } from '@/lib/live'
import { supabase } from '@/lib/supabase'

/**
 * Keeps a live connection to the business's private channel (and the owner
 * channel for App Owners). When a signal arrives, the matching data reloads.
 * Renders nothing.
 */
export function LiveUpdates() {
  const { data: me } = useMe()
  const queryClient = useQueryClient()

  const topics: string[] = []
  if (me?.company && me.profile?.active && ['pending', 'active'].includes(me.company.status)) {
    topics.push(`company:${me.company.id}`)
  }
  if (me?.is_owner) topics.push('owner')
  const topicKey = topics.join('|')

  useEffect(() => {
    const wanted = topicKey ? topicKey.split('|') : []
    if (wanted.length === 0) {
      // Nothing to listen to (like a turned off account), so screens check every so often instead.
      setLiveStatus('offline')
      return
    }

    let cancelled = false
    const channels: RealtimeChannel[] = []
    const joined = new Map<string, boolean>()
    let wasLive = false
    let hasBeenLive = false
    const batcher = createSignalBatcher((tables) => void refreshTables(queryClient, tables))

    const update = () => {
      const isLive = wanted.every((topic) => joined.get(topic) === true)
      // Just connected or reconnected: reload everything once in case a signal was missed.
      if (isLive && !wasLive) void refreshAllLive(queryClient)
      if (isLive) hasBeenLive = true
      wasLive = isLive
      setLiveStatus(isLive ? 'live' : hasBeenLive ? 'offline' : 'connecting')
    }

    setLiveStatus('connecting')
    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return
      for (const topic of wanted) {
        const channel = supabase
          .channel(topic, { config: { private: true } })
          .on('broadcast', { event: 'change' }, (message) => {
            const table = (message.payload as { table?: unknown } | undefined)?.table
            if (typeof table === 'string') batcher.push(table)
          })
          .subscribe((state) => {
            joined.set(topic, state === 'SUBSCRIBED')
            update()
          })
        channels.push(channel)
      }
    })

    return () => {
      cancelled = true
      batcher.cancel()
      for (const channel of channels) void supabase.removeChannel(channel)
    }
  }, [topicKey, queryClient])

  return null
}
