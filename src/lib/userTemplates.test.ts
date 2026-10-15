import { describe, expect, it } from 'vitest'
import { blankProject, freshClip, projectDuration } from '@/lib/edit'
import { defaultText } from '@/lib/edit'
import {
  captureTemplate,
  deleteTemplate,
  introClips,
  logoClips,
  outroClips,
  parseTemplateText,
  projectFromTemplate,
  renameTemplate,
  templateDocument,
} from '@/lib/userTemplates'

function sampleProject() {
  const project = blankProject()
  project.name = 'שיעור'
  const intro = freshClip({
    id: 'intro',
    trackId: 't1',
    assetId: null,
    start: 0,
    duration: 3,
    text: { ...defaultText(), content: 'פתיח', fontSize: 96, color: '#50e6ff' },
  })
  const logo = freshClip({
    id: 'logo',
    assetId: 'logo-asset',
    start: 0,
    duration: 20,
    frame: { x: 0.8, y: 0.04, w: 0.16, h: 0.12, radius: 0.1 },
  })
  const outro = freshClip({
    id: 'outro',
    trackId: 't1',
    assetId: null,
    start: 18,
    duration: 4,
    text: { ...defaultText(), content: 'תודה' },
  })
  project.clips = [intro, logo, outro]
  project.tracks = project.tracks.map((track) => (track.id === 't1' ? { ...track, name: 'כותרות' } : track))
  return project
}

describe('user templates', () => {
  it('splits intro, outro, and logo clips', () => {
    const project = sampleProject()
    expect(introClips(project).map((clip) => clip.id)).toEqual(['intro'])
    expect(outroClips(project).map((clip) => clip.id)).toEqual(['outro'])
    expect(logoClips(project).map((clip) => clip.id)).toEqual(['logo'])
  })

  it('builds a new project from the selected parts', () => {
    const project = sampleProject()
    const template = captureTemplate({
      name: 'ערוץ',
      project,
      preset: '720p30',
      parts: ['intro', 'outro', 'logo', 'captionStyle', 'tracks', 'preset'],
      id: 'tpl-1',
      savedAt: 10,
    })
    expect(template.project).toBeNull()
    expect(template.captionStyle?.fontSize).toBe(96)
    expect(template.tracks?.find((track) => track.id === 't1')?.name).toBe('כותרות')
    const created = projectFromTemplate(template)
    expect(created.preset).toBe('720p30')
    expect(created.project.name).toBe('ערוץ')
    expect(created.project.tracks.find((track) => track.id === 't1')?.name).toBe('כותרות')
    expect(created.project.clips).toHaveLength(3)
    expect(projectDuration(created.project)).toBeGreaterThan(18)
    const renamed = renameTemplate([template], 'tpl-1', 'ערוץ חדש')
    expect(renamed[0]?.name).toBe('ערוץ חדש')
    expect(deleteTemplate(renamed, 'tpl-1')).toEqual([])
  })

  it('restores a full project snapshot from a template file', () => {
    const template = captureTemplate({ name: 'מלא', project: sampleProject(), preset: '1080p30', parts: ['project'] })
    const text = templateDocument(template)
    const parsed = parseTemplateText(text)
    expect(parsed?.project?.clips).toHaveLength(3)
    const created = projectFromTemplate(parsed!)
    expect(created.project.id).not.toBe(template.project?.id)
    expect(created.project.clips).toHaveLength(3)
    expect(parseTemplateText('{')).toBeNull()
  })
})
