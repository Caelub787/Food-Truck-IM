// Simple made up pictures for the demo's supplies, so lists show what pictures look like.
const picture = (emoji: string, background: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${background}"/><text x="50" y="56" font-size="54" text-anchor="middle" dominant-baseline="middle">${emoji}</text></svg>`,
  )}`

const pictures: Record<string, string> = {
  's-milk': picture('🥛', '#e0f2fe'),
  's-oat': picture('🌾', '#fef3c7'),
  's-beans': picture('☕', '#f5e6da'),
  's-cherry': picture('🍒', '#fee2e2'),
  's-blue': picture('🫐', '#dbeafe'),
  's-cup-s': picture('🥤', '#f1f5f9'),
  's-ice': picture('🧊', '#e0f2fe'),
}

/** The storage path a demo supply's picture lives at, if it has one. */
export const picturePath = (companyId: string, supplyId: string) => (pictures[supplyId] ? `${companyId}/supplies/${supplyId}.svg` : null)

/** Every sample picture by storage path. */
export const samplePictures = (companyId: string) => Object.keys(pictures).map((id) => [picturePath(companyId, id)!, pictures[id]!] as const)
