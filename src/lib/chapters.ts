import { t } from '@/lib/i18n'
import type { Marker } from '@/types'

export function formatChapterTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

export function youtubeChapters(markers: Marker[]): string {
  const sorted = [...markers].sort((a, b) => a.time - b.time)
  const lines: string[] = []
  const first = sorted[0]
  if (!first || first.time > 0.4) lines.push(`0:00 ${t('content.chapterStart')}`)
  for (const marker of sorted) {
    const time = lines.length === 0 ? 0 : marker.time
    lines.push(`${formatChapterTime(time)} ${marker.label || t('content.chapter')}`)
  }
  if (!lines.length) lines.push(`0:00 ${t('content.chapterStart')}`)
  return lines.join('\n')
}
