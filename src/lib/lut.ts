import type { Lut } from '@/types'

const MAX_SIZE = 64

export function parseCube(text: string, name = 'LUT'): Lut | null {
  const lines = text.split(/\r?\n/)
  let size = 0
  const values: number[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('TITLE') || line.startsWith('DOMAIN_')) continue
    if (line.startsWith('LUT_3D_SIZE')) {
      size = Number(line.split(/\s+/)[1])
      continue
    }
    if (line.startsWith('LUT_1D_SIZE')) return null
    const parts = line.split(/\s+/).map(Number)
    if (parts.length < 3 || parts.some((value) => !Number.isFinite(value))) continue
    values.push(parts[0]!, parts[1]!, parts[2]!)
  }
  if (!Number.isInteger(size) || size < 2 || size > MAX_SIZE) return null
  if (values.length !== size * size * size * 3) return null
  return { id: crypto.randomUUID(), name, size, data: values }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function sample(lut: Lut, r: number, g: number, b: number): [number, number, number] {
  const size = lut.size
  const scale = size - 1
  const rf = clamp01(r) * scale
  const gf = clamp01(g) * scale
  const bf = clamp01(b) * scale
  const r0 = Math.floor(rf)
  const g0 = Math.floor(gf)
  const b0 = Math.floor(bf)
  const r1 = Math.min(size - 1, r0 + 1)
  const g1 = Math.min(size - 1, g0 + 1)
  const b1 = Math.min(size - 1, b0 + 1)
  const tr = rf - r0
  const tg = gf - g0
  const tb = bf - b0
  const at = (ri: number, gi: number, bi: number): [number, number, number] => {
    const index = ((bi * size + gi) * size + ri) * 3
    return [lut.data[index] ?? 0, lut.data[index + 1] ?? 0, lut.data[index + 2] ?? 0]
  }
  const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
  const c00 = mix(at(r0, g0, b0), at(r1, g0, b0), tr)
  const c10 = mix(at(r0, g1, b0), at(r1, g1, b0), tr)
  const c01 = mix(at(r0, g0, b1), at(r1, g0, b1), tr)
  const c11 = mix(at(r0, g1, b1), at(r1, g1, b1), tr)
  return mix(mix(c00, c10, tg), mix(c01, c11, tg), tb)
}

export function applyLutRgba(image: ImageData, lut: Lut): void {
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = sample(lut, (data[i] ?? 0) / 255, (data[i + 1] ?? 0) / 255, (data[i + 2] ?? 0) / 255)
    data[i] = Math.round(clamp01(r) * 255)
    data[i + 1] = Math.round(clamp01(g) * 255)
    data[i + 2] = Math.round(clamp01(b) * 255)
  }
}

export function sampleLutColor(lut: Lut, r: number, g: number, b: number): [number, number, number] {
  return sample(lut, r, g, b)
}
