export const APP_NAME = 'TruckStock'

export const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', driver: 'Driver' } as const
export type Role = keyof typeof ROLE_LABELS

export type CompanyStatus = 'pending' | 'active' | 'declined' | 'suspended'
export const STATUS_LABELS: Record<CompanyStatus, string> = {
  pending: 'Waiting for approval',
  active: 'Active',
  declined: 'Declined',
  suspended: 'Paused',
}

/** Every time zone the browser knows, with the US ones first since most users are there. */
export function timeZones(): string[] {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['America/Chicago']
  const us = all.filter((z) => z.startsWith('America/') || z.startsWith('Pacific/Honolulu'))
  return [...us, ...all.filter((z) => !us.includes(z))]
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'
}
