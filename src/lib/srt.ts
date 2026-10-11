export type Cue = { start: number; end: number; text: string }

function stamp(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const ms = Math.round((clamped % 1) * 1000)
  const whole = Math.floor(clamped)
  const s = whole % 60
  const m = Math.floor(whole / 60) % 60
  const h = Math.floor(whole / 3600)
  const pad = (value: number, size: number) => value.toString().padStart(size, '0')
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

function parseStamp(value: string): number | null {
  const match = value.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const millis = Number(match[4]!.padEnd(3, '0').slice(0, 3))
  return hours * 3600 + minutes * 60 + seconds + millis / 1000
}

export function cuesToSrt(cues: Cue[]): string {
  return cues
    .map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text.trim()}\n`)
    .join('\n')
}

export function parseSrt(source: string): Cue[] {
  const blocks = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split(/\n{2,}/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
    const timing = lines.findIndex((line) => line.includes('-->'))
    if (timing < 0) continue
    const [rawStart, rawEnd] = lines[timing]!.split('-->')
    const start = parseStamp(rawStart ?? '')
    const end = parseStamp(rawEnd ?? '')
    if (start === null || end === null || end <= start) continue
    const text = lines.slice(timing + 1).join('\n').trim()
    if (!text) continue
    cues.push({ start, end, text })
  }
  return cues
}
