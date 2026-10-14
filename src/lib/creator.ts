import { clipEnd, clampSpeed, freshClip, insertClip, projectDuration, updateClip } from '@/lib/edit'
import type { Asset, CaptionAnchor, Clip, FrameBox, KenBurns, Project, Rotation } from '@/types'

export const END_SCREEN_SECONDS = 12
export const LETTERBOX_RATIO = 0.12
export const JUMP_ZOOM = 1.14

export type ExportWindow = {
  start: number
  end: number
  duration: number
  ranged: boolean
}

export type SafeGuide = {
  id: string
  x: number
  y: number
  w: number
  h: number
  label: string
}

export type ClipAttributes = Pick<
  Clip,
  | 'volume'
  | 'fadeIn'
  | 'fadeOut'
  | 'speed'
  | 'color'
  | 'opacity'
  | 'blend'
  | 'lutId'
  | 'preservePitch'
  | 'denoise'
  | 'normalize'
  | 'voice'
  | 'gate'
  | 'pan'
  | 'audioCrossfade'
  | 'flipH'
  | 'flipV'
  | 'rotation'
  | 'kenBurns'
  | 'mask'
  | 'captionStyle'
>

export const CAPTION_ANCHORS: Record<CaptionAnchor, { x: number; y: number }> = {
  bottom: { x: 0.5, y: 0.78 },
  middle: { x: 0.5, y: 0.5 },
  top: { x: 0.5, y: 0.18 },
}

export function exportWindow(project: Project): ExportWindow {
  const timeline = Math.max(0, projectDuration(project))
  const markIn = project.markIn
  const markOut = project.markOut
  if (markIn == null || markOut == null || !(markOut - markIn >= 0.1)) {
    return { start: 0, end: timeline, duration: timeline, ranged: false }
  }
  const start = Math.min(Math.max(0, markIn), timeline)
  const end = Math.min(Math.max(start, markOut), timeline)
  const duration = end - start
  if (duration < 0.1) return { start: 0, end: timeline, duration: timeline, ranged: false }
  return { start, end, duration, ranged: true }
}

export function loopBounds(project: Project): { start: number; end: number } | null {
  if (!project.loopRegion) return null
  const window = exportWindow(project)
  if (!window.ranged) return null
  return { start: window.start, end: window.end }
}

export function setMark(project: Project, edge: 'in' | 'out', time: number): Project {
  const limit = Math.max(0, projectDuration(project))
  const mark = Math.min(limit, Math.max(0, time))
  const other = edge === 'in' ? project.markOut : project.markIn
  if (other == null || Math.abs(mark - other) <= 0.05) {
    return edge === 'in' ? { ...project, markIn: mark } : { ...project, markOut: mark }
  }
  const markIn = Math.min(mark, other)
  const markOut = Math.max(mark, other)
  return { ...project, markIn, markOut }
}

export function clearMarks(project: Project): Project {
  return { ...project, markIn: null, markOut: null }
}

export function progressFraction(project: Project, time: number): number {
  const window = exportWindow(project)
  if (window.duration <= 0) return 0
  return Math.min(1, Math.max(0, (time - window.start) / window.duration))
}

export function letterboxThickness(amount: number, height: number): number {
  const ratio = Math.min(0.22, Math.max(0, amount))
  if (ratio <= 0 || height <= 0) return 0
  return Math.round(height * ratio)
}

export function progressBarRect(
  fraction: number,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const h = Math.max(4, Math.round(height * 0.012))
  return {
    x: 0,
    y: Math.max(0, height - h),
    w: Math.max(0, width * Math.min(1, Math.max(0, fraction))),
    h,
  }
}

export function youtubeSafeGuides(): SafeGuide[] {
  return [
    { id: 'action', x: 0.035, y: 0.035, w: 0.93, h: 0.93, label: 'פעולה בטוחה' },
    { id: 'title', x: 0.08, y: 0.08, w: 0.84, h: 0.7, label: 'כותרת בטוחה' },
    { id: 'ui', x: 0, y: 0.86, w: 1, h: 0.14, label: 'ממשק יוטיוב' },
  ]
}

export function equalPowerPan(pan: number): { left: number; right: number } {
  const t = Math.min(1, Math.max(-1, pan))
  const angle = ((t + 1) / 2) * (Math.PI / 2)
  return { left: Math.cos(angle), right: Math.sin(angle) }
}

function touches(left: Clip, right: Clip): boolean {
  return left.trackId === right.trackId && Math.abs(right.start - clipEnd(left)) <= 0.08
}

