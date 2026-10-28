import { useLiveQuery } from './live'
import { supabase } from './supabase'

// Photos are shrunk on the phone to about 100 KB before they're sent, so the
// free storage plan lasts. They live in a private bucket under the business's id.

const TARGET_BYTES = 110_000

/** Shrinks a photo from the camera to a small JPEG, as a data URL. */
export async function shrinkPhoto(file: Blob): Promise<string> {
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
  let side = 1280
  try {
    for (;;) {
      const scale = Math.min(1, side / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.width * scale)
      canvas.height = Math.round(image.height * scale)
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.72, 0.6, 0.5, 0.4]) {
        const url = canvas.toDataURL('image/jpeg', quality)
        if (url.length * 0.75 <= TARGET_BYTES || side <= 480) return url
      }
      side = Math.round(side * 0.75)
    }
  } finally {
    image.close()
  }
}

/** Where a new photo goes: <business id>/<what it's for>/<random name>.jpg */
export function newPhotoPath(companyId: string, kind: 'waste' | 'counts') {
  return `${companyId}/${kind}/${crypto.randomUUID()}.jpg`
}

/** A link to see a private photo for a while. */
export function usePhotoUrl(path: string | null | undefined) {
  return useLiveQuery({
    tables: [],
    queryKey: ['photo', path],
    enabled: Boolean(path),
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('photos').createSignedUrl(path!, 3600)
      if (error) throw error
      return data.signedUrl
    },
  })
}
