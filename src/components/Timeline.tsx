import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff, Flag, Headphones, Lock, Magnet, Minus, Plus, Scissors, Trash2, Unlock, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { clipEnd, projectDuration } from '@/lib/edit'
import { formatClock } from '@/lib/time'
import {
  createTextTrack,
  deleteTextTrack,
  endGesture,
  liveTrackVolume,
  getPlayhead,
  importFiles,
  nudgeClip,
  nudgeTrim,
  placeAsset,
  addLaneKey,
  moveLaneKey,
  placeMarker,
  removeSelectedClip,
  rippleSelectedClip,
  seek,
  selectClip,
  selectMarker,
  setLane,
  setPps,
  setSnap,
  toggleRipple,
  toggleTrackFlag,
  splitAtPlayhead,
  subscribeFrames,
} from '@/state/editor'
import { useEditor } from '@/state/hooks'
import { cn } from '@/lib/utils'
import type { Asset, Clip, KeyLane, Track } from '@/types'

const LANES: { id: KeyLane; label: string }[] = [
  { id: 'volume', label: 'עוצמה' },
  { id: 'opacity', label: 'שקיפות' },
  { id: 'scale', label: 'זום' },
  { id: 'x', label: 'אופקי' },
  { id: 'y', label: 'אנכי' },
]

const RULER = 28
const ROW = 56
const AUDIO_ROW = 72

function rowHeight(track: Track): number {
  return track.type === 'audio' ? AUDIO_ROW : ROW
}

function assetIdFromDrop(data: DataTransfer): string | null {
  const custom = data.getData('application/x-retzef-asset')
  if (custom) return custom
  const plain = data.getData('text/plain')
  return plain.startsWith('retzef-asset:') ? plain.slice('retzef-asset:'.length) : null
}

function slicePeaks(asset: Asset, clip: Clip): number[] {
  if (!asset.peaks.length) return []
  if (asset.kind === 'image' || asset.duration <= 0) return asset.peaks
  const speed = clip.speed > 0 ? clip.speed : 1
  const start = Math.min(asset.peaks.length - 1, Math.max(0, Math.floor((clip.inPoint / asset.duration) * asset.peaks.length)))
  const sourceEnd = clip.inPoint + clip.duration * speed
  const end = Math.min(asset.peaks.length, Math.max(start + 1, Math.ceil((sourceEnd / asset.duration) * asset.peaks.length)))
  return asset.peaks.slice(start, end)
}