export function crossfadeEnvelope(clip: Clip, sameTrack: Clip[], local: number): number {
  if (local < 0 || local >= clip.duration) return 0
  let gain = 1
  const previous = sameTrack
    .filter((item) => item.id !== clip.id && touches(item, clip))
    .sort((a, b) => b.start - a.start)[0]
  const next = sameTrack
    .filter((item) => item.id !== clip.id && touches(clip, item))
    .sort((a, b) => a.start - b.start)[0]
  const fadeIn = previous ? Math.min(clip.audioCrossfade ?? 0, clip.duration / 2, previous.duration / 2) : 0
  if (fadeIn > 0 && local < fadeIn) gain *= Math.sin((local / fadeIn) * (Math.PI / 2))
  const fadeOut = next ? Math.min(next.audioCrossfade ?? 0, clip.duration / 2, next.duration / 2) : 0
  if (fadeOut > 0 && local > clip.duration - fadeOut) {
    gain *= Math.sin(((clip.duration - local) / fadeOut) * (Math.PI / 2))
  }
  return Math.min(1, Math.max(0, gain))
}

export function highpass(samples: Float32Array, sampleRate: number, cutoff = 90): Float32Array {
  const rate = Math.max(1, sampleRate)
  const rc = 1 / (2 * Math.PI * Math.max(1, cutoff))
  const alpha = rc / (rc + 1 / rate)
  const out = new Float32Array(samples.length)
  let previousIn = samples[0] ?? 0
  let previousOut = 0
  for (let index = 0; index < samples.length; index++) {
    const input = samples[index] ?? 0
    const next = alpha * (previousOut + input - previousIn)
    out[index] = next
    previousIn = input
    previousOut = next
  }
  return out
}

export function compress(
  samples: Float32Array,
  sampleRate: number,
  options?: { threshold?: number; ratio?: number; attack?: number; release?: number },
): Float32Array {
  const threshold = options?.threshold ?? 0.2
  const ratio = Math.max(1, options?.ratio ?? 3)
  const attack = Math.max(0.001, options?.attack ?? 0.012)
  const release = Math.max(attack, options?.release ?? 0.12)
  const attackCoef = Math.exp(-1 / (Math.max(1, sampleRate) * attack))
  const releaseCoef = Math.exp(-1 / (Math.max(1, sampleRate) * release))
  const out = new Float32Array(samples.length)
  let envelope = 0
  for (let index = 0; index < samples.length; index++) {
    const input = samples[index] ?? 0
    const level = Math.abs(input)
    const coef = level > envelope ? attackCoef : releaseCoef
    envelope = coef * envelope + (1 - coef) * level
    let gain = 1
    if (envelope > threshold) gain = (threshold + (envelope - threshold) / ratio) / envelope
    out[index] = input * gain
  }
  return out
}

export function limitSamples(samples: Float32Array, ceiling = 0.89): Float32Array {
  const cap = Math.min(1, Math.max(0.05, ceiling))
  const out = new Float32Array(samples.length)
  for (let index = 0; index < samples.length; index++) {
    const input = samples[index] ?? 0
    out[index] = Math.max(-cap, Math.min(cap, input))
  }
  return out
}

export function shapeVoice(samples: Float32Array, sampleRate: number): Float32Array {
  return compress(highpass(samples, sampleRate, 90), sampleRate, { threshold: 0.18, ratio: 3.2, attack: 0.01, release: 0.14 })
}

export function noiseGate(
  samples: Float32Array,
  sampleRate: number,
  threshold = 0.02,
  attack = 0.006,
  release = 0.09,
): Float32Array {
  const rate = Math.max(1, sampleRate)
  const attackCoef = Math.exp(-1 / (rate * Math.max(0.001, attack)))
  const releaseCoef = Math.exp(-1 / (rate * Math.max(attack, release)))
  const out = new Float32Array(samples.length)
  let envelope = 0
  let gain = 0
  for (let index = 0; index < samples.length; index++) {
    const input = samples[index] ?? 0
    envelope = 0.99 * envelope + 0.01 * Math.abs(input)
    const open = envelope >= threshold ? 1 : 0
    const coef = open > gain ? attackCoef : releaseCoef
    gain = coef * gain + (1 - coef) * open
    out[index] = input * gain
  }
  return out
}

export function nextRotation(current: Rotation | number): Rotation {
  const steps: Rotation[] = [0, 90, 180, 270]
  const index = steps.indexOf(current as Rotation)
  return steps[(index + 1) % steps.length] ?? 90
}

