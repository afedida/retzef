import { coerceProject } from '@/lib/edit'
import { t } from '@/lib/i18n'
import type { Asset, Project } from '@/types'

export const FOLDER_FILE = 'retzef.json'
export const FOLDER_FORMAT = 'retzef-folder'
export const RECENT_FOLDER_LIMIT = 8

const MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export type FolderAssetRecord = Asset & { file: string }

export type FolderManifest = {
  format: typeof FOLDER_FORMAT
  version: 1
  project: Project
  assets: FolderAssetRecord[]
}

export type RecentFolderMeta = {
  id: string
  name: string
  savedAt: number
}

export interface FolderIO {
  write(path: string, data: Blob): Promise<void>
  read(path: string): Promise<Blob | null>
  list(prefix: string): Promise<string[]>
  remove(path: string): Promise<void>
}

function cleanExt(value: string): string {
  const ext = value.toLowerCase().replace(/[^a-z0-9]/g, '')
  return ext.length > 0 && ext.length <= 5 ? ext : ''
}

export function mediaRelativePath(asset: Pick<Asset, 'id' | 'name' | 'mime'>): string {
  const fromName = asset.name.includes('.') ? cleanExt(asset.name.split('.').pop() ?? '') : ''
  const ext = fromName || MIME_EXT[asset.mime] || 'bin'
  return `media/${asset.id}.${ext}`
}

export function folderSupported(picker: unknown = typeof window === 'undefined' ? undefined : (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker): boolean {
  return typeof picker === 'function'
}

export function rememberRecent(list: RecentFolderMeta[], entry: RecentFolderMeta, limit = RECENT_FOLDER_LIMIT): RecentFolderMeta[] {
  const next = [entry, ...list.filter((item) => item.id !== entry.id)]
  next.sort((a, b) => b.savedAt - a.savedAt)
  return next.slice(0, limit)
}

function assetRecord(asset: Asset, file: string): FolderAssetRecord {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    duration: asset.duration,
    width: asset.width,
    height: asset.height,
    hasAudio: asset.hasAudio,
    peaks: asset.peaks ?? [],
    thumbnail: null,
    mime: asset.mime,
    file,
  }
}

export async function writeProjectFolder(
  io: FolderIO,
  project: Project,
  assets: Asset[],
  blobs: Map<string, Blob>,
  already: Set<string>,
): Promise<Set<string>> {
  const written = new Set(already)
  const records: FolderAssetRecord[] = []
  for (const asset of assets) {
    const file = mediaRelativePath(asset)
    records.push(assetRecord(asset, file))
    const blob = blobs.get(asset.id)
    if (!blob || written.has(asset.id)) continue
    await io.write(file, blob)
    written.add(asset.id)
  }
  const manifest: FolderManifest = { format: FOLDER_FORMAT, version: 1, project, assets: records }
  await io.write(FOLDER_FILE, new Blob([JSON.stringify(manifest)], { type: 'application/json' }))
  const keep = new Set(records.map((item) => item.file))
  for (const path of await io.list('media/')) {
    if (!keep.has(path)) await io.remove(path)
  }
  for (const id of [...written]) {
    if (!assets.some((asset) => asset.id === id)) written.delete(id)
  }
  return written
}

export async function readProjectFolder(io: FolderIO): Promise<{ project: Project; assets: { asset: Asset; blob: Blob }[] }> {
  const file = await io.read(FOLDER_FILE)
  if (!file) throw new Error(t('error.badFolder'))
  const parsed = JSON.parse(await file.text()) as Partial<FolderManifest>
  if (!parsed || parsed.format !== FOLDER_FORMAT || !Array.isArray(parsed.assets)) {
    throw new Error(t('error.badFolderFile'))
  }
  const project = coerceProject(parsed.project)
  if (!project) throw new Error(t('error.badFolderProject'))
  const assets: { asset: Asset; blob: Blob }[] = []
  for (const raw of parsed.assets) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.file !== 'string') continue
    const blob = await io.read(raw.file)
    if (!blob) continue
    const mime = typeof raw.mime === 'string' ? raw.mime : blob.type || 'application/octet-stream'
    assets.push({
      asset: {
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name : raw.id,
        kind: raw.kind === 'audio' || raw.kind === 'image' || raw.kind === 'video' ? raw.kind : 'video',
        duration: typeof raw.duration === 'number' ? raw.duration : 0,
        width: typeof raw.width === 'number' ? raw.width : 0,
        height: typeof raw.height === 'number' ? raw.height : 0,
        hasAudio: Boolean(raw.hasAudio),
        peaks: Array.isArray(raw.peaks) ? raw.peaks.filter((item) => typeof item === 'number') : [],
        thumbnail: null,
        mime,
      },
      blob,
    })
  }
  return { project, assets }
}

export function createMemoryFolder(): FolderIO & { files: Map<string, Blob> } {
  const files = new Map<string, Blob>()
  return {
    files,
    async write(path, data) {
      files.set(path, data)
    },
    async read(path) {
      return files.get(path) ?? null
    },
    async list(prefix) {
      return [...files.keys()].filter((path) => path.startsWith(prefix))
    },
    async remove(path) {
      files.delete(path)
    },
  }
}
