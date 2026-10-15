import { loadAudioBuffer, peakEnvelope, forgetAudio } from '@/lib/audio'
import { getLanguage, setI18nLanguage, t, type Language } from '@/lib/i18n'
import { detectBeats } from '@/lib/beats'
import { transcribePcm } from '@/lib/captions'
import { youtubeChapters } from '@/lib/chapters'
import { dropBlob, getBlob, getUrl, putBlob } from '@/lib/blobs'
import { deleteStoredAsset, loadKv, loadStoredAssets, loadStoredProject, loadVersions, saveAsset, saveKv, saveProject, saveVersions, type ProjectVersion } from '@/lib/db'
import {
  addMarker,
  addTextTrack,
  blankProject,
  clearVolumeKeys,
  clipsTouching,
  coerceProject,
  addLut,
  deleteClips,
  deleteClipsForAsset,
  deleteWord,
  exciseLocalRanges,
  groupClips,
  insertClip,
  makeAdjustmentClip,
  nestClips,
  makeMediaClip,
  makeTextClip,
  moveClip,
  pasteClips,
  preferredTrack,
  projectDuration,
  referencedAssetIds,
  removeMarker,
  removeTextTrack,
  setClipEnd,
  setClipStart,
  setDuckEnvelope,
  setLaneEase,
  setMasterVolume,
  setRippleMode,
  setSpeed,
  setTrackDuck,
  setTrackFlag,
  setTrackVolume,
  setTransition,
  snapPoints,
  splitClip,
  trimClip,
  removeFillers,
  setMotionKeys,
  ungroupClips,
  unnestClip,
  updateClip,
  updateText,
  upsertLaneKey,
  upsertVolumeKey,
} from '@/lib/edit'
import { evenWords } from '@/lib/fillers'
import { LOOKS } from '@/lib/looks'
import { parseCube } from '@/lib/lut'
import { cuesToSrt, parseSrt } from '@/lib/srt'
import {
  addEndScreen,
  applyAttributes,
  applyJumpZoom,
  applySplit,
  clearMarks,
  detachAudio,
  fitMusic,
  jCut,
  lCut,
  loopBounds,
  nextRotation,
  pickAttributes,
  placeCaption,
  setMark,
  type ClipAttributes,
} from '@/lib/creator'
import { addIntro, addLowerThird, addOutro, addSticker, addWatermark } from '@/lib/templates'
import { silentGaps } from '@/lib/vad'
import { captureImageThumbnail, captureVideoThumbnail, probeFile, readProjectFile } from '@/lib/media'
import { packProject, unpackProject } from '@/lib/package'
import { exportProject } from '@/lib/exportVideo'
import { pickMp4Stream } from '@/lib/saveFile'
import {
  autosaveLinkedFolder,
  chooseProjectFolder,
  directoryPickerSupported,
  linkedFolder,
  listRecentFolders,
  openProjectFolder,
  reopenRecentFolder,
} from '@/lib/folderStore'
import {
  DEFAULT_SHORTCUTS,
  cloneBindings,
  parseShortcutDocument,
  readShortcutSettings,
  shortcutDocument,
  writeShortcutSettings,
  type Bindings,
} from '@/lib/shortcuts'
import {
  captureTemplate,
  deleteTemplate,
  parseTemplateDocument,
  projectFromTemplate,
  renameTemplate,
  type TemplatePart,
  type UserTemplate,
} from '@/lib/userTemplates'
import { presetById, REVIEW_RATES, type Asset, type CaptionAnchor, type CaptionLanguage, type Clip, type Ease, type ExportPresetId, type KenBurns, type ColorGrade, type KeyLane, type Project, type ReviewRate, type ShapeKind, type TextStyle, type Transition } from '@/types'

export type EditorState = {
  ready: boolean
  project: Project
  assets: Asset[]
  selectedClipId: string | null
  selectedClipIds: string[]
  selectedAssetId: string | null
  lane: KeyLane
  status: string | null
  captionLanguage: CaptionLanguage
  snap: boolean
  pps: number
  importError: string | null
  exportOpen: boolean
  exportPreset: ExportPresetId
  selectedMarkerId: string | null
  canUndo: boolean
  canRedo: boolean
  trackArmed: boolean
  versions: ProjectVersion[]
  reviewRate: ReviewRate
  showGuides: boolean
  gradeBypass: boolean
  attributeClip: ClipAttributes | null
  exportJob: ExportJob | null
  folderOpen: boolean
  templateOpen: boolean
  shortcutOpen: boolean
  shortcutCapture: boolean
  folderName: string | null
  recentFolders: { id: string; name: string; savedAt: number }[]
  templates: UserTemplate[]
  shortcuts: Bindings
  language: Language
  settingsOpen: boolean
}

export type ExportJob = {
  running: boolean
  ratio: number
  label: string
  speed: number
  error: string | null
  resultUrl: string | null
  resultSize: number
  savedToDisk: boolean
}

const history = {
  past: [] as Project[],
  future: [] as Project[],
}

const shelf = new Map<string, Asset>()
let textTrackId: string | null = null

let gestureBase: Project | null = null
let saveTimer = 0

const state: EditorState = {
  ready: false,
  project: blankProject(),
  assets: [],
  selectedClipId: null,
  selectedClipIds: [],
  selectedAssetId: null,
  lane: 'volume',
  status: null,
  captionLanguage: 'hebrew',
  snap: true,
  pps: 72,
  importError: null,
  exportOpen: false,
  exportPreset: '1080p30',
  selectedMarkerId: null,
  canUndo: false,
  canRedo: false,
  trackArmed: false,
  versions: [],
  reviewRate: 1,
  showGuides: false,
  gradeBypass: false,
  attributeClip: null,
  exportJob: null,
  folderOpen: false,
  templateOpen: false,
  shortcutOpen: false,
  shortcutCapture: false,
  folderName: null,
  recentFolders: [],
  templates: [],
  shortcuts: cloneBindings(DEFAULT_SHORTCUTS),
  language: getLanguage(),
  settingsOpen: false,
}

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function touchHistory() {
  state.canUndo = history.past.length > 0
  state.canRedo = history.future.length > 0
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getState(): EditorState {
  return state
}

function assetMap(): Map<string, Asset> {
  return new Map(state.assets.map((asset) => [asset.id, asset]))
}

function assetOf(clipAssetId: string | null): Asset | null {
  if (!clipAssetId) return null
  return state.assets.find((asset) => asset.id === clipAssetId) ?? null
}

function scheduleSave() {
  if (!state.ready) return
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void saveProject(state.project)
    const blobs = new Map<string, Blob>()
    for (const asset of state.assets) {
      const blob = getBlob(asset.id)
      if (blob) blobs.set(asset.id, blob)
    }
    void autosaveLinkedFolder(state.project, state.assets, blobs).catch(() => undefined)
  }, 350)
}

function projectsInMemory(): Project[] {
  return [...history.past, state.project, ...history.future, ...(gestureBase ? [gestureBase] : [])]
}

