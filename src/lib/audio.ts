import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  Input,
  type WrappedAudioBuffer,
} from 'mediabunny'
import { getBlob } from '@/lib/blobs'
import { denoisePcm } from '@/lib/denoise'
import { audioGain, clampSpeed, flattenCompounds, trackHeard } from '@/lib/edit'
import { applyGain, gainForTarget, integratedLufs } from '@/lib/loudness'
import { timeStretch } from '@/lib/stretch'
import { speechIntervals, speechLevelAt, type Span } from '@/lib/vad'
import type { Asset, Clip, Project } from '@/types'

const cache = new Map<string, Promise<AudioBuffer | null>>()

export function forgetAudio(assetId: string): void {
  cache.delete(assetId)
}

export function loadAudioBuffer(assetId: string): Promise<AudioBuffer | null> {
  const existing = cache.get(assetId)
  if (existing) return existing
  const pending = decodeAssetAudio(assetId).catch(() => null)
  cache.set(assetId, pending)
  return pending
}

async function decodeAssetAudio(assetId: string): Promise<AudioBuffer | null> {
  const blob = getBlob(assetId)
  if (!blob) return null
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) return null
    const sink = new AudioBufferSink(track)
    const parts: WrappedAudioBuffer[] = []
    for await (const part of sink.buffers()) parts.push(part)
    if (!parts.length) return null
    return concatBuffers(parts)
  } finally {
    input.dispose()
  }
}

function concatBuffers(parts: WrappedAudioBuffer[]): AudioBuffer {
  const sampleRate = parts[0]!.buffer.sampleRate
  const channels = Math.max(...parts.map((part) => part.buffer.numberOfChannels))
  const end = Math.max(...parts.map((part) => part.timestamp + part.buffer.duration))
  const length = Math.max(1, Math.ceil(end * sampleRate))
  const output = new AudioBuffer({ length, numberOfChannels: channels, sampleRate })
  for (const part of parts) {
    const offset = Math.max(0, Math.round(part.timestamp * sampleRate))
    for (let channel = 0; channel < channels; channel++) {
      const source = part.buffer.getChannelData(Math.min(channel, part.buffer.numberOfChannels - 1))
      const target = output.getChannelData(channel)
      const room = target.length - offset
      if (room <= 0) continue
      target.set(room >= source.length ? source : source.subarray(0, room), offset)
    }
  }
  return output
}

export function audibleClips(project: Project, assets: Asset[]): Clip[] {
  const flat = flattenCompounds(project)
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  return flat.clips.filter((clip) => {
    if (!clip.assetId || clip.volume <= 0) return false
    if (!trackHeard(flat, clip.trackId)) return false
    return byId.get(clip.assetId)?.hasAudio === true
  })
}

function reverseChannel(samples: Float32Array): Float32Array {
  const out = new Float32Array(samples.length)
  for (let index = 0; index < samples.length; index++) out[index] = samples[samples.length - 1 - index] ?? 0
  return out
}

function resampleSpeed(samples: Float32Array, speed: number): Float32Array {
  const length = Math.max(1, Math.round(samples.length / speed))
  const out = new Float32Array(length)
  for (let index = 0; index < length; index++) {
    const source = Math.min(samples.length - 1, Math.floor(index * speed))
    out[index] = samples[source] ?? 0
  }
  return out
}

let speechRegions: Span[] = []

export function setSpeechRegions(regions: Span[]) {
  speechRegions = regions
}

export function getSpeechRegions(): Span[] {
  return speechRegions
}

function overlapLevel(project: Project, assets: Asset[], time: number, duckTrackId: string, attack: number, release: number): number {
  const flat = flattenCompounds(project)
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  const regions = flat.clips
    .filter((clip) => {
      if (clip.trackId === duckTrackId || !clip.assetId || clip.volume <= 0) return false
      if (!trackHeard(flat, clip.trackId)) return false
      return byId.get(clip.assetId)?.hasAudio === true
    })
    .map((clip) => ({ start: clip.start, end: clip.start + clip.duration }))
  return speechLevelAt(time, regions, attack, release)
}