export function Timeline() {
  const project = useEditor((state) => state.project)
  const assets = useEditor((state) => state.assets)
  const selectedClipId = useEditor((state) => state.selectedClipId)
  const selectedClipIds = useEditor((state) => state.selectedClipIds)
  const lane = useEditor((state) => state.lane)
  const status = useEditor((state) => state.status)
  const selectedMarkerId = useEditor((state) => state.selectedMarkerId)
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
    <section className="flex h-[min(34vh,320px)] min-h-[210px] shrink-0 flex-col border-t bg-[#1e1e1e]">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <Button type="button" size="sm" variant="secondary" onClick={splitAtPlayhead}>
          <Scissors />
          פיצול
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={!selectedClipId} onClick={removeSelectedClip}>
          <Trash2 />
          מחיקה
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={!selectedClipId} onClick={rippleSelectedClip}>
          מחיקה גולשת
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={placeMarker}>
          <Flag />
          סמן
        </Button>
        <Button type="button" size="sm" variant={snap ? 'secondary' : 'ghost'} onClick={() => setSnap(!snap)} aria-pressed={snap}>
          <Magnet />
          הצמדה
        </Button>
        <Button
          type="button"
          size="sm"
          variant={project.ripple ? 'secondary' : 'ghost'}
          aria-pressed={project.ripple}
          onClick={() => toggleRipple(!project.ripple)}
        >
          גלישה
        </Button>
        <select
          aria-label="ערוץ נקודות"
          className="h-8 rounded-md border bg-transparent px-2 text-xs"
          value={lane}
          onChange={(event) => setLane(event.target.value as KeyLane)}
        >
          {LANES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
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
        <div className="w-40 shrink-0 border-e bg-card/50">
          <div style={{ height: RULER }} />
          {project.tracks.map((track) => (
            <div key={track.id} style={{ height: rowHeight(track) }} className="flex flex-col justify-center gap-0.5 border-b px-1 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-0.5">
                <span className={cn('size-1.5 shrink-0 rounded-full', swatch(track))} />
                <span className="min-w-0 flex-1 truncate">{track.name}</span>
                <TrackToggle label={track.locked ? 'פתיחת מסלול' : 'נעילת מסלול'} pressed={track.locked} onClick={() => toggleTrackFlag(track.id, 'locked', !track.locked)}>
                  {track.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                </TrackToggle>
                <TrackToggle label={track.muted ? 'ביטול השתקה' : 'השתקת מסלול'} pressed={track.muted} onClick={() => toggleTrackFlag(track.id, 'muted', !track.muted)}>
                  <VolumeX className="size-3" />
                </TrackToggle>
                <TrackToggle label={track.solo ? 'ביטול סולו' : 'סולו'} pressed={track.solo} onClick={() => toggleTrackFlag(track.id, 'solo', !track.solo)}>
                  <Headphones className="size-3" />
                </TrackToggle>
                <TrackToggle label={track.hidden ? 'הצגת מסלול' : 'הסתרת מסלול'} pressed={track.hidden} onClick={() => toggleTrackFlag(track.id, 'hidden', !track.hidden)}>
                  {track.hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                </TrackToggle>
                {track.type === 'text' && project.tracks.filter((item) => item.type === 'text').length > 1 && (
                  <button type="button" className="text-xs" aria-label={`הסרת ${track.name}`} onClick={() => deleteTextTrack(track.id)}>
                    ×
                  </button>
                )}
              </div>
              {track.type === 'audio' && (
                <input
                  type="range"
                  min={0}
                  max={100}
                  aria-label={`עוצמת ${track.name}`}
                  value={Math.round((track.volume ?? 1) * 100)}
                  onChange={(event) => liveTrackVolume(track.id, Number(event.target.value) / 100)}
                  onPointerUp={() => endGesture()}
                  onKeyUp={() => endGesture()}
                  onBlur={() => endGesture()}
                  className="h-3 w-full accent-[#0078d4]"
                />
              )}
            </div>
          ))}
          <button type="button" className="w-full px-2 py-1 text-start text-[11px] text-primary" onClick={createTextTrack}>
            + מסלול טקסט
          </button>
        </div>
        <div ref={scrollerRef} dir="ltr" className="min-w-0 flex-1 overflow-auto">
          <div ref={contentRef} className="relative" style={{ width }}>
            <div className="sticky top-0 z-20 cursor-ew-resize border-b bg-[#252526]" style={{ height: RULER }} onPointerDown={onRulerDown}>
              <Ruler width={width} pps={pps} />
              {project.beats.map((beat) => (
                <span key={beat} className="pointer-events-none absolute bottom-0 z-10 h-2 w-px bg-[#0078d4]" style={{ left: beat * pps }} />
              ))}
              {project.markIn != null && (
                <span className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-[#50e6ff]" style={{ left: project.markIn * pps }} title="כניסה" />
              )}
              {project.markOut != null && (
                <span className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-[#ffb900]" style={{ left: project.markOut * pps }} title="יציאה" />
              )}
              {project.markers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  title={marker.label}
                  className="absolute top-0 z-30 h-full w-3 -translate-x-1/2"
                  style={{ left: marker.time * pps }}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    seek(marker.time)
                    selectMarker(marker.id)
                  }}
                >
                  <span
                    className={cn(
                      'mx-auto mt-0.5 block h-0 w-0 border-x-[5px] border-x-transparent border-t-[8px]',
                      marker.id === selectedMarkerId ? 'border-t-white' : 'border-t-[#0078d4]',
                    )}
                  />
                </button>
              ))}
            </div>
            {project.tracks.map((track) => (
              <div
                key={track.id}
                data-track-id={track.id}
                data-drop-zone
                style={{ height: rowHeight(track) }}
                className={cn('relative z-0 border-b', hotTrack === track.id && 'bg-primary/10')}
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
                  if (!event.shiftKey) selectClip(null)
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
                      selected={selectedClipIds.includes(clip.id) || clip.id === selectedClipId}
                      lane={lane}
                      asset={clip.assetId ? assetById.get(clip.assetId) ?? null : null}
                    />
                  ))}
              </div>
            ))}
            {project.markIn != null && project.markOut != null && project.markOut > project.markIn && (
              <div
                className="pointer-events-none absolute inset-y-0 z-10 border-x-2 border-[#50e6ff] bg-[#0078d4]/35"
                style={{ left: project.markIn * pps, width: Math.max(4, (project.markOut - project.markIn) * pps) }}
              />
            )}
            <div ref={playheadRef} className="pointer-events-none absolute inset-y-0 z-30 w-px bg-[#50e6ff] will-change-transform">
              <div
                className="pointer-events-auto absolute top-0 h-3 w-3 -translate-x-1/2 cursor-ew-resize"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onRulerDown(event)
                }}
              >
                <div className="mx-auto h-0 w-0 border-x-[6px] border-x-transparent border-t-8 border-t-[#50e6ff]" />
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
        <span>Shift+Delete גלישה</span>
        <span>חצים הזזת קליפ</span>
        <span>M סמן</span>
        <span>Ctrl+C/V</span>
        {status && <span className="text-[#50e6ff]">{status}</span>}
        <span className="ms-auto">Ctrl+גלגלת לזום</span>
      </div>
    </section>
  )
}

