import { useEffect, useRef } from 'react'
import { ImageDown, Pause, Play, SkipBack } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getUrl } from '@/lib/blobs'
import { analyzeSpeech, audibleClips, clipPlaybackBuffer, loadAudioBuffer, schedulePreviewGain } from '@/lib/audio'
import { clampSpeed, projectDuration, sourceTimeAt, updateText, videoLayers } from '@/lib/edit'
import { paintFrame, type Visual } from '@/lib/paint'
import { formatTimecode } from '@/lib/time'
import {
  downloadThumbnail,
  endGesture,
  getPlayhead,
  getState,
  isPlaying,
  live,
  onTransport,
  registerFrameGrab,
  seek,
  selectClip,
  subscribeFrames,
  togglePlay,
} from '@/state/editor'
import { useEditor, usePlaying } from '@/state/hooks'
import { presetById, type Asset, type Clip, type Project } from '@/types'

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
      source.playbackRate.value = playback.rate
      const gain = ctx.createGain()
      schedulePreviewGain(gain.gain, project, assets, clip, time, now)
      source.connect(gain)
      gain.connect(ctx.destination)
      const when = local < 0 ? now + (clip.start - time) : now
      source.start(when, playback.offset, playback.span)
      this.nodes.push(source)
    }
  }
}

export function Preview() {
  const project = useEditor((state) => state.project)
  const assets = useEditor((state) => state.assets)
  const selectedClipId = useEditor((state) => state.selectedClipId)
  const playing = usePlaying()
  const exportPreset = useEditor((state) => state.exportPreset)
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
  }, [project, assets, selectedClipId])

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
      const assetsNow = assetById()
      const active = new Set<string>()
      const layers = videoLayers(currentProject, time)

      for (const clip of currentProject.clips) {
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
        if (video.playbackRate !== clampSpeed(clip.speed)) video.playbackRate = clampSpeed(clip.speed)
        if (video.readyState >= 1 && Math.abs(video.currentTime - sourceTime) > (playingNow ? 0.2 : 0.04)) {
          try {
            const maxTime = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.001) : sourceTime
            video.currentTime = Math.min(sourceTime, maxTime)
          } catch {
            /* seek can throw while metadata is loading */
          }
        }
        if (playingNow && video.paused) void video.play().catch(() => {})
        if (!playingNow && !video.paused) video.pause()
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

      paintFrame(ctx, currentProject, time, visualFor, selectedRef.current)
      if (timecodeRef.current) {
        const fps = presetById(getState().exportPreset).fps
        timecodeRef.current.textContent = `${formatTimecode(time, fps)} / ${formatTimecode(projectDuration(currentProject), fps)}`
      }
    }

    draw.current = render

    const resize = () => {
      const rect = stage.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(2, Math.round(rect.width * dpr))
      canvas.height = Math.max(2, Math.round(rect.height * dpr))
      render()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(stage)
    resize()
    const unsubscribe = subscribeFrames(() => render())
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

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0c0d11]">
      <div className="flex min-h-0 flex-1 items-center justify-center p-3" style={{ containerType: 'size' }}>
        <div
          ref={stageRef}
          className="relative overflow-hidden rounded-lg bg-black shadow-2xl ring-1 ring-white/10"
          style={{
            width: `min(100cqw, calc(100cqh * ${aspect}))`,
            height: `min(100cqh, calc(100cqw / ${aspect}))`,
          }}
        >
          <canvas
            ref={canvasRef}
            className="h-full w-full"
            onPointerDown={(event) => {
              const canvas = canvasRef.current
              if (!canvas) return
              const rect = canvas.getBoundingClientRect()
              const x = (event.clientX - rect.left) / rect.width
              const y = (event.clientY - rect.top) / rect.height
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
                <p className="text-base font-medium text-zinc-100">אין מה להציג עדיין</p>
                <p className="mt-1 text-sm text-zinc-400">ייבאו מדיה והניחו אותה על ציר הזמן</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <div ref={hostRef} className="pointer-events-none fixed start-[-2000px] top-0 h-24 w-40 overflow-hidden opacity-0" aria-hidden />
      <div className="flex h-12 shrink-0 items-center gap-2 border-t px-3">
        <Button type="button" size="icon-sm" variant="ghost" aria-label="חזרה להתחלה" onClick={() => seek(0)}>
          <SkipBack />
        </Button>
        <Button type="button" size="icon-sm" variant="secondary" aria-label={playing ? 'השהיה' : 'ניגון'} onClick={togglePlay}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <span ref={timecodeRef} dir="ltr" className="font-mono text-xs text-muted-foreground tabular-nums">
          00:00.00 / 00:00.00
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={downloadThumbnail}>
          <ImageDown />
          תמונה ממוזערת
        </Button>
        <p className="ms-auto hidden text-[11px] text-muted-foreground sm:block">גררו כתוביות בתצוגה כדי למקם אותן</p>
      </div>
    </section>
  )
}