export function splitFrames(orientation: 'horizontal' | 'vertical'): [FrameBox, FrameBox] {
  if (orientation === 'vertical') {
    return [
      { x: 0, y: 0, w: 1, h: 0.5, radius: 0 },
      { x: 0, y: 0.5, w: 1, h: 0.5, radius: 0 },
    ]
  }
  return [
    { x: 0, y: 0, w: 0.5, h: 1, radius: 0 },
    { x: 0.5, y: 0, w: 0.5, h: 1, radius: 0 },
  ]
}

export function applySplit(project: Project, ids: string[], orientation: 'horizontal' | 'vertical'): Project {
  const clips = ids
    .map((id) => project.clips.find((clip) => clip.id === id))
    .filter((clip): clip is Clip => Boolean(clip && !clip.text))
  const first = clips[0]
  const second = clips[1]
  if (!first || !second) return project
  const [left, right] = splitFrames(orientation)
  let next = updateClip(project, first.id, { frame: left, trackId: first.trackId })
  next = updateClip(next, second.id, {
    frame: right,
    trackId: second.trackId === first.trackId ? 'v2' : second.trackId,
    start: first.start,
  })
  return next
}

export function jumpZoomKen(index: number): KenBurns {
  if (index % 2 === 1) {
    return {
      scaleStart: JUMP_ZOOM,
      scaleEnd: JUMP_ZOOM + 0.04,
      xStart: 0.5,
      yStart: 0.46,
      xEnd: 0.5,
      yEnd: 0.46,
    }
  }
  return { scaleStart: 1, scaleEnd: 1, xStart: 0.5, yStart: 0.5, xEnd: 0.5, yEnd: 0.5 }
}

export function applyJumpZoom(project: Project, trackId = 'v1'): Project {
  const clips = project.clips
    .filter((clip) => clip.trackId === trackId && !clip.text && !clip.shape && !clip.adjustment && clip.assetId)
    .sort((a, b) => a.start - b.start)
  return clips.reduce((next, clip, index) => updateClip(next, clip.id, { kenBurns: jumpZoomKen(index) }), project)
}

export function pickAttributes(clip: Clip): ClipAttributes {
  return {
    volume: clip.volume,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    speed: clip.speed,
    color: { ...clip.color },
    opacity: clip.opacity,
    blend: clip.blend,
    lutId: clip.lutId,
    preservePitch: clip.preservePitch,
    denoise: clip.denoise,
    normalize: clip.normalize,
    voice: clip.voice,
    gate: clip.gate,
    pan: clip.pan,
    audioCrossfade: clip.audioCrossfade,
    flipH: clip.flipH,
    flipV: clip.flipV,
    rotation: clip.rotation,
    kenBurns: { ...clip.kenBurns },
    mask: clip.mask,
    captionStyle: clip.captionStyle,
  }
}

export function applyAttributes(project: Project, ids: string[], attributes: ClipAttributes): Project {
  return ids.reduce((next, id) => updateClip(next, id, { ...attributes, color: { ...attributes.color }, kenBurns: { ...attributes.kenBurns } }), project)
}

export function fitMusic(project: Project, asset: Asset | null): Project {
  const bed = project.clips.filter((clip) => clip.trackId === 'a2').sort((a, b) => a.start - b.start)[0]
  if (!bed) return project
  const videoEnd = project.clips
    .filter((clip) => {
      const track = project.tracks.find((item) => item.id === clip.trackId)
      return track?.type === 'video' && !clip.adjustment
    })
    .reduce((max, clip) => Math.max(max, clipEnd(clip)), 0)
  if (videoEnd < 0.2) return project
  const speed = clampSpeed(bed.speed)
  let duration = Math.max(0.1, videoEnd)
  if (asset && asset.duration > 0) duration = Math.min(duration, Math.max(0.1, (asset.duration - bed.inPoint) / speed))
  const fadeOut = Math.min(1.5, duration / 3)
  const fadeIn = Math.min(0.35, duration / 5)
  return updateClip(project, bed.id, { start: 0, duration, fadeIn, fadeOut })
}

function audioCopy(clip: Clip): Clip {
  return freshClip({
    id: crypto.randomUUID(),
    trackId: 'a1',
    assetId: clip.assetId,
    start: clip.start,
    duration: clip.duration,
    inPoint: clip.inPoint,
    volume: clip.volume > 0 ? clip.volume : 1,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    speed: clip.speed,
    preservePitch: clip.preservePitch,
    reverse: clip.reverse,
    denoise: clip.denoise,
    normalize: clip.normalize,
    voice: clip.voice,
    gate: clip.gate,
    pan: clip.pan,
    audioCrossfade: clip.audioCrossfade,
  })
}

