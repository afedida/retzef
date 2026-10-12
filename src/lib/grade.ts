import { applyLutRgba } from '@/lib/lut'
import type { Chroma, Lut } from '@/types'

function hexToRgb(color: string): [number, number, number] {
  const match = color.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!match) return [0, 1, 0]
  const value = Number.parseInt(match[1]!, 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

export function applyChromaRgba(image: ImageData, chroma: Chroma): void {
  if (!chroma.enabled) return
  const [kr, kg, kb] = hexToRgb(chroma.color)
  const threshold = Math.min(1.2, Math.max(0.02, chroma.threshold))
  const softness = Math.max(0.001, chroma.softness)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const r = (data[i] ?? 0) / 255
    const g = (data[i + 1] ?? 0) / 255
    const b = (data[i + 2] ?? 0) / 255
    const distance = Math.hypot(r - kr, g - kg, b - kb)
    const alpha = Math.min(1, Math.max(0, (distance - threshold) / softness))
    data[i + 3] = Math.round((data[i + 3] ?? 255) * alpha)
  }
}

export function gradeImage(image: ImageData, chroma: Chroma | null, lut: Lut | null): void {
  if (chroma?.enabled) applyChromaRgba(image, chroma)
  if (lut) applyLutRgba(image, lut)
}
