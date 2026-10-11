import { clipEnd, defaultText, insertClip, makeShapeClip, makeTextClip, projectDuration } from '@/lib/edit'
import type { Asset, Clip, Project, ShapeKind } from '@/types'

function place(project: Project, clip: Clip): Project {
  return insertClip(project, clip)
}

export function addLowerThird(project: Project, time: number): Project {
  const bar = makeShapeClip('lower-third', 'v2', time, 4)
  const text = makeTextClip(time, 't1')
  text.duration = 4
  text.text = {
    ...defaultText(),
    content: 'שם הדובר\nתפקיד או כותרת',
    y: 0.8,
    fontSize: 48,
    align: 'start',
    x: 0.08,
  }
  return place(place(project, bar), text)
}

export function addIntro(project: Project): Project {
  const text = makeTextClip(0, 't1')
  text.duration = 3.5
  text.text = { ...defaultText(), content: 'פתיח', fontSize: 120, y: 0.46, animation: 'fade' }
  return place(project, text)
}

export function addOutro(project: Project): Project {
  const start = Math.max(0, projectDuration(project) - 0.05)
  const text = makeTextClip(start, 't1')
  text.duration = 3.5
  text.text = { ...defaultText(), content: 'תודה שצפיתם', fontSize: 84, y: 0.46, animation: 'slide' }
  return place(project, text)
}

export function addSticker(project: Project, time: number, shape: Exclude<ShapeKind, 'lower-third'>): Project {
  return place(project, makeShapeClip(shape, 'v2', time, 4))
}

export function addWatermark(project: Project, asset: Asset, time = 0): Project {
  const duration = Math.max(1, projectDuration(project) || asset.duration || 5)
  const clip: Clip = {
    ...makeShapeClip('rect', 'v2', time, duration),
    shape: null,
    assetId: asset.id,
    opacity: 0.82,
    frame: { x: 0.78, y: 0.04, w: 0.18, h: 0.18, radius: 0.12 },
    volume: 0,
  }
  const end = clipEnd({ ...clip, start: time })
  void end
  return place(project, clip)
}
