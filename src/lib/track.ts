export function matchPatch(
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  patch: Uint8ClampedArray,
  patchSize: number,
  originX: number,
  originY: number,
  radius: number,
): { x: number; y: number } {
  let bestX = originX
  let bestY = originY
  let best = Number.POSITIVE_INFINITY
  const step = 2
  for (let y = originY - radius; y <= originY + radius; y += step) {
    for (let x = originX - radius; x <= originX + radius; x += step) {
      if (x < 0 || y < 0 || x + patchSize > width || y + patchSize > height) continue
      let sad = 0
      for (let py = 0; py < patchSize; py += 2) {
        for (let px = 0; px < patchSize; px += 2) {
          const frameIndex = ((y + py) * width + (x + px)) * 4
          const patchIndex = (py * patchSize + px) * 4
          sad += Math.abs((frame[frameIndex] ?? 0) - (patch[patchIndex] ?? 0))
          sad += Math.abs((frame[frameIndex + 1] ?? 0) - (patch[patchIndex + 1] ?? 0))
          sad += Math.abs((frame[frameIndex + 2] ?? 0) - (patch[patchIndex + 2] ?? 0))
        }
      }
      if (sad < best) {
        best = sad
        bestX = x
        bestY = y
      }
    }
  }
  return { x: bestX, y: bestY }
}
