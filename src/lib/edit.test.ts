import { describe, expect, it } from 'vitest'
import { mixGain } from '@/lib/audio'
import type { Asset, Clip, Project } from '@/types'
import {
  addTextTrack,
  adjacentTransition,
  audioGain,
  blankProject,
  coerceProject,
  fadeEnvelope,
  insertClip,
  keyedVolume,
  makeMediaClip,
  makeTextClip,
  moveClip,
  preferredTrack,
  projectDuration,
  setTrackVolume,
  removeTextTrack,
  resolveStart,
  rippleDelete,
  setSpeed,
  snapMove,
  snapValue,
  splitClip,
  trimClip,
  videoLayers,
  freshClip,
} from '@/lib/edit'

function clip(partial: Partial<Clip> & Pick<Clip, 'id'>): Clip {
  return freshClip(partial)
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
  mime: 'video/mp4',
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
    expect(preferredTrack(base, 'audio', 0, 3, 'a1')).toBe('a1')
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

  it('limits a faster clip to the remaining source', () => {
    const base = project([clip({ id: 'a', start: 0, duration: 8, inPoint: 0 })])
    const sped = setSpeed(base, 'a', 2, video)
    expect(sped.clips[0]?.speed).toBe(2)
    expect(sped.clips[0]?.duration).toBe(5)
  })

  it('ripple-deletes and closes the gap on the same track', () => {
    const base = project([
      clip({ id: 'a', start: 0, duration: 2 }),
      clip({ id: 'b', start: 2, duration: 3 }),
      clip({ id: 'c', start: 0, duration: 4, trackId: 'v2' }),
    ])
    const next = rippleDelete(base, 'a')
    expect(next.clips.find((item) => item.id === 'a')).toBeUndefined()
    expect(next.clips.find((item) => item.id === 'b')?.start).toBe(0)
    expect(next.clips.find((item) => item.id === 'c')?.start).toBe(0)
  })

  it('crossfades only when the clips touch', () => {
    const left = clip({ id: 'a', start: 0, duration: 2 })
    const right = clip({
      id: 'b',
      start: 2,
      duration: 2,
      transition: { kind: 'crossfade', duration: 0.6 },
    })
    const base = project([left, right])
    expect(adjacentTransition(left, right)).toBe(0.6)
    const mid = videoLayers(base, 2)
    expect(mid.map((layer) => layer.clip.id).sort()).toEqual(['a', 'b'])
    const early = videoLayers(base, 0.2)
    expect(early).toHaveLength(1)
    expect(early[0]?.clip.id).toBe('a')
  })

  it('interpolates volume keyframes', () => {
    const item = clip({
      id: 'a',
      duration: 4,
      volume: 1,
      volumeKeys: [
        { time: 0, value: 0 },
        { time: 1, value: 1 },
      ],
    })
    expect(keyedVolume(item, 2)).toBeCloseTo(0.5)
    expect(audioGain(item, 2)).toBeCloseTo(0.5)
  })

  it('adds and removes text tracks without dropping the last one', () => {
    const added = addTextTrack(blankProject())
    expect(added.tracks.filter((track) => track.type === 'text')).toHaveLength(2)
    const extra = added.tracks.find((track) => track.type === 'text' && track.id !== 't1')
    const removed = removeTextTrack(added, extra!.id)
    expect(removed.tracks.filter((track) => track.type === 'text')).toHaveLength(1)
    expect(removeTextTrack(removed, 't1')).toBe(removed)
  })

  it('keeps an extra text track when reopening a project', () => {
    const withTrack = addTextTrack(blankProject())
    const textTrack = withTrack.tracks.find((track) => track.id !== 't1' && track.type === 'text')!
    const title = makeTextClip(0, textTrack.id)
    const loaded = coerceProject({ ...withTrack, clips: [title, makeMediaClip(video, 'v1', 0)] })
    expect(loaded?.tracks.some((track) => track.id === textTrack.id)).toBe(true)
    expect(loaded?.clips.find((item) => item.id === title.id)?.text?.font).toBe('heebo')
    expect(loaded?.masterVolume).toBe(1)
  })

  it('starts with voiceover and music, and ducks music', () => {
    const fresh = blankProject()
    expect(fresh.tracks.find((track) => track.id === 'a1')).toMatchObject({ name: 'קריינות', duck: false, volume: 1 })
    expect(fresh.tracks.find((track) => track.id === 'a2')).toMatchObject({ name: 'מוזיקה', duck: true, volume: 1 })
  })

  it('renames legacy audio tracks, ducks music once, and keeps clips', () => {
    const loaded = coerceProject({
      name: 'ישן',
      tracks: [
        { id: 'v1', type: 'video', name: 'וידאו 1' },
        { id: 't1', type: 'text', name: 'טקסט' },
        { id: 'a1', type: 'audio', name: 'שמע', duck: false },
        { id: 'a2', type: 'audio', name: 'מוזיקה', duck: false },
        { id: 'a3', type: 'audio', name: 'אפקטים', duck: false },
      ],
      clips: [
        { id: 'vo', trackId: 'a1', assetId: 'mic', start: 0, duration: 2, inPoint: 0, volume: 0.8 },
        { id: 'fx', trackId: 'a3', assetId: 'fx', start: 1, duration: 1, inPoint: 0, volume: 1 },
      ],
    })
    expect(loaded?.tracks.find((track) => track.id === 'a1')?.name).toBe('קריינות')
    expect(loaded?.tracks.find((track) => track.id === 'a2')).toMatchObject({ name: 'מוזיקה', duck: true, volume: 1 })
    expect(loaded?.tracks.find((track) => track.id === 'a3')?.name).toBe('אפקטים')
    expect(loaded?.clips.map((item) => `${item.id}:${item.trackId}`)).toEqual(['vo:a1', 'fx:a3'])
    const kept = coerceProject({
      clips: [],
      tracks: loaded?.tracks.map((track) => (track.id === 'a2' ? { ...track, duck: false } : track)),
    })
    expect(kept?.tracks.find((track) => track.id === 'a2')?.duck).toBe(false)
  })

  it('adds missing voiceover and music tracks without dropping clips', () => {
    const loaded = coerceProject({
      clips: [{ id: 'v', trackId: 'v1', assetId: 'a', start: 0, duration: 2, inPoint: 0, volume: 1 }],
      tracks: [
        { id: 'v1', type: 'video', name: 'וידאו 1' },
        { id: 't1', type: 'text', name: 'טקסט' },
        { id: 'sfx', type: 'audio', name: 'אפקטים' },
      ],
    })
    const ids = loaded?.tracks.map((track) => track.id) ?? []
    expect(loaded?.tracks.find((track) => track.id === 'a1')?.name).toBe('קריינות')
    expect(loaded?.tracks.find((track) => track.id === 'a2')).toMatchObject({ name: 'מוזיקה', duck: true })
    expect(ids.indexOf('a1')).toBeLessThan(ids.indexOf('a2'))
    expect(loaded?.clips[0]?.trackId).toBe('v1')
    expect(loaded?.tracks.find((track) => track.id === 'sfx')?.name).toBe('אפקטים')
  })

  it('scales mix gain by the audio track volume', () => {
    const quieter = setTrackVolume(blankProject(), 'a2', 0.5)
    const tracks = quieter.tracks.map((track) => (track.id === 'a2' ? { ...track, duck: false } : track))
    const item = clip({ id: 'm', trackId: 'a2', assetId: 'song', duration: 4, volume: 0.8 })
    expect(mixGain({ ...quieter, tracks }, [], item, 1)).toBeCloseTo(0.4)
  })
})
