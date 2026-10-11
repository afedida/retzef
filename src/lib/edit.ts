import {
  MIN_CLIP,
  type Asset,
  type Clip,
  type MediaKind,
  type Project,
  type TextStyle,
  type TrackType,
  DEFAULT_TRACKS,
} from '@/types'

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration
}

export function projectDuration(project: Project): number {
  return project.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0)
}

export function blankProject(): Project {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: 'פרויקט חדש',
    tracks: DEFAULT_TRACKS.map((track) => ({ ...track })),
    clips: [],
  }
}

export function defaultDuration(asset: Asset): number {
  if (asset.kind === 'image' || !(asset.duration > 0)) return 5
  return Math.max(MIN_CLIP, asset.duration)
}

export function clipTrackType(clip: Clip, assets: Map<string, Asset>): TrackType | null {
  if (clip.text) return 'text'
  if (!clip.assetId) return null
  const asset = assets.get(clip.assetId)
  if (!asset) return null
  return asset.kind === 'audio' ? 'audio' : 'video'
}

export function isSourcedMedia(clip: Clip, asset: Asset | null): boolean {
  return !clip.text && !!asset && asset.kind !== 'image'
}

function rangesOverlap(start: number, duration: number, other: Clip): boolean {
  const a0 = start
  const a1 = start + duration
  const b0 = other.start
  const b1 = clipEnd(other)
  return a0 < b1 - 1e-6 && a1 > b0 + 1e-6
}

export function resolveStart(others: Clip[], start: number, duration: number): number {
  let next = Math.max(0, start)
  const sorted = [...others].sort((a, b) => a.start - b.start)
  for (let i = 0; i < sorted.length + 3; i++) {
    const hit = sorted.find((clip) => rangesOverlap(next, duration, clip))
    if (!hit) return next
    const right = clipEnd(hit)
    const left = hit.start - duration
    const leftFree =
      left >= -1e-6 && !sorted.some((clip) => rangesOverlap(Math.max(0, left), duration, clip))
    if (leftFree && Math.abs(left - start) < Math.abs(right - start)) next = Math.max(0, left)
    else next = right
  }
  const last = sorted[sorted.length - 1]
  return last ? clipEnd(last) : Math.max(0, start)
}

function nearest(time: number, points: number[], threshold: number): { time: number; distance: number } | null {
  if (threshold <= 0) return null
  let best: { time: number; distance: number } | null = null
  for (const point of points) {
    const distance = Math.abs(point - time)
    if (distance < threshold && (!best || distance < best.distance)) best = { time: point, distance }
  }
  return best
}

export function snapValue(time: number, points: number[], threshold: number): number {
  return nearest(time, points, threshold)?.time ?? time
}

export function snapMove(start: number, duration: number, points: number[], threshold: number): number {
  if (threshold <= 0) return Math.max(0, start)
  const byStart = nearest(start, points, threshold)
  const byEnd = nearest(start + duration, points, threshold)
  if (byEnd && (!byStart || byEnd.distance < byStart.distance)) return Math.max(0, byEnd.time - duration)
  if (byStart) return Math.max(0, byStart.time)
  return Math.max(0, start)
}

export function snapPoints(project: Project, playhead: number, excludeId?: string): number[] {
  const points = [0, playhead]
  for (const clip of project.clips) {
    if (clip.id === excludeId) continue
    points.push(clip.start, clipEnd(clip))
  }
  return points
}

export function fadeEnvelope(
  clip: Pick<Clip, 'fadeIn' | 'fadeOut' | 'duration'>,
  localTime: number,
): number {
  const { fadeIn, fadeOut, duration } = clip
  if (localTime < 0 || localTime >= duration) return 0
  let gain = 1
  if (fadeIn > 0 && localTime < fadeIn) gain *= localTime / fadeIn
  if (fadeOut > 0 && localTime > duration - fadeOut) {
    gain *= Math.max(0, (duration - localTime) / fadeOut)
  }
  return Math.min(1, Math.max(0, gain))
}

export function audioGain(clip: Clip, localTime: number): number {
  return Math.max(0, clip.volume) * fadeEnvelope(clip, localTime)
}

export function clampFades(duration: number, fadeIn: number, fadeOut: number): { fadeIn: number; fadeOut: number } {
  const nextIn = Math.max(0, Math.min(fadeIn, duration))
  const nextOut = Math.max(0, Math.min(fadeOut, Math.max(0, duration - nextIn)))
  return { fadeIn: nextIn, fadeOut: nextOut }
}

function withFades(clip: Clip): Clip {
  return { ...clip, ...clampFades(clip.duration, clip.fadeIn, clip.fadeOut) }
}

