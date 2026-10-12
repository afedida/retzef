/** Overlap-add time stretch. Speed above 1 shortens the buffer and keeps the original pitch. */
export function timeStretch(input: Float32Array, sampleRate: number, speed: number): Float32Array {
  if (!(speed > 0) || Math.abs(speed - 1) < 0.001 || input.length < 32) return input.slice()
  const win = Math.max(16, Math.round(sampleRate * 0.02))
  const synHop = Math.max(8, Math.floor(win / 2))
  const anaHop = Math.max(1, Math.round(synHop * speed))
  const outLen = Math.max(1, Math.round(input.length / speed))
  const output = new Float32Array(outLen + win)
  const weight = new Float32Array(output.length)
  const hann = new Float32Array(win)
  for (let i = 0; i < win; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, win - 1)))
  const search = Math.round(sampleRate * 0.012)
  let ana = 0
  let syn = 0
  while (syn + win <= output.length && ana < input.length) {
    let pos = Math.min(ana, Math.max(0, input.length - win))
    if (syn > 0 && input.length >= win) {
      let best = pos
      let bestScore = -Infinity
      const from = Math.max(0, ana - search)
      const to = Math.min(input.length - win, ana + search)
      const overlap = Math.min(synHop, win)
      for (let candidate = from; candidate <= to; candidate += 4) {
        let score = 0
        for (let i = 0; i < overlap; i += 2) score += (output[syn + i] ?? 0) * (input[candidate + i] ?? 0)
        if (score > bestScore) {
          bestScore = score
          best = candidate
        }
      }
      pos = best
    }
    const available = Math.min(win, input.length - pos)
    for (let i = 0; i < available; i++) {
      const w = hann[i] ?? 1
      output[syn + i] = (output[syn + i] ?? 0) + (input[pos + i] ?? 0) * w
      weight[syn + i] = (weight[syn + i] ?? 0) + w
    }
    ana += anaHop
    syn += synHop
    if (syn >= outLen) break
  }
  const result = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const w = weight[i] ?? 0
    result[i] = w > 1e-6 ? (output[i] ?? 0) / w : 0
  }
  return result
}

export function pitchLag(samples: Float32Array, sampleRate: number, expectedHz: number): number {
  const period = Math.round(sampleRate / expectedHz)
  const from = Math.max(8, period - 12)
  const to = period + 12
  let best = period
  let bestScore = -Infinity
  const length = Math.min(samples.length - to - 1, sampleRate)
  if (length < 32) return period
  for (let lag = from; lag <= to; lag++) {
    let score = 0
    for (let i = 0; i < length; i += 2) score += (samples[i] ?? 0) * (samples[i + lag] ?? 0)
    if (score > bestScore) {
      bestScore = score
      best = lag
    }
  }
  return best
}
