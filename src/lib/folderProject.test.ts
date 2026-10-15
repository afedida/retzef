import { describe, expect, it } from 'vitest'
import { blankProject, freshClip } from '@/lib/edit'
import {
  createMemoryFolder,
  folderSupported,
  mediaRelativePath,
  readProjectFolder,
  rememberRecent,
  writeProjectFolder,
} from '@/lib/folderProject'
import type { Asset } from '@/types'

const still: Asset = {
  id: 'still-1',
  name: 'frame.png',
  kind: 'image',
  duration: 0,
  width: 1280,
  height: 720,
  hasAudio: false,
  peaks: [],
  thumbnail: 'data:image/png;base64,xx',
  mime: 'image/png',
}

describe('folder projects', () => {
  it('names media files from the asset id and extension', () => {
    expect(mediaRelativePath(still)).toBe('media/still-1.png')
    expect(mediaRelativePath({ ...still, name: 'voice', mime: 'audio/mpeg' })).toBe('media/still-1.mp3')
  })

  it('treats a missing directory picker as unsupported', () => {
    expect(folderSupported(undefined)).toBe(false)
    expect(folderSupported(() => undefined)).toBe(true)
  })

  it('keeps the newest recent folders and drops duplicates', () => {
    const first = rememberRecent([], { id: 'a', name: 'א', savedAt: 1 })
    const second = rememberRecent(first, { id: 'b', name: 'ב', savedAt: 2 })
    const again = rememberRecent(second, { id: 'a', name: 'א2', savedAt: 3 })
    expect(again.map((item) => item.id)).toEqual(['a', 'b'])
    expect(again[0]?.name).toBe('א2')
  })

  it('writes the project json and media, then skips unchanged media', async () => {
    const io = createMemoryFolder()
    const project = { ...blankProject(), name: 'שיעור', clips: [freshClip({ id: 'c', assetId: still.id, duration: 60 })] }
    const blobs = new Map([[still.id, new Blob(['png'], { type: 'image/png' })]])
    const written = await writeProjectFolder(io, project, [still], blobs, new Set())
    expect(written.has(still.id)).toBe(true)
    expect(io.files.has('retzef.json')).toBe(true)
    expect(io.files.has('media/still-1.png')).toBe(true)
    const before = io.files.get('media/still-1.png')
    const renamed = { ...project, name: 'שיעור 2' }
    await writeProjectFolder(io, renamed, [still], blobs, written)
    expect(io.files.get('media/still-1.png')).toBe(before)
    const loaded = await readProjectFolder(io)
    expect(loaded.project.name).toBe('שיעור 2')
    expect(loaded.assets).toHaveLength(1)
    expect(loaded.assets[0]?.asset.thumbnail).toBeNull()
    expect(await loaded.assets[0]?.blob.text()).toBe('png')
  })

  it('removes media that left the project', async () => {
    const io = createMemoryFolder()
    const project = blankProject()
    await writeProjectFolder(io, project, [still], new Map([[still.id, new Blob(['a'])]]), new Set())
    await writeProjectFolder(io, project, [], new Map(), new Set([still.id]))
    expect(io.files.has('media/still-1.png')).toBe(false)
    const loaded = await readProjectFolder(io)
    expect(loaded.assets).toHaveLength(0)
  })
})
