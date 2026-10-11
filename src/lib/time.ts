import { OUTPUT_FPS } from '@/types'

export function formatTimecode(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const frames = Math.min(OUTPUT_FPS - 1, Math.floor((clamped % 1) * OUTPUT_FPS + 1e-4))
  const whole = Math.floor(clamped)
  const s = whole % 60
  const m = Math.floor(whole / 60) % 60
  const h = Math.floor(whole / 3600)
  const body = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${frames.toString().padStart(2, '0')}`
  return h > 0 ? `${h}:${body}` : body
}

export function formatClock(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const s = Math.floor(clamped % 60)
  const m = Math.floor(clamped / 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function containRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { x: number; y: number; w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: dstW, h: dstH }
  const scale = Math.min(dstW / srcW, dstH / srcH)
  const w = srcW * scale
  const h = srcH * scale
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h }
}
