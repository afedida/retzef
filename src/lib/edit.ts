import {
  DEFAULT_COLOR,
  DEFAULT_KEN,
  DEFAULT_TRACKS,
  MAX_SPEED,
  MIN_CLIP,
  MIN_SPEED,
  type Asset,
  type Clip,
  type ColorGrade,
  type KenBurns,
  type Marker,
  type MediaKind,
  type Project,
  type TextAlign,
  type TextAnimation,
  type TextFont,
  type TextStyle,
  type Track,
  type TrackType,
  type Transition,
  type TransitionKind,
  type VolumeKeyframe,
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
    markers: [],
    masterVolume: 1,
  }
}

export function defaultDuration(asset: Asset): number {
  if (asset.kind === 'image' || !(asset.duration > 0)) return 5
  return Math.max(MIN_CLIP, asset.duration)
}

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
}

export function defaultKen(): KenBurns {
  return { ...DEFAULT_KEN }
}

export function defaultColor(): ColorGrade {
  return { ...DEFAULT_COLOR }
}

export function defaultText(): TextStyle {
  return {
    content: 'שלום, זה רצף',
    fontSize: 72,
    color: '#ffffff',
    x: 0.5,
    y: 0.82,
    font: 'heebo',
    align: 'center',
    stroke: true,
    shadow: false,
    plate: true,
    animation: 'none',
    animDuration: 0.45,
  }
}

function mediaDefaults(): Pick<Clip, 'speed' | 'transition' | 'volumeKeys' | 'kenBurns' | 'color'> {
  return {
    speed: 1,
    transition: null,
    volumeKeys: [],
    kenBurns: defaultKen(),
    color: defaultColor(),
  }
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
  const points = [0, playhead, ...project.markers.map((marker) => marker.time)]
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

export function keyedVolume(clip: Pick<Clip, 'volume' | 'volumeKeys' | 'duration'>, localTime: number): number {
  const keys = [...(clip.volumeKeys ?? [])].sort((a, b) => a.time - b.time)
  if (!keys.length) return Math.max(0, clip.volume)
  const t = clip.duration > 0 ? localTime / clip.duration : 0
  const first = keys[0]!
  if (t <= first.time) return Math.max(0, first.value)
  const last = keys[keys.length - 1]!
  if (t >= last.time) return Math.max(0, last.value)
  for (let index = 1; index < keys.length; index++) {
    const right = keys[index]!
    const left = keys[index - 1]!
    if (t <= right.time) {
      const span = Math.max(1e-6, right.time - left.time)
      const mix = (t - left.time) / span
      return Math.max(0, left.value + (right.value - left.value) * mix)
    }
  }
  return Math.max(0, last.value)
}

export function audioGain(clip: Clip, localTime: number): number {
  return keyedVolume(clip, localTime) * fadeEnvelope(clip, localTime)
}

export function clampFades(duration: number, fadeIn: number, fadeOut: number): { fadeIn: number; fadeOut: number } {
  const nextIn = Math.max(0, Math.min(fadeIn, duration))
  const nextOut = Math.max(0, Math.min(fadeOut, Math.max(0, duration - nextIn)))
  return { fadeIn: nextIn, fadeOut: nextOut }
}

function withFades(clip: Clip): Clip {
  return { ...clip, ...clampFades(clip.duration, clip.fadeIn, clip.fadeOut) }
}

export function sourceSpan(clip: Clip): number {
  return clip.duration * clampSpeed(clip.speed)
}

export function maxTimelineDuration(clip: Clip, asset: Asset | null): number {
  if (!isSourcedMedia(clip, asset) || !asset) return Infinity
  return Math.max(MIN_CLIP, (asset.duration - clip.inPoint) / clampSpeed(clip.speed))
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
    ...mediaDefaults(),
  }
}

export function makeTextClip(start: number, trackId = 't1'): Clip {
  return {
    id: crypto.randomUUID(),
    trackId,
    assetId: null,
    start: Math.max(0, start),
    duration: 3,
    inPoint: 0,
    volume: 1,
    fadeIn: 0.15,
    fadeOut: 0.15,
    text: defaultText(),
    ...mediaDefaults(),
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
    if (!tracks.some((track) => track.id === id)) continue
    const others = project.clips.filter((clip) => clip.trackId === id)
    if (!others.some((clip) => rangesOverlap(time, duration, clip))) return id
  }
  for (const track of tracks) {
    const others = project.clips.filter((clip) => clip.trackId === track.id)
    if (!others.some((clip) => rangesOverlap(time, duration, clip))) return track.id
  }
  return order.find((id) => tracks.some((track) => track.id === id)) ?? tracks[0]?.id ?? 'v1'
}

