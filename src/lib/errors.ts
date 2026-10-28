// Turns technical errors into messages a person can act on.
const authMessages: [RegExp, string][] = [
  [/invalid login credentials/i, "That email and password don't match. Try again or reset your password."],
  [/email not confirmed/i, 'Please confirm your email first. Check your inbox for the link.'],
  [/user already registered/i, 'That email already has an account. Try logging in instead.'],
  [/password should be at least/i, 'Your password needs at least 8 characters.'],
  [/rate limit|too many requests/i, 'Too many tries. Please wait a minute and try again.'],
  [/expired|invalid.*(token|otp|link)|otp.*(expired|invalid)/i, 'That link has expired or was already used. Ask for a new one.'],
  [/failed to fetch|network/i, 'Could not reach the server. Check your connection and try again.'],
  [/should be different from the old password/i, 'Please pick a password different from your old one.'],
]

export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  for (const [pattern, friendly] of authMessages) if (pattern.test(message)) return friendly
  return message || 'Something went wrong. Please try again.'
}
