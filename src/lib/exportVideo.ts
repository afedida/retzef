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
  StreamTarget,
  canEncodeAudio,
  canEncodeVideo,
  type StreamTargetChunk,
  type WrappedCanvas,
} from 'mediabunny'
import { getBlob } from '@/lib/blobs'
import { mixProjectAudio } from '@/lib/audio'
import { flattenCompounds, projectDuration, sourceTimeAt, videoLayers } from '@/lib/edit'
import { paintFrame, type Visual } from '@/lib/paint'
import {
  AUDIO_BITRATE,
  presetById,
  type Asset,
  type Clip,
  type ExportPresetId,
  type Project,
} from '@/types'

export type ExportProgress = {
  ratio: number
  label: string
}

export type ExportResult = {
  mode: 'download' | 'file'
  blob: Blob | null
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

async function seekExportVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const max = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.04) : time
  const target = Math.min(Math.max(0, time), max)
  if (video.readyState >= 1 && Math.abs(video.currentTime - target) < 0.03) return
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', fail)
      resolve()
    }
    const fail = () => {
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', fail)
      reject(new Error('חיפוש בפריים הפוך נכשל'))
    }
    video.addEventListener('seeked', done)
    video.addEventListener('error', fail)
    video.currentTime = target
  })
}

export async function exportProject(
  project: Project,
  assets: Asset[],
  onProgress: (progress: ExportProgress) => void,
  signal?: AbortSignal,
  options?: { preset?: ExportPresetId; stream?: WritableStream<StreamTargetChunk> | null },
): Promise<ExportResult> {
  const preset = presetById(options?.preset ?? '1080p30')
  const timeline = flattenCompounds(project)
  const duration = projectDuration(timeline)
  if (duration <= 0) throw new Error('אין קליפים על ציר הזמן')
  if (duration > 10 * 60) throw new Error('הייצוא בגרסה הזו מוגבל לעשר דקות')
  if (signal?.aborted) throw new DOMException('הייצוא בוטל', 'AbortError')

  const highProfile = await canEncodeVideo('avc', {
    width: preset.width,
    height: preset.height,
    bitrate: preset.videoBitrate,
    frameRate: preset.fps,
    fullCodecString: HIGH_PROFILE,
  })
  const videoOk = highProfile
    ? true
    : await canEncodeVideo('avc', {
        width: preset.width,
        height: preset.height,
        bitrate: preset.videoBitrate,
        frameRate: preset.fps,
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
  const totalFrames = Math.max(1, Math.ceil(duration * preset.fps - 1e-6))
  const timelineDuration = totalFrames / preset.fps
  const audioBuffer = await mixProjectAudio(timeline, assets, timelineDuration)
  if (signal?.aborted) throw new DOMException('הייצוא בוטל', 'AbortError')

  await Promise.all([
    document.fonts.load('700 72px Heebo'),
    document.fonts.load('700 72px Rubik'),
    document.fonts.load('700 72px Assistant'),
    document.fonts.load('700 72px "Frank Ruhl Libre"'),
  ])
  await document.fonts.ready

  const canvas = document.createElement('canvas')
  canvas.width = preset.width
  canvas.height = preset.height
  canvas.style.position = 'fixed'
  canvas.style.left = '-12000px'
  canvas.style.top = '0'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('לא ניתן לפתוח משטח ציור לייצוא')

  const opened: VideoCursor[] = []
  const reversed: { clip: Clip; video: HTMLVideoElement; url: string }[] = []
  const images = new Map<string, ImageBitmap>()
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))

  const streaming = Boolean(options?.stream)
  const target = streaming ? new StreamTarget(options!.stream!, { chunked: true, chunkSize: 2 ** 20 }) : new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: streaming ? 'fragmented' : 'in-memory' }),
    target,
  })
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    quality: new Quality({ bitrate: preset.videoBitrate }),
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
  output.addVideoTrack(videoSource, { frameRate: preset.fps })
  output.addAudioTrack(audioSource)

  try {
    onProgress({ ratio: 0.08, label: 'פותח את מקורות הווידאו' })
    for (const clip of timeline.clips) {
      if (!clip.assetId || clip.text) continue
      const asset = assetById.get(clip.assetId)
      const blob = getBlob(clip.assetId)
      if (!asset || !blob) continue
      if (asset.kind === 'image') {
        if (!images.has(asset.id)) images.set(asset.id, await createImageBitmap(blob))
        continue
      }
      if (asset.kind !== 'video') continue
      if (clip.reverse) {
        const url = URL.createObjectURL(blob)
        const video = document.createElement('video')
        video.muted = true
        video.playsInline = true
        video.preload = 'auto'
        video.src = url
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve()
          video.onerror = () => reject(new Error('לא ניתן לפתוח קליפ הפוך'))
        })
        reversed.push({ clip, video, url })
        continue
      }
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
      const track = await input.getPrimaryVideoTrack()
      if (!track || !(await track.canDecode())) {
        input.dispose()
        continue
      }
      const sink = new CanvasSink(track)
      const speed = clip.speed > 0 ? clip.speed : 1
      const handle = Math.max(2, (clip.transition?.duration ?? 0) + 0.5) * speed
      const start = Math.max(0, clip.inPoint - handle)
      const end = clip.inPoint + clip.duration * speed + handle
      opened.push({
        clip,
        width: asset.width || track.displayWidth || preset.width,
        height: asset.height || track.displayHeight || preset.height,
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
    for (const clip of timeline.clips) {
      if (!clip.assetId || clip.text) continue
      const asset = assetById.get(clip.assetId)
      if (!asset) {
        missing.add(clip.id)
        continue
      }
      if (asset.kind === 'video' && !clip.reverse && !opened.some((cursor) => cursor.clip.id === clip.id)) missing.add(clip.id)
      if (asset.kind === 'video' && clip.reverse && !reversed.some((item) => item.clip.id === clip.id)) missing.add(clip.id)
      if (asset.kind === 'image' && !images.has(asset.id)) missing.add(clip.id)
    }

    for (let frame = 0; frame < totalFrames; frame++) {
      if (signal?.aborted) throw new DOMException('הייצוא בוטל', 'AbortError')
      const time = frame / preset.fps
      const layers = videoLayers(timeline, time)
      for (const cursor of opened) {
        const layer = layers.find((item) => item.clip.id === cursor.clip.id)
        if (!layer) continue
        await advanceCursor(cursor, sourceTimeAt(cursor.clip, layer.sourceLocal))
      }
      for (const hold of reversed) {
        const layer = layers.find((item) => item.clip.id === hold.clip.id)
        if (!layer) continue
        await seekExportVideo(hold.video, sourceTimeAt(hold.clip, layer.sourceLocal))
      }
      paintFrame(
        ctx,
        timeline,
        time,
        (clip): Visual => {
          if (missing.has(clip.id)) return { status: 'missing' }
          const image = clip.assetId ? images.get(clip.assetId) : undefined
          if (image) return { status: 'ready', source: image, width: image.width, height: image.height }
          const hold = reversed.find((item) => item.clip.id === clip.id)
          if (hold?.video && hold.video.readyState >= 2 && hold.video.videoWidth) {
            return { status: 'ready', source: hold.video, width: hold.video.videoWidth, height: hold.video.videoHeight }
          }
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
      await videoSource.add(time, 1 / preset.fps)
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
    if (streaming) {
      onProgress({ ratio: 1, label: 'הקובץ נשמר' })
      return { mode: 'file', blob: null }
    }
    if (!(target instanceof BufferTarget) || !target.buffer) throw new Error('הייצוא הסתיים בלי נתונים')
    onProgress({ ratio: 1, label: 'הקובץ מוכן' })
    return { mode: 'download', blob: new Blob([target.buffer], { type: 'video/mp4' }) }
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
    for (const hold of reversed) {
      hold.video.src = ''
      URL.revokeObjectURL(hold.url)
    }
    for (const image of images.values()) image.close()
  }
}
