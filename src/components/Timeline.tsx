import { useEffect, useRef, useState } from 'react'
import { Magnet, Minus, Plus, Scissors, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { clipEnd, projectDuration } from '@/lib/edit'
import { formatClock } from '@/lib/time'
import {
  endGesture,
  getPlayhead,
  importFiles,
  nudgeClip,
  nudgeTrim,
  placeAsset,
  removeSelectedClip,
  seek,
  selectClip,
  setPps,
  setSnap,
  splitAtPlayhead,
  subscribeFrames,
} from '@/state/editor'
import { useEditor } from '@/state/hooks'
import { cn } from '@/lib/utils'
import type { Asset, Clip, Track } from '@/types'

const RULER = 28
const ROW = 56

function assetIdFromDrop(data: DataTransfer): string | null {
  const custom = data.getData('application/x-retzef-asset')
  if (custom) return custom
  const plain = data.getData('text/plain')
  return plain.startsWith('retzef-asset:') ? plain.slice('retzef-asset:'.length) : null
}

function slicePeaks(asset: Asset, clip: Clip): number[] {
  if (!asset.peaks.length) return []
  if (asset.kind === 'image' || asset.duration <= 0) return asset.peaks
  const start = Math.min(asset.peaks.length - 1, Math.max(0, Math.floor((clip.inPoint / asset.duration) * asset.peaks.length)))
  const end = Math.min(asset.peaks.length, Math.max(start + 1, Math.ceil(((clip.inPoint + clip.duration) / asset.duration) * asset.peaks.length)))
  return asset.peaks.slice(start, end)
}

export function Timeline() {
  const project = useEditor((state) => state.project)
  const assets = useEditor((state) => state.assets)
  const selectedClipId = useEditor((state) => state.selectedClipId)
  const snap = useEditor((state) => state.snap)
  const pps = useEditor((state) => state.pps)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const [hotTrack, setHotTrack] = useState<string | null>(null)
  const duration = Math.max(90, projectDuration(project) + 12)
  const width = Math.max(duration * pps, 640)
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))

  useEffect(() => {
    const node = playheadRef.current
    const write = (time: number) => {
      if (node) node.style.transform = `translate3d(${time * pps}px, 0, 0)`
    }
    write(getPlayhead())
    return subscribeFrames(write)
  }, [pps])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const next = pps * (event.deltaY > 0 ? 0.9 : 1.1)
      const rect = scroller.getBoundingClientRect()
      const anchor = event.clientX - rect.left + scroller.scrollLeft
      const time = anchor / pps
      setPps(next)
      requestAnimationFrame(() => {
        scroller.scrollLeft = time * Math.min(280, Math.max(16, next)) - (event.clientX - rect.left)
      })
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [pps])

  const timeFromClient = (clientX: number) => {
    const content = contentRef.current
    if (!content) return 0
    const rect = content.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left) / pps)
  }

  const onRulerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const scrub = (clientX: number) => seek(timeFromClient(clientX))
    scrub(event.clientX)
    const move = (ev: PointerEvent) => scrub(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <section className="flex h-[min(34vh,320px)] min-h-[210px] shrink-0 flex-col border-t bg-[#121318]">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <Button type="button" size="sm" variant="secondary" onClick={splitAtPlayhead}>
          <Scissors />
          פיצול
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={!selectedClipId} onClick={removeSelectedClip}>
          <Trash2 />
          מחיקה
        </Button>
        <Button type="button" size="sm" variant={snap ? 'secondary' : 'ghost'} onClick={() => setSnap(!snap)} aria-pressed={snap}>
          <Magnet />
          הצמדה
        </Button>
        <div className="ms-auto flex items-center gap-1">
          <Button type="button" size="icon-sm" variant="ghost" aria-label="התרחקות" onClick={() => setPps(pps / 1.2)}>
            <Minus />
          </Button>
          <span dir="ltr" className="w-14 text-center font-mono text-[11px] text-muted-foreground">
            {Math.round(pps)} px/s
          </span>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="התקרבות" onClick={() => setPps(pps * 1.2)}>
            <Plus />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-24 shrink-0 border-e bg-card/50">
          <div style={{ height: RULER }} />
          {project.tracks.map((track) => (
            <div key={track.id} style={{ height: ROW }} className="flex items-center border-b px-2 text-[11px] text-muted-foreground">
              <span className={cn('me-1.5 size-1.5 rounded-full', swatch(track))} />
              {track.name}
            </div>
          ))}
        </div>
        <div ref={scrollerRef} dir="ltr" className="min-w-0 flex-1 overflow-auto">
          <div ref={contentRef} className="relative" style={{ width }}>
            <div className="sticky top-0 z-20 cursor-ew-resize border-b bg-[#181a20]" style={{ height: RULER }} onPointerDown={onRulerDown}>
              <Ruler width={width} pps={pps} />
            </div>
            {project.tracks.map((track) => (
              <div
                key={track.id}
                data-track-id={track.id}
                data-drop-zone
                style={{ height: ROW }}
                className={cn('relative border-b', hotTrack === track.id && 'bg-primary/10')}
                onDragOver={(event) => {
                  event.preventDefault()
                  setHotTrack(track.id)
                }}
                onDragLeave={() => setHotTrack((current) => (current === track.id ? null : current))}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setHotTrack(null)
                  const time = timeFromClient(event.clientX)
                  const assetId = assetIdFromDrop(event.dataTransfer)
                  if (assetId) {
                    placeAsset(assetId, time, track.id)
                    return
                  }
                  const files = [...event.dataTransfer.files]
                  if (!files.length) return
                  void importFiles(files).then((imported) => {
                    let cursor = time
                    for (const asset of imported) {
                      placeAsset(asset.id, cursor, track.id)
                      cursor += asset.kind === 'image' || asset.duration <= 0 ? 5 : asset.duration
                    }
                  })
                }}
                onPointerDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  seek(timeFromClient(event.clientX))
                  selectClip(null)
                }}
              >
                {project.clips
                  .filter((clip) => clip.trackId === track.id)
                  .map((clip) => (
                    <ClipBlock
                      key={clip.id}
                      clip={clip}
                      track={track}
                      pps={pps}
                      selected={clip.id === selectedClipId}
                      asset={clip.assetId ? assetById.get(clip.assetId) ?? null : null}
                    />
                  ))}
              </div>
            ))}
            <div ref={playheadRef} className="pointer-events-none absolute inset-y-0 z-30 w-px bg-[#ff5d52] will-change-transform">
              <div
                className="pointer-events-auto absolute top-0 h-3 w-3 -translate-x-1/2 cursor-ew-resize"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onRulerDown(event)
                }}
              >
                <div className="mx-auto h-0 w-0 border-x-[6px] border-x-transparent border-t-8 border-t-[#ff5d52]" />
              </div>
            </div>
            {project.clips.length === 0 && (
              <div className="pointer-events-none absolute top-12 left-4 text-xs text-muted-foreground">
                גררו מדיה לכאן. הציר נע משמאל לימין.
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[11px] text-muted-foreground">
        <span>רווח ניגון</span>
        <span>S פיצול</span>
        <span>Delete מחיקה</span>
        <span>Ctrl+Z ביטול</span>
        <span className="ms-auto">Ctrl+גלגלת לזום</span>
      </div>
    </section>
  )
}

