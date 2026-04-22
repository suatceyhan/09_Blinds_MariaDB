export type ResizeImageOptions = {
  /** Max width or height in CSS pixels. */
  maxDimension: number
  /** Target output format for lossy recompression. */
  outputType: 'image/jpeg' | 'image/webp'
  /** 0..1 */
  quality: number
  /** Hard cap; if still larger, we'll lower quality in a few steps. */
  maxBytes: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

async function fileToImageBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    return await createImageBitmap(file)
  }
  // Fallback for older browsers.
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not read image.'))
      el.src = url
    })
    // @ts-expect-error - TS doesn't know createImageBitmap may exist late.
    if (typeof createImageBitmap === 'function') return await createImageBitmap(img)
    // Last resort: draw from HTMLImageElement below via canvas.
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not supported.')
    ctx.drawImage(img, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))), 'image/png')
    })
    return await createImageBitmap(blob)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))),
      type,
      quality,
    )
  })
}

/**
 * Resize + recompress a photo before upload to reduce bandwidth and avoid server limits.
 * If anything fails, returns the original file.
 */
export async function resizePhotoForUpload(
  file: File,
  opts: ResizeImageOptions,
): Promise<File> {
  try {
    if (!file.type.startsWith('image/')) return file
    const bmp = await fileToImageBitmap(file)
    const w = bmp.width
    const h = bmp.height
    if (!w || !h) return file

    const maxDim = Math.max(w, h)
    const scale = maxDim > opts.maxDimension ? opts.maxDimension / maxDim : 1
    const outW = Math.max(1, Math.round(w * scale))
    const outH = Math.max(1, Math.round(h * scale))

    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return file
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, outW, outH)

    // Quick path: if the original is already small, keep it.
    if (file.size <= opts.maxBytes && scale === 1) return file

    const qSteps = [opts.quality, 0.82, 0.74, 0.66, 0.58].map((q) => clamp(q, 0.4, 0.92))
    let best: Blob | null = null
    for (const q of qSteps) {
      const b = await canvasToBlob(canvas, opts.outputType, q)
      best = b
      if (b.size <= opts.maxBytes) break
    }
    if (!best) return file

    const ext = opts.outputType === 'image/webp' ? 'webp' : 'jpg'
    const base = file.name.replace(/\.[^.]+$/, '')
    const name = `${base || 'photo'}.${ext}`
    return new File([best], name, { type: opts.outputType })
  } catch {
    return file
  }
}

