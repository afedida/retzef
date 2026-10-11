import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  Input,
  type WrappedAudioBuffer,
} from 'mediabunny'
import { getBlob } from '@/lib/blobs'
import { audioGain, clampSpeed } from '@/lib/edit'
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
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  return project.clips.filter((clip) => {
    if (!clip.assetId || clip.volume <= 0) return false
    return byId.get(clip.assetId)?.hasAudio === true
  })
}

function speechAt(project: Project, assets: Asset[], time: number, duckTrackId: string): boolean {
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  return project.clips.some((clip) => {
    if (clip.trackId === duckTrackId || !clip.assetId || clip.volume <= 0) return false
    if (byId.get(clip.assetId)?.hasAudio !== true) return false
    return time >= clip.start && time < clip.start + clip.duration
  })
}

export function mixGain(project: Project, assets: Asset[], clip: Clip, local: number): number {
  const track = project.tracks.find((item) => item.id === clip.trackId)
  let duck = 1
  if (track?.duck) {
    const time = clip.start + local
    const active = speechAt(project, assets, time, clip.trackId)
    const edge = speechAt(project, assets, time - 0.12, clip.trackId) || speechAt(project, assets, time + 0.08, clip.trackId)
    duck = active ? 0.28 : edge ? 0.62 : 1
  }
  return audioGain(clip, local) * project.masterVolume * duck
}

export async function mixProjectAudio(project: Project, assets: Asset[], duration: number): Promise<AudioBuffer> {
  const sampleRate = 48000
  const length = Math.max(1, Math.ceil(duration * sampleRate))
  const offline = new OfflineAudioContext(2, length, sampleRate)
  const master = offline.createGain()
  master.gain.value = 1
  master.connect(offline.destination)
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
    const source = offline.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = speed
    const gain = offline.createGain()
    scheduleGain(gain.gain, project, assets, clip, 0)
    source.connect(gain)
    gain.connect(master)
    source.start(Math.max(0, clip.start), offset, bufferSpan)
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