function swatch(track: Track): string {
  if (track.type === 'video') return 'bg-sky-400'
  if (track.type === 'text') return 'bg-amber-400'
  return 'bg-emerald-400'
}

function Ruler({ width, pps }: { width: number; pps: number }) {
  const steps = [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60]
  const step = steps.find((candidate) => candidate * pps >= 72) ?? 60
  const ticks: number[] = []
  for (let time = 0; time <= width / pps + step; time += step) ticks.push(Number(time.toFixed(3)))
  return (
    <div className="relative h-full">
      {ticks.map((time) => (
        <div key={time} className="absolute top-0 h-full border-l border-white/15" style={{ left: time * pps }}>
          <span className="absolute top-1 left-1 font-mono text-[10px] text-muted-foreground">{formatClock(time)}</span>
        </div>
      ))}
    </div>
  )
}

function ClipBlock({
  clip,
  track,
  pps,
  selected,
  asset,
}: {
  clip: Clip
  track: Track
  pps: number
  selected: boolean
  asset: Asset | null
}) {
  const label = clip.text?.content.replaceAll('\n', ' ') || asset?.name || 'מדיה חסרה'
  const peaks = asset ? slicePeaks(asset, clip) : []
  const color =
    track.type === 'video' ? 'bg-[#2c6d96]' : track.type === 'text' ? 'bg-[#8a5a22]' : 'bg-[#1d7a4e]'

  const begin = (event: React.PointerEvent<HTMLDivElement>, mode: 'move' | 'start' | 'end') => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    selectClip(clip.id)
    const originX = event.clientX
    const originY = event.clientY
    const originStart = clip.start
    const originDuration = clip.duration
    let moved = false
    const move = (ev: PointerEvent) => {
      if (mode === 'move' && Math.abs(ev.clientX - originX) < 3 && Math.abs(ev.clientY - originY) < 3) return
      moved = true
      const delta = (ev.clientX - originX) / pps
      const trackEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-track-id]')
      const trackId = trackEl?.getAttribute('data-track-id') ?? clip.trackId
      if (mode === 'move') nudgeClip(clip.id, originStart + delta, trackId)
      if (mode === 'start') nudgeTrim(clip.id, 'start', originStart + delta)
      if (mode === 'end') nudgeTrim(clip.id, 'end', originStart + originDuration + delta)
    }
    const up = () => {
      if (moved) endGesture()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      data-clip-id={clip.id}
      className={cn(
        'absolute top-1.5 bottom-1.5 touch-none overflow-hidden rounded-md text-white shadow-sm select-none',
        color,
        selected && 'ring-2 ring-amber-200',
        !asset && !clip.text && 'bg-rose-900',
      )}
      style={{ left: clip.start * pps, width: Math.max(8, clip.duration * pps) }}
      onPointerDown={(event) => begin(event, 'move')}
    >
      <div className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize" onPointerDown={(event) => begin(event, 'start')} />
      <div className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize" onPointerDown={(event) => begin(event, 'end')} />
      <div className="pointer-events-none relative h-full px-2 py-1">
        <p className="truncate text-[11px] font-medium">{label}</p>
        {peaks.length > 0 && (
          <svg viewBox={`0 0 ${peaks.length} 32`} preserveAspectRatio="none" className="absolute inset-x-1 bottom-1 h-5 opacity-70">
            <path
              d={peaks.map((peak, index) => `M${index} 32 V${32 - peak * 30}`).join(' ')}
              stroke="white"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        )}
      </div>
      <span className="sr-only">{formatClock(clipEnd(clip) - clip.start)}</span>
    </div>
  )
}
