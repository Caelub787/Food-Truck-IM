// Turns technical errors into messages a person can act on.
const messages: [RegExp, string][] = [
  [/invalid login credentials/i, "That email and password don't match. Try again or reset your password."],
  [/email not confirmed/i, 'Please confirm your email first. Check your inbox for the link.'],
  [/user already registered/i, 'That email already has an account. Try logging in instead.'],
  [/password should be at least/i, 'Your password needs at least 8 characters.'],
  [/rate limit|too many requests/i, 'Too many tries. Please wait a minute and try again.'],
  [/expired|invalid.*(token|otp|link)|otp.*(expired|invalid)/i, 'That link has expired or was already used. Ask for a new one.'],
  [/failed to fetch|network|load failed/i, 'Could not reach the server. Check your connection and try again.'],
  [/should be different from the old password/i, 'Please pick a password different from your old one.'],
  [/duplicate key value/i, 'That name is already used. Pick a different one.'],
  [/update or delete on table .* violates foreign key/i, "This is used in your history, so it can't be deleted. Turn it off instead."],
  [/violates foreign key constraint/i, "Something this points to wasn't found. It may have just been removed."],
  [/row-level security|permission denied/i, "You don't have permission to do that."],
  [/violates check constraint/i, 'One of the values is not allowed. Check the numbers and try again.'],
]

export function friendlyError(error: unknown): string {
  const message =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : ''
  for (const [pattern, friendly] of messages) if (pattern.test(message)) return friendly
  return message || 'Something went wrong. Please try again.'
}