export async function analyzeSpeech(project: Project, assets: Asset[]): Promise<Span[]> {
  const flat = flattenCompounds(project)
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  const regions: Span[] = []
  for (const clip of flat.clips) {
    const track = project.tracks.find((item) => item.id === clip.trackId)
    if (!clip.assetId || track?.duck || !trackHeard(flat, clip.trackId)) continue
    if (byId.get(clip.assetId)?.hasAudio !== true) continue
    const buffer = await loadAudioBuffer(clip.assetId)
    if (!buffer) continue
    const speed = clampSpeed(clip.speed)
    const offset = Math.max(0, Math.round(clip.inPoint * buffer.sampleRate))
    const length = Math.max(1, Math.round(clip.duration * speed * buffer.sampleRate))
    const channel = buffer.getChannelData(0)
    const slice = channel.subarray(offset, Math.min(channel.length, offset + length))
    if (slice.length < 32) continue
    for (const span of speechIntervals(slice, buffer.sampleRate)) {
      if (clip.reverse) {
        regions.push({
          start: clip.start + clip.duration - span.end / speed,
          end: clip.start + clip.duration - span.start / speed,
        })
      } else {
        regions.push({
          start: clip.start + span.start / speed,
          end: clip.start + span.end / speed,
        })
      }
    }
  }
  speechRegions = regions
  return regions
}

export function mixGain(project: Project, assets: Asset[], clip: Clip, local: number): number {
  const track = project.tracks.find((item) => item.id === clip.trackId)
  let duck = 1
  if (track?.duck) {
    const time = clip.start + local
    const amount = project.duckAmount ?? 0.72
    const attack = project.duckAttack ?? 0.08
    const release = project.duckRelease ?? 0.28
    const level = speechRegions.length ? speechLevelAt(time, speechRegions, attack, release) : overlapLevel(project, assets, time, clip.trackId, attack, release)
    duck = 1 - amount * level
  }
  return audioGain(clip, local) * (project.masterVolume ?? 1) * duck
}

const playbackCache = new Map<string, Promise<AudioBuffer>>()

function sliceChannel(buffer: AudioBuffer, channel: number, offset: number, length: number): Float32Array {
  const data = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))
  const start = Math.max(0, Math.min(data.length, offset))
  const end = Math.max(start, Math.min(data.length, start + length))
  return data.slice(start, end)
}

async function processSlice(clip: Clip, buffer: AudioBuffer, offsetSec: number, spanSec: number): Promise<AudioBuffer> {
  const speed = clampSpeed(clip.speed)
  const preserve = clip.preservePitch !== false && Math.abs(speed - 1) > 0.001
  const rate = buffer.sampleRate
  const offset = Math.max(0, Math.round(offsetSec * rate))
  const length = Math.max(1, Math.round(spanSec * rate))
  const channels = buffer.numberOfChannels
  const processed: Float32Array[] = []
  for (let channel = 0; channel < channels; channel++) {
    let samples = sliceChannel(buffer, channel, offset, length)
    if (preserve) samples = timeStretch(samples, rate, speed)
    else if (clip.reverse && Math.abs(speed - 1) > 0.001) samples = resampleSpeed(samples, speed)
    if (clip.denoise) samples = await denoisePcm(samples, rate)
    if (clip.reverse) samples = reverseChannel(samples)
    processed.push(samples)
  }
  let gain = 1
  if (clip.normalize && processed[0]) {
    const loudness = integratedLufs(processed[0], processed[1] ?? null, rate)
    gain = gainForTarget(loudness)
    for (let channel = 0; channel < processed.length; channel++) processed[channel] = applyGain(processed[channel]!, gain)
  }
  const outLength = processed[0]?.length ?? 1
  const output = new AudioBuffer({ length: Math.max(1, outLength), numberOfChannels: channels, sampleRate: rate })
  for (let channel = 0; channel < channels; channel++) output.getChannelData(channel).set(processed[channel] ?? new Float32Array(outLength))
  return output
}

export async function clipPlaybackBuffer(clip: Clip, buffer: AudioBuffer, offsetSec: number, spanSec: number): Promise<{
  buffer: AudioBuffer
  offset: number
  rate: number
  span: number
}> {
  const speed = clampSpeed(clip.speed)
  const needs = clip.reverse || clip.denoise || clip.normalize || (clip.preservePitch !== false && Math.abs(speed - 1) > 0.001)
  if (!needs) return { buffer, offset: offsetSec, rate: speed, span: spanSec }
  const key = `${clip.assetId}:${offsetSec.toFixed(3)}:${spanSec.toFixed(3)}:${speed}:${clip.preservePitch}:${clip.denoise}:${clip.normalize}:${clip.reverse}`
  let pending = playbackCache.get(key)
  if (!pending) {
    pending = processSlice(clip, buffer, offsetSec, spanSec)
    playbackCache.set(key, pending)
  }
  const next = await pending
  return { buffer: next, offset: 0, rate: 1, span: next.duration }
}

