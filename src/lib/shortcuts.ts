import { t } from '@/lib/i18n'

export const SHORTCUT_IDS = [
  'save',
  'undo',
  'redo',
  'copy',
  'paste',
  'group',
  'ungroup',
  'play',
  'split',
  'delete',
  'rippleDelete',
  'nudgeLeft',
  'nudgeRight',
  'nudgeLeftSecond',
  'nudgeRightSecond',
  'marker',
  'markIn',
  'markOut',
  'loop',
  'clearMarks',
  'goStart',
  'zoomIn',
  'zoomOut',
] as const

export type ShortcutId = (typeof SHORTCUT_IDS)[number]

export type Chord = {
  code: string
  mod: boolean
  shift: boolean
  alt: boolean
}

export type ShortcutScope = 'always' | 'timeline'

export type Bindings = Record<ShortcutId, Chord[]>

export type ShortcutEvent = {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  save: 'שמירה',
  undo: 'ביטול',
  redo: 'ביצוע מחדש',
  copy: 'העתקה',
  paste: 'הדבקה',
  group: 'קיבוץ',
  ungroup: 'פירוק קיבוץ',
  play: 'ניגון / השהיה',
  split: 'פיצול בנקודת הניגון',
  delete: 'מחיקה',
  rippleDelete: 'מחיקה גולשת',
  nudgeLeft: 'הזזה שמאלה בפריים',
  nudgeRight: 'הזזה ימינה בפריים',
  nudgeLeftSecond: 'הזזה שמאלה בשנייה',
  nudgeRightSecond: 'הזזה ימינה בשנייה',
  marker: 'סמן',
  markIn: 'נקודת כניסה',
  markOut: 'נקודת יציאה',
  loop: 'לולאה על הטווח',
  clearMarks: 'ניקוי טווח',
  goStart: 'חזרה להתחלה',
  zoomIn: 'הגדלת הציר',
  zoomOut: 'הקטנת הציר',
}

const SCOPE: Record<ShortcutId, ShortcutScope> = {
  save: 'always',
  undo: 'always',
  redo: 'always',
  copy: 'timeline',
  paste: 'timeline',
  group: 'timeline',
  ungroup: 'timeline',
  play: 'timeline',
  split: 'timeline',
  delete: 'timeline',
  rippleDelete: 'timeline',
  nudgeLeft: 'timeline',
  nudgeRight: 'timeline',
  nudgeLeftSecond: 'timeline',
  nudgeRightSecond: 'timeline',
  marker: 'timeline',
  markIn: 'timeline',
  markOut: 'timeline',
  loop: 'timeline',
  clearMarks: 'timeline',
  goStart: 'timeline',
  zoomIn: 'timeline',
  zoomOut: 'timeline',
}

export function shortcutScope(id: ShortcutId): ShortcutScope {
  return SCOPE[id]
}

function chord(code: string, mod = false, shift = false, alt = false): Chord {
  return { code, mod, shift, alt }
}

export function cloneBindings(bindings: Bindings): Bindings {
  return SHORTCUT_IDS.reduce((map, id) => {
    map[id] = bindings[id].map((item) => ({ ...item }))
    return map
  }, {} as Bindings)
}

export const DEFAULT_SHORTCUTS: Bindings = {
  save: [chord('KeyS', true)],
  undo: [chord('KeyZ', true)],
  redo: [chord('KeyZ', true, true), chord('KeyY', true)],
  copy: [chord('KeyC', true)],
  paste: [chord('KeyV', true)],
  group: [chord('KeyG', true)],
  ungroup: [chord('KeyG', true, true)],
  play: [chord('Space')],
  split: [chord('KeyS')],
  delete: [chord('Delete'), chord('Backspace')],
  rippleDelete: [chord('Delete', false, true), chord('Backspace', false, true)],
  nudgeLeft: [chord('ArrowLeft')],
  nudgeRight: [chord('ArrowRight')],
  nudgeLeftSecond: [chord('ArrowLeft', false, true)],
  nudgeRightSecond: [chord('ArrowRight', false, true)],
  marker: [chord('KeyM')],
  markIn: [chord('KeyI')],
  markOut: [chord('KeyO')],
  loop: [chord('KeyL')],
  clearMarks: [chord('KeyX', false, false, true)],
  goStart: [chord('Home')],
  zoomIn: [chord('Equal'), chord('NumpadAdd')],
  zoomOut: [chord('Minus'), chord('NumpadSubtract')],
}

/** Premiere-style edits: Ctrl+K splits, Ctrl+L loops, so the bare letters stay closer to the selection tools. */
export const PREMIERE_SHORTCUTS: Bindings = {
  ...cloneBindings(DEFAULT_SHORTCUTS),
  split: [chord('KeyK', true)],
  loop: [chord('KeyL', true)],
  marker: [chord('KeyM')],
  markIn: [chord('KeyI')],
  markOut: [chord('KeyO')],
  play: [chord('Space')],
  goStart: [chord('Home')],
  rippleDelete: [chord('Delete', false, true), chord('Backspace', false, true)],
}