function syncShelf() {
  const live = referencedAssetIds(projectsInMemory())
  for (const id of [...shelf.keys()]) {
    if (live.has(id)) continue
    shelf.delete(id)
    dropBlob(id)
    forgetAudio(id)
  }
  const needed = referencedAssetIds([state.project])
  const restored: Asset[] = []
  for (const id of needed) {
    if (state.assets.some((asset) => asset.id === id)) continue
    const kept = shelf.get(id)
    const blob = getBlob(id)
    if (!kept || !blob) continue
    restored.push(kept)
    void saveAsset(kept, blob)
  }
  if (restored.length) state.assets = [...state.assets, ...restored]
}

function commit(mutator: (project: Project) => Project) {
  endGesture()
  const previous = state.project
  const next = mutator(previous)
  if (next === previous) return
  history.past.push(previous)
  if (history.past.length > 80) history.past.shift()
  history.future = []
  state.project = next
  state.selectedClipIds = state.selectedClipIds.filter((id) => next.clips.some((clip) => clip.id === id))
  if (state.selectedClipId && !next.clips.some((clip) => clip.id === state.selectedClipId)) {
    state.selectedClipId = state.selectedClipIds[0] ?? null
  }
  if (state.selectedMarkerId && !next.markers.some((marker) => marker.id === state.selectedMarkerId)) {
    state.selectedMarkerId = null
  }
  syncShelf()
  touchHistory()
  scheduleSave()
  emit()
}

export function live(mutator: (base: Project) => Project) {
  if (!gestureBase) gestureBase = state.project
  state.project = mutator(gestureBase)
  emit()
}

export function endGesture() {
  if (gestureBase && gestureBase !== state.project) {
    history.past.push(gestureBase)
    if (history.past.length > 80) history.past.shift()
    history.future = []
    touchHistory()
    scheduleSave()
  }
  gestureBase = null
}

export function undo() {
  gestureBase = null
  const previous = history.past.pop()
  if (!previous) return
  history.future.push(state.project)
  state.project = previous
  if (state.selectedClipId && !previous.clips.some((clip) => clip.id === state.selectedClipId)) {
    state.selectedClipId = null
  }
  syncShelf()
  touchHistory()
  scheduleSave()
  emit()
}

export function redo() {
  gestureBase = null
  const next = history.future.pop()
  if (!next) return
  history.past.push(state.project)
  state.project = next
  syncShelf()
  touchHistory()
  scheduleSave()
  emit()
}

export function selectClip(id: string | null, additive = false) {
  if (!id) {
    state.selectedClipId = null
    state.selectedClipIds = []
  } else if (additive) {
    const chosen = new Set(state.selectedClipIds)
    if (chosen.has(id)) chosen.delete(id)
    else chosen.add(id)
    state.selectedClipIds = [...chosen]
    state.selectedClipId = chosen.has(id) ? id : (state.selectedClipIds[0] ?? null)
  } else {
    state.selectedClipId = id
    state.selectedClipIds = [id]
  }
  if (state.selectedClipId) state.selectedMarkerId = null
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  state.selectedAssetId = clip?.assetId ?? state.selectedAssetId
  if (clip?.text) textTrackId = clip.trackId
  emit()
}

export function selectMarker(id: string | null) {
  state.selectedMarkerId = id
  if (id) state.selectedClipId = null
  emit()
}

export function setExportPreset(preset: ExportPresetId) {
  state.exportPreset = preset
  emit()
}

export function selectAsset(id: string | null) {
  state.selectedAssetId = id
  emit()
}

export function setSnap(enabled: boolean) {
  state.snap = enabled
  emit()
}

export function setPps(pps: number) {
  state.pps = Math.min(280, Math.max(16, pps))
  emit()
}

export function setExportOpen(open: boolean) {
  state.exportOpen = open
  emit()
}

export function renameProject(name: string) {
  commit((project) => ({ ...project, name }))
}

export function placeAsset(assetId: string, time: number, trackId?: string) {
  const asset = assetOf(assetId)
  if (!asset) return
  const duration = asset.kind === 'image' || asset.duration <= 0 ? 5 : asset.duration
  const track = preferredTrack(state.project, asset.kind, Math.max(0, time), duration, trackId)
  const clip = makeMediaClip(asset, track, time)
  commit((project) => insertClip(project, clip))
  state.selectedClipId = clip.id
  state.selectedAssetId = asset.id
  emit()
}

export function addTextClip(trackId?: string) {
  const texts = state.project.tracks.filter((track) => track.type === 'text')
  const selected = state.project.clips.find((clip) => clip.id === state.selectedClipId)
  const preferred = textTrackId && texts.some((item) => item.id === textTrackId) ? textTrackId : null
  const track =
    trackId && texts.some((item) => item.id === trackId)
      ? trackId
      : preferred
        ? preferred
        : selected && texts.some((item) => item.id === selected.trackId)
          ? selected.trackId
          : (texts[0]?.id ?? 't1')
  const clip = makeTextClip(playhead, track)
  commit((project) => insertClip(project, clip))
  state.selectedClipId = clip.id
  emit()
}

export function createTextTrack() {
  commit(addTextTrack)
  const texts = state.project.tracks.filter((track) => track.type === 'text')
  textTrackId = texts[texts.length - 1]?.id ?? null
}

export function deleteTextTrack(trackId: string) {
  commit((project) => removeTextTrack(project, trackId))
}

export function toggleTrackDuck(trackId: string, duck: boolean) {
  commit((project) => setTrackDuck(project, trackId, duck))
}

export function liveTrackVolume(trackId: string, volume: number) {
  live((project) => setTrackVolume(project, trackId, volume))
}

export function placeMic(assetId: string, time: number) {
  const voice =
    state.project.tracks.find((track) => track.type === 'audio' && track.id === 'a1') ??
    state.project.tracks.find((track) => track.type === 'audio' && (track.name === 'קריינות' || track.name === 'Voiceover'))
  placeAsset(assetId, time, voice?.id ?? 'a1')
}

export function liveMaster(volume: number) {
  live((base) => setMasterVolume(base, volume))
}

export function liveSpeed(clipId: string, speed: number) {
  const clip = state.project.clips.find((item) => item.id === clipId)
  live((base) => setSpeed(base, clipId, speed, assetOf(clip?.assetId ?? null)))
}

export function liveKen(clipId: string, patch: Partial<KenBurns>) {
  live((base) => {
    const clip = base.clips.find((item) => item.id === clipId)
    if (!clip) return base
    return updateClip(base, clipId, { kenBurns: { ...clip.kenBurns, ...patch } })
  })
}

export function liveColor(clipId: string, patch: Partial<ColorGrade>) {
  live((base) => {
    const clip = base.clips.find((item) => item.id === clipId)
    if (!clip) return base
    return updateClip(base, clipId, { color: { ...clip.color, ...patch } })
  })
}

export function liveTransition(clipId: string, transition: Transition | null) {
  live((base) => setTransition(base, clipId, transition))
}

export function addVolumeKeyAtPlayhead() {
  const id = state.selectedClipId
  const clip = state.project.clips.find((item) => item.id === id)
  if (!id || !clip || clip.text) return
  commit((project) => upsertVolumeKey(project, id, playhead, clip.volume))
}