export function makeMediaClip(asset: Asset, trackId: string, start: number): Clip {
  return {
    id: crypto.randomUUID(),
    trackId,
    assetId: asset.id,
    start: Math.max(0, start),
    duration: defaultDuration(asset),
    inPoint: 0,
    volume: asset.kind === 'audio' ? 0.8 : 1,
    fadeIn: 0,
    fadeOut: 0,
    text: null,
  }
}

export function makeTextClip(start: number): Clip {
  return {
    id: crypto.randomUUID(),
    trackId: 't1',
    assetId: null,
    start: Math.max(0, start),
    duration: 3,
    inPoint: 0,
    volume: 1,
    fadeIn: 0.15,
    fadeOut: 0.15,
    text: {
      content: 'שלום, זה רצף',
      fontSize: 72,
      color: '#ffffff',
      x: 0.5,
      y: 0.82,
    },
  }
}

export function preferredTrack(
  project: Project,
  kind: MediaKind,
  time: number,
  duration: number,
  requested?: string,
): string {
  const type: TrackType = kind === 'audio' ? 'audio' : 'video'
  const tracks = project.tracks.filter((track) => track.type === type)
  if (requested && tracks.some((track) => track.id === requested)) return requested
  const order = kind === 'audio' ? ['a2', 'a1'] : ['v1', 'v2']
  for (const id of order) {
    const others = project.clips.filter((clip) => clip.trackId === id)
    if (!others.some((clip) => rangesOverlap(time, duration, clip))) return id
  }
  return order[0] ?? tracks[0]?.id ?? 'v1'
}

export function insertClip(project: Project, clip: Clip): Project {
  const others = project.clips.filter((item) => item.trackId === clip.trackId)
  const start = resolveStart(others, clip.start, clip.duration)
  return { ...project, clips: [...project.clips, { ...clip, start }] }
}

export function deleteClip(project: Project, clipId: string): Project {
  return { ...project, clips: project.clips.filter((clip) => clip.id !== clipId) }
}

export function deleteClipsForAsset(project: Project, assetId: string): Project {
  return { ...project, clips: project.clips.filter((clip) => clip.assetId !== assetId) }
}

function replaceClip(project: Project, clip: Clip): Project {
  return { ...project, clips: project.clips.map((item) => (item.id === clip.id ? clip : item)) }
}

export function moveClip(
  project: Project,
  clipId: string,
  desiredStart: number,
  desiredTrackId: string,
  points: number[],
  threshold: number,
  assets: Map<string, Asset>,
): Project {
  const clip = project.clips.find((item) => item.id === clipId)
  if (!clip) return project
  const kind = clipTrackType(clip, assets)
  const track = project.tracks.find((item) => item.id === desiredTrackId)
  const trackId = track && kind && track.type === kind ? track.id : clip.trackId
  const others = project.clips.filter((item) => item.trackId === trackId && item.id !== clip.id)
  let start = Math.max(0, desiredStart)
  start = snapMove(start, clip.duration, points, threshold)
  start = resolveStart(others, start, clip.duration)
  return replaceClip(project, { ...clip, start, trackId })
}

export function trimClip(
  project: Project,
  clipId: string,
  edge: 'start' | 'end',
  time: number,
  asset: Asset | null,
  points: number[],
  threshold: number,
): Project {
  const clip = project.clips.find((item) => item.id === clipId)
  if (!clip) return project
  const neighbors = project.clips.filter((item) => item.trackId === clip.trackId && item.id !== clip.id)
  const sourced = isSourcedMedia(clip, asset)
  const sourceDuration = sourced && asset ? asset.duration : Infinity

  if (edge === 'end') {
    let end = snapValue(time, points, threshold)
    end = Math.max(clip.start + MIN_CLIP, end)
    let duration = end - clip.start
    if (Number.isFinite(sourceDuration)) duration = Math.min(duration, Math.max(MIN_CLIP, sourceDuration - clip.inPoint))
    for (const neighbor of neighbors) {
      if (neighbor.start >= clip.start - 1e-6 && neighbor.start < clip.start + duration) {
        duration = Math.min(duration, neighbor.start - clip.start)
      }
    }
    duration = Math.max(MIN_CLIP, duration)
    return replaceClip(project, withFades({ ...clip, duration }))
  }

  const end = clipEnd(clip)
  let start = snapValue(time, points, threshold)
  start = Math.min(start, end - MIN_CLIP)
  start = Math.max(0, start)
  if (sourced) start = Math.max(start, clip.start - clip.inPoint)
  for (const neighbor of neighbors) {
    const neighborEnd = clipEnd(neighbor)
    if (neighborEnd <= clip.start + 1e-4) start = Math.max(start, neighborEnd)
  }
  start = Math.min(start, end - MIN_CLIP)
  const duration = end - start
  const inPoint = sourced ? clip.inPoint + (start - clip.start) : 0
  return replaceClip(project, withFades({ ...clip, start, duration, inPoint }))
}

