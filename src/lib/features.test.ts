import { describe, expect, it } from 'vitest'
import { blankProject, exciseLocalRanges, freshClip, groupClips, moveClip, pasteClips, sourceTimeAt, videoLayers } from '@/lib/edit'
import { sampleLane } from '@/lib/keyframes'
import { gainForTarget, integratedLufs } from '@/lib/loudness'
import { parseCube, sampleLutColor } from '@/lib/lut'
import { cuesToSrt, parseSrt } from '@/lib/srt'
import { pitchLag, timeStretch } from '@/lib/stretch'
import { silentGaps, speechIntervals, speechLevelAt } from '@/lib/vad'
import type { Asset } from '@/types'

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

describe('round three editing', () => {
  it('eases between keyframes', () => {
    const keys = [
      { time: 0, value: 0, ease: 'easeIn' as const },
      { time: 1, value: 1, ease: 'linear' as const },
    ]
    expect(sampleLane(keys, 0.5, 0)).toBeCloseTo(0.25)
    expect(sampleLane(keys, 0, 9)).toBe(0)
    expect(sampleLane(keys, 1, 9)).toBe(1)
  })

  it('samples the incoming clip from its head handle', () => {
    const left = freshClip({ id: 'a', start: 0, duration: 2 })
    const right = freshClip({
      id: 'b',
      start: 2,
      duration: 2,
      inPoint: 0.4,
      transition: { kind: 'crossfade', duration: 0.4 },
    })
    const project = { ...blankProject(), clips: [left, right] }
    const layer = videoLayers(project, 1.9).find((item) => item.clip.id === 'b')
    expect(layer?.sourceLocal).toBeCloseTo(-0.1)
    expect(sourceTimeAt(right, layer?.sourceLocal ?? 0)).toBeCloseTo(0.3)
    const held = freshClip({ id: 'c', start: 2, duration: 2, inPoint: 0, transition: { kind: 'crossfade', duration: 0.4 } })
    expect(sourceTimeAt(held, -0.1)).toBe(0)
  })

  it('keeps pitch while shortening a tone', () => {
    const sampleRate = 48000
    const length = sampleRate
    const input = new Float32Array(length)
    for (let i = 0; i < length; i++) input[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate)
    const stretched = timeStretch(input, sampleRate, 2)
    expect(stretched.length).toBeGreaterThan(sampleRate * 0.4)
    expect(stretched.length).toBeLessThan(sampleRate * 0.6)
    const lag = pitchLag(stretched, sampleRate, 440)
    expect(Math.abs(lag - sampleRate / 440)).toBeLessThan(8)
  })

  it('moves loudness toward -14 LUFS', () => {
    const sampleRate = 48000
    const input = new Float32Array(sampleRate)
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.05
    const before = integratedLufs(input, input, sampleRate)
    const gain = gainForTarget(before)
    const boosted = input.map((sample) => sample * gain)
    const after = integratedLufs(boosted, boosted, sampleRate)
    expect(Math.abs(after + 14)).toBeLessThan(Math.abs(before + 14))
  })

  it('finds a silent gap and closes it', () => {
    const sampleRate = 8000
    const channel = new Float32Array(sampleRate)
    for (let i = 0; i < 1600; i++) channel[i] = Math.sin(i) * 0.4
    for (let i = 5600; i < channel.length; i++) channel[i] = Math.sin(i) * 0.4
    const gaps = silentGaps(channel, sampleRate, 0.015, 0.35)
    expect(gaps.length).toBeGreaterThan(0)
    const project = { ...blankProject(), clips: [freshClip({ id: 'a', duration: 1 }), freshClip({ id: 'b', start: 1, duration: 2 })] }
    const next = exciseLocalRanges(project, 'a', gaps)
    const first = next.clips.find((item) => item.id === 'a')
    expect(first && first.duration < 1).toBe(true)
    expect(next.clips.find((item) => item.id === 'b')!.start).toBeLessThan(1)
  })

  it('ramps ducking across attack and release', () => {
    expect(speechLevelAt(0.02, [{ start: 0, end: 1 }], 0.08, 0.2)).toBeCloseTo(0.25)
    expect(speechLevelAt(0.5, [{ start: 0, end: 1 }], 0.08, 0.2)).toBe(1)
    expect(speechLevelAt(1.1, [{ start: 0, end: 1 }], 0.08, 0.2)).toBeCloseTo(0.5)
  })

  it('marks loud stretches as speech', () => {
    const sampleRate = 16000
    const channel = new Float32Array(sampleRate)
    for (let i = 2000; i < 8000; i++) channel[i] = Math.sin(i / 3) * 0.3
    const speech = speechIntervals(channel, sampleRate)
    expect(speech.length).toBeGreaterThan(0)
    expect(speech[0]!.start).toBeGreaterThan(0.05)
  })

  it('round-trips Hebrew SRT cues', () => {
    const cues = [{ start: 1.2, end: 3.5, text: 'שלום, זה רצף' }]
    const parsed = parseSrt(cuesToSrt(cues))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.text).toBe('שלום, זה רצף')
    expect(parsed[0]?.start).toBeCloseTo(1.2, 2)
  })

  it('reads a .cube LUT', () => {
    const cube = `TITLE warm
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
0.5 0.5 0.5
`
    const lut = parseCube(cube, 'warm')
    expect(lut?.size).toBe(2)
    const color = sampleLutColor(lut!, 1, 1, 1)
    expect(color[0]).toBeCloseTo(0.5)
  })

  it('moves a group together and pastes copies', () => {
    const base = {
      ...blankProject(),
      clips: [freshClip({ id: 'a', start: 0, duration: 1 }), freshClip({ id: 'b', start: 1, duration: 1, trackId: 'v2' })],
    }
    const grouped = groupClips(base, ['a', 'b'])
    const groupId = grouped.clips[0]?.groupId
    expect(groupId).toBeTruthy()
    expect(grouped.clips[1]?.groupId).toBe(groupId)
    const moved = moveClip(grouped, 'a', 2, 'v1', [], 0, new Map([[video.id, video]]))
    expect(moved.clips.find((item) => item.id === 'a')?.start).toBeCloseTo(2)
    expect(moved.clips.find((item) => item.id === 'b')?.start).toBeCloseTo(3)
    const pasted = pasteClips(base, base.clips, 4)
    expect(pasted.ids).toHaveLength(2)
    expect(Math.min(...pasted.project.clips.filter((item) => pasted.ids.includes(item.id)).map((item) => item.start))).toBeCloseTo(4)
  })

  it('fills new project defaults when reopening an older file', () => {
    const loaded = blankProject()
    expect(loaded.duckAmount).toBeCloseTo(0.72)
    expect(loaded.ripple).toBe(false)
    expect(loaded.clips).toEqual([])
  })
})
