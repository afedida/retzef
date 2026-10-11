import { dropBlob } from '@/lib/blobs'
import { coerceProject } from '@/lib/edit'
import type { Asset, Project } from '@/types'

const DB_NAME = 'retzef'
const DB_VERSION = 1

type AssetRecord = Asset & { blob: Blob }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveAsset(asset: Asset, blob: Blob): Promise<void> {
  const db = await openDb()
  const record: AssetRecord = { ...asset, blob }
  await requestToPromise(db.transaction('assets', 'readwrite').objectStore('assets').put(record))
  db.close()
}

export async function deleteStoredAsset(id: string, dropMemory = true): Promise<void> {
  const db = await openDb()
  await requestToPromise(db.transaction('assets', 'readwrite').objectStore('assets').delete(id))
  db.close()
  if (dropMemory) dropBlob(id)
}

export async function loadStoredAssets(): Promise<AssetRecord[]> {
  const db = await openDb()
  const records = await requestToPromise(db.transaction('assets', 'readonly').objectStore('assets').getAll() as IDBRequest<AssetRecord[]>)
  db.close()
  return records
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDb()
  await requestToPromise(db.transaction('kv', 'readwrite').objectStore('kv').put(project, 'project'))
  db.close()
}

export async function loadStoredProject(): Promise<Project | null> {
  const db = await openDb()
  const value = await requestToPromise(db.transaction('kv', 'readonly').objectStore('kv').get('project'))
  db.close()
  return coerceProject(value)
}
