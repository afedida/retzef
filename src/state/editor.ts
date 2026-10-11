import { loadAudioBuffer, peakEnvelope, forgetAudio } from '@/lib/audio'
import { transcribePcm } from '@/lib/captions'
import { dropBlob, getBlob, getUrl, putBlob } from '@/lib/blobs'
import { deleteStoredAsset, loadStoredAssets, loadStoredProject, saveAsset, saveProject } from '@/lib/db'
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
  exciseLocalRanges,
  groupClips,
  insertClip,
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
  setTransition,
  snapPoints,
  splitClip,
  trimClip,
  ungroupClips,
  updateClip,
  updateText,
  upsertLaneKey,
  upsertVolumeKey,
} from '@/lib/edit'
import { parseCube } from '@/lib/lut'
import { cuesToSrt, parseSrt } from '@/lib/srt'
import { addIntro, addLowerThird, addOutro, addSticker, addWatermark } from '@/lib/templates'
import { silentGaps } from '@/lib/vad'
import { captureImageThumbnail, captureVideoThumbnail, probeFile, readProjectFile } from '@/lib/media'
import { packProject, unpackProject } from '@/lib/package'
import { presetById, type Asset, type CaptionLanguage, type Clip, type Ease, type ExportPresetId, type KenBurns, type ColorGrade, type KeyLane, type Project, type ShapeKind, type TextStyle, type Transition } from '@/types'

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
  if (open) pause()
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
  state.status = clipboard.length ? `הועתקו ${clipboard.length} קליפים` : null
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
    state.status = 'קובץ ה-LUT לא נקרא'
    emit()
    return
  }
  const clipId = state.selectedClipId
  commit((project) => {
    const withLut = addLut(project, lut)
    if (!clipId) return withLut
    return updateClip(withLut, clipId, { lutId: lut.id })
  })
  state.status = `LUT ${lut.name} נוסף`
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
    state.status = 'קובץ ה-SRT ריק'
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
      next = insertClip(next, clip)
    }
    return next
  })
  state.status = `יובאו ${cues.length} כתוביות`
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
    state.status = 'בחרו קליפ עם שמע'
    emit()
    return
  }
  state.status = 'מכין שמע לתמלול…'
  emit()
  const buffer = await loadAudioBuffer(clip.assetId)
  if (!buffer) {
    state.status = 'אין שמע בקליפ'
    emit()
    return
  }
  const speed = clip.speed > 0 ? clip.speed : 1
  const offset = Math.max(0, Math.round(clip.inPoint * buffer.sampleRate))
  const length = Math.max(1, Math.round(clip.duration * speed * buffer.sampleRate))
  const channel = buffer.getChannelData(0)
  const slice = channel.slice(offset, Math.min(channel.length, offset + length))
  state.status = 'מוריד מודל וממלל…'
  emit()
  try {
    const cues = await transcribePcm(slice, buffer.sampleRate, state.captionLanguage)
    if (!cues.length) {
      state.status = 'לא זוהה דיבור'
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
        next = insertClip(next, caption)
      }
      return next
    })
    state.status = `נוספו ${cues.length} כתוביות`
    emit()
  } catch (error) {
    state.status = error instanceof Error ? error.message : 'התמלול נכשל'
    emit()
  }
}

export async function jumpCutSelected() {
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId)
  if (!clip?.assetId) {
    state.status = 'בחרו קליפ עם שמע'
    emit()
    return
  }
  const buffer = await loadAudioBuffer(clip.assetId)
  if (!buffer) {
    state.status = 'אין שמע לזיהוי שתיקה'
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
    state.status = 'לא נמצאו שתיקות'
    emit()
    return
  }
  const ranges = gaps.map((gap) => ({ start: gap.start / speed, end: gap.end / speed }))
  commit((project) => exciseLocalRanges(project, clip.id, ranges))
  state.status = `הוסרו ${gaps.length} קטעי שתיקה`
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
      state.importError = error instanceof Error ? error.message : 'הייבוא נכשל'
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
    { url: '/samples/demo-video.mp4', name: 'סרטון-דוגמה.mp4', type: 'video/mp4' },
    { url: '/samples/demo-music.mp3', name: 'מוזיקה-דוגמה.mp3', type: 'audio/mpeg' },
    { url: '/samples/demo-still.png', name: 'תמונה-דוגמה.png', type: 'image/png' },
  ]
  const files: File[] = []
  for (const sample of samples) {
    const response = await fetch(sample.url)
    if (!response.ok) throw new Error('לא הצלחתי לטעון את מדיית הדוגמה')
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
    state.importError = error instanceof Error ? error.message : 'טעינת החבילה נכשלה'
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
    if (!project) throw new Error('קובץ הפרויקט לא תקין')
    history.past.push(state.project)
    history.future = []
    state.project = project
    state.selectedClipId = null
    state.importError = null
    touchHistory()
    scheduleSave()
    emit()
  } catch (error) {
    state.importError = error instanceof Error ? error.message : 'טעינת הפרויקט נכשלה'
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
    state.importError = error instanceof Error ? error.message : 'טעינת השמירה המקומית נכשלה'
  }
  state.ready = true
  touchHistory()
  emit()
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
    const next = clockPlayhead + (now - clockPerf) / 1000
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
  if (playhead >= duration - frameDuration()) playhead = 0
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
