import { describe, expect, it } from 'vitest'
import { detectBeats } from '@/lib/beats'
import { youtubeChapters } from '@/lib/chapters'
import { evenWords, fillerRanges, isFiller } from '@/lib/fillers'
import { matchPatch } from '@/lib/track'
import {
  blankProject,
  coerceProject,
  defaultText,
  deleteWord,
  flattenCompounds,
  freshClip,
  nestClips,
  sourceTimeAt,
  unnestClip,
} from '@/lib/edit'

describe('studio tools', () => {
  it('plays a reversed clip from the out point back to the in point', () => {
    const clip = freshClip({ id: 'a', inPoint: 1, duration: 2, speed: 1, reverse: true })
    expect(sourceTimeAt(clip, 0)).toBeCloseTo(3)
    expect(sourceTimeAt(clip, 2)).toBeCloseTo(1)
  })

  it('finds filler words and closes the gap when a word is deleted', () => {
    expect(isFiller('אממ')).toBe(true)
    expect(isFiller('שלום')).toBe(false)
    const words = evenWords('שלום אה עולם', 3)
    expect(fillerRanges(words, 0).map((range) => words.find((word) => word.start === range.start)?.text)).toEqual(['אה'])
    let project = blankProject()
    project = {
      ...project,
      clips: [
        freshClip({ id: 'v', start: 0, duration: 3, trackId: 'v1' }),
        freshClip({
          id: 't',
          start: 0,
          duration: 3,
          trackId: 't1',
          assetId: null,
          text: { ...defaultText(), content: 'שלום אה עולם' },
          words,
        }),
      ],
    }
    const next = deleteWord(project, 't', 1)
    const video = next.clips.find((clip) => clip.id === 'v')
    expect(video?.duration).toBeLessThan(3)
    expect(next.clips.some((clip) => clip.words.some((word) => word.text === 'אה'))).toBe(false)
    expect(next.clips.some((clip) => clip.text?.content === 'אה')).toBe(false)
  })

  it('detects impulses as beats', () => {
    const sampleRate = 8000
    const samples = new Float32Array(sampleRate * 2)
    for (let index = 0; index < 4; index++) samples[index * (sampleRate / 2)] = 1
    expect(detectBeats(samples, sampleRate).length).toBeGreaterThanOrEqual(3)
  })

  it('writes a YouTube chapter list that starts at 0:00', () => {
    const text = youtubeChapters([
      { id: 'b', time: 65, label: 'הדגמה' },
      { id: 'a', time: 12, label: 'פתיח' },
    ])
    expect(text.startsWith('0:00')).toBe(true)
    expect(text).toContain('0:12 פתיח')
    expect(text).toContain('1:05 הדגמה')
  })

  it('nests clips into one block and flattens them back onto the timeline', () => {
    const project = {
      ...blankProject(),
      clips: [freshClip({ id: 'a', start: 0, duration: 2 }), freshClip({ id: 'b', start: 2, duration: 2 })],
    }
    const nested = nestClips(project, ['a', 'b'])
    expect(nested.clips).toHaveLength(1)
    expect(nested.clips[0]?.children).toHaveLength(2)
    const flat = flattenCompounds(nested)
    expect(flat.clips.map((clip) => clip.start)).toEqual([0, 2])
    const opened = unnestClip(nested, nested.clips[0]!.id)
    expect(opened.clips).toHaveLength(2)
  })

  it('keeps older projects loading with the new clip defaults', () => {
    const legacy = {
      version: 1,
      id: 'p',
      name: 'ישן',
      tracks: blankProject().tracks,
      clips: [
        {
          id: 'c',
          trackId: 'v1',
          assetId: 'asset',
          start: 0,
          duration: 2,
          inPoint: 0,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          text: null,
        },
      ],
      markers: [],
    }
    const project = coerceProject(legacy)
    expect(project?.beats).toEqual([])
    expect(project?.clips[0]?.reverse).toBe(false)
    expect(project?.clips[0]?.mask).toBe('none')
    expect(project?.clips[0]?.captionStyle).toBe('plain')
    expect(project?.clips[0]?.children).toBeNull()
  })

  it('finds a bright patch that moved inside the search radius', () => {
    const width = 40
    const height = 40
    const frame = new Uint8ClampedArray(width * height * 4)
    const size = 8
    for (let y = 12; y < 20; y++) {
      for (let x = 16; x < 24; x++) {
        const index = (y * width + x) * 4
        frame[index] = 255
        frame[index + 1] = 255
        frame[index + 2] = 255
        frame[index + 3] = 255
      }
    }
    const patch = new Uint8ClampedArray(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const frameIndex = ((12 + y) * width + (16 + x)) * 4
        const patchIndex = (y * size + x) * 4
        patch[patchIndex] = frame[frameIndex]!
        patch[patchIndex + 1] = frame[frameIndex + 1]!
        patch[patchIndex + 2] = frame[frameIndex + 2]!
        patch[patchIndex + 3] = frame[frameIndex + 3]!
      }
    }
    expect(matchPatch(frame, width, height, patch, size, 4, 4, 20)).toEqual({ x: 16, y: 12 })
  })
})
