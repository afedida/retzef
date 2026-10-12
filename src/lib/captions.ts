import { resampleMono } from '@/lib/denoise'
import type { Cue } from '@/lib/srt'
import type { CaptionLanguage } from '@/types'

type Chunk = { text?: string; timestamp?: [number, number | null] }
type AsrResult = { text?: string; chunks?: Chunk[] }
type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<AsrResult>

async function pickDevice(): Promise<'webgpu' | 'wasm'> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    if (gpu && (await gpu.requestAdapter())) return 'webgpu'
  } catch {
    /* wasm fallback */
  }
  return 'wasm'
}

export async function transcribePcm(samples: Float32Array, sampleRate: number, language: CaptionLanguage): Promise<Cue[]> {
  const audio = sampleRate === 16000 ? samples : resampleMono(samples, sampleRate, 16000)
  const { pipeline } = await import('@huggingface/transformers')
  const create = async (device: 'webgpu' | 'wasm') =>
    (await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', { device })) as unknown as Transcriber
  let transcriber: Transcriber
  const preferred = await pickDevice()
  try {
    transcriber = await create(preferred)
  } catch {
    transcriber = await create('wasm')
  }
  let result: AsrResult
  try {
    result = await transcriber(audio, {
      language: language === 'hebrew' ? 'hebrew' : 'english',
      return_timestamps: true,
      chunk_length_s: 30,
    })
  } catch {
    transcriber = await create('wasm')
    result = await transcriber(audio, {
      language: language === 'hebrew' ? 'hebrew' : 'english',
      return_timestamps: true,
      chunk_length_s: 30,
    })
  }
  const chunks = result.chunks ?? []
  const cues: Cue[] = []
  for (const chunk of chunks) {
    const text = chunk.text?.trim() ?? ''
    const start = chunk.timestamp?.[0]
    const end = chunk.timestamp?.[1]
    if (!text || start === undefined || end === null || end === undefined || end <= start) continue
    cues.push({ start, end, text })
  }
  if (!cues.length && result.text?.trim()) {
    cues.push({ start: 0, end: Math.max(0.4, audio.length / 16000), text: result.text.trim() })
  }
  return cues
}