export function removeVolumeKeys(clipId: string) {
  commit((project) => clearVolumeKeys(project, clipId))
}

let clipboard: Clip[] = []

function selectionIds(): string[] {
  if (state.selectedClipIds.length) return state.selectedClipIds
  return state.selectedClipId ? [state.selectedClipId] : []
}

export function setLane(lane: KeyLane) {
  state.lane = lane
  emit()
}

export function setCaptionLanguage(language: CaptionLanguage) {
  state.captionLanguage = language
  emit()
}

export function setStatus(status: string | null) {
  state.status = status
  emit()
}

export function toggleRipple(ripple: boolean) {
  commit((project) => setRippleMode(project, ripple))
}

export function toggleTrackFlag(trackId: string, flag: 'locked' | 'muted' | 'solo' | 'hidden', value: boolean) {
  commit((project) => setTrackFlag(project, trackId, flag, value))
}

export function setDuck(patch: Partial<Pick<Project, 'duckAmount' | 'duckAttack' | 'duckRelease'>>) {
  live((project) => setDuckEnvelope(project, patch))
}

export function patchClip(clipId: string, patch: Partial<Clip>) {
  live((project) => updateClip(project, clipId, patch))
}

export function copySelection() {
  const ids = new Set(selectionIds())
  clipboard = state.project.clips.filter((clip) => ids.has(clip.id)).map((clip) => structuredClone(clip))
  state.status = clipboard.length ? t('status.copied', { count: clipboard.length }) : null
  emit()
}

export function pasteSelection() {
  if (!clipboard.length) return
  const pasted = pasteClips(state.project, clipboard, playhead)
  commit(() => pasted.project)
  state.selectedClipIds = pasted.ids
  state.selectedClipId = pasted.ids[0] ?? null
  emit()
}

export function groupSelection() {
  const ids = selectionIds()
  commit((project) => groupClips(project, ids))
}

export function ungroupSelection() {
  const ids = selectionIds()
  commit((project) => ungroupClips(project, ids))
}

export function moveLaneKey(clipId: string, fromTime: number, time: number, value: number) {
  const clip = state.project.clips.find((item) => item.id === clipId)
  if (!clip) return
  const lane = state.lane
  live((project) => {
    const current = project.clips.find((item) => item.id === clipId)
    if (!current) return project
    const without = {
      ...current,
      keys: {
        ...current.keys,
        [lane]: current.keys[lane].filter((key) => Math.abs(key.time - fromTime) > 0.001),
      },
      volumeKeys: lane === 'volume' ? current.volumeKeys.filter((key) => Math.abs(key.time - fromTime) > 0.001) : current.volumeKeys,
    }
    const cleared = { ...project, clips: project.clips.map((item) => (item.id === clipId ? without : item)) }
    const ease = current.keys[lane].find((key) => Math.abs(key.time - fromTime) < 0.001)?.ease ?? 'linear'
    return upsertLaneKey(cleared, clipId, lane, time, value, ease)
  })
}

export function addLaneKey(clipId: string, time: number, value: number) {
  commit((project) => upsertLaneKey(project, clipId, state.lane, time, value, 'linear'))
}

export function easeLane(ease: Ease) {
  const id = state.selectedClipId
  if (!id) return
  commit((project) => setLaneEase(project, id, state.lane, ease))
}

export function applyTemplate(kind: 'lower' | 'intro' | 'outro' | 'rect' | 'ellipse' | 'star' | 'watermark') {
  const asset = state.assets.find((item) => item.id === state.selectedAssetId && item.kind === 'image')
    ?? state.assets.find((item) => item.kind === 'image')
  commit((project) => {
    if (kind === 'lower') return addLowerThird(project, playhead)
    if (kind === 'intro') return addIntro(project)
    if (kind === 'outro') return addOutro(project)
    if (kind === 'watermark') {
      if (!asset) return project
      return addWatermark(project, asset, playhead)
    }
    const shape: ShapeKind = kind
    return addSticker(project, playhead, shape)
  })
}

export function importLutText(name: string, text: string) {
  const lut = parseCube(text, name.replace(/\.cube$/i, ''))
  if (!lut) {
    state.status = t('status.lutBad')
    emit()
    return
  }
  const clipId = state.selectedClipId
  commit((project) => {
    const withLut = addLut(project, lut)
    if (!clipId) return withLut
    return updateClip(withLut, clipId, { lutId: lut.id })
  })
  state.status = t('status.lutAdded', { name: lut.name })
  emit()
}

export function assignLut(lutId: string | null) {
  const id = state.selectedClipId
  if (!id) return
  commit((project) => updateClip(project, id, { lutId }))
}

export function importSrtText(text: string) {
  const cues = parseSrt(text)
  if (!cues.length) {
    state.status = t('status.srtEmpty')
    emit()
    return
  }
  const trackId = textTrackId ?? state.project.tracks.find((track) => track.type === 'text')?.id ?? 't1'
  commit((project) => {
    let next = project
    for (const cue of cues) {
      const clip = makeTextClip(cue.start, trackId)
      clip.duration = Math.max(0.2, cue.end - cue.start)
      if (clip.text) clip.text = { ...clip.text, content: cue.text, y: 0.86, fontSize: 54 }
      clip.words = evenWords(cue.text, clip.duration)
      next = insertClip(next, clip)
    }
    return next
  })
  state.status = t('status.srtImported', { count: cues.length })
  emit()
}

