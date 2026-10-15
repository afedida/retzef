import { letterboxThickness, progressBarRect, progressFraction } from '@/lib/creator'
import { getLanguage, t } from '@/lib/i18n'
import { fadeEnvelope, trackShown, videoLayers } from '@/lib/edit'
import { gradeImage } from '@/lib/grade'
import { sampleLane } from '@/lib/keyframes'
import { containRect } from '@/lib/time'
import { DEFAULT_FRAME, type BlendMode, type Clip, type Lut, type Project, type TextFont } from '@/types'

export type PaintOptions = {
  gradeBypass?: boolean
}

export type ReadyVisual = {
  status: 'ready'
  source: CanvasImageSource
  width: number
  height: number
}

export type Visual = ReadyVisual | { status: 'missing' } | { status: 'pending' }

const FONT_STACK: Record<TextFont, string> = {
  heebo: 'Heebo, Arial, sans-serif',
  rubik: 'Rubik, Heebo, Arial, sans-serif',
  assistant: 'Assistant, Heebo, Arial, sans-serif',
  frank: 'Frank Ruhl Libre, Heebo, serif',
}

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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
}

let scratch: HTMLCanvasElement | null = null

function scratchCanvas(width: number, height: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!scratch) scratch = document.createElement('canvas')
  if (scratch.width !== width) scratch.width = width
  if (scratch.height !== height) scratch.height = height
  return scratch.getContext('2d', { willReadFrequently: true })
}

