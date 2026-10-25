// Shrinks a photo on the phone before uploading it. A phone camera photo is often 3-8 MB; after
// this it is about 100-250 KB, so it uploads quickly on mobile data and costs the seller less data.
// Drawing it onto a canvas also drops the photo's hidden details (e.g. GPS location) - good for privacy.

const MAX_SIDE = 1200 // pixels, longest side
const QUALITY = 0.8

export async function shrinkPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY))
  // WebP is smallest; a browser that can't make WebP gives back PNG instead, so fall back to JPEG.
  const webp = await toBlob('image/webp')
  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await toBlob('image/jpeg')
  if (!jpeg) throw new Error('This photo could not be prepared. Try another one.')
  return jpeg
}
