import { shrinkPhoto } from './photos'

// Verification documents (ID, driver's licence, police clearance), as the server names them.
export const DOCUMENT_LABEL: Record<string, string> = {
  id_document: 'ID document',
  drivers_licence: 'Driver’s licence',
  police_clearance: 'Police clearance',
}

export interface ChosenFile {
  name: string
  base64: string
  bytes: number
}

// A photo is shrunk on the phone first (it uploads quicker on mobile data and loses hidden details such
// as the location); a PDF goes as it is. Sent as base64 text; the server checks the type and size again.
export async function readDocument(file: File, maxBytes: number): Promise<ChosenFile> {
  const blob = file.type === 'application/pdf' ? file : await shrinkPhoto(file, { maxSide: 2000, quality: 0.85 })
  if (blob.size > maxBytes) throw new Error('That file is too big: 5 MB at most.')
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(new Error('That file could not be read. Please try another one.'))
    reader.readAsDataURL(blob)
  })
  return { name: file.name, base64, bytes: blob.size }
}
