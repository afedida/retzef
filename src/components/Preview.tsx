import { useEffect, useRef } from 'react'
import { ImageDown, Pause, Play, SkipBack } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getUrl } from '@/lib/blobs'
import { analyzeSpeech, audibleClips, clipPlaybackBuffer, loadAudioBuffer, schedulePreviewGain } from '@/lib/audio'
import { youtubeSafeGuides } from '@/lib/creator'
import { guideLabel } from '@/lib/i18n'
import { clampSpeed, flattenCompounds, projectDuration, sourceTimeAt, updateText, videoLayers } from '@/lib/edit'
import { matchPatch } from '@/lib/track'
import { paintFrame, type Visual } from '@/lib/paint'
import { formatTimecode } from '@/lib/time'
import {
  applyMotion,
  downloadThumbnail,
  endGesture,
  getPlayhead,
  getState,
  isPlaying,
  live,
  onTransport,
  registerFrameGrab,
  registerPreviewGrab,
  seek,
  selectClip,
  setReviewRate,
  setStatus,
  subscribeFrames,
  togglePlay,
} from '@/state/editor'
import { useEditor, usePlaying, useT } from '@/state/hooks'
import { presetById, REVIEW_RATES, type Asset, type Clip, type Project, type ReviewRate } from '@/types'

class PreviewMixer {
  private ctx: AudioContext | null = null
  private nodes: AudioBufferSourceNode[] = []
  private token = 0

  stop() {
    this.token += 1
    for (const node of this.nodes) {
      try {
        node.stop()
      } catch {
        /* already stopped */
      }
      node.disconnect()
    }
    this.nodes = []
  }

  async start(project: Project, assets: Asset[], time: number) {
    this.stop()
    const token = this.token
    const ctx = this.ctx ?? new AudioContext()
    this.ctx = ctx
    if (ctx.state === 'suspended') await ctx.resume()
    if (token !== this.token) return
    const now = ctx.currentTime + 0.04
    const review = getState().reviewRate || 1
    for (const clip of audibleClips(project, assets)) {
      if (!clip.assetId) continue
      const buffer = await loadAudioBuffer(clip.assetId)
      if (token !== this.token || !buffer) continue
      const local = time - clip.start
      if (local >= clip.duration) continue
      const speed = clampSpeed(clip.speed)
      const offset = clip.inPoint + Math.max(0, local) * speed
      if (offset >= buffer.duration) continue
      const playFor = Math.min((clip.duration - Math.max(0, local)) * speed, buffer.duration - offset)
      if (playFor <= 0.01) continue
      const playback = await clipPlaybackBuffer(clip, buffer, offset, playFor)
      if (token !== this.token) return
      const source = ctx.createBufferSource()
      source.buffer = playback.buffer
      source.playbackRate.value = playback.rate * review
      const gain = ctx.createGain()
      const panner = ctx.createStereoPanner()
      panner.pan.value = Math.min(1, Math.max(-1, clip.pan ?? 0))
      schedulePreviewGain(gain.gain, project, assets, clip, time, now, review)
      source.connect(gain)
      gain.connect(panner)
      panner.connect(ctx.destination)
      const when = local < 0 ? now + (clip.start - time) / review : now
      source.start(when, playback.offset, playback.span)
      this.nodes.push(source)
    }
  }
}

