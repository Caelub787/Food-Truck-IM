// The demo can't use a service worker, so app updates are never offered.
export function useRegisterSW() {
  return { needRefresh: [false, () => {}] as const, offlineReady: [false, () => {}] as const, updateServiceWorker: async () => {} }
}