function TrackToggle({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string
  pressed: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={cn('grid size-4 place-items-center rounded text-[10px]', pressed ? 'bg-primary/30 text-foreground' : 'opacity-60')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function swatch(track: Track): string {
  if (track.type === 'video') return 'bg-[#0078d4]'
  if (track.type === 'text') return 'bg-[#8661c5]'
  return 'bg-[#0e7a6b]'
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

function laneKeys(clip: Clip, lane: KeyLane) {
  const keys = clip.keys?.[lane] ?? []
  if (lane === 'volume' && clip.volumeKeys.length && !keys.length) {
    return clip.volumeKeys.map((key) => ({ time: key.time, value: key.value, ease: key.ease ?? ('linear' as const) }))
  }
  return keys
}

function ClipBlock({
  clip,
  track,
  pps,
  selected,
  lane,
  asset,
}: {
  clip: Clip
  track: Track
  pps: number
  selected: boolean
  lane: KeyLane
  asset: Asset | null
}) {
  const label = clip.children?.length
    ? 'מקונן'
    : clip.adjustment
      ? 'התאמה'
      : clip.text?.content.replaceAll('\n', ' ') || asset?.name || 'מדיה חסרה'
  const peaks = asset ? slicePeaks(asset, clip) : []
  const color =
    track.type === 'video' ? 'bg-[#0e639c]' : track.type === 'text' ? 'bg-[#5c2e91]' : 'bg-[#0e7a6b]'

  const begin = (event: React.PointerEvent<HTMLDivElement>, mode: 'move' | 'start' | 'end') => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    if (track.locked) {
      selectClip(clip.id, event.shiftKey)
      return
    }
    selectClip(clip.id, event.shiftKey)
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
        selected && 'ring-2 ring-[#50e6ff]',
        clip.groupId && 'outline outline-1 outline-[#0078d4]/80',
        !asset && !clip.text && !clip.shape && 'bg-rose-900',
        track.locked && 'opacity-70',
      )}
      style={{ left: clip.start * pps, width: Math.max(8, clip.duration * pps) }}
      onPointerDown={(event) => begin(event, 'move')}
      onDoubleClick={(event) => {
        if (track.locked) return
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        const ratio = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
        addLaneKey(clip.id, clip.start + ((event.clientX - rect.left) / pps), lane === 'scale' ? 1 + (1 - ratio) * 3 : 1 - ratio)
      }}
    >
      <div className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize" onPointerDown={(event) => begin(event, 'start')} />
      <div className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize" onPointerDown={(event) => begin(event, 'end')} />
      <div className="pointer-events-none relative h-full px-2 py-1">
        <p className="truncate text-[11px] font-medium">
          {label}
          {clip.speed !== 1 ? ` · ${clip.speed.toFixed(2)}x` : ''}
          {clip.transition ? ' · מעבר' : ''}
        </p>
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
      {selected &&
        laneKeys(clip, lane).map((key) => (
          <button
            key={`${key.time}:${key.value}`}
            type="button"
            aria-label="נקודת מפתח"
            className="absolute z-20 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-[#50e6ff]"
            style={{ left: `${key.time * 100}%`, top: `${(1 - (lane === 'scale' ? (key.value - 1) / 3 : key.value)) * 100}%` }}
            onPointerDown={(event) => {
              event.stopPropagation()
              if (track.locked) return
              const host = event.currentTarget.parentElement
              if (!host) return
              const originTime = key.time
              const move = (ev: PointerEvent) => {
                const rect = host.getBoundingClientRect()
                const nextTime = clip.start + ((ev.clientX - rect.left) / rect.width) * clip.duration
                const ratio = 1 - (ev.clientY - rect.top) / rect.height
                const value = lane === 'scale' ? 1 + Math.min(1, Math.max(0, ratio)) * 3 : Math.min(1, Math.max(0, ratio))
                moveLaneKey(clip.id, originTime, nextTime, value)
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
        ))}
      <span className="sr-only">{formatClock(clipEnd(clip) - clip.start)}</span>
    </div>
  )
}
