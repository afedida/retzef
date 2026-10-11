import { describe, expect, it } from 'vitest'
import type { Asset, Clip, Project } from '@/types'
import {
  audioGain,
  blankProject,
  coerceProject,
  fadeEnvelope,
  insertClip,
  makeTextClip,
  moveClip,
  preferredTrack,
  projectDuration,
  resolveStart,
  snapMove,
  snapValue,
  splitClip,
  trimClip,
} from '@/lib/edit'

function clip(partial: Partial<Clip> & Pick<Clip, 'id'>): Clip {
  return {
    trackId: 'v1',
    assetId: 'asset-1',
    start: 0,
    duration: 4,
    inPoint: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    text: null,
    ...partial,
  }
}

function project(clips: Clip[]): Project {
  return { ...blankProject(), clips }
}

const video: Asset = {
  id: 'asset-1',
  name: 'clip.mp4',
  kind: 'video',
  duration: 10,
  width: 1280,
  height: 720,
  hasAudio: true,
  peaks: [],
  thumbnail: null,
}

describe('timeline edits', () => {
  it('snaps to the nearest point inside the threshold', () => {
    expect(snapValue(1.2, [0, 1, 2], 0.3)).toBe(1)
    expect(snapValue(1.2, [0, 2], 0.1)).toBe(1.2)
  })

  it('snaps a move by the closer edge', () => {
    expect(snapMove(1.05, 4, [1, 5], 0.2)).toBe(1)
    expect(snapMove(0.9, 4, [5], 0.2)).toBe(1)
  })

  it('pushes a new clip out of an overlap', () => {
    const others = [clip({ id: 'a', start: 0, duration: 4 })]
    expect(resolveStart(others, 2, 4)).toBe(4)
    expect(resolveStart(others, 3.2, 1)).toBe(4)
  })

  it('allows clips to touch without counting as overlap', () => {
    const others = [clip({ id: 'a', start: 0, duration: 4 })]
    expect(resolveStart(others, 4, 2)).toBe(4)
  })

  it('trims the end at the source duration and the next clip', () => {
    const base = project([
      clip({ id: 'a', start: 0, duration: 3, inPoint: 0 }),
      clip({ id: 'b', start: 6, duration: 2 }),
    ])
    const trimmed = trimClip(base, 'a', 'end', 9, video, [], 0)
    const clipA = trimmed.clips.find((item) => item.id === 'a')
    expect(clipA?.duration).toBe(6)
  })

  it('keeps the end fixed when trimming the start and respects the source head', () => {
    const base = project([clip({ id: 'a', start: 2, duration: 4, inPoint: 1 })])
    const extended = trimClip(base, 'a', 'start', 0, video, [], 0)
    const clipA = extended.clips.find((item) => item.id === 'a')
    expect(clipA?.start).toBe(1)
    expect(clipA?.inPoint).toBe(0)
    expect(clipA?.duration).toBe(5)
  })

  it('lets a text clip extend earlier than its original in-point', () => {
    const text = makeTextClip(2)
    text.duration = 3
    const base = project([text])
    const extended = trimClip(base, text.id, 'start', 0, null, [], 0)
    const next = extended.clips[0]
    expect(next?.start).toBe(0)
    expect(next?.duration).toBe(5)
    expect(next?.text?.content).toContain('שלום')
  })

  it('splits a clip into two that cover the original range', () => {
    const base = project([clip({ id: 'a', start: 1, duration: 4, inPoint: 0.5, fadeIn: 1, fadeOut: 1 })])
    const split = splitClip(base, 'a', 3)
    expect(split).not.toBeNull()
    const [left, right] = split!.project.clips
    expect(left?.duration).toBe(2)
    expect(right?.start).toBe(3)
    expect(right?.duration).toBe(2)
    expect(right?.inPoint).toBe(2.5)
    expect((left?.fadeIn ?? 0) + (left?.fadeOut ?? 0)).toBeLessThanOrEqual((left?.duration ?? 0) + 1e-6)
    expect(projectDuration(split!.project)).toBe(5)
  })

  it('refuses to split too close to an edge', () => {
    const base = project([clip({ id: 'a', start: 0, duration: 4 })])
    expect(splitClip(base, 'a', 0.01)).toBeNull()
  })

  it('moves onto a free track and refuses a track of the wrong type', () => {
    const base = project([clip({ id: 'a', start: 0, duration: 4 })])
    const assets = new Map([[video.id, video]])
    const moved = moveClip(base, 'a', 1, 'a2', [], 0, assets)
    expect(moved.clips[0]?.trackId).toBe('v1')
    expect(moved.clips[0]?.start).toBe(1)
    const layered = moveClip(base, 'a', 0, 'v2', [], 0, assets)
    expect(layered.clips[0]?.trackId).toBe('v2')
  })

  it('picks a free video track when the main track is busy', () => {
    const base = project([clip({ id: 'a', start: 0, duration: 4 })])
    expect(preferredTrack(base, 'video', 1, 2)).toBe('v2')
    expect(preferredTrack(base, 'audio', 0, 3)).toBe('a2')
  })

  it('fades audio in and out', () => {
    const item = clip({ id: 'a', duration: 4, fadeIn: 1, fadeOut: 1, volume: 0.5 })
    expect(fadeEnvelope(item, 0)).toBe(0)
    expect(fadeEnvelope(item, 1)).toBe(1)
    expect(audioGain(item, 2)).toBeCloseTo(0.5)
    expect(audioGain(item, 3.5)).toBeCloseTo(0.25)
    expect(fadeEnvelope(item, 4)).toBe(0)
  })

  it('drops broken clips when loading a project file', () => {
    const loaded = coerceProject({
      name: 'בדיקה',
      clips: [
        clip({ id: 'ok', start: 1, duration: 2 }),
        { id: 'bad' },
        { ...makeTextClip(0), id: 'title' },
      ],
    })
    expect(loaded?.name).toBe('בדיקה')
    expect(loaded?.clips.map((item) => item.id)).toEqual(['ok', 'title'])
    expect(loaded?.tracks).toHaveLength(5)
  })

  it('inserts beside an existing clip instead of overlapping it', () => {
    const base = project([clip({ id: 'a', start: 0, duration: 4 })])
    const incoming = clip({ id: 'b', start: 1, duration: 2 })
    const next = insertClip(base, incoming)
    expect(next.clips.find((item) => item.id === 'b')?.start).toBe(4)
  })
})
