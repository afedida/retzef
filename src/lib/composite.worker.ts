type Layer = {
  imageId: string
  dx: number
  dy: number
  dw: number
  dh: number
  opacity: number
}

type Message =
  | { type: 'image'; imageId: string; bitmap: ImageBitmap }
  | { type: 'drop'; imageId: string }
  | {
      type: 'frame'
      id: number
      width: number
      height: number
      layers: Layer[]
      letterboxPx: number
      progress: { y: number; h: number; w: number } | null
    }

const images = new Map<string, ImageBitmap>()
let canvas: OffscreenCanvas | null = null
let context: OffscreenCanvasRenderingContext2D | null = null

function surface(width: number, height: number): OffscreenCanvasRenderingContext2D {
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height)
    context = canvas.getContext('2d', { alpha: false })
  }
  if (!context || !canvas) throw new Error('no 2d')
  return context
}

self.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data
  if (message.type === 'image') {
    images.get(message.imageId)?.close()
    images.set(message.imageId, message.bitmap)
    return
  }
  if (message.type === 'drop') {
    images.get(message.imageId)?.close()
    images.delete(message.imageId)
    return
  }
  try {
    const ctx = surface(message.width, message.height)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = '#1b1b1b'
    ctx.fillRect(0, 0, message.width, message.height)
    for (const layer of message.layers) {
      const bitmap = images.get(layer.imageId)
      if (!bitmap) continue
      ctx.globalAlpha = layer.opacity
      ctx.drawImage(bitmap, layer.dx, layer.dy, layer.dw, layer.dh)
    }
    ctx.globalAlpha = 1
    if (message.letterboxPx > 0) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, message.width, message.letterboxPx)
      ctx.fillRect(0, message.height - message.letterboxPx, message.width, message.letterboxPx)
    }
    if (message.progress) {
      ctx.fillStyle = 'rgba(255,255,255,0.28)'
      ctx.fillRect(0, message.progress.y, message.width, message.progress.h)
      ctx.fillStyle = '#0078d4'
      ctx.fillRect(0, message.progress.y, message.progress.w, message.progress.h)
    }
    const bitmap = canvas!.transferToImageBitmap()
    self.postMessage({ id: message.id, bitmap }, { transfer: [bitmap] })
  } catch (error) {
    self.postMessage({ id: message.id, error: error instanceof Error ? error.message : 'composite failed' })
  }
}
