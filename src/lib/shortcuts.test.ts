import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHORTCUTS,
  PREMIERE_SHORTCUTS,
  SHORTCUT_LABELS,
  cloneBindings,
  conflictsIn,
  findConflict,
  formatChord,
  matchShortcut,
  parseShortcutDocument,
  rebind,
  shortcutDocument,
} from '@/lib/shortcuts'

describe('keyboard shortcuts', () => {
  it('ships defaults and a premiere preset without conflicts', () => {
    expect(conflictsIn(DEFAULT_SHORTCUTS)).toEqual([])
    expect(conflictsIn(PREMIERE_SHORTCUTS)).toEqual([])
    expect(PREMIERE_SHORTCUTS.split[0]).toMatchObject({ code: 'KeyK', mod: true })
    expect(PREMIERE_SHORTCUTS.loop[0]).toMatchObject({ code: 'KeyL', mod: true })
    expect(SHORTCUT_LABELS.split).toContain('פיצול')
  })

  it('rejects a chord that belongs to another action', () => {
    const conflict = findConflict(DEFAULT_SHORTCUTS, 'split', { code: 'KeyM', mod: false, shift: false, alt: false })
    expect(conflict).toBe('marker')
    const blocked = rebind(DEFAULT_SHORTCUTS, 'split', { code: 'KeyM', mod: false, shift: false, alt: false })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.conflict).toBe('marker')
    expect(DEFAULT_SHORTCUTS.split[0]?.code).toBe('KeyS')
  })

  it('rebinds one slot and still matches the other chord', () => {
    const next = rebind(cloneBindings(DEFAULT_SHORTCUTS), 'zoomIn', { code: 'KeyE', mod: true, shift: false, alt: false }, 0)
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(formatChord(next.bindings.zoomIn[0]!)).toBe('Ctrl+E')
    expect(matchShortcut(next.bindings, { code: 'NumpadAdd', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, false)).toBe('zoomIn')
    expect(matchShortcut(next.bindings, { code: 'KeyS', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, true)).toBe('save')
    expect(matchShortcut(next.bindings, { code: 'KeyS', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, true)).toBeNull()
  })

  it('round-trips a shortcut file', () => {
    const text = shortcutDocument(PREMIERE_SHORTCUTS)
    expect(parseShortcutDocument(text)?.split[0]?.code).toBe('KeyK')
    expect(parseShortcutDocument('{"format":"other"}')).toBeNull()
    expect(parseShortcutDocument('{')).toBeNull()
  })
})
