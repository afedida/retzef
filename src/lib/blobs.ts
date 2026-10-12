const blobs = new Map<string, Blob>()
const urls = new Map<string, string>()

export function putBlob(id: string, blob: Blob): string {
  const previous = urls.get(id)
  if (previous) URL.revokeObjectURL(previous)
  blobs.set(id, blob)
  const url = URL.createObjectURL(blob)
  urls.set(id, url)
  return url
}

export function getBlob(id: string): Blob | null {
  return blobs.get(id) ?? null
}

export function getUrl(id: string): string | null {
  return urls.get(id) ?? null
}

export function dropBlob(id: string): void {
  const previous = urls.get(id)
  if (previous) URL.revokeObjectURL(previous)
  blobs.delete(id)
  urls.delete(id)
}
