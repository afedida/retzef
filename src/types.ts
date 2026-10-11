export const OUTPUT_WIDTH = 1920
export const OUTPUT_HEIGHT = 1080
export const OUTPUT_FPS = 30
export const VIDEO_BITRATE = 8_000_000
export const AUDIO_BITRATE = 192_000
export const MIN_CLIP = 0.1

export type MediaKind = 'video' | 'audio' | 'image'
export type TrackType = 'video' | 'audio' | 'text'

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
}

export type TextStyle = {
  content: string
  fontSize: number
  color: string
  x: number
  y: number
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
}

export type Track = {
  id: string
  type: TrackType
  name: string
}

export type Project = {
  version: 1
  id: string
  name: string
  tracks: Track[]
  clips: Clip[]
}

export const DEFAULT_TRACKS: Track[] = [
  { id: 'v2', type: 'video', name: 'וידאו 2' },
  { id: 'v1', type: 'video', name: 'וידאו 1' },
  { id: 't1', type: 'text', name: 'טקסט' },
  { id: 'a1', type: 'audio', name: 'שמע' },
  { id: 'a2', type: 'audio', name: 'מוזיקה' },
]

export type ProjectFile = {
  format: 'retzef'
  version: 1
  project: Project
}
