import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
  canEncodeVideo,
  type WrappedCanvas,
} from 'mediabunny'
import { getBlob } from '@/lib/blobs'
import { mixProjectAudio } from '@/lib/audio'
import { projectDuration } from '@/lib/edit'
import { paintFrame, type Visual } from '@/lib/paint'
import {
  AUDIO_BITRATE,
  OUTPUT_FPS,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  VIDEO_BITRATE,
  type Asset,
  type Clip,
  type Project,
} from '@/types'

export type ExportProgress = {
  ratio: number
  label: string
}

type VideoCursor = {
  clip: Clip
  width: number
  height: number
  iter: AsyncGenerator<WrappedCanvas, void, unknown>
  current: WrappedCanvas | null
  next: WrappedCanvas | null
  done: boolean
  input: Input
}

const HIGH_PROFILE = 'avc1.640028'

async function advanceCursor(cursor: VideoCursor, sourceTime: number) {
  while (true) {
    if (!cursor.next && !cursor.done) {
      const next = await cursor.iter.next()
      if (next.done) cursor.done = true
      else cursor.next = next.value
    }
    if (!cursor.current && cursor.next) {
      cursor.current = cursor.next
      cursor.next = null
      continue
    }
    if (cursor.next && cursor.next.timestamp <= sourceTime + 0.0008) {
      cursor.current = cursor.next
      cursor.next = null
      continue
    }
    break
  }
  if (cursor.current) {
    cursor.width = cursor.current.canvas.width
    cursor.height = cursor.current.canvas.height
  }
}

