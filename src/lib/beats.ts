export function detectBeats(samples: Float32Array, sampleRate: number): number[] {
  const hop = 512
  if (sampleRate <= 0 || samples.length < hop * 4) return []
  const energies: number[] = []
  for (let index = 0; index + hop <= samples.length; index += hop) {
    let sum = 0
    for (let offset = 0; offset < hop; offset++) {
      const sample = samples[index + offset] ?? 0
      sum += sample * sample
    }
    energies.push(sum / hop)
  }
  const beats: number[] = []
  let last = -1
  for (let index = 2; index < energies.length; index++) {
    const previous = energies.slice(Math.max(0, index - 8), index)
    const average = previous.reduce((total, value) => total + value, 0) / Math.max(1, previous.length)
    const energy = energies[index] ?? 0
    const time = (index * hop) / sampleRate
    if (energy > average * 1.8 + 1e-8 && energy >= (energies[index - 1] ?? 0) && time - last >= 0.28) {
      beats.push(Math.round(time * 1000) / 1000)
      last = time
      if (beats.length >= 400) break
    }
  }
  return beats
}
