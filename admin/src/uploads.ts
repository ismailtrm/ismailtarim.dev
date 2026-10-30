import { api } from './api'

// Asks for alt text, uploads each image and inserts its Markdown at the cursor. Shared by every Markdown editor in the panel.
export async function uploadImages(
  files: File[],
  insert: ((text: string) => void) | null,
  onStatus: (message: string) => void,
  onError: (message: string) => void,
) {
  for (const file of files) {
    const alt = window.prompt(`Describe "${file.name}" for readers who cannot see it (alt text):`)?.trim()
    if (!alt) continue
    onStatus(`Uploading ${file.name}...`)
    try {
      const bitmap = await createImageBitmap(file)
      const res = await api.upload(file, alt, bitmap.width, bitmap.height)
      const safeAlt = alt.replace(/[\[\]\\]/g, '\\$&').replace(/\s+/g, ' ')
      insert?.(`\n![${safeAlt}](${res.url})\n`)
      onStatus(`Uploaded ${file.name}.`)
    } catch (e) {
      onError(`Upload failed: ${(e as Error).message}`)
      onStatus('')
    }
  }
}
