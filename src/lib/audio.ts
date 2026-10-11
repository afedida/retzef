import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  Input,
  type WrappedAudioBuffer,
} from 'mediabunny'
import { getBlob } from '@/lib/blobs'
import { audioGain } from '@/lib/edit'
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

export async function mixProjectAudio(project: Project, assets: Asset[], duration: number): Promise<AudioBuffer> {
  const sampleRate = 48000
  const length = Math.max(1, Math.ceil(duration * sampleRate))
  const offline = new OfflineAudioContext(2, length, sampleRate)
  const clips = audibleClips(project, assets)
  for (const clip of clips) {
    if (!clip.assetId) continue
    const buffer = await loadAudioBuffer(clip.assetId)
    if (!buffer) continue
    const offset = Math.max(0, clip.inPoint)
    if (offset >= buffer.duration) continue
    const playFor = Math.min(clip.duration, buffer.duration - offset)
    if (playFor <= 0.001) continue
    const source = offline.createBufferSource()
    source.buffer = buffer
    const gain = offline.createGain()
    scheduleOfflineGain(gain.gain, clip)
    source.connect(gain)
    gain.connect(offline.destination)
    source.start(Math.max(0, clip.start), offset, playFor)
  }
  return offline.startRendering()
}

function scheduleOfflineGain(param: AudioParam, clip: Clip): void {
  const volume = Math.max(0, clip.volume)
  const t0 = Math.max(0, clip.start)
  const t1 = t0 + clip.duration
  const fadeIn = Math.min(Math.max(0, clip.fadeIn), clip.duration)
  const fadeOut = Math.min(Math.max(0, clip.fadeOut), Math.max(0, clip.duration - fadeIn))
  param.setValueAtTime(fadeIn > 0 ? 0 : volume, t0)
  if (fadeIn > 0) param.linearRampToValueAtTime(volume, t0 + fadeIn)
  const fadeStart = t1 - fadeOut
  if (fadeOut > 0 && fadeStart > t0 + fadeIn + 0.0001) param.setValueAtTime(volume, fadeStart)
  if (fadeOut > 0) param.linearRampToValueAtTime(0, t1)
}

export function schedulePreviewGain(param: AudioParam, clip: Clip, playhead: number, now: number): void {
  const t0 = clip.start
  const t1 = clip.start + clip.duration
  const fadeIn = Math.min(Math.max(0, clip.fadeIn), clip.duration)
  const fadeOut = Math.min(Math.max(0, clip.fadeOut), Math.max(0, clip.duration - fadeIn))
  const points: { t: number; v: number }[] = [{ t: t0, v: fadeIn > 0 ? 0 : clip.volume }]
  if (fadeIn > 0) points.push({ t: t0 + fadeIn, v: clip.volume })
  if (fadeOut > 0) {
    const fadeStart = t1 - fadeOut
    if (fadeStart > t0 + fadeIn + 0.0001) points.push({ t: fadeStart, v: clip.volume })
    points.push({ t: t1, v: 0 })
  }
  const local = playhead - clip.start
  const current = local >= 0 && local < clip.duration ? audioGain(clip, local) : 0
  param.setValueAtTime(current, now)
  let previous = now
  for (const point of points) {
    if (point.t <= playhead + 0.001) continue
    const when = now + (point.t - playhead)
    if (when <= previous) continue
    param.linearRampToValueAtTime(Math.max(0, point.v), when)
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
