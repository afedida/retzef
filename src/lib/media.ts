import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { t } from '@/lib/i18n'
import { containRect } from '@/lib/time'
import type { MediaKind } from '@/types'

export class MediaReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaReadError'
  }
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function sniffKind(file: File): MediaKind | 'media' {
  if (file.type.startsWith('image/') || IMAGE_EXT.has(extension(file.name))) return 'image'
  return 'media'
}

export async function probeFile(file: File): Promise<{
  name: string
  kind: MediaKind
  duration: number
  width: number
  height: number
  hasAudio: boolean
  mime: string
  blob: Blob
}> {
  if (sniffKind(file) === 'image') {
    const bitmap = await createImageBitmap(file)
    const width = bitmap.width
    const height = bitmap.height
    bitmap.close()
    return { name: file.name, kind: 'image', duration: 0, width, height, hasAudio: false, mime: file.type || 'image/png', blob: file }
  }

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    if (!video && !audio) throw new MediaReadError(t('error.mediaInside', { name: file.name }))
    const duration = await input.computeDuration()
    return {
      name: file.name,
      kind: video ? 'video' : 'audio',
      duration: Number.isFinite(duration) ? duration : 0,
      width: video?.displayWidth ?? 0,
      height: video?.displayHeight ?? 0,
      hasAudio: Boolean(audio),
      mime: file.type || (video ? 'video/mp4' : 'audio/mpeg'),
      blob: file,
    }
  } catch (error) {
    if (error instanceof MediaReadError) throw error
    throw new MediaReadError(t('error.mediaFile', { name: file.name }))
  } finally {
    input.dispose()
  }
}

export function captureVideoThumbnail(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url
    const finish = (value: string | null) => {
      video.src = ''
      resolve(value)
    }
    video.onerror = () => finish(null)
    video.onloadeddata = () => {
      const target = Number.isFinite(video.duration) ? Math.min(0.4, Math.max(0, video.duration / 4)) : 0
      video.onseeked = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 320
        canvas.height = 180
        const ctx = canvas.getContext('2d')
        if (!ctx || !video.videoWidth) {
          finish(null)
          return
        }
        ctx.fillStyle = '#111'
        ctx.fillRect(0, 0, 320, 180)
        const rect = containRect(video.videoWidth, video.videoHeight, 320, 180)
        ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h)
        finish(canvas.toDataURL('image/jpeg', 0.72))
      }
      try {
        video.currentTime = target
      } catch {
        finish(null)
      }
    }
  })
}

export async function captureImageThumbnail(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, 320, 180)
    const rect = containRect(bitmap.width, bitmap.height, 320, 180)
    ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return null
  }
}

export async function readProjectFile(file: File): Promise<unknown> {
  const text = await file.text()
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object') throw new Error(t('error.badProject'))
  const raw = parsed as { format?: string; project?: unknown }
  if (raw.format === 'retzef') return raw.project
  return parsed
}