export function splitClip(project: Project, clipId: string, time: number): { project: Project; newId: string } | null {
  const clip = project.clips.find((item) => item.id === clipId)
  if (!clip) return null
  if (time <= clip.start + MIN_CLIP / 2 || time >= clipEnd(clip) - MIN_CLIP / 2) return null
  const leftDuration = time - clip.start
  const rightDuration = clip.duration - leftDuration
  const rightId = crypto.randomUUID()
  const left = withFades({ ...clip, duration: leftDuration })
  const right = withFades({
    ...clip,
    id: rightId,
    start: time,
    duration: rightDuration,
    inPoint: clip.inPoint + leftDuration,
    text: clip.text ? { ...clip.text } : null,
  })
  return {
    newId: rightId,
    project: {
      ...project,
      clips: project.clips.flatMap((item) => (item.id === clip.id ? [left, right] : [item])),
    },
  }
}

export function updateClip(project: Project, clipId: string, patch: Partial<Clip>): Project {
  return {
    ...project,
    clips: project.clips.map((clip) => (clip.id === clipId ? withFades({ ...clip, ...patch }) : clip)),
  }
}

export function updateText(project: Project, clipId: string, patch: Partial<TextStyle>): Project {
  return {
    ...project,
    clips: project.clips.map((clip) => {
      if (clip.id !== clipId || !clip.text) return clip
      const text = { ...clip.text, ...patch }
      text.fontSize = Math.min(180, Math.max(18, text.fontSize))
      text.x = Math.min(1, Math.max(0, text.x))
      text.y = Math.min(1, Math.max(0, text.y))
      return { ...clip, text }
    }),
  }
}

export function setClipStart(project: Project, clipId: string, start: number, asset: Asset | null): Project {
  return trimClip(project, clipId, 'start', start, asset, [], 0)
}

export function setClipEnd(project: Project, clipId: string, end: number, asset: Asset | null): Project {
  return trimClip(project, clipId, 'end', end, asset, [], 0)
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function coerceText(value: unknown): TextStyle | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<TextStyle>
  if (typeof raw.content !== 'string') return null
  return {
    content: raw.content,
    fontSize: Math.min(180, Math.max(18, finite(raw.fontSize, 72))),
    color: typeof raw.color === 'string' ? raw.color : '#ffffff',
    x: Math.min(1, Math.max(0, finite(raw.x, 0.5))),
    y: Math.min(1, Math.max(0, finite(raw.y, 0.82))),
  }
}

function coerceClip(value: unknown): Clip | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Clip>
  if (typeof raw.id !== 'string' || typeof raw.trackId !== 'string') return null
  if (!DEFAULT_TRACKS.some((track) => track.id === raw.trackId)) return null
  const text = raw.trackId === 't1' ? coerceText(raw.text) : null
  if (raw.trackId === 't1' && !text) return null
  if (raw.trackId !== 't1' && typeof raw.assetId !== 'string') return null
  const duration = Math.max(MIN_CLIP, finite(raw.duration, 1))
  const fades = clampFades(duration, finite(raw.fadeIn, 0), finite(raw.fadeOut, 0))
  return {
    id: raw.id,
    trackId: raw.trackId,
    assetId: raw.trackId === 't1' ? null : (raw.assetId ?? null),
    start: Math.max(0, finite(raw.start, 0)),
    duration,
    inPoint: Math.max(0, finite(raw.inPoint, 0)),
    volume: Math.min(1, Math.max(0, finite(raw.volume, 1))),
    fadeIn: fades.fadeIn,
    fadeOut: fades.fadeOut,
    text,
  }
}

export function coerceProject(value: unknown): Project | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Project>
  if (!Array.isArray(raw.clips)) return null
  const clips = raw.clips.map(coerceClip).filter((clip): clip is Clip => clip !== null)
  return {
    version: 1,
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'פרויקט חדש',
    tracks: DEFAULT_TRACKS.map((track) => ({ ...track })),
    clips,
  }
}

export function clipsTouching(project: Project, time: number): Clip[] {
  return project.clips.filter((clip) => time > clip.start + MIN_CLIP / 2 && time < clipEnd(clip) - MIN_CLIP / 2)
}