export function chordId(value: Chord): string {
  return `${value.mod ? 'mod+' : ''}${value.alt ? 'alt+' : ''}${value.shift ? 'shift+' : ''}${value.code}`
}

export function chordsEqual(a: Chord, b: Chord): boolean {
  return chordId(a) === chordId(b)
}

export function chordFromEvent(event: ShortcutEvent): Chord {
  return {
    code: event.code,
    mod: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  }
}

const CODE_LABEL: Record<string, string> = {
  Space: '',
  Delete: 'Delete',
  Backspace: 'Backspace',
  ArrowLeft: '←',
  ArrowRight: '→',
  Home: 'Home',
  Equal: '=',
  Minus: '-',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
}

export function formatChord(value: Chord): string {
  const parts: string[] = []
  if (value.mod) parts.push('Ctrl')
  if (value.alt) parts.push('Alt')
  if (value.shift) parts.push('Shift')
  const named = value.code === 'Space' ? t('key.space') : CODE_LABEL[value.code]
  parts.push(named || (value.code.startsWith('Key') ? value.code.slice(3) : value.code))
  return parts.join('+')
}

export function formatBinding(chords: Chord[]): string {
  return chords.map(formatChord).join(' / ')
}

function isChord(value: unknown): value is Chord {
  if (!value || typeof value !== 'object') return false
  const chordValue = value as Partial<Chord>
  return typeof chordValue.code === 'string' && chordValue.code.length > 0 && typeof chordValue.mod === 'boolean' && typeof chordValue.shift === 'boolean' && typeof chordValue.alt === 'boolean'
}

export function normalizeBindings(value: unknown): Bindings | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { bindings?: unknown }
  const source = raw.bindings && typeof raw.bindings === 'object' ? (raw.bindings as Record<string, unknown>) : (value as Record<string, unknown>)
  const next = cloneBindings(DEFAULT_SHORTCUTS)
  for (const id of SHORTCUT_IDS) {
    const list = source[id]
    if (!Array.isArray(list) || !list.length || !list.every(isChord)) continue
    next[id] = list.map((item) => ({ code: item.code, mod: item.mod, shift: item.shift, alt: item.alt }))
  }
  return conflictsIn(next).length ? null : next
}

export function conflictsIn(bindings: Bindings): { chord: string; actions: ShortcutId[] }[] {
  const owners = new Map<string, ShortcutId[]>()
  for (const id of SHORTCUT_IDS) {
    for (const item of bindings[id]) {
      const key = chordId(item)
      const list = owners.get(key) ?? []
      list.push(id)
      owners.set(key, list)
    }
  }
  return [...owners.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([chordKey, actions]) => ({ chord: chordKey, actions }))
}

export function findConflict(bindings: Bindings, action: ShortcutId, next: Chord): ShortcutId | null {
  const key = chordId(next)
  for (const id of SHORTCUT_IDS) {
    if (id === action) continue
    if (bindings[id].some((item) => chordId(item) === key)) return id
  }
  return null
}

export function rebind(bindings: Bindings, action: ShortcutId, next: Chord, slot = 0): { ok: true; bindings: Bindings } | { ok: false; conflict: ShortcutId } {
  const conflict = findConflict(bindings, action, next)
  if (conflict) return { ok: false, conflict }
  const copy = cloneBindings(bindings)
  const chords = copy[action].map((item) => ({ ...item }))
  if (slot >= chords.length) chords.push({ ...next })
  else chords[slot] = { ...next }
  copy[action] = chords
  return { ok: true, bindings: copy }
}

export function matchShortcut(bindings: Bindings, event: ShortcutEvent, typing: boolean): ShortcutId | null {
  const pressed = chordFromEvent(event)
  const key = chordId(pressed)
  for (const id of SHORTCUT_IDS) {
    if (typing && shortcutScope(id) !== 'always') continue
    if (bindings[id].some((item) => chordId(item) === key)) return id
  }
  return null
}

export function shortcutDocument(bindings: Bindings): string {
  return JSON.stringify({ format: 'retzef-shortcuts', version: 1, bindings }, null, 2)
}

const SHORTCUT_STORAGE = 'retzef-shortcuts'

export function readShortcutSettings(): Bindings {
  try {
    const text = localStorage.getItem(SHORTCUT_STORAGE)
    if (!text) return cloneBindings(DEFAULT_SHORTCUTS)
    return parseShortcutDocument(text) ?? cloneBindings(DEFAULT_SHORTCUTS)
  } catch {
    return cloneBindings(DEFAULT_SHORTCUTS)
  }
}

export function writeShortcutSettings(bindings: Bindings): void {
  localStorage.setItem(SHORTCUT_STORAGE, shortcutDocument(bindings))
}

export function parseShortcutDocument(text: string): Bindings | null {
  try {
    const parsed = JSON.parse(text) as { format?: string; bindings?: unknown }
    if (parsed.format !== 'retzef-shortcuts') return null
    return normalizeBindings(parsed)
  } catch {
    return null
  }
}
