/** Matches text anywhere in any of the given values, ignoring case. */
export function matchesSearch(search: string, ...values: (string | null | undefined)[]) {
  const text = search.trim().toLowerCase()
  return !text || values.some((v) => (v ?? '').toLowerCase().includes(text))
}
