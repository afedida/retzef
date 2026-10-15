export type CompositeLayer = {
  imageId: string
  dx: number
  dy: number
  dw: number
  dh: number
  opacity: number
}

export type CompositeFrame = {
  width: number
  height: number
  layers: CompositeLayer[]
  letterboxPx: number
  progress: { y: number; h: number; w: number } | null
}

type Reply = { id: number; bitmap?: ImageBitmap; error?: string }

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (bitmap: ImageBitmap) => void; reject: (error: Error) => void }>()

function thread(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./composite.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const waiter = pending.get(event.data.id)
    if (!waiter) return
    pending.delete(event.data.id)
    if (event.data.bitmap) waiter.resolve(event.data.bitmap)
    else waiter.reject(new Error(event.data.error || 'composite failed'))
  }
  worker.onerror = () => {
    for (const waiter of pending.values()) waiter.reject(new Error('worker failed'))
    pending.clear()
    worker = null
  }
  return worker
}

export function compositeAvailable(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
}

export function compositeImage(imageId: string, bitmap: ImageBitmap): void {
  thread().postMessage({ type: 'image', imageId, bitmap }, [bitmap])
}

export function compositeFrame(job: CompositeFrame): Promise<ImageBitmap> {
  const id = ++seq
  const target = thread()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    target.postMessage({ type: 'frame', id, ...job })
  })
}
