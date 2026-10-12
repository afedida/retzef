import type { StreamTargetChunk } from 'mediabunny'

type SavePicker = (options?: {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle>

function picker(): SavePicker | null {
  const candidate = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  return typeof candidate === 'function' ? candidate : null
}

export function canPickSaveFile(): boolean {
  return picker() !== null
}

export async function pickMp4Stream(filename: string): Promise<WritableStream<StreamTargetChunk> | null> {
  const open = picker()
  if (!open) return null
  const handle = await open({
    suggestedName: filename,
    types: [{ description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }],
  })
  const writable = await handle.createWritable()
  return new WritableStream<StreamTargetChunk>({
    write: (chunk) => writable.write({ type: 'write', position: chunk.position, data: chunk.data }),
    close: () => writable.close(),
    abort: (reason) => writable.abort(reason),
  })
}
