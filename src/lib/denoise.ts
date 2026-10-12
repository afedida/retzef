type RnnoiseModule = {
  _rnnoise_create: () => number
  _rnnoise_destroy: (state: number) => void
  _rnnoise_process_frame: (state: number, output: number, input: number) => number
  _malloc: (size: number) => number
  _free: (ptr: number) => void
  HEAPF32: Float32Array
}

const FRAME = 480
let modulePromise: Promise<RnnoiseModule> | null = null

async function loadModule(): Promise<RnnoiseModule> {
  if (!modulePromise) {
    modulePromise = import('@jitsi/rnnoise-wasm').then((mod) => {
      const create = mod.createRNNWasmModuleSync as () => RnnoiseModule
      return create()
    })
  }
  return modulePromise
}

export async function denoisePcm(channel: Float32Array, sampleRate: number): Promise<Float32Array> {
  const audio = sampleRate === 48000 ? channel : resample(channel, sampleRate, 48000)
  const wasm = await loadModule()
  const state = wasm._rnnoise_create()
  const ptr = wasm._malloc(FRAME * 4)
  const out = new Float32Array(audio.length)
  try {
    for (let offset = 0; offset < audio.length; offset += FRAME) {
      const view = wasm.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + FRAME)
      view.fill(0)
      const count = Math.min(FRAME, audio.length - offset)
      for (let i = 0; i < count; i++) view[i] = (audio[offset + i] ?? 0) * 32768
      wasm._rnnoise_process_frame(state, ptr, ptr)
      for (let i = 0; i < count; i++) out[offset + i] = (view[i] ?? 0) / 32768
    }
  } finally {
    wasm._rnnoise_destroy(state)
    wasm._free(ptr)
  }
  return sampleRate === 48000 ? out : resample(out, 48000, sampleRate)
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input
  const length = Math.max(1, Math.round((input.length * to) / from))
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const position = (i * from) / to
    const index = Math.floor(position)
    const frac = position - index
    const a = input[Math.min(index, input.length - 1)] ?? 0
    const b = input[Math.min(index + 1, input.length - 1)] ?? a
    output[i] = a + (b - a) * frac
  }
  return output
}

export function resampleMono(input: Float32Array, from: number, to: number): Float32Array {
  return resample(input, from, to)
}