export function insertClip(project: Project, clip: Clip): Project {
  const others = project.clips.filter((item) => item.trackId === clip.trackId)
  const start = resolveStart(others, clip.start, clip.duration)
  return { ...project, clips: [...project.clips, { ...clip, start }] }
}

export function deleteClip(project: Project, clipId: string): Project {
  return { ...project, clips: project.clips.filter((clip) => clip.id !== clipId) }
}

export function rippleDelete(project: Project, clipId: string): Project {
  const clip = project.clips.find((item) => item.id === clipId)
  if (!clip) return project
  const end = clipEnd(clip)
  const shift = clip.duration
  return {
    ...project,
    clips: project.clips.flatMap((item) => {
      if (item.id === clipId) return []
      if (item.trackId === clip.trackId && item.start >= end - 1e-4) {
        return [{ ...item, start: Math.max(0, item.start - shift) }]
      }
      return [item]
    }),
  }
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
  const speed = clampSpeed(clip.speed)

  if (edge === 'end') {
    let end = snapValue(time, points, threshold)
    end = Math.max(clip.start + MIN_CLIP, end)
    let duration = end - clip.start
    if (sourced && asset) duration = Math.min(duration, Math.max(MIN_CLIP, (asset.duration - clip.inPoint) / speed))
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
  if (sourced) start = Math.max(start, clip.start - clip.inPoint / speed)
  for (const neighbor of neighbors) {
    const neighborEnd = clipEnd(neighbor)
    if (neighborEnd <= clip.start + 1e-4) start = Math.max(start, neighborEnd)
  }
  start = Math.min(start, end - MIN_CLIP)
  const duration = end - start
  const inPoint = sourced ? clip.inPoint + (start - clip.start) * speed : 0
  return replaceClip(project, withFades({ ...clip, start, duration, inPoint }))
}

function splitKeys(keys: VolumeKeyframe[], leftRatio: number): { left: VolumeKeyframe[]; right: VolumeKeyframe[] } {
  if (!keys.length) return { left: [], right: [] }
  const ratio = Math.min(0.999, Math.max(0.001, leftRatio))
  const left = keys
    .filter((key) => key.time <= ratio + 1e-6)
    .map((key) => ({ time: Math.min(1, key.time / ratio), value: key.value }))
  const right = keys
    .filter((key) => key.time >= ratio - 1e-6)
    .map((key) => ({ time: Math.max(0, (key.time - ratio) / (1 - ratio)), value: key.value }))
  return { left, right }
}

function splitKen(ken: KenBurns, leftRatio: number): { left: KenBurns; right: KenBurns } {
  const mix = (a: number, b: number) => a + (b - a) * leftRatio
  const midScale = mix(ken.scaleStart, ken.scaleEnd)
  const midX = mix(ken.xStart, ken.xEnd)
  const midY = mix(ken.yStart, ken.yEnd)
  return {
    left: { ...ken, scaleEnd: midScale, xEnd: midX, yEnd: midY },
    right: { ...ken, scaleStart: midScale, xStart: midX, yStart: midY },
  }
}

export function splitClip(project: Project, clipId: string, time: number): { project: Project; newId: string } | null {
  const clip = project.clips.find((item) => item.id === clipId)
  if (!clip) return null
  if (time <= clip.start + MIN_CLIP / 2 || time >= clipEnd(clip) - MIN_CLIP / 2) return null
  const leftDuration = time - clip.start
  const rightDuration = clip.duration - leftDuration
  const ratio = leftDuration / clip.duration
  const rightId = crypto.randomUUID()
  const keys = splitKeys(clip.volumeKeys, ratio)
  const ken = splitKen(clip.kenBurns, ratio)
  const left = withFades({ ...clip, duration: leftDuration, volumeKeys: keys.left, kenBurns: ken.left })
  const right = withFades({
    ...clip,
    id: rightId,
    start: time,
    duration: rightDuration,
    inPoint: clip.inPoint + leftDuration * clampSpeed(clip.speed),
    text: clip.text ? { ...clip.text } : null,
    transition: null,
    volumeKeys: keys.right,
    kenBurns: ken.right,
    color: { ...clip.color },
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

export function setSpeed(project: Project, clipId: string, speed: number, asset: Asset | null): Project {
  const clip = project.clips.find((item) => item.id === clipId)
  if (!clip) return project
  const nextSpeed = clampSpeed(speed)
  let duration = clip.duration
  if (isSourcedMedia(clip, asset) && asset) {
    duration = Math.min(duration, Math.max(MIN_CLIP, (asset.duration - clip.inPoint) / nextSpeed))
  }
  return updateClip(project, clipId, { speed: nextSpeed, duration })
}

export function setTransition(project: Project, clipId: string, transition: Transition | null): Project {
  return updateClip(project, clipId, { transition })
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
      text.animDuration = Math.min(clip.duration, Math.max(0.05, text.animDuration))
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

export function addTextTrack(project: Project): Project {
  const count = project.tracks.filter((track) => track.type === 'text').length + 1
  const track: Track = { id: crypto.randomUUID(), type: 'text', name: `טקסט ${count}`, duck: false }
  const insertAt = project.tracks.findIndex((item) => item.type === 'audio')
  const tracks = [...project.tracks]
  tracks.splice(insertAt === -1 ? tracks.length : insertAt, 0, track)
  return { ...project, tracks }
}

export function removeTextTrack(project: Project, trackId: string): Project {
  const texts = project.tracks.filter((track) => track.type === 'text')
  if (texts.length <= 1) return project
  if (!texts.some((track) => track.id === trackId)) return project
  return {
    ...project,
    tracks: project.tracks.filter((track) => track.id !== trackId),
    clips: project.clips.filter((clip) => clip.trackId !== trackId),
  }
}

export function setTrackDuck(project: Project, trackId: string, duck: boolean): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => (track.id === trackId && track.type === 'audio' ? { ...track, duck } : track)),
  }
}

export function addMarker(project: Project, time: number, label?: string): Project {
  const marker: Marker = {
    id: crypto.randomUUID(),
    time: Math.max(0, time),
    label: label?.trim() || 'סמן',
  }
  return { ...project, markers: [...project.markers, marker].sort((a, b) => a.time - b.time) }
}

export function removeMarker(project: Project, markerId: string): Project {
  return { ...project, markers: project.markers.filter((marker) => marker.id !== markerId) }
}

export function setMasterVolume(project: Project, volume: number): Project {
  return { ...project, masterVolume: Math.min(1, Math.max(0, volume)) }
}

export function upsertVolumeKey(project: Project, clipId: string, time: number, value: number): Project {
  const clip = project.clips.find((item) => item.id === clipId)
  if (!clip || clip.duration <= 0) return project
  const local = Math.min(1, Math.max(0, (time - clip.start) / clip.duration))
  const valueClamped = Math.min(1, Math.max(0, value))
  const without = clip.volumeKeys.filter((key) => Math.abs(key.time - local) > 0.01)
  const volumeKeys = [...without, { time: local, value: valueClamped }].sort((a, b) => a.time - b.time)
  return updateClip(project, clipId, { volumeKeys })
}

export function clearVolumeKeys(project: Project, clipId: string): Project {
  return updateClip(project, clipId, { volumeKeys: [] })
}

export function referencedAssetIds(projects: Project[]): Set<string> {
  const ids = new Set<string>()
  for (const project of projects) {
    for (const clip of project.clips) {
      if (clip.assetId) ids.add(clip.assetId)
    }
  }
  return ids
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const FONTS: TextFont[] = ['heebo', 'rubik', 'assistant', 'frank']
const ALIGNS: TextAlign[] = ['start', 'center', 'end']
const ANIMS: TextAnimation[] = ['none', 'fade', 'slide']
const TRANSITIONS: TransitionKind[] = ['crossfade', 'dip', 'slide']

function coerceText(value: unknown): TextStyle | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<TextStyle>
  if (typeof raw.content !== 'string') return null
  const base = defaultText()
  return {
    content: raw.content,
    fontSize: Math.min(180, Math.max(18, finite(raw.fontSize, base.fontSize))),
    color: typeof raw.color === 'string' ? raw.color : base.color,
    x: Math.min(1, Math.max(0, finite(raw.x, base.x))),
    y: Math.min(1, Math.max(0, finite(raw.y, base.y))),
    font: FONTS.includes(raw.font as TextFont) ? (raw.font as TextFont) : 'heebo',
    align: ALIGNS.includes(raw.align as TextAlign) ? (raw.align as TextAlign) : 'center',
    stroke: raw.stroke !== false,
    shadow: raw.shadow === true,
    plate: raw.plate !== false,
    animation: ANIMS.includes(raw.animation as TextAnimation) ? (raw.animation as TextAnimation) : 'none',
    animDuration: Math.min(8, Math.max(0.05, finite(raw.animDuration, base.animDuration))),
  }
}

function coerceKen(value: unknown): KenBurns {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<KenBurns>
  const scale = (input: unknown, fallback: number) => Math.min(4, Math.max(1, finite(input, fallback)))
  const pan = (input: unknown, fallback: number) => Math.min(1, Math.max(0, finite(input, fallback)))
  return {
    scaleStart: scale(raw.scaleStart, 1),
    scaleEnd: scale(raw.scaleEnd, 1),
    xStart: pan(raw.xStart, 0.5),
    yStart: pan(raw.yStart, 0.5),
    xEnd: pan(raw.xEnd, 0.5),
    yEnd: pan(raw.yEnd, 0.5),
  }
}

function coerceColor(value: unknown): ColorGrade {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<ColorGrade>
  return {
    brightness: Math.min(1, Math.max(-1, finite(raw.brightness, 0))),
    contrast: Math.min(2, Math.max(0, finite(raw.contrast, 1))),
    saturation: Math.min(2, Math.max(0, finite(raw.saturation, 1))),
  }
}

function coerceTransition(value: unknown): Transition | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Transition>
  if (!TRANSITIONS.includes(raw.kind as TransitionKind)) return null
  return { kind: raw.kind as TransitionKind, duration: Math.min(2, Math.max(0.1, finite(raw.duration, 0.5))) }
}

function coerceKeys(value: unknown): VolumeKeyframe[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const raw = item as Partial<VolumeKeyframe>
      return {
        time: Math.min(1, Math.max(0, finite(raw.time, 0))),
        value: Math.min(1, Math.max(0, finite(raw.value, 1))),
      }
    })
    .filter((item): item is VolumeKeyframe => item !== null)
    .sort((a, b) => a.time - b.time)
}

