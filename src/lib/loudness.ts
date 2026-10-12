export const TARGET_LUFS = -14

function biquad(samples: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
  const out = new Float32Array(samples.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i] ?? 0
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

function kWeight(channel: Float32Array): Float32Array {
  const shelf = biquad(channel, 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585)
  return biquad(shelf, 1, -2, 1, -1.99004745483398, 0.99007225036621)
}

/** Integrated loudness. Coefficients match a 48 kHz K-weighting chain. */
export function integratedLufs(left: Float32Array, right: Float32Array | null, sampleRate: number): number {
  const l = kWeight(left)
  const r = right ? kWeight(right) : l
  const block = Math.max(1, Math.round(0.4 * sampleRate))
  const hop = Math.max(1, Math.round(0.1 * sampleRate))
  const powers: number[] = []
  if (l.length >= block) {
    for (let i = 0; i + block <= l.length; i += hop) {
      let sum = 0
      for (let j = 0; j < block; j++) {
        const lv = l[i + j] ?? 0
        const rv = r[i + j] ?? 0
        sum += lv * lv + rv * rv
      }
      powers.push(sum / block)
    }
  }
  let ms = 0
  if (!powers.length) {
    let sum = 0
    for (let i = 0; i < l.length; i++) sum += (l[i] ?? 0) ** 2 + (r[i] ?? 0) ** 2
    ms = sum / Math.max(1, l.length)
  } else {
    const mean = powers.reduce((total, value) => total + value, 0) / powers.length
    const relative = mean * 10 ** (-10 / 10)
    const gated = powers.filter((value) => value >= relative && value > 1e-12)
    const used = gated.length ? gated : powers
    ms = used.reduce((total, value) => total + value, 0) / used.length
  }
  return -0.691 + 10 * Math.log10(Math.max(ms, 1e-12))
}

export function gainForTarget(lufs: number, target = TARGET_LUFS): number {
  if (!Number.isFinite(lufs)) return 1
  const gain = 10 ** ((target - lufs) / 20)
  return Math.min(12, Math.max(0.02, gain))
}

export function applyGain(channel: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(channel.length)
  for (let i = 0; i < channel.length; i++) out[i] = (channel[i] ?? 0) * gain
  return out
}
