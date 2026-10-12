import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { getBlob } from '@/lib/blobs'
import { coerceProject } from '@/lib/edit'
import type { Asset, Project } from '@/types'

type PackManifest = {
  format: 'retzef-pack'
  version: 1
  project: unknown
  assets: Asset[]
}

export async function packProject(project: Project, assets: Asset[]): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  const packed: Asset[] = []
  for (const asset of assets) {
    const blob = getBlob(asset.id)
    if (!blob) continue
    files[`media/${asset.id}`] = new Uint8Array(await blob.arrayBuffer())
    packed.push({ ...asset, thumbnail: null })
  }
  const manifest: PackManifest = { format: 'retzef-pack', version: 1, project, assets: packed }
  files['project.json'] = strToU8(JSON.stringify(manifest))
  return zipSync(files, { level: 0 })
}

export async function unpackProject(file: File): Promise<{ project: Project; assets: { asset: Asset; blob: Blob }[] }> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const json = entries['project.json']
  if (!json) throw new Error('החבילה לא מכילה פרויקט')
  const manifest = JSON.parse(strFromU8(json)) as PackManifest
  if (!manifest || manifest.format !== 'retzef-pack' || !Array.isArray(manifest.assets)) {
    throw new Error('החבילה לא תקינה')
  }
  const project = coerceProject(manifest.project)
  if (!project) throw new Error('הפרויקט בחבילה לא תקין')
  const assets: { asset: Asset; blob: Blob }[] = []
  for (const raw of manifest.assets) {
    if (!raw || typeof raw.id !== 'string') continue
    const data = entries[`media/${raw.id}`]
    if (!data) continue
    const copy = new Uint8Array(data.byteLength)
    copy.set(data)
    const mime = typeof raw.mime === 'string' ? raw.mime : 'application/octet-stream'
    assets.push({
      asset: {
        ...raw,
        mime,
        thumbnail: null,
        peaks: Array.isArray(raw.peaks) ? raw.peaks : [],
      },
      blob: new Blob([copy], { type: mime }),
    })
  }
  return { project, assets }
}
