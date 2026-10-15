import { loadKv, saveKv } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  folderSupported,
  readProjectFolder,
  rememberRecent,
  writeProjectFolder,
  type FolderIO,
  type RecentFolderMeta,
} from '@/lib/folderProject'
import type { Asset, Project } from '@/types'

type DirectoryHandle = FileSystemDirectoryHandle

type RecentRecord = RecentFolderMeta & { handle: DirectoryHandle }

export type LinkedFolder = {
  id: string
  name: string
  written: Set<string>
}

const RECENT_KEY = 'recent-folders'

let linked: { record: RecentRecord; written: Set<string> } | null = null

function picker(): ((options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirectoryHandle>) | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as Window & { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirectoryHandle> }).showDirectoryPicker
  return typeof candidate === 'function' ? candidate : null
}

export function directoryPickerSupported(): boolean {
  return folderSupported(picker())
}

type PermissionedHandle = DirectoryHandle & {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

async function permission(handle: DirectoryHandle, request: boolean): Promise<boolean> {
  const mode = 'readwrite' as const
  const permitted = handle as PermissionedHandle
  const current = await permitted.queryPermission?.({ mode })
  if (current === 'granted') return true
  if (!request) return false
  const next = await permitted.requestPermission?.({ mode })
  return next === 'granted'
}

function adapter(handle: DirectoryHandle): FolderIO {
  return {
    async write(path, data) {
      const file = await fileHandle(handle, path, true)
      const writable = await file.createWritable()
      await writable.write(data)
      await writable.close()
    },
    async read(path) {
      try {
        const file = await fileHandle(handle, path, false)
        return await file.getFile()
      } catch {
        return null
      }
    },
    async list(prefix) {
      const found: string[] = []
      await walk(handle, '', prefix, found)
      return found
    },
    async remove(path) {
      const slash = path.lastIndexOf('/')
      const dir = slash === -1 ? handle : await directoryHandle(handle, path.slice(0, slash), false)
      await dir.removeEntry(path.slice(slash + 1))
    },
  }
}

async function directoryHandle(root: DirectoryHandle, path: string, create: boolean): Promise<DirectoryHandle> {
  let current = root
  for (const part of path.split('/').filter(Boolean)) {
    current = await current.getDirectoryHandle(part, { create })
  }
  return current
}

async function fileHandle(root: DirectoryHandle, path: string, create: boolean): Promise<FileSystemFileHandle> {
  const slash = path.lastIndexOf('/')
  const dir = slash === -1 ? root : await directoryHandle(root, path.slice(0, slash), create)
  return dir.getFileHandle(path.slice(slash + 1), { create })
}

async function walk(dir: DirectoryHandle, prefix: string, match: string, found: string[]): Promise<void> {
  for await (const [name, child] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (child.kind === 'file') {
      if (path.startsWith(match)) found.push(path)
    } else {
      await walk(child as DirectoryHandle, path, match, found)
    }
  }
}

async function readRecent(): Promise<RecentRecord[]> {
  const value = await loadKv<RecentRecord[]>(RECENT_KEY)
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item.id === 'string' && item.handle && typeof item.name === 'string')
}

async function storeRecent(list: RecentRecord[]): Promise<void> {
  await saveKv(RECENT_KEY, list.slice(0, 8))
}

export async function listRecentFolders(): Promise<RecentFolderMeta[]> {
  const records = await readRecent()
  return records.map(({ id, name, savedAt }) => ({ id, name, savedAt })).sort((a, b) => b.savedAt - a.savedAt)
}

export function linkedFolder(): LinkedFolder | null {
  if (!linked) return null
  return { id: linked.record.id, name: linked.record.name, written: linked.written }
}

async function upsert(handle: DirectoryHandle, name: string): Promise<RecentRecord> {
  const records = await readRecent()
  let match: RecentRecord | null = null
  for (const item of records) {
    if (await item.handle.isSameEntry?.(handle)) {
      match = item
      break
    }
  }
  const entry: RecentRecord = match
    ? { ...match, handle, name, savedAt: Date.now() }
    : { id: crypto.randomUUID(), name, handle, savedAt: Date.now() }
  await storeRecent(rememberRecent(records, entry).map((meta) => (meta.id === entry.id ? entry : records.find((item) => item.id === meta.id) ?? entry)))
  return entry
}

async function activate(handle: DirectoryHandle, name: string, written: Set<string>): Promise<LinkedFolder> {
  const record = await upsert(handle, name)
  linked = { record, written }
  return { id: record.id, name: record.name, written }
}

export async function chooseProjectFolder(project: Project, assets: Asset[], blobs: Map<string, Blob>): Promise<LinkedFolder> {
  const open = picker()
  if (!open) throw new Error(t('error.noPicker'))
  const handle = await open({ mode: 'readwrite', id: 'retzef-project' })
  if (!(await permission(handle, true))) throw new Error(t('error.noWrite'))
  const written = await writeProjectFolder(adapter(handle), project, assets, blobs, new Set())
  return activate(handle, project.name, written)
}

export async function openProjectFolder(): Promise<{ project: Project; assets: { asset: Asset; blob: Blob }[]; link: LinkedFolder }> {
  const open = picker()
  if (!open) throw new Error(t('error.noOpen'))
  const handle = await open({ mode: 'readwrite', id: 'retzef-project' })
  if (!(await permission(handle, true))) throw new Error(t('error.noRead'))
  const loaded = await readProjectFolder(adapter(handle))
  const link = await activate(handle, loaded.project.name, new Set(loaded.assets.map((item) => item.asset.id)))
  return { ...loaded, link }
}

export async function reopenRecentFolder(id: string): Promise<{ project: Project; assets: { asset: Asset; blob: Blob }[]; link: LinkedFolder }> {
  const records = await readRecent()
  const record = records.find((item) => item.id === id)
  if (!record) throw new Error(t('error.recentMissing'))
  if (!(await permission(record.handle, true))) throw new Error(t('error.reauth'))
  const loaded = await readProjectFolder(adapter(record.handle))
  const link = await activate(record.handle, loaded.project.name, new Set(loaded.assets.map((item) => item.asset.id)))
  return { ...loaded, link }
}

export async function autosaveLinkedFolder(project: Project, assets: Asset[], blobs: Map<string, Blob>): Promise<void> {
  if (!linked) return
  if (!(await permission(linked.record.handle, false))) return
  const written = await writeProjectFolder(adapter(linked.record.handle), project, assets, blobs, linked.written)
  linked.written = written
  linked.record = { ...linked.record, name: project.name, savedAt: Date.now() }
  const records = await readRecent()
  await storeRecent(records.map((item) => (item.id === linked?.record.id ? linked.record : item)))
}

export function unlinkFolder(): void {
  linked = null
}