function drawShape(ctx: CanvasRenderingContext2D, clip: Clip, width: number, height: number) {
  const frame = clip.frame
  const x = frame.x * width
  const y = frame.y * height
  const w = frame.w * width
  const h = frame.h * height
  ctx.fillStyle = clip.shapeFill || '#f59e0b'
  if (clip.shape === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  if (clip.shape === 'star') {
    const cx = x + w / 2
    const cy = y + h / 2
    const outer = Math.min(w, h) / 2
    const inner = outer * 0.45
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? outer : inner
      const angle = -Math.PI / 2 + (i * Math.PI) / 5
      const px = cx + Math.cos(angle) * radius
      const py = cy + Math.sin(angle) * radius
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
    return
  }
  roundRect(ctx, x, y, w, h, frame.radius * Math.min(w, h) * 0.5)
  ctx.fill()
}

type Box = { x: number; y: number; w: number; h: number }

function drawVisual(
  ctx: CanvasRenderingContext2D,
  visual: Visual,
  clip: Clip,
  local: number,
  dest: Box,
  filterPrefix = '',
  gradeBypass = false,
) {
  if (visual.status === 'missing') {
    ctx.fillStyle = '#3a2226'
    ctx.fillRect(dest.x, dest.y, dest.w, dest.h)
    ctx.fillStyle = '#f4e7e4'
    ctx.font = `600 ${Math.max(18, dest.h / 18)}px Heebo, Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.direction = getLanguage() === 'en' ? 'ltr' : 'rtl'
    ctx.fillText(t('content.missingMedia'), dest.x + dest.w / 2, dest.y + dest.h / 2)
    return
  }
  if (visual.status !== 'ready') return
  const progress = clip.duration > 0 ? local / clip.duration : 0
  const ken = clip.kenBurns
  const scale = clip.keys?.scale?.length ? sampleLane(clip.keys.scale, progress, ken.scaleStart) : lerp(ken.scaleStart, ken.scaleEnd, progress)
  const px = clip.keys?.x?.length ? sampleLane(clip.keys.x, progress, ken.xStart) : lerp(ken.xStart, ken.xEnd, progress)
  const py = clip.keys?.y?.length ? sampleLane(clip.keys.y, progress, ken.yStart) : lerp(ken.yStart, ken.yEnd, progress)
  const rotation = clip.rotation ?? 0
  const turned = rotation === 90 || rotation === 270
  const srcW = turned ? visual.height : visual.width
  const srcH = turned ? visual.width : visual.height
  const rect = containRect(srcW, srcH, dest.w, dest.h)
  const w = rect.w * scale
  const h = rect.h * scale
  const x = (dest.w - w) * px
  const y = (dest.h - h) * py
  ctx.save()
  ctx.beginPath()
  ctx.rect(dest.x, dest.y, dest.w, dest.h)
  ctx.clip()
  ctx.translate(dest.x + dest.w / 2, dest.y + dest.h / 2)
  if (clip.flipH) ctx.scale(-1, 1)
  if (clip.flipV) ctx.scale(1, -1)
  if (rotation) ctx.rotate((rotation * Math.PI) / 180)
  ctx.filter = `${filterPrefix} ${colorFilter(clip, gradeBypass)}`.trim()
  ctx.drawImage(visual.source, -dest.w / 2 + x, -dest.h / 2 + y, w, h)
  ctx.restore()
}

function drawGraded(
  ctx: CanvasRenderingContext2D,
  visual: Visual,
  clip: Clip,
  local: number,
  width: number,
  height: number,
  luts: Lut[],
  box: Box | null,
  gradeBypass = false,
) {
  const lut = gradeBypass || !clip.lutId ? null : (luts.find((item) => item.id === clip.lutId) ?? null)
  const dest = box ?? { x: 0, y: 0, w: width, h: height }
  if (!lut && !clip.chroma?.enabled) {
    drawVisual(ctx, visual, clip, local, dest, '', gradeBypass)
    return
  }
  const grade = scratchCanvas(Math.max(1, Math.round(dest.w)), Math.max(1, Math.round(dest.h)))
  if (!grade || !scratch) {
    drawVisual(ctx, visual, clip, local, dest)
    return
  }
  grade.setTransform(1, 0, 0, 1, 0, 0)
  grade.clearRect(0, 0, scratch.width, scratch.height)
  drawVisual(grade, visual, clip, local, { x: 0, y: 0, w: scratch.width, h: scratch.height }, '', gradeBypass)
  const image = grade.getImageData(0, 0, scratch.width, scratch.height)
  gradeImage(image, clip.chroma?.enabled ? clip.chroma : null, lut)
  grade.putImageData(image, 0, 0)
  ctx.drawImage(scratch, dest.x, dest.y, dest.w, dest.h)
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  width: number,
  height: number,
  selected: boolean,
  time: number,
) {
  if (!clip.text) return
  const local = time - clip.start
  if (local < 0 || local >= clip.duration) return
  const text = clip.text
  const keyed = clip.keys?.opacity?.length ? sampleLane(clip.keys.opacity, local / clip.duration, clip.opacity ?? 1) : (clip.opacity ?? 1)
  let opacity = fadeEnvelope(clip, local) * keyed
  let slide = 0
  if (text.animation !== 'none' && text.animDuration > 0 && local < text.animDuration) {
    const progress = local / text.animDuration
    if (text.animation === 'fade') opacity *= progress
    if (text.animation === 'slide') slide = (1 - progress) * (text.align === 'end' ? -1 : 1)
  }
  if (opacity <= 0) return
  const lines = text.content.replaceAll('\r', '').split('\n')
  const shown = lines.length ? lines : ['']
  const fontPx = (text.fontSize * height) / 1080
  const direction = dominantDirection(text.content)
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.translate(slide * width * 0.18, 0)
  ctx.font = `700 ${fontPx}px ${FONT_STACK[text.font]}`
  ctx.direction = direction
  ctx.textAlign = text.align
  ctx.textBaseline = 'middle'
  if ((clip.captionStyle === 'karaoke' || clip.captionStyle === 'pop') && clip.words.length) {
    drawCaptionWords(ctx, clip, width, height, selected, local, fontPx, direction)
    ctx.restore()
    return
  }
  const x = text.align === 'center' ? text.x * width : text.align === 'end' ? text.x * width : text.x * width
  const y = text.y * height
  const lineH = fontPx * 1.28
  const blockH = lineH * shown.length
  let maxW = 0
  for (const line of shown) maxW = Math.max(maxW, ctx.measureText(line || ' ').width)
  const padX = fontPx * 0.45
  const padY = fontPx * 0.28
  const boxW = maxW + padX * 2
  const boxH = blockH + padY * 2
  const anchorOnRight = (direction === 'rtl' && text.align === 'start') || (direction === 'ltr' && text.align === 'end')
  const boxX = text.align === 'center' ? x - boxW / 2 : anchorOnRight ? x - boxW : x
  const boxY = y - boxH / 2
  if (text.plate) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)'
    roundRect(ctx, boxX, boxY, boxW, boxH, fontPx * 0.22)
    ctx.fill()
  }
  if (selected) {
    ctx.strokeStyle = 'rgba(0, 120, 212, 0.95)'
    ctx.lineWidth = Math.max(2, fontPx / 18)
    roundRect(ctx, boxX, boxY, boxW, boxH, fontPx * 0.22)
    ctx.stroke()
  }
  if (text.shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.72)'
    ctx.shadowBlur = fontPx * 0.28
    ctx.shadowOffsetY = fontPx * 0.08
  }
  ctx.lineJoin = 'round'
  ctx.fillStyle = text.color
  shown.forEach((line, index) => {
    const ly = y - blockH / 2 + lineH * index + lineH / 2
    const value = line || ' '
    if (text.stroke) {
      ctx.shadowColor = 'transparent'
      ctx.lineWidth = Math.max(2, fontPx / 16)
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.82)'
      ctx.strokeText(value, x, ly)
      if (text.shadow) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.72)'
        ctx.shadowBlur = fontPx * 0.28
        ctx.shadowOffsetY = fontPx * 0.08
      }
    }
    ctx.fillText(value, x, ly)
  })
  ctx.restore()
}

function drawCaptionWords(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  width: number,
  height: number,
  selected: boolean,
  local: number,
  fontPx: number,
  direction: 'rtl' | 'ltr',
) {
  const text = clip.text
  if (!text) return
  const words = clip.words
  const sequence = direction === 'rtl' ? [...words].reverse() : words
  ctx.font = `700 ${fontPx}px ${FONT_STACK[text.font]}`
  const gap = fontPx * 0.28
  const widths = sequence.map((word) => ctx.measureText(word.text).width)
  const total = widths.reduce((sum, item) => sum + item, 0) + gap * Math.max(0, words.length - 1)
  const anchor = text.x * width
  let cursor = text.align === 'center' ? anchor - total / 2 : text.align === 'end' ? anchor - total : anchor
  if (direction === 'rtl' && text.align === 'start') cursor = anchor - total
  const y = text.y * height
  if (text.plate) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)'
    roundRect(ctx, cursor - fontPx * 0.35, y - fontPx * 0.75, total + fontPx * 0.7, fontPx * 1.5, fontPx * 0.2)
    ctx.fill()
  }
  if (selected) {
    ctx.strokeStyle = 'rgba(0, 120, 212, 0.95)'
    ctx.lineWidth = Math.max(2, fontPx / 18)
    roundRect(ctx, cursor - fontPx * 0.35, y - fontPx * 0.75, total + fontPx * 0.7, fontPx * 1.5, fontPx * 0.2)
    ctx.stroke()
  }
  sequence.forEach((word, index) => {
    const active = local >= word.start && local < word.end
    const size = clip.captionStyle === 'pop' && active ? fontPx * 1.18 : fontPx
    ctx.font = `700 ${size}px ${FONT_STACK[text.font]}`
    ctx.fillStyle = active ? '#50e6ff' : text.color
    ctx.globalAlpha = active ? 1 : 0.82
    const wordWidth = widths[index] ?? ctx.measureText(word.text).width
    if (text.stroke) {
      ctx.lineWidth = Math.max(2, size / 16)
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.82)'
      ctx.strokeText(word.text, cursor, y)
    }
    ctx.fillText(word.text, cursor, y)
    cursor += wordWidth + gap
  })
  ctx.globalAlpha = 1
}

function colorFilter(clip: Clip, gradeBypass = false): string {
  if (gradeBypass) return 'brightness(1) contrast(1) saturate(1)'
  const color = clip.color
  return `brightness(${(1 + color.brightness).toFixed(3)}) contrast(${color.contrast.toFixed(3)}) saturate(${color.saturation.toFixed(3)})`
}

let plate: HTMLCanvasElement | null = null

function plateContext(width: number, height: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!plate) plate = document.createElement('canvas')
  if (plate.width !== width) plate.width = width
  if (plate.height !== height) plate.height = height
  const context = plate.getContext('2d')
  context?.clearRect(0, 0, width, height)
  return context
}

function drawPortrait(
  ctx: CanvasRenderingContext2D,
  visual: Visual,
  clip: Clip,
  local: number,
  width: number,
  height: number,
  gradeBypass = false,
) {
  const dest = { x: 0, y: 0, w: width, h: height }
  drawVisual(ctx, visual, clip, local, dest, 'blur(18px)', gradeBypass)
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(width * 0.5, height * 0.42, width * 0.22, height * 0.34, 0, 0, Math.PI * 2)
  ctx.clip()
  drawVisual(ctx, visual, clip, local, dest, '', gradeBypass)
  ctx.restore()
}

function applyMask(ctx: CanvasRenderingContext2D, clip: Clip, width: number, height: number) {
  if (clip.mask === 'none') return
  ctx.save()
  ctx.globalCompositeOperation = 'destination-in'
  if (clip.mask === 'ellipse') {
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.ellipse(width / 2, height / 2, width * 0.34, height * 0.42, 0, 0, Math.PI * 2)
    ctx.fill()
  } else {
    const gradient = ctx.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, height * 0.62)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }
  ctx.restore()
}

function applyAdjustment(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  width: number,
  height: number,
  opacity: number,
  gradeBypass = false,
) {
  if (gradeBypass) return
  const buffer = plateContext(width, height)
  if (!buffer || !plate) return
  buffer.drawImage(ctx.canvas, 0, 0)
  ctx.save()
  ctx.filter = colorFilter(clip, gradeBypass)
  ctx.globalAlpha = opacity
  ctx.drawImage(plate, 0, 0)
  ctx.restore()
}

export function paintFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  time: number,
  getVisual: (clip: Clip) => Visual,
  selectedClipId: string | null,
  options?: PaintOptions,
) {
  const gradeBypass = options?.gradeBypass === true
  const width = ctx.canvas.width
  const height = ctx.canvas.height
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#1b1b1b'
  ctx.fillRect(0, 0, width, height)

  for (const layer of videoLayers(project, time)) {
    if (layer.opacity <= 0) continue
    if (layer.clip.adjustment) {
      applyAdjustment(ctx, layer.clip, width, height, layer.opacity, gradeBypass)
      continue
    }
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.globalCompositeOperation = BLEND[layer.clip.blend] ?? 'source-over'
    if (layer.slide !== 0) ctx.translate(layer.slide * width, 0)
    const frame = layer.clip.frame ?? DEFAULT_FRAME
    const boxed = frame.w < 0.995 || frame.h < 0.995 || frame.x > 0.002 || frame.y > 0.002 || frame.radius > 0
    const boxX = frame.x * width
    const boxY = frame.y * height
    const boxW = frame.w * width
    const boxH = frame.h * height
    if (boxed) {
      roundRect(ctx, boxX, boxY, boxW, boxH, frame.radius * Math.min(boxW, boxH) * 0.5)
      ctx.clip()
    }
    const masked = layer.clip.mask !== 'none' || layer.clip.portrait
    if (masked) {
      const buffer = plateContext(width, height)
      if (buffer && plate) {
        if (layer.clip.portrait) drawPortrait(buffer, getVisual(layer.clip), layer.clip, layer.local, width, height, gradeBypass)
        else if (layer.clip.shape && !layer.clip.assetId) drawShape(buffer, layer.clip, width, height)
        else drawGraded(buffer, getVisual(layer.clip), layer.clip, layer.local, width, height, project.luts, null, gradeBypass)
        applyMask(buffer, layer.clip, width, height)
        ctx.drawImage(plate, 0, 0)
      }
    } else if (layer.clip.shape && !layer.clip.assetId) drawShape(ctx, layer.clip, width, height)
    else drawGraded(ctx, getVisual(layer.clip), layer.clip, layer.local, width, height, project.luts, boxed ? { x: boxX, y: boxY, w: boxW, h: boxH } : null, gradeBypass)
    if (layer.clip.borderWidth > 0) {
      ctx.strokeStyle = layer.clip.borderColor || '#ffffff'
      ctx.lineWidth = (layer.clip.borderWidth * height) / 1080
      roundRect(ctx, boxX, boxY, boxW, boxH, frame.radius * Math.min(boxW, boxH) * 0.5)
      ctx.stroke()
    }
    ctx.restore()
  }

  const textTracks = project.tracks.filter((track) => track.type === 'text' && trackShown(project, track.id))
  for (let index = textTracks.length - 1; index >= 0; index--) {
    const track = textTracks[index]
    if (!track) continue
    for (const clip of project.clips) {
      if (clip.trackId !== track.id || !clip.text) continue
      drawText(ctx, clip, width, height, clip.id === selectedClipId, time)
    }
  }

  const bars = letterboxThickness(project.letterbox ?? 0, height)
  if (bars > 0) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, bars)
    ctx.fillRect(0, height - bars, width, bars)
  }
  if (project.progressBar) {
    const rect = progressBarRect(progressFraction(project, time), width, height)
    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    ctx.fillRect(0, rect.y, width, rect.h)
    ctx.fillStyle = '#0078d4'
    ctx.fillRect(0, rect.y, rect.w, rect.h)
  }
}
