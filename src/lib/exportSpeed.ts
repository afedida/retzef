import { letterboxThickness, progressBarRect, progressFraction } from '@/lib/creator'
import { t } from '@/lib/i18n'
import { videoLayers } from '@/lib/edit'
import { containRect } from '@/lib/time'
import type { Clip, FrameBox, KenBurns, Project } from '@/types'

export type Acceleration = 'prefer-hardware' | 'prefer-software' | 'no-preference'

export const PIPELINE_DEPTH = 2

export function chooseAcceleration(hardwareSupported: boolean, requested: Acceleration = 'prefer-hardware'): Acceleration {
  if (requested === 'no-preference' || requested === 'prefer-software') return requested
  return hardwareSupported ? 'prefer-hardware' : 'prefer-software'
}

export function fallbackAcceleration(current: Acceleration): Acceleration | null {
  if (current === 'prefer-hardware') return 'prefer-software'
  return null
}

export function realtimeFactor(mediaSeconds: number, wallSeconds: number): number {
  if (!(wallSeconds > 0) || !(mediaSeconds >= 0) || !Number.isFinite(mediaSeconds) || !Number.isFinite(wallSeconds)) return 0
  return mediaSeconds / wallSeconds
}

export function formatRealtime(factor: number): string {
  if (!Number.isFinite(factor) || factor <= 0) return '—'
  return `${factor >= 10 ? factor.toFixed(0) : factor.toFixed(1)}×`
}

export function accelerationLabel(acceleration: Acceleration): string {
  if (acceleration === 'prefer-hardware') return t('accel.hardware')
  if (acceleration === 'prefer-software') return t('accel.software')
  return t('accel.default')
}

function identityKen(ken: KenBurns): boolean {
  return ken.scaleStart === 1 && ken.scaleEnd === 1 && ken.xStart === 0.5 && ken.yStart === 0.5 && ken.xEnd === 0.5 && ken.yEnd === 0.5
}

export function canUseWorkerComposite(project: Project): boolean {
  if (!project.clips.length) return false
  for (const clip of project.clips) {
    if (clip.text || clip.shape || clip.adjustment || clip.portrait) return false
    if (clip.children?.length) return false
    if (clip.mask !== 'none' || clip.chroma.enabled || clip.lutId) return false
    if (clip.flipH || clip.flipV || clip.rotation !== 0 || clip.borderWidth > 0) return false
    if (clip.blend !== 'normal') return false
    if (clip.transition) return false
    if (!identityKen(clip.kenBurns)) return false
    if (clip.color.brightness !== 0 || clip.color.contrast !== 1 || clip.color.saturation !== 1) return false
  }
  return true
}

export type PlacedRect = { dx: number; dy: number; dw: number; dh: number }

export function placedRect(frame: FrameBox, srcW: number, srcH: number, canvasW: number, canvasH: number): PlacedRect {
  const boxW = frame.w * canvasW
  const boxH = frame.h * canvasH
  const fitted = containRect(srcW, srcH, boxW, boxH)
  return { dx: frame.x * canvasW + fitted.x, dy: frame.y * canvasH + fitted.y, dw: fitted.w, dh: fitted.h }
}

export type WorkerLayerPlan = PlacedRect & { clipId: string; opacity: number }

export function workerLayerPlan(
  project: Project,
  time: number,
  canvasW: number,
  canvasH: number,
  sourceSize: (clip: Clip) => { width: number; height: number } | null,
): WorkerLayerPlan[] {
  const plans: WorkerLayerPlan[] = []
  for (const layer of videoLayers(project, time)) {
    if (layer.opacity <= 0 || layer.slide !== 0) continue
    const size = sourceSize(layer.clip)
    if (!size || size.width <= 0 || size.height <= 0) continue
    const placed = placedRect(layer.clip.frame, size.width, size.height, canvasW, canvasH)
    plans.push({ clipId: layer.clip.id, opacity: layer.opacity, ...placed })
  }
  return plans
}

export function workerOverlay(project: Project, time: number, width: number, height: number): { letterboxPx: number; progress: { y: number; h: number; w: number } | null } {
  return {
    letterboxPx: letterboxThickness(project.letterbox ?? 0, height),
    progress: project.progressBar ? progressBarRect(progressFraction(project, time), width, height) : null,
  }
}
