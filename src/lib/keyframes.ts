import type { Ease, Keyframe } from '@/types'

export function easeMix(ease: Ease | undefined, t: number): number {
  const x = Math.min(1, Math.max(0, t))
  if (ease === 'easeIn') return x * x
  if (ease === 'easeOut') return 1 - (1 - x) * (1 - x)
  if (ease === 'easeInOut') return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2
  return x
}

export function sampleLane(keys: Keyframe[], t: number, fallback: number): number {
  if (!keys.length) return fallback
  const sorted = [...keys].sort((a, b) => a.time - b.time)
  const first = sorted[0]!
  if (t <= first.time) return first.value
  const last = sorted[sorted.length - 1]!
  if (t >= last.time) return last.value
  for (let index = 1; index < sorted.length; index++) {
    const right = sorted[index]!
    const left = sorted[index - 1]!
    if (t <= right.time) {
      const span = Math.max(1e-6, right.time - left.time)
      const mix = easeMix(left.ease, (t - left.time) / span)
      return left.value + (right.value - left.value) * mix
    }
  }
  return last.value
}
