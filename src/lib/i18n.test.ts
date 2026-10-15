import { describe, expect, it, afterEach } from 'vitest'
import { en } from '@/lib/i18n/en'
import { he } from '@/lib/i18n/he'
import {
  directionFor,
  displayTrackName,
  getLanguage,
  presetLabel,
  setI18nLanguage,
  shortcutLabel,
  t,
  templatePartLabel,
  translate,
} from '@/lib/i18n'

describe('i18n', () => {
  afterEach(() => setI18nLanguage('he'))

  it('uses the same keys in Hebrew and English', () => {
    const heKeys = Object.keys(he).sort()
    const enKeys = Object.keys(en).sort()
    expect(enKeys).toEqual(heKeys)
    expect(heKeys.length).toBeGreaterThan(200)
  })

  it('fills placeholders and keeps Hebrew as the default', () => {
    expect(getLanguage()).toBe('he')
    expect(t('panel.media')).toBe('מדיה')
    expect(t('status.copied', { count: 3 })).toBe('הועתקו 3 קליפים')
    expect(translate('en', 'status.copied', { count: 3 })).toBe('Copied 3 clips')
    expect(directionFor('he')).toBe('rtl')
    expect(directionFor('en')).toBe('ltr')
  })

  it('switches the interface without translating stored user content', () => {
    setI18nLanguage('en')
    expect(t('panel.media')).toBe('Media')
    expect(t('export.title')).toBe('Export for YouTube')
    expect(shortcutLabel('split')).toBe('Split at playhead')
    expect(templatePartLabel('captionStyle')).toBe('Caption style')
    expect(presetLabel('square')).toBe('Square 1:1')
    expect(displayTrackName('v1', 'וידאו 1')).toBe('Video 1')
    expect(displayTrackName('a2', 'Music')).toBe('Music')
    expect(displayTrackName('t1', 'כותרות')).toBe('כותרות')
    expect(displayTrackName('tx', 'טקסט 2')).toBe('Text 2')
    expect(displayTrackName('v1', 'הסרט שלי')).toBe('הסרט שלי')
  })
})
