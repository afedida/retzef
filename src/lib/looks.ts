import type { ColorGrade } from '@/types'

export type Look = {
  id: string
  label: string
  color: ColorGrade
}

export const LOOKS: Look[] = [
  { id: 'clean', label: 'נקי', color: { brightness: 0.02, contrast: 1.04, saturation: 1 } },
  { id: 'cinema', label: 'קולנוע', color: { brightness: -0.05, contrast: 1.16, saturation: 0.82 } },
  { id: 'warm', label: 'חם', color: { brightness: 0.04, contrast: 1.05, saturation: 1.12 } },
  { id: 'cold', label: 'קר', color: { brightness: 0.01, contrast: 1.08, saturation: 0.78 } },
  { id: 'vivid', label: 'רווי', color: { brightness: 0.03, contrast: 1.12, saturation: 1.35 } },
]
