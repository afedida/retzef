import { en } from '@/lib/i18n/en'
import { he, type MessageKey } from '@/lib/i18n/he'
import type { ShortcutId } from '@/lib/shortcuts'

export type Language = 'he' | 'en'
export type { MessageKey }
export { he, en }

const STORAGE_KEY = 'retzef-language'

export type Vars = Record<string, string | number>

const PRESET_KEYS: Record<string, MessageKey> = {
  '1080p30': 'preset.1080p30',
  '1080p60': 'preset.1080p60',
  '720p30': 'preset.720p30',
  shorts: 'preset.shorts',
  square: 'preset.square',
  feed: 'preset.feed',
}

const LOOK_KEYS: Record<string, MessageKey> = {
  clean: 'look.clean',
  cinema: 'look.cinema',
  warm: 'look.warm',
  cold: 'look.cold',
  vivid: 'look.vivid',
}

const GUIDE_KEYS: Record<string, MessageKey> = {
  action: 'guide.action',
  title: 'guide.title',
  ui: 'guide.ui',
}

const TRACK_ALIASES: Record<string, { names: string[]; key: MessageKey }> = {
  v2: { names: ['וידאו 2', 'Video 2'], key: 'track.v2' },
  v1: { names: ['וידאו 1', 'Video 1'], key: 'track.v1' },
  t1: { names: ['טקסט', 'Text'], key: 'track.t1' },
  a1: { names: ['קריינות', 'Voiceover', 'שמע', 'a1'], key: 'track.a1' },
  a2: { names: ['מוזיקה', 'Music', 'שמע', 'a2'], key: 'track.a2' },
}

function readStored(): Language {
  try {
    if (typeof localStorage === 'undefined') return 'he'
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'he'
  } catch {
    return 'he'
  }
}

let current: Language = readStored()

export function getLanguage(): Language {
  return current
}

export function directionFor(language: Language): 'rtl' | 'ltr' {
  return language === 'en' ? 'ltr' : 'rtl'
}

export function translate(language: Language, key: MessageKey, vars?: Vars): string {
  const table = language === 'en' ? en : he
  let text: string = table[key] ?? he[key]
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

export function t(key: MessageKey, vars?: Vars): string {
  return translate(current, key, vars)
}

export function applyDocumentLanguage(language: Language = current) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
  document.documentElement.dir = directionFor(language)
  document.title = translate(language, 'app.title')
}

export function setI18nLanguage(language: Language) {
  current = language === 'en' ? 'en' : 'he'
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, current)
  } catch {
    /* private mode */
  }
  applyDocumentLanguage(current)
}

export function presetLabel(id: string): string {
  const key = PRESET_KEYS[id]
  return key ? t(key) : id
}

export function lookLabel(id: string): string {
  const key = LOOK_KEYS[id]
  return key ? t(key) : id
}

export function guideLabel(id: string): string {
  const key = GUIDE_KEYS[id]
  return key ? t(key) : id
}

export function shortcutLabel(id: ShortcutId): string {
  return t(`shortcut.${id}`)
}

export function templatePartLabel(id: string): string {
  const key = `template.part.${id}` as MessageKey
  return key in he ? t(key) : id
}

export function displayTrackName(id: string, name: string): string {
  const entry = TRACK_ALIASES[id]
  if (entry?.names.includes(name)) return t(entry.key)
  const numbered = /^(?:טקסט|Text) (\d+)$/.exec(name)
  if (numbered) return t('content.textTrackN', { n: numbered[1]! })
  return name
}

export function dictionaryKeys(): { he: string[]; en: string[] } {
  return { he: Object.keys(he), en: Object.keys(en) }
}

applyDocumentLanguage(current)
