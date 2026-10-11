export type Span = { start: number; end: number }

function windowRms(channel: Float32Array, sampleRate: number, windowSec: number): { hop: number; values: number[] } {
  const hop = Math.max(1, Math.round(sampleRate * windowSec))
  const values: number[] = []
  for (let offset = 0; offset < channel.length; offset += hop) {
    let sum = 0
    const end = Math.min(channel.length, offset + hop)
    const count = Math.max(1, end - offset)
    for (let i = offset; i < end; i++) {
      const sample = channel[i] ?? 0
      sum += sample * sample
    }
    values.push(Math.sqrt(sum / count))
  }
  return { hop, values }
}

function spansFromMask(mask: boolean[], hop: number, sampleRate: number, minDuration: number): Span[] {
  const spans: Span[] = []
  let open = -1
  for (let i = 0; i <= mask.length; i++) {
    const on = mask[i] === true
    if (on && open < 0) open = i
    if (!on && open >= 0) {
      const start = (open * hop) / sampleRate
      const end = (i * hop) / sampleRate
      if (end - start >= minDuration) spans.push({ start, end })
      open = -1
    }
  }
  return spans
}

export function speechIntervals(channel: Float32Array, sampleRate: number, threshold = 0.02, minDuration = 0.08): Span[] {
  const { hop, values } = windowRms(channel, sampleRate, 0.02)
  return spansFromMask(values.map((value) => value >= threshold), hop, sampleRate, minDuration)
}

export function silentGaps(channel: Float32Array, sampleRate: number, threshold = 0.015, minGap = 0.35): Span[] {
  const { hop, values } = windowRms(channel, sampleRate, 0.02)
  return spansFromMask(values.map((value) => value < threshold), hop, sampleRate, minGap)
}

export function speechLevelAt(time: number, regions: Span[], attack: number, release: number): number {
  let level = 0
  for (const region of regions) {
    if (time >= region.start && time < region.end) {
      const rise = attack <= 0.001 ? 1 : Math.min(1, (time - region.start) / attack)
      level = Math.max(level, rise)
    } else if (time >= region.end && time < region.end + Math.max(0, release)) {
      const fall = release <= 0.001 ? 0 : 1 - (time - region.end) / release
      level = Math.max(level, Math.max(0, fall))
    }
  }
  return level
}
