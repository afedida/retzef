import { forgetAudio, peakEnvelope } from '@/lib/audio'
import { getBlob, getUrl, putBlob } from '@/lib/blobs'
import { deleteStoredAsset, loadStoredAssets, loadStoredProject, saveAsset, saveProject } from '@/lib/db'
import {
  blankProject,
  clipsTouching,
  coerceProject,
  deleteClip,
  deleteClipsForAsset,
  insertClip,
  makeMediaClip,
  makeTextClip,
  moveClip,
  preferredTrack,
  projectDuration,
  setClipEnd,
  setClipStart,
  snapPoints,
  splitClip,
  trimClip,
  updateClip,
  updateText,
} from '@/lib/edit'
import { captureImageThumbnail, captureVideoThumbnail, probeFile, readProjectFile } from '@/lib/media'
import { OUTPUT_FPS, type Asset, type Project, type TextStyle } from '@/types'

export type EditorState = {
  ready: boolean
  project: Project
  assets: Asset[]
  selectedClipId: string | null
  selectedAssetId: string | null
  snap: boolean
  pps: number
  importError: string | null
  exportOpen: boolean
  canUndo: boolean
  canRedo: boolean
}

const history = {
  past: [] as Project[],
  future: [] as Project[],
}

let gestureBase: Project | null = null
let saveTimer = 0

const state: EditorState = {
  ready: false,
  project: blankProject(),
  assets: [],
  selectedClipId: null,
  selectedAssetId: null,
  snap: true,
  pps: 72,
  importError: null,
  exportOpen: false,
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

function commit(mutator: (project: Project) => Project) {
  endGesture()
  const previous = state.project
  const next = mutator(previous)
  if (next === previous) return
  history.past.push(previous)
  if (history.past.length > 80) history.past.shift()
  history.future = []
  state.project = next
  if (state.selectedClipId && !next.clips.some((clip) => clip.id === state.selectedClipId)) {
    state.selectedClipId = null
  }
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
  touchHistory()
  scheduleSave()
  emit()
}

export function selectClip(id: string | null) {
  state.selectedClipId = id
  const clip = state.project.clips.find((item) => item.id === id)
  state.selectedAssetId = clip?.assetId ?? state.selectedAssetId
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

export function addTextClip() {
  const clip = makeTextClip(playhead)
  commit((project) => insertClip(project, clip))
  state.selectedClipId = clip.id
  emit()
}

export function removeSelectedClip() {
  if (!state.selectedClipId) return
  const id = state.selectedClipId
  commit((project) => deleteClip(project, id))
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
  live((base) => moveClip(base, clipId, start, trackId, points, threshold, assetMap()))
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
  commit((project) => deleteClipsForAsset(project, assetId))
  state.assets = state.assets.filter((asset) => asset.id !== assetId)
  if (state.selectedAssetId === assetId) state.selectedAssetId = null
  forgetAudio(assetId)
  await deleteStoredAsset(assetId)
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
      loaded.push(asset)
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
  if (playhead >= duration - 1 / OUTPUT_FPS) playhead = 0
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

export function stepFrames(frames: number) {
  seek(playhead + frames / OUTPUT_FPS)
}