export async function mixProjectAudio(project: Project, assets: Asset[], duration: number): Promise<AudioBuffer> {
  const sampleRate = 48000
  const length = Math.max(1, Math.ceil(duration * sampleRate))
  const offline = new OfflineAudioContext(2, length, sampleRate)
  const master = offline.createGain()
  master.gain.value = 1
  master.connect(offline.destination)
  await analyzeSpeech(project, assets)
  const clips = audibleClips(project, assets)
  for (const clip of clips) {
    if (!clip.assetId) continue
    const buffer = await loadAudioBuffer(clip.assetId)
    if (!buffer) continue
    const speed = clampSpeed(clip.speed)
    const offset = Math.max(0, clip.inPoint)
    if (offset >= buffer.duration) continue
    const bufferSpan = Math.min(clip.duration * speed, buffer.duration - offset)
    if (bufferSpan <= 0.001) continue
    const playback = await clipPlaybackBuffer(clip, buffer, offset, bufferSpan)
    const source = offline.createBufferSource()
    source.buffer = playback.buffer
    source.playbackRate.value = playback.rate
    const gain = offline.createGain()
    scheduleGain(gain.gain, project, assets, clip, 0)
    source.connect(gain)
    gain.connect(master)
    source.start(Math.max(0, clip.start), playback.offset, playback.span)
  }
  return offline.startRendering()
}

function sampleTimes(project: Project, clip: Clip): number[] {
  const points = new Set<number>([0, Math.max(0, clip.duration - 0.0001)])
  if (clip.fadeIn > 0) points.add(Math.min(clip.duration, clip.fadeIn))
  if (clip.fadeOut > 0) points.add(Math.max(0, clip.duration - clip.fadeOut))
  for (const key of clip.volumeKeys) points.add(Math.min(clip.duration, Math.max(0, key.time * clip.duration)))
  const duck = project.tracks.some((track) => track.id === clip.trackId && track.duck)
  if (duck || clip.volumeKeys.length > 1) {
    for (let local = 0.05; local < clip.duration; local += 0.05) points.add(local)
  }
  return [...points].sort((a, b) => a - b)
}

function scheduleGain(param: AudioParam, project: Project, assets: Asset[], clip: Clip, origin: number): void {
  let previous = -1
  for (const local of sampleTimes(project, clip)) {
    const when = origin + Math.max(0, clip.start + local)
    if (when <= previous) continue
    const value = mixGain(project, assets, clip, local)
    if (previous < 0) param.setValueAtTime(value, when)
    else param.linearRampToValueAtTime(value, when)
    previous = when
  }
}

export function schedulePreviewGain(
  param: AudioParam,
  project: Project,
  assets: Asset[],
  clip: Clip,
  playhead: number,
  now: number,
): void {
  const localNow = playhead - clip.start
  const current = localNow >= 0 && localNow < clip.duration ? mixGain(project, assets, clip, localNow) : 0
  param.setValueAtTime(current, now)
  const step = 0.05
  let previous = now
  for (let local = Math.max(0, localNow) + step; local < clip.duration; local += step) {
    const when = now + (clip.start + local - playhead)
    if (when <= previous) continue
    param.linearRampToValueAtTime(mixGain(project, assets, clip, local), when)
    previous = when
  }
}

export async function peakEnvelope(assetId: string, bars = 160): Promise<number[]> {
  const buffer = await loadAudioBuffer(assetId)
  if (!buffer) return []
  const data = buffer.getChannelData(0)
  const block = Math.max(1, Math.floor(data.length / bars))
  const peaks: number[] = []
  for (let i = 0; i < bars; i++) {
    let max = 0
    const start = i * block
    const step = Math.max(1, Math.floor(block / 48))
    for (let j = 0; j < block; j += step) {
      const value = Math.abs(data[start + j] ?? 0)
      if (value > max) max = value
    }
    peaks.push(max)
  }
  const normal = Math.max(...peaks, 0.001)
  return peaks.map((peak) => peak / normal)
}
