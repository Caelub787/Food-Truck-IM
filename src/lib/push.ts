import { rpc, supabase } from './supabase'

// Turning push notifications on for this phone or computer. Needs the app's
// public VAPID key (see docs/SETUP.md). On iPhones it only works once the app
// is added to the home screen.

export const pushKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function keyBytes(key: string) {
  const s = key.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** The subscription on this device right now, if any. */
export async function currentPush() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function turnOnPush() {
  if (!pushSupported() || !pushKey) throw new Error("This browser can't get notifications from the app.")
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser or phone settings, then try again.')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(pushKey) }))
  const json = sub.toJSON()
  await rpc('save_push_subscription', {
    p: { endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, user_agent: navigator.userAgent.slice(0, 300) },
  })
}

export async function turnOffPush() {
  const sub = await currentPush()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}
