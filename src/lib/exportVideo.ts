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
import { compositeAvailable, compositeFrame, compositeImage } from '@/lib/composite'
import { mixProjectAudio, sliceAudioBuffer } from '@/lib/audio'
import { exportWindow } from '@/lib/creator'
import { flattenCompounds, projectDuration, sourceTimeAt, videoLayers } from '@/lib/edit'
import {
  accelerationLabel,
  canUseWorkerComposite,
  chooseAcceleration,
  fallbackAcceleration,
  formatRealtime,
  PIPELINE_DEPTH,
  realtimeFactor,
  workerLayerPlan,
  workerOverlay,
  type Acceleration,
} from '@/lib/exportSpeed'
import { t } from '@/lib/i18n'
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
  speed: number
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
      reject(new Error(t('error.reverseSeek')))
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
  options?: {
    preset?: ExportPresetId
    stream?: WritableStream<StreamTargetChunk> | null
    acceleration?: Acceleration
    legacy?: boolean
    blobs?: Map<string, Blob>
  },
): Promise<ExportResult> {
  const preset = presetById(options?.preset ?? '1080p30')
  const timeline = flattenCompounds(project)
  const duration = projectDuration(timeline)
  const range = exportWindow(timeline)
  if (duration <= 0 || range.duration <= 0) throw new Error(t('error.noClips'))
  if (range.duration > 10 * 60) throw new Error(t('error.tenMinutes'))
  if (signal?.aborted) throw new DOMException(t('error.exportCancelled'), 'AbortError')

  const readBlob = (id: string) => options?.blobs?.get(id) ?? getBlob(id)
  const legacy = options?.legacy === true
  const pipeline = !legacy
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
    throw new Error(t('error.noH264'))
  }

  const nativeAac = await canEncodeAudio('aac', {
    numberOfChannels: 2,
    sampleRate: 48000,
    bitrate: AUDIO_BITRATE,
    fullCodecString: 'mp4a.40.2',
  })
  if (!nativeAac) {
    onProgress({ ratio: 0.01, label: t('error.aac'), speed: 0 })
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
    registerAacEncoder()
  }

  onProgress({ ratio: 0.02, label: range.ranged ? t('error.audioRange') : t('error.audio'), speed: 0 })
  const totalFrames = Math.max(1, Math.ceil(range.duration * preset.fps - 1e-6))
  const timelineDuration = totalFrames / preset.fps
  const mixed = await mixProjectAudio(timeline, assets, range.start + timelineDuration)
  const audioBuffer = sliceAudioBuffer(mixed, range.start, timelineDuration)
  if (signal?.aborted) throw new DOMException(t('error.exportCancelled'), 'AbortError')

  await Promise.all([
    document.fonts.load('700 72px Heebo'),
    document.fonts.load('700 72px Rubik'),
    document.fonts.load('700 72px Assistant'),
    document.fonts.load('700 72px "Frank Ruhl Libre"'),
  ])
  await document.fonts.ready

  const surface = createExportSurface(preset.width, preset.height, legacy)
  const canvas = surface.canvas
  const ctx = surface.ctx
  const requested: Acceleration = legacy ? 'no-preference' : (options?.acceleration ?? 'prefer-hardware')
  const hardwareOk =
    requested === 'prefer-hardware'
      ? await canEncodeVideo('avc', {
          width: preset.width,
          height: preset.height,
          bitrate: preset.videoBitrate,
          frameRate: preset.fps,
          hardwareAcceleration: 'prefer-hardware',
          ...(highProfile ? { fullCodecString: HIGH_PROFILE } : {}),
        })
      : false
  let acceleration = chooseAcceleration(hardwareOk, requested)

  const opened: VideoCursor[] = []
  const reversed: { clip: Clip; video: HTMLVideoElement; url: string }[] = []
  const images = new Map<string, ImageBitmap>()
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))

  const streaming = Boolean(options?.stream)
  const openOutput = (mode: Acceleration) => {
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
      hardwareAcceleration: mode,
      ...(highProfile ? { fullCodecString: HIGH_PROFILE } : {}),
    })
    const audioSource = new AudioBufferSource({
      codec: 'aac',
      quality: new Quality({ bitrate: AUDIO_BITRATE }),
      fullCodecString: 'mp4a.40.2',
    })
    output.addVideoTrack(videoSource, { frameRate: preset.fps })
    output.addAudioTrack(audioSource)
    return { target, output, videoSource, audioSource }
  }
  let mux = openOutput(acceleration)

  try {
    onProgress({ ratio: 0.08, label: t('error.openSources'), speed: 0 })
    for (const clip of timeline.clips) {
      if (!clip.assetId || clip.text) continue
      const asset = assetById.get(clip.assetId)
      const blob = readBlob(clip.assetId)
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
          video.onerror = () => reject(new Error(t('error.reverseOpen')))
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

    while (true) {
      try {
        await mux.output.start()
        break
      } catch (error) {
        const next = fallbackAcceleration(acceleration)
        if (!next) throw error
        try {
          await mux.output.cancel()
        } catch {
          /* not started */
        }
        acceleration = next
        mux = openOutput(acceleration)
        onProgress({ ratio: 0.1, label: t('error.software'), speed: 0 })
      }
    }
    onProgress({ ratio: 0.12, label: t('error.encoder', { label: accelerationLabel(acceleration) }), speed: 0 })
    await mux.audioSource.add(audioBuffer)
    mux.audioSource.close()

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

    const visualOf = (clip: Clip): Visual => {
      if (missing.has(clip.id)) return { status: 'missing' }
      const image = clip.assetId ? images.get(clip.assetId) : undefined
      if (image) return { status: 'ready', source: image, width: image.width, height: image.height }
      const hold = reversed.find((item) => item.clip.id === clip.id)
      if (hold?.video && hold.video.readyState >= 2 && hold.video.videoWidth) {
        return { status: 'ready', source: hold.video, width: hold.video.videoWidth, height: hold.video.videoHeight }
      }
      const cursor = opened.find((item) => item.clip.id === clip.id)
      if (cursor?.current) {
        return { status: 'ready', source: cursor.current.canvas, width: cursor.width, height: cursor.height }
      }
      return { status: 'pending' }
    }
    const settle = async (time: number) => {
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
    }
    let workerComposite = !legacy && compositeAvailable() && canUseWorkerComposite(timeline)
    const postedStill = new Set<string>()
    const paintAt = async (time: number) => {
      if (workerComposite) {
        try {
          const plans = workerLayerPlan(timeline, time, preset.width, preset.height, (clip) => {
            const visual = visualOf(clip)
            return visual.status === 'ready' ? { width: visual.width, height: visual.height } : null
          })
          const layers = []
          for (const plan of plans) {
            const clip = timeline.clips.find((item) => item.id === plan.clipId)
            if (!clip) continue
            const visual = visualOf(clip)
            if (visual.status !== 'ready') continue
            const imageId = clip.assetId ?? clip.id
            const still = Boolean(clip.assetId && images.has(clip.assetId))
            if (!still || !postedStill.has(imageId)) {
              compositeImage(imageId, await createImageBitmap(visual.source as ImageBitmapSource))
              if (still) postedStill.add(imageId)
            }
            layers.push({ imageId, dx: plan.dx, dy: plan.dy, dw: plan.dw, dh: plan.dh, opacity: plan.opacity })
          }
          const overlay = workerOverlay(timeline, time, preset.width, preset.height)
          const composed = await compositeFrame({
            width: preset.width,
            height: preset.height,
            layers,
            letterboxPx: overlay.letterboxPx,
            progress: overlay.progress,
          })
          ctx.drawImage(composed, 0, 0)
          composed.close()
          return
        } catch {
          workerComposite = false
        }
      }
      paintFrame(ctx, timeline, time, visualOf, null)
    }

    const encodeStarted = performance.now()
    const encodes: Promise<void>[] = []
    await settle(range.start)
    for (let frame = 0; frame < totalFrames; frame++) {
      if (signal?.aborted) throw new DOMException(t('error.exportCancelled'), 'AbortError')
      const time = range.start + frame / preset.fps
      await paintAt(time)
      const encoded = mux.videoSource.add(frame / preset.fps, 1 / preset.fps)
      const upcoming = frame + 1 < totalFrames ? settle(range.start + (frame + 1) / preset.fps) : Promise.resolve()
      if (pipeline) {
        encodes.push(encoded)
        if (encodes.length >= PIPELINE_DEPTH) await encodes.shift()
        await upcoming
      } else {
        await encoded
        await upcoming
      }
      if (frame % 4 === 0 || frame === totalFrames - 1) {
        const speed = realtimeFactor((frame + 1) / preset.fps, (performance.now() - encodeStarted) / 1000)
        onProgress({
          ratio: 0.15 + 0.8 * ((frame + 1) / totalFrames),
          label: t('error.frame', { current: frame + 1, total: totalFrames, speed: formatRealtime(speed) }),
          speed,
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    while (encodes.length) await encodes.shift()

    mux.videoSource.close()
    onProgress({ ratio: 0.97, label: t('error.muxClose'), speed: realtimeFactor(timelineDuration, (performance.now() - encodeStarted) / 1000) })
    await mux.output.finalize()
    const speed = realtimeFactor(timelineDuration, (performance.now() - encodeStarted) / 1000)
    if (streaming) {
      onProgress({ ratio: 1, label: t('error.saved'), speed })
      return { mode: 'file', blob: null }
    }
    if (!(mux.target instanceof BufferTarget) || !mux.target.buffer) throw new Error(t('error.noData'))
    onProgress({ ratio: 1, label: t('error.ready', { speed: formatRealtime(speed) }), speed })
    return { mode: 'download', blob: new Blob([mux.target.buffer], { type: 'video/mp4' }) }
  } catch (error) {
    try {
      await mux.output.cancel()
    } catch {
      /* already closed */
    }
    throw error
  } finally {
    surface.release()
    for (const cursor of opened) cursor.input.dispose()
    for (const hold of reversed) {
      hold.video.src = ''
      URL.revokeObjectURL(hold.url)
    }
    for (const image of images.values()) image.close()
  }
}

function createExportSurface(width: number, height: number, legacy: boolean): {
  canvas: HTMLCanvasElement | OffscreenCanvas
  ctx: CanvasRenderingContext2D
  release: () => void
} {
  if (!legacy && typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { alpha: false })
    if (ctx) return { canvas, ctx: ctx as unknown as CanvasRenderingContext2D, release: () => undefined }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.style.position = 'fixed'
  canvas.style.left = '-12000px'
  canvas.style.top = '0'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error(t('error.noCanvas'))
  return { canvas, ctx, release: () => canvas.remove() }
}