export function Preview() {
  const t = useT()
  const project = useEditor((state) => state.project)
  const assets = useEditor((state) => state.assets)
  const selectedClipId = useEditor((state) => state.selectedClipId)
  const playing = usePlaying()
  const exportPreset = useEditor((state) => state.exportPreset)
  const reviewRate = useEditor((state) => state.reviewRate)
  const showGuides = useEditor((state) => state.showGuides)
  const gradeBypass = useEditor((state) => state.gradeBypass)
  const frame = presetById(exportPreset)
  const aspect = frame.width / frame.height
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const videosRef = useRef(new Map<string, HTMLVideoElement>())
  const imagesRef = useRef(new Map<string, HTMLImageElement>())
  const mixerRef = useRef(new PreviewMixer())
  const projectRef = useRef(project)
  const assetsRef = useRef(assets)
  const selectedRef = useRef(selectedClipId)
  const timecodeRef = useRef<HTMLSpanElement>(null)
  const draw = useRef<() => void>(() => {})

  useEffect(() => {
    projectRef.current = project
    assetsRef.current = assets
    selectedRef.current = selectedClipId
    draw.current()
  }, [project, assets, selectedClipId, gradeBypass])

  useEffect(() => {
    for (const clip of project.clips) {
      const asset = assets.find((item) => item.id === clip.assetId)
      if (asset?.hasAudio && clip.assetId) void loadAudioBuffer(clip.assetId)
    }
    void analyzeSpeech(project, assets)
  }, [project, assets])

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return

    const assetById = () => new Map(assetsRef.current.map((asset) => [asset.id, asset]))

    const ensureVideo = (clipId: string, assetId: string) => {
      let video = videosRef.current.get(clipId)
      if (!video) {
        video = document.createElement('video')
        video.muted = true
        video.volume = 0
        video.playsInline = true
        video.preload = 'auto'
        video.dataset.bound = '1'
        video.addEventListener('seeked', () => draw.current())
        video.addEventListener('loadeddata', () => draw.current())
        hostRef.current?.append(video)
        videosRef.current.set(clipId, video)
      }
      const url = getUrl(assetId)
      if (url && video.dataset.asset !== assetId) {
        video.src = url
        video.dataset.asset = assetId
      }
      return video
    }

    const ensureImage = (assetId: string) => {
      let image = imagesRef.current.get(assetId)
      if (!image) {
        image = new Image()
        image.onload = () => draw.current()
        imagesRef.current.set(assetId, image)
      }
      const url = getUrl(assetId)
      if (url && image.dataset.asset !== assetId) {
        image.src = url
        image.dataset.asset = assetId
      }
      return image
    }

    const render = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const currentProject = projectRef.current
      const fpsNow = presetById(getState().exportPreset).fps
      const time = Math.floor(getPlayhead() * fpsNow + 1e-4) / fpsNow
      const playingNow = isPlaying()
      const stageBox = stage.getBoundingClientRect()
      const dpr = playingNow ? 1 : Math.min(window.devicePixelRatio || 1, 2)
      let pixelWidth = Math.max(2, Math.round(stageBox.width * dpr))
      let pixelHeight = Math.max(2, Math.round(stageBox.height * dpr))
      const cap = playingNow ? 960 : 1920
      if (pixelWidth > cap) {
        pixelHeight = Math.max(2, Math.round((pixelHeight * cap) / pixelWidth))
        pixelWidth = cap
      }
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      const assetsNow = assetById()
      const active = new Set<string>()
      const flat = flattenCompounds(currentProject)
      const layers = videoLayers(flat, time)

      for (const clip of flat.clips) {
        const asset = clip.assetId ? assetsNow.get(clip.assetId) : undefined
        if (!asset || asset.kind !== 'video') continue
        active.add(clip.id)
        const video = ensureVideo(clip.id, asset.id)
        const local = time - clip.start
        const layer = layers.find((item) => item.clip.id === clip.id)
        const visible = Boolean(layer) || (local >= -0.08 && local < clip.duration + 0.02)
        if (!visible) {
          if (!video.paused) video.pause()
          continue
        }
        const sourceTime = sourceTimeAt(clip, layer ? layer.sourceLocal : local)
        const reversed = clip.reverse
        const pictureRate = clampSpeed(clip.speed) * (playingNow ? getState().reviewRate || 1 : 1)
        if (!reversed && video.playbackRate !== pictureRate) video.playbackRate = pictureRate
        if (video.readyState >= 1 && Math.abs(video.currentTime - sourceTime) > (playingNow && !reversed ? 0.2 : 0.04)) {
          try {
            const maxTime = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.001) : sourceTime
            video.currentTime = Math.min(sourceTime, maxTime)
          } catch {
            /* seek can throw while metadata is loading */
          }
        }
        if (reversed) {
          if (!video.paused) video.pause()
        } else {
          if (playingNow && video.paused) void video.play().catch(() => {})
          if (!playingNow && !video.paused) video.pause()
        }
      }

      for (const [id, video] of videosRef.current) {
        if (active.has(id)) continue
        video.pause()
        video.remove()
        videosRef.current.delete(id)
      }

      const visualFor = (clip: Clip): Visual => {
        const asset = clip.assetId ? assetsNow.get(clip.assetId) : undefined
        if (!clip.assetId || !asset) return clip.text ? { status: 'pending' } : { status: 'missing' }
        if (asset.kind === 'image') {
          const image = ensureImage(asset.id)
          if (!image.complete || !image.naturalWidth) return { status: 'pending' }
          return { status: 'ready', source: image, width: image.naturalWidth, height: image.naturalHeight }
        }
        if (asset.kind === 'video') {
          const video = videosRef.current.get(clip.id)
          if (!video || video.readyState < 2 || !video.videoWidth) return { status: 'pending' }
          return { status: 'ready', source: video, width: video.videoWidth, height: video.videoHeight }
        }
        return { status: 'pending' }
      }

      paintFrame(ctx, flat, time, visualFor, selectedRef.current, { gradeBypass: getState().gradeBypass })
      if (timecodeRef.current) {
        const fps = presetById(getState().exportPreset).fps
        timecodeRef.current.textContent = `${formatTimecode(time, fps)} / ${formatTimecode(projectDuration(currentProject), fps)}`
      }
    }

    draw.current = render

    const resize = () => render()
    const observer = new ResizeObserver(resize)
    observer.observe(stage)
    resize()
    const unsubscribe = subscribeFrames(() => render())
    const unregisterGrab = registerPreviewGrab(
      () =>
        new Promise((resolve) => {
          canvas.toBlob((blob) => resolve(blob), 'image/png')
        }),
    )
    const unregister = registerFrameGrab(() => {
      canvas.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        const safe = getState().project.name.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim() || 'retzef'
        link.href = url
        link.download = `${safe}-thumbnail.png`
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1500)
      }, 'image/png')
    })
    return () => {
      observer.disconnect()
      unsubscribe()
      unregister()
      unregisterGrab()
    }
  }, [])

  useEffect(() => {
    const mixer = mixerRef.current
    return onTransport((event) => {
      if (event === 'pause' || !isPlaying()) {
        mixer.stop()
        for (const video of videosRef.current.values()) video.pause()
        return
      }
      void mixer.start(projectRef.current, assetsRef.current, getPlayhead())
    })
  }, [])

  useEffect(() => {
    const videos = videosRef.current
    const mixer = mixerRef.current
    return () => {
      mixer.stop()
      for (const video of videos.values()) {
        video.pause()
        video.src = ''
        video.remove()
      }
      videos.clear()
    }
  }, [])

  const empty = project.clips.length === 0

  const trackAt = async (nx: number, ny: number) => {
    const current = getState()
    const text = current.project.clips.find((clip) => clip.id === current.selectedClipId && clip.text)
    if (!text?.text) {
      setStatus(t('preview.pickCaption'))
      return
    }
    const flat = flattenCompounds(current.project)
    const time = getPlayhead()
    const videoClip = [...flat.clips].reverse().find((clip) => {
      const asset = current.assets.find((item) => item.id === clip.assetId)
      return asset?.kind === 'video' && time >= clip.start && time < clip.start + clip.duration
    })
    const video = videoClip ? videosRef.current.get(videoClip.id) : undefined
    if (!videoClip || !video) {
      setStatus(t('preview.noVideo'))
      return
    }
    const sample = document.createElement('canvas')
    sample.width = 160
    sample.height = 90
    const context = sample.getContext('2d', { willReadFrequently: true })
    if (!context) return
    const paint = (sourceTime: number) =>
      new Promise<void>((resolve) => {
        video.pause()
        const max = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.04) : sourceTime
        const target = Math.min(Math.max(0, sourceTime), max)
        if (Math.abs(video.currentTime - target) < 0.03) {
          context.drawImage(video, 0, 0, sample.width, sample.height)
          resolve()
          return
        }
        video.addEventListener(
          'seeked',
          () => {
            context.drawImage(video, 0, 0, sample.width, sample.height)
            resolve()
          },
          { once: true },
        )
        video.currentTime = target
      })
    await paint(sourceTimeAt(videoClip, time - videoClip.start))
    const size = 16
    let originX = Math.max(0, Math.min(sample.width - size, Math.round(nx * sample.width) - size / 2))
    let originY = Math.max(0, Math.min(sample.height - size, Math.round(ny * sample.height) - size / 2))
    const patch = new Uint8ClampedArray(context.getImageData(originX, originY, size, size).data)
    const points: { time: number; x: number; y: number }[] = []
    for (let step = 0; step <= 16; step++) {
      const local = time - videoClip.start + step * 0.12
      if (local >= videoClip.duration) break
      await paint(sourceTimeAt(videoClip, local))
      const frame = context.getImageData(0, 0, sample.width, sample.height).data
      const found = matchPatch(frame, sample.width, sample.height, patch, size, originX, originY, 18)
      originX = found.x
      originY = found.y
      points.push({
        time: time + step * 0.12,
        x: (found.x + size / 2) / sample.width,
        y: (found.y + size / 2) / sample.height,
      })
    }
    if (points.length) applyMotion(text.id, points)
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="flex min-h-0 flex-1 items-center justify-center p-3" style={{ containerType: 'size' }}>
        <div
          ref={stageRef}
          className="relative overflow-hidden rounded-md bg-black ring-1 ring-border"
          style={{
            width: `min(100cqw, calc(100cqh * ${aspect}))`,
            height: `min(100cqh, calc(100cqw / ${aspect}))`,
          }}
        >
          {showGuides && (
            <div className="pointer-events-none absolute inset-0">
              {youtubeSafeGuides().map((guide) => (
                <div
                  key={guide.id}
                  className="absolute border border-[#50e6ff]/80"
                  style={{ left: `${guide.x * 100}%`, top: `${guide.y * 100}%`, width: `${guide.w * 100}%`, height: `${guide.h * 100}%` }}
                >
                  <span className="absolute start-1 top-0.5 text-[10px] text-white drop-shadow">{guideLabel(guide.id)}</span>
                </div>
              ))}
            </div>
          )}
          <canvas
            ref={canvasRef}
            className="h-full w-full"
            onPointerDown={(event) => {
              const canvas = canvasRef.current
              if (!canvas) return
              const rect = canvas.getBoundingClientRect()
              const x = (event.clientX - rect.left) / rect.width
              const y = (event.clientY - rect.top) / rect.height
              if (getState().trackArmed) {
                void trackAt(x, y)
                return
              }
              const time = getPlayhead()
              const hit = project.clips
                .filter((clip) => clip.text && time >= clip.start && time < clip.start + clip.duration)
                .find((clip) => clip.text && Math.abs(clip.text.x - x) < 0.22 && Math.abs(clip.text.y - y) < 0.12)
              if (!hit) return
              selectClip(hit.id)
              const originX = hit.text?.x ?? 0.5
              const originY = hit.text?.y ?? 0.5
              const startX = event.clientX
              const startY = event.clientY
              const move = (ev: PointerEvent) => {
                const nx = Math.min(1, Math.max(0, originX + (ev.clientX - startX) / rect.width))
                const ny = Math.min(1, Math.max(0, originY + (ev.clientY - startY) / rect.height))
                live((base) => updateText(base, hit.id, { x: nx, y: ny }))
              }
              const up = () => {
                endGesture()
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          />
          {empty && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
              <div>
                <p className="text-base font-medium">{t('preview.emptyTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('preview.emptyHint')}</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <div ref={hostRef} className="pointer-events-none fixed start-[-2000px] top-0 h-24 w-40 overflow-hidden opacity-0" aria-hidden />
      <div className="flex h-12 shrink-0 items-center gap-2 border-t px-3">
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t('preview.goStart')} onClick={() => seek(0)}>
          <SkipBack />
        </Button>
        <Button type="button" size="icon-sm" variant="secondary" aria-label={playing ? t('preview.pause') : t('preview.play')} onClick={togglePlay}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <span ref={timecodeRef} dir="ltr" className="font-mono text-xs text-muted-foreground tabular-nums">
          00:00.00 / 00:00.00
        </span>
        <div className="flex items-center gap-1" aria-label={t('preview.reviewRate')}>
          {REVIEW_RATES.map((rate) => (
            <Button
              key={rate}
              type="button"
              size="sm"
              variant={reviewRate === rate ? 'secondary' : 'ghost'}
              aria-pressed={reviewRate === rate}
              onClick={() => setReviewRate(rate as ReviewRate)}
            >
              {rate}x
            </Button>
          ))}
        </div>
        {gradeBypass && <span className="text-[11px] text-[#50e6ff]">{t('preview.noGrade')}</span>}
        <Button type="button" size="sm" variant="ghost" onClick={downloadThumbnail}>
          <ImageDown />
          {t('preview.thumbnail')}
        </Button>
        <p className="ms-auto hidden text-[11px] text-muted-foreground sm:block">{t('preview.dragHint')}</p>
      </div>
    </section>
  )
}
