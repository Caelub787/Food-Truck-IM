import { useLiveQuery } from './live'
import { supabase } from './supabase'

// Photos are shrunk on the phone to about 100 KB before they're sent, so the
// free storage plan lasts. They live in a private bucket under the business's id.

const TARGET_BYTES = 110_000

/** Supply pictures show in lists, so they're kept even smaller (about 40 KB). */
export const SUPPLY_PHOTO = { side: 600, bytes: 45_000 }

/** Shrinks a photo from the camera to a small JPEG, as a data URL. */
export async function shrinkPhoto(file: Blob, { side: maxSide = 1280, bytes = TARGET_BYTES } = {}): Promise<string> {
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
  let side = maxSide
  try {
    for (;;) {
      const scale = Math.min(1, side / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.width * scale)
      canvas.height = Math.round(image.height * scale)
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.72, 0.6, 0.5, 0.4]) {
        const url = canvas.toDataURL('image/jpeg', quality)
        if (url.length * 0.75 <= bytes || side <= 480) return url
      }
      side = Math.round(side * 0.75)
    }
  } finally {
    image.close()
  }
}

/** Where a new photo goes: <business id>/<what it's for>/<random name>.jpg */
export function newPhotoPath(companyId: string, kind: 'waste' | 'counts' | 'supplies') {
  return `${companyId}/${kind}/${crypto.randomUUID()}.jpg`
}

/** Sends a shrunk photo (a data URL) to the private bucket. */
export async function uploadPhoto(path: string, dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob()
  const { error } = await supabase.storage.from('photos').upload(path, blob, { upsert: true, contentType: blob.type })
  if (error) throw error
}

/** Deletes photos nothing uses anymore. If that fails the file just stays, so it never blocks the work. */
export async function removePhotos(paths: (string | null | undefined)[]) {
  const list = paths.filter((p): p is string => Boolean(p))
  if (list.length) await supabase.storage.from('photos').remove(list).catch(() => undefined)
}

/** A link to see a private photo for a while. */
export function usePhotoUrl(path: string | null | undefined) {
  return useLiveQuery({
    tables: [],
    queryKey: ['photo', path],
    enabled: Boolean(path),
    staleTime: 30 * 60_000,
    queryFn: async () => {
      // The demo keeps photos in memory.
      const demo = (globalThis as { __demoPhotos?: Map<string, string> }).__demoPhotos?.get(path!)
      if (demo) return demo
      const { data, error } = await supabase.storage.from('photos').createSignedUrl(path!, 3600)
      if (error) throw error
      return data.signedUrl
    },
  })
}

const noLinks: Record<string, string> = {}

/** Links for many private photos at once, in one request, by path. */
export function usePhotoUrls(paths: (string | null | undefined)[]) {
  const list = [...new Set(paths.filter((p): p is string => Boolean(p)))].sort()
  const query = useLiveQuery({
    tables: [],
    queryKey: ['photos', list],
    enabled: list.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const demo = (globalThis as { __demoPhotos?: Map<string, string> }).__demoPhotos
      if (demo) return Object.fromEntries(list.map((p) => [p, demo.get(p) ?? '']))
      const { data, error } = await supabase.storage.from('photos').createSignedUrls(list, 3600)
      if (error) throw error
      return Object.fromEntries(data.filter((d) => d.path && d.signedUrl).map((d) => [d.path!, d.signedUrl]))
    },
  })
  return query.data ?? noLinks
}

type HasPhoto = { photo_path?: string | null }

/**
 * Picture links for a list of supplies, as a function from supply to link.
 * Undefined when none of them have a picture, so lists without any stay plain.
 */
export function useSupplyPhotos(supplies: HasPhoto[] | undefined) {
  const paths = (supplies ?? []).map((s) => s.photo_path)
  const urls = usePhotoUrls(paths)
  if (!paths.some(Boolean)) return undefined
  return (s: HasPhoto) => (s.photo_path ? urls[s.photo_path] : undefined)
}