export function exportSrtFile() {
  const cues = state.project.clips
    .filter((clip) => clip.text)
    .sort((a, b) => a.start - b.start)
    .map((clip) => ({ start: clip.start, end: clip.start + clip.duration, text: clip.text?.content ?? '' }))
  const body = cuesToSrt(cues)
  const blob = new Blob([body], { type: 'application/x-subrip' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${state.project.name || 'retzef'}.srt`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export async function transcribeSelected() {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  if (!clip?.assetId) {
    state.status = t('status.pickAudio')
    emit()
    return
  }
  state.status = t('status.prepareAudio')
  emit()
  const buffer = await loadAudioBuffer(clip.assetId)
  if (!buffer) {
    state.status = t('status.noAudio')
    emit()
    return
  }
  const speed = clip.speed > 0 ? clip.speed : 1
  const offset = Math.max(0, Math.round(clip.inPoint * buffer.sampleRate))
  const length = Math.max(1, Math.round(clip.duration * speed * buffer.sampleRate))
  const channel = buffer.getChannelData(0)
  const slice = channel.slice(offset, Math.min(channel.length, offset + length))
  state.status = t('status.transcribing')
  emit()
  try {
    const cues = await transcribePcm(slice, buffer.sampleRate, state.captionLanguage)
    if (!cues.length) {
      state.status = t('status.noSpeech')
      emit()
      return
    }
    const trackId = textTrackId ?? state.project.tracks.find((track) => track.type === 'text')?.id ?? 't1'
    commit((project) => {
      let next = project
      for (const cue of cues) {
        const caption = makeTextClip(clip.start + cue.start / speed, trackId)
        caption.duration = Math.max(0.3, (cue.end - cue.start) / speed)
        if (caption.text) caption.text = { ...caption.text, content: cue.text, y: 0.86, fontSize: 54, plate: true }
        caption.words = evenWords(cue.text, caption.duration)
        next = insertClip(next, caption)
      }
      return next
    })
    state.status = t('status.captionsAdded', { count: cues.length })
    emit()
  } catch (error) {
    state.status = error instanceof Error ? error.message : t('status.transcribeFailed')
    emit()
  }
}

export async function jumpCutSelected() {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  if (!clip?.assetId) {
    state.status = t('status.pickAudio')
    emit()
    return
  }
  const buffer = await loadAudioBuffer(clip.assetId)
  if (!buffer) {
    state.status = t('status.noSilenceAudio')
    emit()
    return
  }
  const speed = clip.speed > 0 ? clip.speed : 1
  const offset = Math.max(0, Math.round(clip.inPoint * buffer.sampleRate))
  const length = Math.max(1, Math.round(clip.duration * speed * buffer.sampleRate))
  const channel = buffer.getChannelData(0)
  const slice = channel.subarray(offset, Math.min(channel.length, offset + length))
  const gaps = silentGaps(slice, buffer.sampleRate)
  if (!gaps.length) {
    state.status = t('status.noSilence')
    emit()
    return
  }
  const ranges = gaps.map((gap) => ({ start: gap.start / speed, end: gap.end / speed }))
  commit((project) => exciseLocalRanges(project, clip.id, ranges))
  state.status = t('status.silenceRemoved', { count: gaps.length })
  emit()
}

function selectedIds(): string[] {
  return state.selectedClipIds.length ? [...state.selectedClipIds] : state.selectedClipId ? [state.selectedClipId] : []
}

function projectSignature(project: Project): string {
  return `${project.name}|${project.clips.map((clip) => `${clip.id}:${clip.start.toFixed(2)}:${clip.duration.toFixed(2)}`).join(',')}`
}

export async function refreshVersions() {
  state.versions = await loadVersions()
  emit()
}

export async function rememberVersion(manual = false) {
  const versions = state.versions.length ? state.versions : await loadVersions()
  const signature = projectSignature(state.project)
  if (!manual && versions[0] && projectSignature(versions[0].project) === signature) {
    state.versions = versions
    return
  }
  const next: ProjectVersion = {
    id: crypto.randomUUID(),
    savedAt: Date.now(),
    name: state.project.name,
    project: structuredClone(state.project),
  }
  state.versions = [next, ...versions].slice(0, 12)
  await saveVersions(state.versions)
  if (manual) state.status = t('status.versionSaved')
  emit()
}

export function restoreVersion(id: string) {
  const version = state.versions.find((item) => item.id === id)
  if (!version) return
  const project = coerceProject(structuredClone(version.project))
  if (!project) return
  commit(() => project)
  state.status = t('status.versionRestored')
  emit()
}

export function setTrackArmed(armed: boolean) {
  state.trackArmed = armed
  state.status = armed ? t('status.trackHint') : null
  emit()
}

function note(message: string) {
  state.status = message
  emit()
}

export function markInAtPlayhead() {
  commit((project) => setMark(project, 'in', playhead))
  note(t('status.markIn'))
}

export function markOutAtPlayhead() {
  commit((project) => setMark(project, 'out', playhead))
  note(t('status.markOut'))
}

export function clearExportMarks() {
  commit((project) => clearMarks(project))
  note(t('status.rangeCleared'))
}

export function toggleLoop(loop: boolean) {
  commit((project) => ({ ...project, loopRegion: loop }))
}

export function setReviewRate(rate: ReviewRate) {
  if (!REVIEW_RATES.includes(rate)) return
  state.reviewRate = rate
  emit()
  if (playing) {
    runClock()
    emitTransport('seek')
  }
}

export function toggleGuides(show: boolean) {
  state.showGuides = show
  emit()
}

export function toggleGradeBypass(bypass: boolean) {
  state.gradeBypass = bypass
  emit()
}

export function toggleProgressBar(enabled: boolean) {
  commit((project) => ({ ...project, progressBar: enabled }))
}

export function toggleLetterbox(enabled: boolean) {
  commit((project) => ({ ...project, letterbox: enabled ? 0.12 : 0 }))
}

export function insertEndScreen() {
  commit((project) => addEndScreen(project))
  note(t('status.endScreen'))
}

export function jumpZoomTrack() {
  const before = state.project.clips.filter((clip) => clip.trackId === 'v1' && clip.assetId && !clip.text).length
  if (!before) {
    note(t('status.noVideo1'))
    return
  }
  commit((project) => applyJumpZoom(project, 'v1'))
  note(t('status.jumpZoom'))
}

export function fitMusicBed() {
  const bed = state.project.clips.find((clip) => clip.trackId === 'a2')
  if (!bed) {
    note(t('status.noMusic'))
    return
  }
  commit((project) => fitMusic(project, assetOf(bed.assetId)))
  note(t('status.musicFit'))
}

export function splitSelection(orientation: 'horizontal' | 'vertical') {
  const ids = selectedIds()
  if (ids.length < 2) {
    note(t('status.pickTwo'))
    return
  }
  commit((project) => applySplit(project, ids, orientation))
  note(orientation === 'vertical' ? t('status.splitVertical') : t('status.splitHorizontal'))
}

export function detachSelectedAudio() {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  if (!clip) {
    note(t('status.pickVideoAudio'))
    return
  }
  const asset = assetOf(clip.assetId)
  const next = detachAudio(state.project, clip.id, asset)
  if (next === state.project) {
    note(t('status.detachVideoOnly'))
    return
  }
  commit(() => next)
  note(t('status.detached'))
}

export function jCutSelected() {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  if (!clip) return
  const next = jCut(state.project, clip.id, assetOf(clip.assetId))
  if (next === state.project) {
    note(t('status.jcutNeed'))
    return
  }
  commit(() => next)
  note(t('status.jcutDone'))
}

export function lCutSelected() {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  if (!clip) return
  const next = lCut(state.project, clip.id, assetOf(clip.assetId))
  if (next === state.project) {
    note(t('status.lcutNeed'))
    return
  }
  commit(() => next)
  note(t('status.lcutDone'))
}

export function copyAttributes() {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  if (!clip) {
    note(t('status.pickCopy'))
    return
  }
  state.attributeClip = pickAttributes(clip)
  note(t('status.copiedAttr'))
  emit()
}

export function pasteAttributes() {
  const attributes = state.attributeClip
  const ids = selectedIds()
  if (!attributes || !ids.length) {
    note(t('status.pasteNeed'))
    return
  }
  commit((project) => applyAttributes(project, ids, attributes))
  note(t('status.pastedAttr'))
}

export function anchorCaption(anchor: CaptionAnchor) {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  if (!clip?.text) {
    note(t('status.pickCaptions'))
    return
  }
  commit((project) => placeCaption(project, clip.id, anchor))
}

export function rotateSelected() {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  if (!clip || clip.text) return
  commit((project) => updateClip(project, clip.id, { rotation: nextRotation(clip.rotation ?? 0) }))
}

export function toggleFlip(axis: 'h' | 'v') {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  if (!clip || clip.text) return
  commit((project) => updateClip(project, clip.id, axis === 'h' ? { flipH: !clip.flipH } : { flipV: !clip.flipV }))
}

export function applyLook(id: string) {
  const look = LOOKS.find((item) => item.id === id)
  const ids = selectedIds()
  if (!look || !ids.length) {
    state.status = t('status.pickLook')
    emit()
    return
  }
  commit((project) => ids.reduce((next, clipId) => updateClip(next, clipId, { color: { ...look.color } }), project))
}

export function reframeShorts() {
  setExportPreset('shorts')
  const picked = selectedIds().filter((id) => state.project.clips.some((clip) => clip.id === id && !clip.text))
  const targets = picked.length ? picked : state.project.clips.filter((clip) => !clip.text && (clip.assetId || clip.children?.length)).map((clip) => clip.id)
  commit((project) =>
    targets.reduce(
      (next, id) =>
        updateClip(next, id, {
          kenBurns: { scaleStart: 3.16, scaleEnd: 3.16, xStart: 0.5, yStart: 0.5, xEnd: 0.5, yEnd: 0.5 },
        }),
      project,
    ),
  )
  state.status = t('status.portrait')
  emit()
}

export function toggleReverse() {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  if (!clip?.assetId) {
    state.status = t('status.pickMediaReverse')
    emit()
    return
  }
  commit((project) => updateClip(project, clip.id, { reverse: !clip.reverse }))
}

export function setMask(mask: 'none' | 'ellipse' | 'vignette') {
  const id = state.selectedClipId
  if (!id) return
  commit((project) => updateClip(project, id, { mask }))
}

export function togglePortrait() {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  if (!clip?.assetId) return
  commit((project) => updateClip(project, clip.id, { portrait: !clip.portrait }))
}

export function addAdjustment() {
  const track = state.project.tracks.find((item) => item.type === 'video' && item.id === 'v2') ?? state.project.tracks.find((item) => item.type === 'video')
  if (!track) return
  const clip = makeAdjustmentClip(track.id, playhead)
  commit((project) => insertClip(project, clip))
  state.selectedClipId = clip.id
  state.selectedClipIds = [clip.id]
  emit()
}

export function setCaptionStyle(style: 'plain' | 'karaoke' | 'pop') {
  const textIds = state.project.clips.filter((clip) => clip.text).map((clip) => clip.id)
  const picked = selectedIds().filter((id) => textIds.includes(id))
  const ids = picked.length ? picked : textIds
  if (!ids.length) {
    state.status = t('status.noCaptions')
    emit()
    return
  }
  commit((project) =>
    ids.reduce((next, id) => {
      const clip = next.clips.find((item) => item.id === id)
      if (!clip?.text) return next
      return updateClip(next, id, {
        captionStyle: style,
        words: clip.words.length ? clip.words : evenWords(clip.text.content, clip.duration),
      })
    }, project),
  )
  state.status = style === 'karaoke' ? t('status.karaoke') : style === 'pop' ? t('status.pop') : t('status.plain')
  emit()
}

export function nestSelection() {
  const ids = selectedIds()
  const before = state.project.clips.length
  commit((project) => nestClips(project, ids))
  if (state.project.clips.length === before) state.status = t('status.sameTrack')
  emit()
}

export function unnestSelection() {
  const id = state.selectedClipId
  if (!id) return
  commit((project) => unnestClip(project, id))
}

export function downloadChapters() {
  const body = youtubeChapters(state.project.markers)
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${state.project.name || 'retzef'}-chapters.txt`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export async function markBeats() {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId && item.assetId)
  if (!clip?.assetId) {
    state.status = t('status.pickAudio')
    emit()
    return
  }
  const buffer = await loadAudioBuffer(clip.assetId)
  if (!buffer) {
    state.status = t('status.noBeatAudio')
    emit()
    return
  }
  const speed = clip.speed > 0 ? clip.speed : 1
  const offset = Math.max(0, Math.round(clip.inPoint * buffer.sampleRate))
  const length = Math.max(1, Math.round(clip.duration * speed * buffer.sampleRate))
  const channel = buffer.getChannelData(0).slice(offset, Math.min(buffer.length, offset + length))
  const beats = detectBeats(channel, buffer.sampleRate).map((time) => clip.start + time / speed)
  commit((project) => ({ ...project, beats }))
  state.status = beats.length ? t('status.beats', { count: beats.length }) : t('status.noBeats')
  emit()
}

export function clearBeats() {
  commit((project) => ({ ...project, beats: [] }))
}

export function cutWord(clipId: string, index: number) {
  commit((project) => deleteWord(project, clipId, index))
}

export function cutFillers() {
  const before = projectSignature(state.project)
  commit((project) => removeFillers(project))
  state.status = projectSignature(state.project) === before ? t('status.noFillers') : t('status.fillersRemoved')
  emit()
}

let grabPng: (() => Promise<Blob | null>) | null = null

export function registerPreviewGrab(grab: () => Promise<Blob | null>): () => void {
  grabPng = grab
  return () => {
    if (grabPng === grab) grabPng = null
  }
}

export async function freezeFrame() {
  const blob = await grabPng?.()
  if (!blob) {
    state.status = t('status.noFrame')
    emit()
    return
  }
  const file = new File([blob], t('status.frameFile'), { type: 'image/png' })
  const created = await importFiles([file])
  const asset = created[0]
  if (!asset) return
  const trackId = preferredTrack(state.project, 'image', playhead, 2)
  let placed: string | null = null
  commit((project) => {
    const clip = makeMediaClip(asset, trackId, playhead)
    clip.duration = 2
    placed = clip.id
    return insertClip(project, clip)
  })
  if (placed) {
    state.selectedClipId = placed
    state.selectedClipIds = [placed]
  }
  state.status = t('status.freezeAdded')
  emit()
}

export function applyMotion(clipId: string, points: { time: number; x: number; y: number }[]) {
  commit((project) => setMotionKeys(project, clipId, points))
  state.trackArmed = false
  state.status = t('status.textTrackSaved')
  emit()
}

export function nudgeSelectedClip(delta: number) {
  const id = state.selectedClipId
  if (!id) {
    seek(playhead + delta)
    return
  }
  const clip = state.project.clips.find((item) => item.id === id)
  if (!clip) return
  commit((project) => moveClip(project, id, clip.start + delta, clip.trackId, [], 0, assetMap()))
}

export function rippleSelectedClip() {
  const ids = state.selectedClipIds.length ? [...state.selectedClipIds] : state.selectedClipId ? [state.selectedClipId] : []
  if (!ids.length) return
  commit((project) => deleteClips(project, ids, true))
}

export function placeMarker() {
  commit((project) => addMarker(project, playhead))
}

export function deleteSelectedMarker() {
  if (!state.selectedMarkerId) return
  const id = state.selectedMarkerId
  state.selectedMarkerId = null
  commit((project) => removeMarker(project, id))
}

export function removeSelectedClip() {
  const ids = state.selectedClipIds.length ? [...state.selectedClipIds] : state.selectedClipId ? [state.selectedClipId] : []
  if (!ids.length) return
  commit((project) => (project.ripple ? deleteClips(project, ids, true) : deleteClips(project, ids, false)))
}

export function splitAtPlayhead() {
  const time = playhead
  const selected = state.project.clips.find((clip) => clip.id === state.selectedClipId)
  const targets =
    selected && clipsTouching({ ...state.project, clips: [selected] }, time).length
      ? [selected.id]
      : clipsTouching(state.project, time).map((clip) => clip.id)
  if (!targets.length) return
  let created: string | null = null
  commit((project) => {
    let next = project
    for (const id of targets) {
      const result = splitClip(next, id, time)
      if (!result) continue
      next = result.project
      created = result.newId
    }
    return next
  })
  if (created) state.selectedClipId = created
  emit()
}

export function nudgeClip(clipId: string, start: number, trackId: string) {
  const points = state.snap ? snapPoints(state.project, playhead, clipId) : []
  const threshold = state.snap ? 10 / state.pps : 0
  const companions = state.selectedClipIds.includes(clipId) ? state.selectedClipIds : []
  live((base) => moveClip(base, clipId, start, trackId, points, threshold, assetMap(), companions))
}

export function nudgeTrim(clipId: string, edge: 'start' | 'end', time: number) {
  const clip = state.project.clips.find((item) => item.id === clipId)
  const points = state.snap ? snapPoints(state.project, playhead, clipId) : []
  const threshold = state.snap ? 10 / state.pps : 0
  live((base) => trimClip(base, clipId, edge, time, assetOf(clip?.assetId ?? null), points, threshold))
}

export function commitClipStart(clipId: string, start: number) {
  const clip = state.project.clips.find((item) => item.id === clipId)
  commit((project) => setClipStart(project, clipId, start, assetOf(clip?.assetId ?? null)))
}

export function commitClipEnd(clipId: string, end: number) {
  const clip = state.project.clips.find((item) => item.id === clipId)
  commit((project) => setClipEnd(project, clipId, end, assetOf(clip?.assetId ?? null)))
}

export function liveVolume(clipId: string, volume: number) {
  live((base) => updateClip(base, clipId, { volume }))
}

export function liveFade(clipId: string, edge: 'fadeIn' | 'fadeOut', value: number) {
  live((base) => updateClip(base, clipId, { [edge]: value }))
}

export function liveText(clipId: string, patch: Partial<TextStyle>) {
  live((base) => updateText(base, clipId, patch))
}

export async function importFiles(files: File[]): Promise<Asset[]> {
  state.importError = null
  emit()
  const created: Asset[] = []
  for (const file of files) {
    try {
      const probed = await probeFile(file)
      const asset: Asset = {
        id: crypto.randomUUID(),
        name: probed.name,
        kind: probed.kind,
        duration: probed.duration,
        width: probed.width,
        height: probed.height,
        hasAudio: probed.hasAudio,
        peaks: [],
        thumbnail: null,
        mime: probed.mime,
      }
      putBlob(asset.id, probed.blob)
      await saveAsset(asset, probed.blob)
      state.assets = [...state.assets, asset]
      state.selectedAssetId = asset.id
      created.push(asset)
      emit()
      void enrichAsset(asset.id)
    } catch (error) {
      state.importError = error instanceof Error ? error.message : t('status.importFailed')
      emit()
    }
  }
  return created
}

async function enrichAsset(id: string) {
  const asset = state.assets.find((item) => item.id === id)
  const blob = getBlob(id)
  const url = getUrl(id)
  if (!asset || !blob) return
  let thumbnail: string | null = null
  if (asset.kind === 'video' && url) thumbnail = await captureVideoThumbnail(url)
  if (asset.kind === 'image') thumbnail = await captureImageThumbnail(blob)
  let peaks: number[] = []
  if (asset.hasAudio) {
    try {
      peaks = await peakEnvelope(id)
    } catch {
      peaks = []
    }
  }
  const current = state.assets.find((item) => item.id === id)
  if (!current) return
  const next = { ...current, thumbnail, peaks }
  state.assets = state.assets.map((item) => (item.id === id ? next : item))
  const stored = getBlob(id)
  if (stored) await saveAsset(next, stored)
  emit()
}

export async function loadSampleMedia(): Promise<void> {
  const samples: { url: string; name: string; type: string }[] = [
    { url: '/samples/demo-video.mp4', name: t('content.sampleVideo'), type: 'video/mp4' },
    { url: '/samples/demo-music.mp3', name: t('content.sampleMusic'), type: 'audio/mpeg' },
    { url: '/samples/demo-still.png', name: t('content.sampleImage'), type: 'image/png' },
  ]
  const files: File[] = []
  for (const sample of samples) {
    const response = await fetch(sample.url)
    if (!response.ok) throw new Error(t('error.sampleLoad'))
    const blob = await response.blob()
    files.push(new File([blob], sample.name, { type: sample.type || blob.type }))
  }
  await importFiles(files)
}

export async function removeAsset(assetId: string) {
  const asset = state.assets.find((item) => item.id === assetId)
  if (asset) shelf.set(assetId, asset)
  commit((project) => deleteClipsForAsset(project, assetId))
  state.assets = state.assets.filter((item) => item.id !== assetId)
  if (state.selectedAssetId === assetId) state.selectedAssetId = null
  await deleteStoredAsset(assetId, false)
  syncShelf()
  emit()
}

export function downloadProjectFile() {
  const payload = {
    format: 'retzef' as const,
    version: 1 as const,
    project: state.project,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const safe = state.project.name.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim() || 'retzef'
  link.href = url
  link.download = `${safe}.retzef.json`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function safeName(name: string, fallback: string): string {
  return name.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim() || fallback
}

export async function downloadProjectPackage() {
  const bytes = await packProject(state.project, state.assets)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  saveBlob(`${safeName(state.project.name, 'retzef')}.retzef.zip`, new Blob([copy], { type: 'application/zip' }))
}

export async function loadProjectPackage(file: File) {
  try {
    const unpacked = await unpackProject(file)
    history.past.push(state.project)
    history.future = []
    state.project = unpacked.project
    const incoming = new Map(state.assets.map((asset) => [asset.id, asset]))
    for (const item of unpacked.assets) {
      putBlob(item.asset.id, item.blob)
      shelf.set(item.asset.id, item.asset)
      incoming.set(item.asset.id, item.asset)
      await saveAsset(item.asset, item.blob)
      void enrichAsset(item.asset.id)
    }
    state.assets = [...incoming.values()]
    state.selectedClipId = null
    state.selectedMarkerId = null
    state.importError = null
    syncShelf()
    touchHistory()
    scheduleSave()
    emit()
  } catch (error) {
    state.importError = error instanceof Error ? error.message : t('status.packageFailed')
    emit()
  }
}

export async function loadAnyProjectFile(file: File) {
  if (file.name.endsWith('.zip') || file.type === 'application/zip') {
    await loadProjectPackage(file)
    return
  }
  await loadProjectFile(file)
}

let frameGrab: (() => void) | null = null

export function registerFrameGrab(grab: () => void): () => void {
  frameGrab = grab
  return () => {
    if (frameGrab === grab) frameGrab = null
  }
}

export function downloadThumbnail() {
  frameGrab?.()
}

export async function loadProjectFile(file: File) {
  try {
    const parsed = await readProjectFile(file)
    const project = coerceProject(parsed)
    if (!project) throw new Error(t('error.badProject'))
    history.past.push(state.project)
    history.future = []
    state.project = project
    state.selectedClipId = null
    state.importError = null
    touchHistory()
    scheduleSave()
    emit()
  } catch (error) {
    state.importError = error instanceof Error ? error.message : t('status.projectLoadFailed')
    emit()
  }
}

let initOnce: Promise<void> | null = null

export function initEditor(): Promise<void> {
  if (!initOnce) initOnce = boot()
  return initOnce
}

async function boot() {
  try {
    const [records, project] = await Promise.all([loadStoredAssets(), loadStoredProject()])
    const loaded: Asset[] = []
    for (const record of records) {
      const { blob, ...asset } = record
      putBlob(asset.id, blob)
      loaded.push({
        ...asset,
        mime: asset.mime || blob.type || '',
        peaks: asset.peaks ?? [],
        thumbnail: asset.thumbnail ?? null,
      })
    }
    state.assets = loaded
    if (project) state.project = project
  } catch (error) {
    state.importError = error instanceof Error ? error.message : t('status.localLoadFailed')
  }
  state.shortcuts = readShortcutSettings()
  state.ready = true
  touchHistory()
  emit()
  void loadStudioSettings()
  void loadVersions()
    .then((versions) => {
      state.versions = versions
      emit()
    })
    .catch(() => undefined)
  window.setInterval(() => {
    if (state.ready) void rememberVersion(false)
  }, 120_000)
}

async function loadStudioSettings(): Promise<void> {
  try {
    const [templates, recent] = await Promise.all([loadKv<unknown[]>('user-templates'), listRecentFolders()])
    state.templates = Array.isArray(templates)
      ? templates.flatMap((item) => {
          const parsed = parseTemplateDocument(item)
          return parsed ? [parsed] : []
        })
      : []
    state.recentFolders = recent
    state.folderName = linkedFolder()?.name ?? null
    emit()
  } catch {
    /* settings stay empty */
  }
}

function assetBlobs(): Map<string, Blob> {
  const blobs = new Map<string, Blob>()
  for (const asset of state.assets) {
    const blob = getBlob(asset.id)
    if (blob) blobs.set(asset.id, blob)
  }
  return blobs
}

function installLoaded(project: Project, assets: { asset: Asset; blob: Blob }[], status: string) {
  history.past.push(state.project)
  if (history.past.length > 80) history.past.shift()
  history.future = []
  for (const item of assets) {
    putBlob(item.asset.id, item.blob)
    void saveAsset(item.asset, item.blob)
  }
  const ids = new Set(assets.map((item) => item.asset.id))
  state.assets = [...state.assets.filter((asset) => !ids.has(asset.id)), ...assets.map((item) => item.asset)]
  state.project = project
  state.selectedClipId = null
  state.selectedClipIds = []
  state.importError = null
  state.status = status
  touchHistory()
  scheduleSave()
  emit()
}

function noteFolderError(error: unknown, unsupported: string) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    state.status = t('status.folderCancelled')
  } else if (!directoryPickerSupported()) {
    state.status = unsupported
  } else {
    state.status = error instanceof Error ? error.message : t('status.folderFailed')
  }
  emit()
}

export function setFolderOpen(open: boolean) {
  state.folderOpen = open
  if (open) void loadStudioSettings()
  emit()
}

export function setTemplateOpen(open: boolean) {
  state.templateOpen = open
  emit()
}

export function setLanguage(language: Language) {
  setI18nLanguage(language)
  state.language = getLanguage()
  state.status = null
  emit()
}

export function setSettingsOpen(open: boolean) {
  state.settingsOpen = open
  emit()
}

export function setShortcutOpen(open: boolean) {
  state.shortcutOpen = open
  state.shortcutCapture = false
  emit()
}

export function setShortcutCapture(active: boolean) {
  state.shortcutCapture = active
  emit()
}

export async function saveActiveProject(): Promise<void> {
  if (!linkedFolder()) {
    downloadProjectFile()
    return
  }
  try {
    await autosaveLinkedFolder(state.project, state.assets, assetBlobs())
    state.status = t('status.savedFolder')
  } catch (error) {
    noteFolderError(error, t('status.folderUnsupportedSave'))
  }
  emit()
}

export async function saveProjectToFolder(): Promise<void> {
  try {
    const link = await chooseProjectFolder(state.project, state.assets, assetBlobs())
    state.folderName = link.name
    state.status = t('status.savedFolder')
    state.recentFolders = await listRecentFolders()
    emit()
  } catch (error) {
    noteFolderError(error, t('status.folderUnsupportedSave'))
  }
}

export async function openFolderProject(): Promise<void> {
  try {
    const loaded = await openProjectFolder()
    state.folderName = loaded.link.name
    installLoaded(loaded.project, loaded.assets, t('status.openedFolder'))
    state.recentFolders = await listRecentFolders()
    emit()
  } catch (error) {
    noteFolderError(error, t('status.folderUnsupportedOpen'))
  }
}

export async function openRecentFolder(id: string): Promise<void> {
  try {
    const loaded = await reopenRecentFolder(id)
    state.folderName = loaded.link.name
    installLoaded(loaded.project, loaded.assets, t('status.openedRecent'))
    state.recentFolders = await listRecentFolders()
    emit()
  } catch (error) {
    noteFolderError(error, t('status.folderUnsupportedOpen'))
  }
}

async function persistTemplates(templates: UserTemplate[]) {
  state.templates = templates
  await saveKv('user-templates', templates)
  emit()
}

export async function saveCurrentTemplate(name: string, parts: TemplatePart[]): Promise<void> {
  if (!parts.length) {
    state.status = t('status.pickParts')
    emit()
    return
  }
  const template = captureTemplate({ name, project: state.project, preset: state.exportPreset, parts })
  await persistTemplates([template, ...state.templates].slice(0, 40))
  state.status = t('status.templateSaved', { name: template.name })
  emit()
}

export async function renameStoredTemplate(id: string, name: string): Promise<void> {
  await persistTemplates(renameTemplate(state.templates, id, name))
}

export async function deleteStoredTemplate(id: string): Promise<void> {
  await persistTemplates(deleteTemplate(state.templates, id))
  state.status = t('status.templateDeleted')
  emit()
}

export function applyStoredTemplate(id: string) {
  const template = state.templates.find((item) => item.id === id)
  if (!template) return
  const created = projectFromTemplate(template)
  history.past.push(state.project)
  if (history.past.length > 80) history.past.shift()
  history.future = []
  state.project = created.project
  state.selectedClipId = null
  state.selectedClipIds = []
  if (created.preset) state.exportPreset = created.preset
  state.status = t('status.templateProject')
  touchHistory()
  scheduleSave()
  emit()
}

export function importTemplateText(text: string) {
  const template = parseTemplateDocument(JSON.parse(text) as unknown)
  if (!template) throw new Error(t('error.badTemplate'))
  template.id = crypto.randomUUID()
  void persistTemplates([template, ...state.templates].slice(0, 40))
  state.status = t('status.templateImported', { name: template.name })
  emit()
}

export function applyShortcutBindings(bindings: Bindings) {
  state.shortcuts = cloneBindings(bindings)
  writeShortcutSettings(state.shortcuts)
  state.shortcutCapture = false
  emit()
}

export function resetShortcutBindings() {
  applyShortcutBindings(cloneBindings(DEFAULT_SHORTCUTS))
  state.status = t('status.shortcutsReset')
  emit()
}

export function importShortcutText(text: string): boolean {
  const bindings = parseShortcutDocument(text)
  if (!bindings) return false
  applyShortcutBindings(bindings)
  state.status = t('status.shortcutsImported')
  emit()
  return true
}

export function shortcutFileText(): string {
  return shortcutDocument(state.shortcuts)
}

let exportAbort: AbortController | null = null
let exportObjectUrl: string | null = null

export function cancelExport() {
  exportAbort?.abort()
}

export function dismissExportResult() {
  if (exportObjectUrl) URL.revokeObjectURL(exportObjectUrl)
  exportObjectUrl = null
  state.exportJob = null
  emit()
}

export async function beginExport(): Promise<void> {
  if (state.exportJob?.running) return
  const project = structuredClone(state.project)
  const assets = state.assets.map((asset) => ({ ...asset }))
  const blobs = assetBlobs()
  if (exportObjectUrl) URL.revokeObjectURL(exportObjectUrl)
  exportObjectUrl = null
  const controller = new AbortController()
  exportAbort = controller
  state.exportJob = { running: true, ratio: 0, label: t('status.exportReady'), speed: 0, error: null, resultUrl: null, resultSize: 0, savedToDisk: false }
  emit()
  const safe = project.name.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim() || 'retzef'
  let stream: Awaited<ReturnType<typeof pickMp4Stream>> = null
  try {
    stream = await pickMp4Stream(`${safe}.mp4`)
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') {
      state.exportJob = { ...state.exportJob, running: false, label: t('status.exportCancelled') }
      emit()
      return
    }
    stream = null
  }
  if (controller.signal.aborted) return
  try {
    const result = await exportProject(
      project,
      assets,
      (progress) => {
        if (!state.exportJob || exportAbort !== controller) return
        state.exportJob = { ...state.exportJob, ratio: progress.ratio, label: progress.label, speed: progress.speed }
        emit()
      },
      controller.signal,
      { preset: state.exportPreset, stream, blobs },
    )
    if (result.blob) {
      exportObjectUrl = URL.createObjectURL(result.blob)
      const link = document.createElement('a')
      link.href = exportObjectUrl
      link.download = `${safe}.mp4`
      link.click()
      state.exportJob = {
        running: false,
        ratio: 1,
        label: t('status.fileReady'),
        speed: state.exportJob?.speed ?? 0,
        error: null,
        resultUrl: exportObjectUrl,
        resultSize: result.blob.size,
        savedToDisk: false,
      }
    } else {
      state.exportJob = {
        running: false,
        ratio: 1,
        label: t('status.fileSaved'),
        speed: state.exportJob?.speed ?? 0,
        error: null,
        resultUrl: null,
        resultSize: 0,
        savedToDisk: true,
      }
    }
  } catch (caught) {
    if (!state.exportJob) return
    const aborted = caught instanceof DOMException && caught.name === 'AbortError'
    state.exportJob = {
      ...state.exportJob,
      running: false,
      error: aborted ? t('status.exportCancelled') : caught instanceof Error ? caught.message : t('status.exportFailed'),
      label: aborted ? t('status.exportCancelled') : state.exportJob.label,
    }
  } finally {
    if (exportAbort === controller) exportAbort = null
    emit()
  }
}

let playhead = 0
let playing = false
let raf = 0
let clockPerf = 0
let clockPlayhead = 0

const frameListeners = new Set<(time: number) => void>()
const transportListeners = new Set<(event: 'play' | 'pause' | 'seek') => void>()
const playingListeners = new Set<() => void>()

function emitFrame() {
  frameListeners.forEach((listener) => listener(playhead))
}

function emitTransport(event: 'play' | 'pause' | 'seek') {
  transportListeners.forEach((listener) => listener(event))
}

function emitPlaying() {
  playingListeners.forEach((listener) => listener())
}

export function getPlayhead(): number {
  return playhead
}

export function isPlaying(): boolean {
  return playing
}

export function subscribeFrames(listener: (time: number) => void): () => void {
  frameListeners.add(listener)
  return () => frameListeners.delete(listener)
}

export function onTransport(listener: (event: 'play' | 'pause' | 'seek') => void): () => void {
  transportListeners.add(listener)
  return () => transportListeners.delete(listener)
}

export function subscribePlaying(listener: () => void): () => void {
  playingListeners.add(listener)
  return () => playingListeners.delete(listener)
}

function stopClock() {
  cancelAnimationFrame(raf)
}

function runClock() {
  stopClock()
  clockPerf = performance.now()
  clockPlayhead = playhead
  const tick = (now: number) => {
    if (!playing) return
    const limit = projectDuration(state.project)
    const rate = state.reviewRate || 1
    const next = clockPlayhead + ((now - clockPerf) / 1000) * rate
    const loop = loopBounds(state.project)
    if (loop && next >= loop.end - 1e-4) {
      playhead = loop.start
      clockPlayhead = loop.start
      clockPerf = now
      emitFrame()
      emitTransport('seek')
      raf = requestAnimationFrame(tick)
      return
    }
    if (limit > 0 && next >= limit - 1e-4) {
      playhead = limit
      playing = false
      emitPlaying()
      emitFrame()
      emitTransport('pause')
      return
    }
    playhead = next
    emitFrame()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

export function seek(time: number) {
  const limit = Math.max(projectDuration(state.project) + 20, 60)
  playhead = Math.min(Math.max(0, time), limit)
  if (playing) runClock()
  emitFrame()
  emitTransport('seek')
}

export function pause() {
  if (!playing) return
  playing = false
  stopClock()
  emitPlaying()
  emitTransport('pause')
}

export function play() {
  const duration = projectDuration(state.project)
  if (duration <= 0) return
  const loop = loopBounds(state.project)
  if (loop) {
    if (playhead < loop.start || playhead >= loop.end - frameDuration()) playhead = loop.start
  } else if (playhead >= duration - frameDuration()) playhead = 0
  if (playing) return
  playing = true
  emitPlaying()
  emitTransport('play')
  runClock()
}

export function togglePlay() {
  if (playing) pause()
  else play()
}

function frameDuration(): number {
  return 1 / presetById(state.exportPreset).fps
}

export function stepFrames(frames: number) {
  seek(playhead + frames * frameDuration())
}