function coerceTracks(value: unknown): Track[] {
  if (!Array.isArray(value)) return DEFAULT_TRACKS.map((track) => ({ ...track }))
  const tracks: Track[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Partial<Track>
    if (typeof raw.id !== 'string' || !raw.id) continue
    if (raw.type !== 'video' && raw.type !== 'audio' && raw.type !== 'text') continue
    tracks.push({
      id: raw.id,
      type: raw.type,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : raw.id,
      duck: raw.duck === true,
    })
  }
  if (!tracks.some((track) => track.type === 'video') || !tracks.some((track) => track.type === 'audio')) {
    return DEFAULT_TRACKS.map((track) => ({ ...track }))
  }
  if (!tracks.some((track) => track.type === 'text')) {
    const audioAt = tracks.findIndex((track) => track.type === 'audio')
    tracks.splice(audioAt === -1 ? tracks.length : audioAt, 0, { id: 't1', type: 'text', name: 'טקסט', duck: false })
  }
  return tracks
}

function coerceClip(value: unknown, tracks: Track[]): Clip | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Clip>
  if (typeof raw.id !== 'string' || typeof raw.trackId !== 'string') return null
  const track = tracks.find((item) => item.id === raw.trackId)
  if (!track) return null
  const text = track.type === 'text' ? coerceText(raw.text) : null
  if (track.type === 'text' && !text) return null
  if (track.type !== 'text' && typeof raw.assetId !== 'string') return null
  const duration = Math.max(MIN_CLIP, finite(raw.duration, 1))
  const fades = clampFades(duration, finite(raw.fadeIn, 0), finite(raw.fadeOut, 0))
  return {
    id: raw.id,
    trackId: raw.trackId,
    assetId: track.type === 'text' ? null : (raw.assetId ?? null),
    start: Math.max(0, finite(raw.start, 0)),
    duration,
    inPoint: Math.max(0, finite(raw.inPoint, 0)),
    volume: Math.min(1, Math.max(0, finite(raw.volume, 1))),
    fadeIn: fades.fadeIn,
    fadeOut: fades.fadeOut,
    text,
    speed: clampSpeed(finite(raw.speed, 1)),
    transition: track.type === 'video' ? coerceTransition(raw.transition) : null,
    volumeKeys: coerceKeys(raw.volumeKeys),
    kenBurns: coerceKen(raw.kenBurns),
    color: coerceColor(raw.color),
  }
}

