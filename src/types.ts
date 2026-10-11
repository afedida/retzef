export const OUTPUT_WIDTH = 1920
export const OUTPUT_HEIGHT = 1080
export const OUTPUT_FPS = 30
export const VIDEO_BITRATE = 8_000_000
export const AUDIO_BITRATE = 192_000
export const MIN_CLIP = 0.1
export const MIN_SPEED = 0.25
export const MAX_SPEED = 4

export type MediaKind = 'video' | 'audio' | 'image'
export type TrackType = 'video' | 'audio' | 'text'
export type TextFont = 'heebo' | 'rubik' | 'assistant' | 'frank'
export type TextAlign = 'start' | 'center' | 'end'
export type TextAnimation = 'none' | 'fade' | 'slide'
export type TransitionKind = 'crossfade' | 'dip' | 'slide'

export type ExportPresetId = '1080p30' | '1080p60' | '720p30' | 'shorts'

export type ExportPreset = {
  id: ExportPresetId
  label: string
  width: number
  height: number
  fps: number
  videoBitrate: number
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: '1080p30', label: '1080p 30', width: 1920, height: 1080, fps: 30, videoBitrate: 8_000_000 },
  { id: '1080p60', label: '1080p 60', width: 1920, height: 1080, fps: 60, videoBitrate: 12_000_000 },
  { id: '720p30', label: '720p 30', width: 1280, height: 720, fps: 30, videoBitrate: 5_000_000 },
  { id: 'shorts', label: 'Shorts 9:16', width: 1080, height: 1920, fps: 30, videoBitrate: 8_000_000 },
]

export function presetById(id: ExportPresetId): ExportPreset {
  return EXPORT_PRESETS.find((preset) => preset.id === id) ?? EXPORT_PRESETS[0]!
}

export type Asset = {
  id: string
  name: string
  kind: MediaKind
  duration: number
  width: number
  height: number
  hasAudio: boolean
  peaks: number[]
  thumbnail: string | null
  mime: string
}

export type TextStyle = {
  content: string
  fontSize: number
  color: string
  x: number
  y: number
  font: TextFont
  align: TextAlign
  stroke: boolean
  shadow: boolean
  plate: boolean
  animation: TextAnimation
  animDuration: number
}

export type Transition = {
  kind: TransitionKind
  duration: number
}

export type KenBurns = {
  scaleStart: number
  scaleEnd: number
  xStart: number
  yStart: number
  xEnd: number
  yEnd: number
}

export type ColorGrade = {
  brightness: number
  contrast: number
  saturation: number
}

export type VolumeKeyframe = {
  time: number
  value: number
}

export type Clip = {
  id: string
  trackId: string
  assetId: string | null
  start: number
  duration: number
  inPoint: number
  volume: number
  fadeIn: number
  fadeOut: number
  text: TextStyle | null
  speed: number
  transition: Transition | null
  volumeKeys: VolumeKeyframe[]
  kenBurns: KenBurns
  color: ColorGrade
}

export type Track = {
  id: string
  type: TrackType
  name: string
  duck: boolean
}

export type Marker = {
  id: string
  time: number
  label: string
}

export type Project = {
  version: 1
  id: string
  name: string
  tracks: Track[]
  clips: Clip[]
  markers: Marker[]
  masterVolume: number
}

export const DEFAULT_KEN: KenBurns = {
  scaleStart: 1,
  scaleEnd: 1,
  xStart: 0.5,
  yStart: 0.5,
  xEnd: 0.5,
  yEnd: 0.5,
}

export const DEFAULT_COLOR: ColorGrade = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
}

export const DEFAULT_TRACKS: Track[] = [
  { id: 'v2', type: 'video', name: 'וידאו 2', duck: false },
  { id: 'v1', type: 'video', name: 'וידאו 1', duck: false },
  { id: 't1', type: 'text', name: 'טקסט', duck: false },
  { id: 'a1', type: 'audio', name: 'שמע', duck: false },
  { id: 'a2', type: 'audio', name: 'מוזיקה', duck: false },
]

export type ProjectFile = {
  format: 'retzef'
  version: 1
  project: Project
}