export function detachAudio(project: Project, clipId: string, asset: Asset | null): Project {
  const clip = project.clips.find((item) => item.id === clipId)
  if (!clip?.assetId || !asset?.hasAudio || clip.text) return project
  const track = project.tracks.find((item) => item.id === clip.trackId)
  if (!track || track.type === 'audio') return project
  const muted = updateClip(project, clip.id, { volume: 0 })
  return insertClip(muted, audioCopy(clip))
}

function detachedOrSelf(project: Project, clip: Clip, asset: Asset | null): { project: Project; audio: Clip } | null {
  const track = project.tracks.find((item) => item.id === clip.trackId)
  if (track?.type === 'audio') return { project, audio: clip }
  const next = detachAudio(project, clip.id, asset)
  if (next === project) return null
  const audio = next.clips[next.clips.length - 1]
  if (!audio) return null
  return { project: next, audio }
}

export function jCut(project: Project, clipId: string, asset: Asset | null, lead = 0.7): Project {
  const clip = project.clips.find((item) => item.id === clipId)
  if (!clip || !asset?.hasAudio) return project
  const held = detachedOrSelf(project, clip, asset)
  if (!held) return project
  const audio = held.audio
  const speed = clampSpeed(audio.speed)
  const shift = Math.min(lead, audio.inPoint / speed, audio.start)
  if (shift < 0.05) return held.project
  return updateClip(held.project, audio.id, {
    start: audio.start - shift,
    duration: audio.duration + shift,
    inPoint: Math.max(0, audio.inPoint - shift * speed),
  })
}

export function lCut(project: Project, clipId: string, asset: Asset | null, tail = 0.7): Project {
  const clip = project.clips.find((item) => item.id === clipId)
  if (!clip || !asset?.hasAudio) return project
  const held = detachedOrSelf(project, clip, asset)
  if (!held) return project
  const audio = held.audio
  const speed = clampSpeed(audio.speed)
  const sourceLeft = asset.duration - (audio.inPoint + audio.duration * speed)
  const extend = Math.min(tail, Math.max(0, sourceLeft / speed))
  if (extend < 0.05) return held.project
  return updateClip(held.project, audio.id, { duration: audio.duration + extend })
}

export function addEndScreen(project: Project): Project {
  const start = Math.max(0, projectDuration(project))
  const duration = END_SCREEN_SECONDS
  const subscribe = freshClip({
    id: crypto.randomUUID(),
    trackId: 'v2',
    assetId: null,
    start,
    duration,
    shape: 'rect',
    shapeFill: '#0e639c',
    opacity: 0.94,
    frame: { x: 0.08, y: 0.22, w: 0.38, h: 0.5, radius: 0.08 },
    volume: 0,
  })
  const nextCard = freshClip({
    id: crypto.randomUUID(),
    trackId: 'v2',
    assetId: null,
    start,
    duration,
    shape: 'rect',
    shapeFill: '#252526',
    borderWidth: 10,
    borderColor: '#50e6ff',
    opacity: 0.94,
    frame: { x: 0.54, y: 0.22, w: 0.38, h: 0.5, radius: 0.08 },
    volume: 0,
  })
  const subscribeText = freshClip({
    id: crypto.randomUUID(),
    trackId: 't1',
    assetId: null,
    start,
    duration,
    text: {
      content: 'הירשמו',
      fontSize: 68,
      color: '#ffffff',
      x: 0.27,
      y: 0.48,
      font: 'heebo',
      align: 'center',
      stroke: false,
      shadow: true,
      plate: false,
      animation: 'fade',
      animDuration: 0.4,
    },
  })
  const nextText = freshClip({
    id: crypto.randomUUID(),
    trackId: 't1',
    assetId: null,
    start,
    duration,
    text: {
      content: 'הסרטון הבא',
      fontSize: 48,
      color: '#ffffff',
      x: 0.73,
      y: 0.48,
      font: 'heebo',
      align: 'center',
      stroke: false,
      shadow: true,
      plate: false,
      animation: 'fade',
      animDuration: 0.4,
    },
  })
  return { ...project, clips: [...project.clips, subscribe, nextCard, subscribeText, nextText] }
}

export function placeCaption(project: Project, clipId: string, anchor: CaptionAnchor): Project {
  const clip = project.clips.find((item) => item.id === clipId)
  if (!clip?.text) return project
  const spot = CAPTION_ANCHORS[anchor]
  return updateClip(project, clipId, { text: { ...clip.text, x: spot.x, y: spot.y, align: 'center' } })
}