function coerceMarkers(value: unknown): Marker[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const raw = item as Partial<Marker>
      if (typeof raw.id !== 'string') return null
      return {
        id: raw.id,
        time: Math.max(0, finite(raw.time, 0)),
        label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : 'סמן',
      }
    })
    .filter((item): item is Marker => item !== null)
    .sort((a, b) => a.time - b.time)
}

export function coerceProject(value: unknown): Project | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Project>
  if (!Array.isArray(raw.clips)) return null
  const tracks = coerceTracks(raw.tracks)
  const clips = raw.clips.map((clip) => coerceClip(clip, tracks)).filter((clip): clip is Clip => clip !== null)
  return {
    version: 1,
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'פרויקט חדש',
    tracks,
    clips,
    markers: coerceMarkers(raw.markers),
    masterVolume: Math.min(1, Math.max(0, finite(raw.masterVolume, 1))),
  }
}

export function clipsTouching(project: Project, time: number): Clip[] {
  return project.clips.filter((clip) => time > clip.start + MIN_CLIP / 2 && time < clipEnd(clip) - MIN_CLIP / 2)
}

export type DrawLayer = {
  clip: Clip
  local: number
  opacity: number
  slide: number
}

function clampedLocal(clip: Clip, time: number): number {
  return Math.min(Math.max(0, time - clip.start), Math.max(0, clip.duration - 1e-4))
}

