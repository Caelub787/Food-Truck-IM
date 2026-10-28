// Runs before the app: swaps in the pretend server and logs in as the sample admin.
import { demoSession, installDemo, resetDemo, switchUser, currentUser } from './server'

installDemo()
;(window as unknown as { __truckstockDemo: unknown }).__truckstockDemo = { switchUser, resetDemo, currentUser }
try {
  // Supabase reads the saved login from here when it starts.
  localStorage.setItem('sb-demo-auth-token', JSON.stringify(demoSession()))
} catch {
  // No storage (private window): the login screen shows instead, with the demo logins on it.
}
