import { blankProject, clipEnd, coerceProject, projectDuration } from '@/lib/edit'
import { t } from '@/lib/i18n'
import type { Clip, ExportPresetId, Project, TextStyle, Track } from '@/types'

export const TEMPLATE_PARTS = ['project', 'intro', 'outro', 'logo', 'captionStyle', 'tracks', 'preset'] as const

export type TemplatePart = (typeof TEMPLATE_PARTS)[number]

export const TEMPLATE_PART_LABELS: Record<TemplatePart, string> = {
  project: 'הפרויקט כולו',
  intro: 'פתיח',
  outro: 'סיום',
  logo: 'לוגו / סימן מים',
  captionStyle: 'סגנון כתוביות',
  tracks: 'פריסת מסלולים',
  preset: 'פורמט ייצוא',
}

export type UserTemplate = {
  id: string
  name: string
  savedAt: number
  parts: TemplatePart[]
  preset: ExportPresetId | null
  tracks: Track[] | null
  captionStyle: Partial<TextStyle> | null
  intro: Clip[]
  outro: Clip[]
  logo: Clip[]
  project: Project | null
}

const INTRO_WINDOW = 6
const OUTRO_WINDOW = 14

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function introClips(project: Project): Clip[] {
  return project.clips.filter((clip) => clip.start < INTRO_WINDOW && (clip.text || clip.shape) && !clip.assetId)
}

export function outroClips(project: Project): Clip[] {
  const end = projectDuration(project)
  if (end <= 0) return []
  return project.clips.filter((clip) => {
    const begins = end - clip.start
    return begins <= OUTRO_WINDOW && begins >= 0 && (clip.text || clip.shape)
  })
}

export function logoClips(project: Project): Clip[] {
  return project.clips.filter((clip) => {
    if (clip.text) return false
    const frame = clip.frame
    return frame.w > 0 && frame.w <= 0.34 && frame.h > 0 && frame.h <= 0.34 && (frame.x >= 0.6 || frame.y <= 0.2)
  })
}

export function dominantCaptionStyle(project: Project): Partial<TextStyle> | null {
  const text = project.clips.find((clip) => clip.text)?.text
  if (!text) return null
  return {
    font: text.font,
    fontSize: text.fontSize,
    color: text.color,
    align: text.align,
    stroke: text.stroke,
    shadow: text.shadow,
    plate: text.plate,
    animation: text.animation,
    animDuration: text.animDuration,
  }
}

function relativeClips(clips: Clip[]): Clip[] {
  if (!clips.length) return []
  const origin = Math.min(...clips.map((clip) => clip.start))
  return clips.map((clip) => ({ ...clone(clip), start: Math.max(0, clip.start - origin) }))
}

export function captureTemplate(input: {
  name: string
  project: Project
  preset: ExportPresetId
  parts: TemplatePart[]
  id?: string
  savedAt?: number
}): UserTemplate {
  const parts = TEMPLATE_PARTS.filter((part) => input.parts.includes(part))
  const wants = (part: TemplatePart) => parts.includes(part)
  return {
    id: input.id ?? crypto.randomUUID(),
    name: input.name.trim() || t('template.fallbackName'),
    savedAt: input.savedAt ?? Date.now(),
    parts,
    preset: wants('preset') || wants('project') ? input.preset : null,
    tracks: wants('tracks') || wants('project') ? clone(input.project.tracks) : null,
    captionStyle: wants('captionStyle') ? dominantCaptionStyle(input.project) : null,
    intro: wants('intro') || wants('project') ? relativeClips(introClips(input.project)) : [],
    outro: wants('outro') || wants('project') ? relativeClips(outroClips(input.project)) : [],
    logo: wants('logo') || wants('project') ? relativeClips(logoClips(input.project)) : [],
    project: wants('project') ? clone(input.project) : null,
  }
}

function withCaption(clip: Clip, style: Partial<TextStyle> | null): Clip {
  if (!clip.text || !style) return clip
  return { ...clip, text: { ...clip.text, ...style } }
}

function retimed(clips: Clip[], origin: number, style: Partial<TextStyle> | null): Clip[] {
  return clips.map((clip) => withCaption({ ...clone(clip), id: crypto.randomUUID(), start: origin + clip.start }, style))
}

export function projectFromTemplate(template: UserTemplate): { project: Project; preset: ExportPresetId | null } {
  if (template.project) {
    const project = coerceProject(clone(template.project)) ?? blankProject()
    project.id = crypto.randomUUID()
    project.name = template.name || project.name
    if (template.tracks?.length) project.tracks = clone(template.tracks)
    return { project, preset: template.preset }
  }
  const project = blankProject()
  project.name = template.name || project.name
  if (template.tracks?.length) project.tracks = clone(template.tracks)
  const style = template.captionStyle
  const intro = retimed(template.intro, 0, style)
  project.clips.push(...intro)
  const logoOrigin = 0
  project.clips.push(...retimed(template.logo, logoOrigin, style))
  const outroOrigin = project.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0)
  project.clips.push(...retimed(template.outro, outroOrigin, style))
  return { project, preset: template.preset }
}

export function renameTemplate(list: UserTemplate[], id: string, name: string): UserTemplate[] {
  const trimmed = name.trim()
  if (!trimmed) return list
  return list.map((item) => (item.id === id ? { ...item, name: trimmed } : item))
}

export function deleteTemplate(list: UserTemplate[], id: string): UserTemplate[] {
  return list.filter((item) => item.id !== id)
}

function isPart(value: unknown): value is TemplatePart {
  return typeof value === 'string' && (TEMPLATE_PARTS as readonly string[]).includes(value)
}

export function parseTemplateDocument(value: unknown): UserTemplate | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<UserTemplate> & { format?: string }
  if (raw.format !== 'retzef-template' && raw.format !== undefined) return null
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || !Array.isArray(raw.parts) || !raw.parts.every(isPart)) return null
  const project = raw.project ? coerceProject(raw.project) : null
  if (raw.project && !project) return null
  return {
    id: raw.id,
    name: raw.name,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
    parts: raw.parts,
    preset: raw.preset ?? null,
    tracks: Array.isArray(raw.tracks) ? raw.tracks : null,
    captionStyle: raw.captionStyle ?? null,
    intro: Array.isArray(raw.intro) ? raw.intro : [],
    outro: Array.isArray(raw.outro) ? raw.outro : [],
    logo: Array.isArray(raw.logo) ? raw.logo : [],
    project,
  }
}

export function templateDocument(template: UserTemplate): string {
  return JSON.stringify({ format: 'retzef-template', version: 1, ...template }, null, 2)
}

export function parseTemplateText(text: string): UserTemplate | null {
  try {
    return parseTemplateDocument(JSON.parse(text) as unknown)
  } catch {
    return null
  }
}
