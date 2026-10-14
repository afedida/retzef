import { describe, expect, it } from 'vitest'
import {
  addEndScreen,
  applyAttributes,
  applyJumpZoom,
  applySplit,
  CAPTION_ANCHORS,
  compress,
  crossfadeEnvelope,
  detachAudio,
  equalPowerPan,
  END_SCREEN_SECONDS,
  exportWindow,
  fitMusic,
  highpass,
  jCut,
  jumpZoomKen,
  lCut,
  letterboxThickness,
  limitSamples,
  loopBounds,
  nextRotation,
  noiseGate,
  pickAttributes,
  placeCaption,
  progressBarRect,
  progressFraction,
  setMark,
  shapeVoice,
  splitFrames,
  youtubeSafeGuides,
} from '@/lib/creator'
import { blankProject, coerceProject, freshClip, makeTextClip } from '@/lib/edit'
import type { Asset, Clip, Project } from '@/types'

const video: Asset = {
  id: 'asset-1',
  name: 'talk.mp4',
  kind: 'video',
  duration: 10,
  width: 1920,
  height: 1080,
  hasAudio: true,
  peaks: [],
  thumbnail: null,
  mime: 'video/mp4',
}

function project(clips: Clip[], patch: Partial<Project> = {}): Project {
  return { ...blankProject(), clips, ...patch }
}

