import { describe, expect, it } from 'vitest'
import { blankProject, freshClip } from '@/lib/edit'
import { defaultText } from '@/lib/edit'
import {
  accelerationLabel,
  canUseWorkerComposite,
  chooseAcceleration,
  fallbackAcceleration,
  formatRealtime,
  placedRect,
  realtimeFactor,
  workerLayerPlan,
  workerOverlay,
} from '@/lib/exportSpeed'

describe('export speed', () => {
  it('prefers hardware and falls back to software', () => {
    expect(chooseAcceleration(true)).toBe('prefer-hardware')
    expect(chooseAcceleration(false)).toBe('prefer-software')
    expect(chooseAcceleration(true, 'no-preference')).toBe('no-preference')
    expect(fallbackAcceleration('prefer-hardware')).toBe('prefer-software')
    expect(fallbackAcceleration('prefer-software')).toBeNull()
    expect(accelerationLabel('prefer-hardware')).toBe('מקודד חומרה')
  })

  it('reports encode speed against realtime', () => {
    expect(realtimeFactor(60, 30)).toBe(2)
    expect(realtimeFactor(60, 0)).toBe(0)
    expect(formatRealtime(2)).toBe('2.0×')
    expect(formatRealtime(0)).toBe('—')
  })

  it('sends a plain still to the worker and keeps captions on the main thread', () => {
    const plain = blankProject()
    plain.clips = [freshClip({ id: 'still', duration: 60 })]
    plain.progressBar = true
    plain.letterbox = 0.12
    expect(canUseWorkerComposite(plain)).toBe(true)
    const caption = {
      ...plain,
      clips: [...plain.clips, freshClip({ id: 'cap', assetId: null, text: { ...defaultText(), content: 'שלום' } })],
    }
    expect(canUseWorkerComposite(caption)).toBe(false)
    const rect = placedRect(plain.clips[0]!.frame, 1280, 720, 1920, 1080)
    expect(rect.dw).toBeCloseTo(1920)
    expect(rect.dh).toBeCloseTo(1080)
    const plan = workerLayerPlan(plain, 1, 1920, 1080, () => ({ width: 1280, height: 720 }))
    expect(plan).toHaveLength(1)
    expect(plan[0]?.clipId).toBe('still')
    const overlay = workerOverlay(plain, 30, 1920, 1080)
    expect(overlay.letterboxPx).toBeGreaterThan(0)
    expect(overlay.progress?.w).toBeGreaterThan(0)
    expect(overlay.progress?.w).toBeLessThan(1920)
  })
})