export function adjacentTransition(previous: Clip | null, next: Clip): number {
  if (!previous || !next.transition) return 0
  if (Math.abs(next.start - clipEnd(previous)) > 0.08) return 0
  return Math.min(next.transition.duration, previous.duration, next.duration)
}

export function videoLayers(project: Project, time: number): DrawLayer[] {
  const layers: DrawLayer[] = []
  const videoTracks = project.tracks.filter((track) => track.type === 'video')
  for (let index = videoTracks.length - 1; index >= 0; index--) {
    const track = videoTracks[index]
    if (!track) continue
    const clips = project.clips.filter((clip) => clip.trackId === track.id).sort((a, b) => a.start - b.start)
    const covered = new Set<string>()
    for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
      const incoming = clips[clipIndex]
      const outgoing = clipIndex > 0 ? clips[clipIndex - 1] : null
      if (!incoming || !outgoing) continue
      const span = adjacentTransition(outgoing, incoming)
      if (span <= 0) continue
      const cut = incoming.start
      const start = cut - span / 2
      const end = cut + span / 2
      if (time < start || time >= end) continue
      const progress = (time - start) / span
      const kind = incoming.transition?.kind
      covered.add(outgoing.id)
      covered.add(incoming.id)
      const push = (clip: Clip, opacity: number, slide: number) => {
        const local = clampedLocal(clip, time)
        layers.push({ clip, local, opacity: opacity * fadeEnvelope(clip, local), slide })
      }
      if (kind === 'dip') {
        if (progress < 0.5) push(outgoing, 1 - progress * 2, 0)
        else push(incoming, (progress - 0.5) * 2, 0)
      } else if (kind === 'slide') {
        push(outgoing, 1, -progress)
        push(incoming, 1, 1 - progress)
      } else {
        push(outgoing, 1 - progress, 0)
        push(incoming, progress, 0)
      }
    }
    for (const clip of clips) {
      if (covered.has(clip.id)) continue
      if (time < clip.start || time >= clip.start + clip.duration) continue
      const local = time - clip.start
      layers.push({ clip, local, opacity: fadeEnvelope(clip, local), slide: 0 })
    }
  }
  return layers
}

export function sourceTimeAt(clip: Clip, local: number): number {
  return Math.max(0, clip.inPoint + local * clampSpeed(clip.speed))
}