describe('youtube creator tools', () => {
  it('exports the marked range and falls back to the full timeline', () => {
    const base = project([freshClip({ id: 'a', duration: 80 })], { markIn: 10, markOut: 70 })
    expect(exportWindow(base)).toMatchObject({ start: 10, end: 70, duration: 60, ranged: true })
    expect(exportWindow(project([freshClip({ id: 'a', duration: 8 })]))).toMatchObject({ duration: 8, ranged: false })
    expect(exportWindow(project([freshClip({ id: 'a', duration: 8 })], { markIn: 3, markOut: 3.02 })).ranged).toBe(false)
  })

  it('loops only a real in-out range', () => {
    const open = project([freshClip({ id: 'a', duration: 20 })], { loopRegion: true })
    expect(loopBounds(open)).toBeNull()
    const marked = setMark(setMark(open, 'in', 4), 'out', 9)
    expect(loopBounds({ ...marked, loopRegion: true })).toEqual({ start: 4, end: 9 })
  })

  it('swaps the range when the new mark would invert it', () => {
    const marked = setMark(setMark(project([freshClip({ id: 'a', duration: 12 })]), 'in', 2), 'out', 6)
    expect(setMark(marked, 'in', 8)).toMatchObject({ markIn: 6, markOut: 8 })
    expect(setMark(marked, 'out', 1)).toMatchObject({ markIn: 1, markOut: 2 })
  })

  it('measures the progress bar inside the export range', () => {
    const base = project([freshClip({ id: 'a', duration: 100 })], { markIn: 40, markOut: 60 })
    expect(progressFraction(base, 40)).toBe(0)
    expect(progressFraction(base, 50)).toBeCloseTo(0.5)
    expect(progressFraction(base, 70)).toBe(1)
    expect(progressBarRect(0.25, 1000, 500).w).toBe(250)
    expect(letterboxThickness(0, 1080)).toBe(0)
    expect(letterboxThickness(0.12, 1000)).toBe(120)
  })

  it('keeps title-safe guides above the YouTube UI band', () => {
    const guides = youtubeSafeGuides()
    const title = guides.find((guide) => guide.id === 'title')
    const ui = guides.find((guide) => guide.id === 'ui')
    expect(title).toBeTruthy()
    expect(ui).toBeTruthy()
    expect((title?.y ?? 0) + (title?.h ?? 0)).toBeLessThanOrEqual((ui?.y ?? 0) + 0.001)
    expect(CAPTION_ANCHORS.bottom.y).toBeLessThan(ui?.y ?? 1)
  })

  it('pans with equal power', () => {
    expect(equalPowerPan(0).left).toBeCloseTo(Math.SQRT1_2)
    expect(equalPowerPan(0).right).toBeCloseTo(Math.SQRT1_2)
    expect(equalPowerPan(-1)).toEqual({ left: 1, right: 0 })
    expect(equalPowerPan(1).left).toBeCloseTo(0)
    expect(equalPowerPan(1).right).toBeCloseTo(1)
  })

  it('equal-power crossfades touching audio clips', () => {
    const left = freshClip({ id: 'a', start: 0, duration: 2, audioCrossfade: 0 })
    const right = freshClip({ id: 'b', start: 2, duration: 2, audioCrossfade: 1 })
    expect(crossfadeEnvelope(right, [left, right], 0.5)).toBeCloseTo(Math.sin(Math.PI / 4))
    expect(crossfadeEnvelope(left, [left, right], 1.5)).toBeCloseTo(Math.sin(Math.PI / 4))
    expect(crossfadeEnvelope(right, [left, right], 1.5)).toBe(1)
    const gap = freshClip({ id: 'c', start: 3, duration: 2, audioCrossfade: 1 })
    expect(crossfadeEnvelope(gap, [left, gap], 0.2)).toBe(1)
  })

  it('high-passes rumble, compresses loud voice, limits peaks, and gates room tone', () => {
    const rate = 4000
    const constant = new Float32Array(rate).fill(1)
    const filtered = highpass(constant, rate, 80)
    expect(Math.abs(filtered[filtered.length - 1] ?? 1)).toBeLessThan(0.05)
    const loud = compress(constant, rate, { threshold: 0.2, ratio: 4, attack: 0.005, release: 0.05 })
    expect(Math.abs(loud[loud.length - 1] ?? 1)).toBeLessThan(0.55)
    const quiet = compress(new Float32Array(rate).fill(0.05), rate, { threshold: 0.2, ratio: 4, attack: 0.005, release: 0.05 })
    expect(quiet[quiet.length - 1]).toBeCloseTo(0.05, 1)
    expect(limitSamples(new Float32Array([2, -2, 0.2]))[0]).toBeCloseTo(0.89)
    const tone = new Float32Array(rate).fill(0.001)
    const gated = noiseGate(tone, rate, 0.02)
    expect(Math.abs(gated[gated.length - 1] ?? 1)).toBeLessThan(0.0002)
    const voice = shapeVoice(constant, rate)
    expect(Math.abs(voice[voice.length - 1] ?? 1)).toBeLessThan(0.7)
  })

  it('detaches video audio and builds a J-cut and an L-cut', () => {
    const clip = freshClip({ id: 'talk', start: 2, duration: 2, inPoint: 1, volume: 0.8, trackId: 'v1' })
    const detached = detachAudio(project([clip]), 'talk', video)
    expect(detached.clips.find((item) => item.id === 'talk')?.volume).toBe(0)
    const voice = detached.clips.find((item) => item.trackId === 'a1')
    expect(voice).toMatchObject({ assetId: 'asset-1', start: 2, duration: 2, inPoint: 1 })

    const cut = jCut(project([clip]), 'talk', video, 0.5)
    const lead = cut.clips.find((item) => item.trackId === 'a1')
    expect(lead?.start).toBeCloseTo(1.5)
    expect(lead?.duration).toBeCloseTo(2.5)
    expect(lead?.inPoint).toBeCloseTo(0.5)

    const tail = lCut(project([freshClip({ id: 'talk', start: 0, duration: 2, inPoint: 0 })]), 'talk', video, 0.6)
    expect(tail.clips.find((item) => item.trackId === 'a1')?.duration).toBeCloseTo(2.6)
    const silent = project([clip])
    expect(jCut(silent, 'talk', { ...video, hasAudio: false })).toBe(silent)
  })

  it('does not J-cut a clip that has no source ahead of the in point', () => {
    const clip = freshClip({ id: 'talk', start: 0, duration: 2, inPoint: 0, trackId: 'a1', assetId: 'asset-1' })
    const base = project([clip])
    expect(jCut(base, 'talk', video, 0.5)).toBe(base)
  })

  it('splits the frame, alternates jump zoom, and anchors captions', () => {
    expect(splitFrames('horizontal')[1]).toMatchObject({ x: 0.5, w: 0.5 })
    expect(splitFrames('vertical')[1]).toMatchObject({ y: 0.5, h: 0.5 })
    const left = freshClip({ id: 'a', start: 0, duration: 4, trackId: 'v1' })
    const right = freshClip({ id: 'b', start: 4, duration: 4, trackId: 'v1' })
    const split = applySplit(project([left, right]), ['a', 'b'], 'horizontal')
    expect(split.clips.find((item) => item.id === 'b')).toMatchObject({ trackId: 'v2', start: 0, frame: splitFrames('horizontal')[1] })
    const zoomed = applyJumpZoom(project([left, freshClip({ id: 'c', start: 4, duration: 2, trackId: 'v1' })]))
    expect(zoomed.clips.find((item) => item.id === 'c')?.kenBurns.scaleStart).toBe(jumpZoomKen(1).scaleStart)
    const caption = makeTextClip(0)
    const lowered = placeCaption(project([caption]), caption.id, 'bottom')
    expect(lowered.clips[0]?.text).toMatchObject(CAPTION_ANCHORS.bottom)
    expect(nextRotation(270)).toBe(0)
  })

  it('fits the music bed and appends a twelve second end screen', () => {
    const picture = freshClip({ id: 'v', duration: 8, trackId: 'v1' })
    const music = freshClip({ id: 'm', trackId: 'a2', assetId: 'song', duration: 30, inPoint: 0 })
    const fitted = fitMusic(project([picture, music]), { ...video, id: 'song', kind: 'audio', duration: 30 })
    expect(fitted.clips.find((item) => item.id === 'm')).toMatchObject({ start: 0, duration: 8 })
    expect(fitted.clips.find((item) => item.id === 'm')?.fadeOut).toBeGreaterThan(1)
    const ending = addEndScreen(project([picture]))
    expect(Math.max(...ending.clips.map((item) => item.start + item.duration))).toBe(8 + END_SCREEN_SECONDS)
    expect(ending.clips.some((item) => item.text?.content === 'הירשמו')).toBe(true)
    expect(ending.clips.some((item) => item.text?.content === 'הסרטון הבא')).toBe(true)
  })

  it('pastes grade and voice settings without replacing caption text', () => {
    const source = freshClip({ id: 'a', volume: 0.4, voice: true, pan: -0.3, color: { brightness: 0.2, contrast: 1.2, saturation: 0.8 } })
    const caption = makeTextClip(1)
    const pasted = applyAttributes(project([source, caption]), [caption.id], pickAttributes(source))
    expect(pasted.clips.find((item) => item.id === caption.id)?.volume).toBe(0.4)
    expect(pasted.clips.find((item) => item.id === caption.id)?.voice).toBe(true)
    expect(pasted.clips.find((item) => item.id === caption.id)?.text?.content).toBe(caption.text?.content)
  })

  it('loads older projects with the new defaults', () => {
    const loaded = coerceProject({
      name: 'ישן',
      clips: [{ id: 'c', trackId: 'v1', assetId: 'asset', start: 0, duration: 2, inPoint: 0, volume: 1, fadeIn: 0, fadeOut: 0, text: null }],
      tracks: blankProject().tracks,
    })
    expect(loaded?.markIn).toBeNull()
    expect(loaded?.progressBar).toBe(false)
    expect(loaded?.letterbox).toBe(0)
    expect(loaded?.clips[0]).toMatchObject({ pan: 0, audioCrossfade: 0, voice: false, gate: false, flipH: false, rotation: 0 })
  })
})