export async function exportProject(
  project: Project,
  assets: Asset[],
  onProgress: (progress: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const duration = projectDuration(project)
  if (duration <= 0) throw new Error('אין קליפים על ציר הזמן')
  if (duration > 10 * 60) throw new Error('הייצוא בגרסה הזו מוגבל לעשר דקות')
  if (signal?.aborted) throw new DOMException('הייצוא בוטל', 'AbortError')

  const highProfile = await canEncodeVideo('avc', {
    width: OUTPUT_WIDTH,
    height: OUTPUT_HEIGHT,
    bitrate: VIDEO_BITRATE,
    frameRate: OUTPUT_FPS,
    fullCodecString: HIGH_PROFILE,
  })
  const videoOk = highProfile
    ? true
    : await canEncodeVideo('avc', {
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
        bitrate: VIDEO_BITRATE,
        frameRate: OUTPUT_FPS,
      })
  if (!videoOk) {
    throw new Error('הדפדפן לא תומך בקידוד H.264. ייצוא עובד ב-Chrome או ב-Edge.')
  }

  const nativeAac = await canEncodeAudio('aac', {
    numberOfChannels: 2,
    sampleRate: 48000,
    bitrate: AUDIO_BITRATE,
    fullCodecString: 'mp4a.40.2',
  })
  if (!nativeAac) {
    onProgress({ ratio: 0.01, label: 'טוען מקודד AAC' })
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
    registerAacEncoder()
  }

  onProgress({ ratio: 0.02, label: 'מכין את פס הקול' })
  const totalFrames = Math.max(1, Math.ceil(duration * OUTPUT_FPS - 1e-6))
  const timelineDuration = totalFrames / OUTPUT_FPS
  const audioBuffer = await mixProjectAudio(project, assets, timelineDuration)
  if (signal?.aborted) throw new DOMException('הייצוא בוטל', 'AbortError')

  await document.fonts.load('700 72px Heebo')
  await document.fonts.ready

  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_WIDTH
  canvas.height = OUTPUT_HEIGHT
  canvas.style.position = 'fixed'
  canvas.style.left = '-12000px'
  canvas.style.top = '0'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('לא ניתן לפתוח משטח ציור לייצוא')

  const opened: VideoCursor[] = []
  const images = new Map<string, ImageBitmap>()
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))

  const target = new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  })
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    quality: new Quality({ bitrate: VIDEO_BITRATE }),
    keyFrameInterval: 2,
    latencyMode: 'quality',
    hardwareAcceleration: 'no-preference',
    ...(highProfile ? { fullCodecString: HIGH_PROFILE } : {}),
  })
  const audioSource = new AudioBufferSource({
    codec: 'aac',
    quality: new Quality({ bitrate: AUDIO_BITRATE }),
    fullCodecString: 'mp4a.40.2',
  })
  output.addVideoTrack(videoSource, { frameRate: OUTPUT_FPS })
  output.addAudioTrack(audioSource)

  try {
    onProgress({ ratio: 0.08, label: 'פותח את מקורות הווידאו' })
    for (const clip of project.clips) {
      if (!clip.assetId || clip.text) continue
      const asset = assetById.get(clip.assetId)
      const blob = getBlob(clip.assetId)
      if (!asset || !blob) continue
      if (asset.kind === 'image') {
        if (!images.has(asset.id)) images.set(asset.id, await createImageBitmap(blob))
        continue
      }
      if (asset.kind !== 'video') continue
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
      const track = await input.getPrimaryVideoTrack()
      if (!track || !(await track.canDecode())) {
        input.dispose()
        continue
      }
      const sink = new CanvasSink(track)
      const start = Math.max(0, clip.inPoint - 0.2)
      const end = clip.inPoint + clip.duration + 0.15
      opened.push({
        clip,
        width: asset.width || track.displayWidth || OUTPUT_WIDTH,
        height: asset.height || track.displayHeight || OUTPUT_HEIGHT,
        iter: sink.canvases(start, end),
        current: null,
        next: null,
        done: false,
        input,
      })
    }

    await output.start()
    onProgress({ ratio: 0.12, label: 'מקודד AAC' })
    await audioSource.add(audioBuffer)
    audioSource.close()

    const missing = new Set<string>()
    for (const clip of project.clips) {
      if (!clip.assetId || clip.text) continue
      const asset = assetById.get(clip.assetId)
      if (!asset) {
        missing.add(clip.id)
        continue
      }
      if (asset.kind === 'video' && !opened.some((cursor) => cursor.clip.id === clip.id)) missing.add(clip.id)
      if (asset.kind === 'image' && !images.has(asset.id)) missing.add(clip.id)
    }

    for (let frame = 0; frame < totalFrames; frame++) {
      if (signal?.aborted) throw new DOMException('הייצוא בוטל', 'AbortError')
      const time = frame / OUTPUT_FPS
      for (const cursor of opened) {
        const local = time - cursor.clip.start
        if (local < -0.001 || local >= cursor.clip.duration) continue
        await advanceCursor(cursor, cursor.clip.inPoint + local)
      }
      paintFrame(
        ctx,
        project,
        time,
        (clip): Visual => {
          if (missing.has(clip.id)) return { status: 'missing' }
          const image = clip.assetId ? images.get(clip.assetId) : undefined
          if (image) return { status: 'ready', source: image, width: image.width, height: image.height }
          const cursor = opened.find((item) => item.clip.id === clip.id)
          if (cursor?.current) {
            return {
              status: 'ready',
              source: cursor.current.canvas,
              width: cursor.width,
              height: cursor.height,
            }
          }
          return { status: 'pending' }
        },
        null,
      )
      await videoSource.add(time, 1 / OUTPUT_FPS)
      if (frame % 4 === 0 || frame === totalFrames - 1) {
        onProgress({
          ratio: 0.15 + 0.8 * ((frame + 1) / totalFrames),
          label: `מרנדר פריים ${frame + 1} מתוך ${totalFrames}`,
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    videoSource.close()
    onProgress({ ratio: 0.97, label: 'סוגר את קובץ ה-MP4' })
    await output.finalize()
    const buffer = target.buffer
    if (!buffer) throw new Error('הייצוא הסתיים בלי נתונים')
    onProgress({ ratio: 1, label: 'הקובץ מוכן' })
    return new Blob([buffer], { type: 'video/mp4' })
  } catch (error) {
    try {
      await output.cancel()
    } catch {
      /* already closed */
    }
    throw error
  } finally {
    canvas.remove()
    for (const cursor of opened) cursor.input.dispose()
    for (const image of images.values()) image.close()
  }
}
