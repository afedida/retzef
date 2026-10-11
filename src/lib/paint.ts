import { fadeEnvelope } from '@/lib/edit'
import { containRect } from '@/lib/time'
import type { Clip, Project } from '@/types'

export type ReadyVisual = {
  status: 'ready'
  source: CanvasImageSource
  width: number
  height: number
}

export type Visual = ReadyVisual | { status: 'missing' } | { status: 'pending' }

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function dominantDirection(text: string): 'rtl' | 'ltr' {
  for (const char of text) {
    if (/\p{Script=Hebrew}/u.test(char)) return 'rtl'
    if (/\p{Script=Latin}/u.test(char)) return 'ltr'
  }
  return 'rtl'
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  opacity: number,
  width: number,
  height: number,
  selected: boolean,
) {
  if (!clip.text || opacity <= 0) return
  const lines = clip.text.content.replaceAll('\r', '').split('\n')
  const shown = lines.length ? lines : ['']
  const fontPx = (clip.text.fontSize * height) / 1080
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.font = `700 ${fontPx}px Heebo, Arial, sans-serif`
  ctx.direction = dominantDirection(clip.text.content)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const x = clip.text.x * width
  const y = clip.text.y * height
  const lineH = fontPx * 1.28
  const blockH = lineH * shown.length
  let maxW = 0
  for (const line of shown) maxW = Math.max(maxW, ctx.measureText(line || ' ').width)
  const padX = fontPx * 0.45
  const padY = fontPx * 0.28
  const boxW = maxW + padX * 2
  const boxH = blockH + padY * 2
  const boxX = x - boxW / 2
  const boxY = y - boxH / 2
  ctx.fillStyle = 'rgba(0, 0, 0, 0.48)'
  roundRect(ctx, boxX, boxY, boxW, boxH, fontPx * 0.22)
  ctx.fill()
  if (selected) {
    ctx.strokeStyle = 'rgba(255, 214, 140, 0.95)'
    ctx.lineWidth = Math.max(2, fontPx / 18)
    ctx.stroke()
  }
  ctx.lineWidth = Math.max(2, fontPx / 16)
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.82)'
  ctx.fillStyle = clip.text.color
  shown.forEach((line, index) => {
    const ly = y - blockH / 2 + lineH * index + lineH / 2
    const value = line || ' '
    ctx.strokeText(value, x, ly)
    ctx.fillText(value, x, ly)
  })
  ctx.restore()
}

export function paintFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  time: number,
  getVisual: (clip: Clip) => Visual,
  selectedClipId: string | null,
) {
  const width = ctx.canvas.width
  const height = ctx.canvas.height
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#050506'
  ctx.fillRect(0, 0, width, height)

  const videoTracks = project.tracks.filter((track) => track.type === 'video')
  for (let index = videoTracks.length - 1; index >= 0; index--) {
    const track = videoTracks[index]
    if (!track) continue
    for (const clip of project.clips) {
      if (clip.trackId !== track.id) continue
      if (time < clip.start || time >= clip.start + clip.duration) continue
      const opacity = fadeEnvelope(clip, time - clip.start)
      if (opacity <= 0) continue
      const visual = getVisual(clip)
      ctx.save()
      ctx.globalAlpha = opacity
      if (visual.status === 'ready') {
        const rect = containRect(visual.width, visual.height, width, height)
        ctx.drawImage(visual.source, rect.x, rect.y, rect.w, rect.h)
      } else if (visual.status === 'missing') {
        ctx.fillStyle = '#3a2226'
        ctx.fillRect(0, 0, width, height)
        ctx.fillStyle = '#f4e7e4'
        ctx.font = `600 ${Math.max(18, height / 18)}px Heebo, Arial, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.direction = 'rtl'
        ctx.fillText('מדיה חסרה', width / 2, height / 2)
      }
      ctx.restore()
    }
  }

  for (const clip of project.clips) {
    if (!clip.text) continue
    if (time < clip.start || time >= clip.start + clip.duration) continue
    drawText(ctx, clip, fadeEnvelope(clip, time - clip.start), width, height, clip.id === selectedClipId)
  }
}
