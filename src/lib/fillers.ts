import type { CaptionWord } from '@/types'

const FILLERS = new Set([
  'אה',
  'אמ',
  'אממ',
  'אמממ',
  'אהמ',
  'כאילו',
  'כזה',
  'um',
  'uh',
  'umm',
  'uhh',
  'erm',
  'hmm',
  'like',
  'ah',
  'eh',
])

export function isFiller(word: string): boolean {
  const token = word.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()
  return token.length > 0 && FILLERS.has(token)
}

export function evenWords(text: string, duration: number): CaptionWord[] {
  const parts = text.replaceAll('\n', ' ').split(/\s+/).filter(Boolean)
  if (!parts.length || !(duration > 0)) return []
  const span = duration / parts.length
  return parts.map((word, index) => ({
    text: word,
    start: index * span,
    end: (index + 1) * span,
  }))
}

export function fillerRanges(words: CaptionWord[], pad = 0.04): { start: number; end: number }[] {
  return words
    .filter((word) => isFiller(word.text))
    .map((word) => ({
      start: Math.max(0, word.start - pad),
      end: word.end + pad,
    }))
}
