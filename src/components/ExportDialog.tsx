import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { exportProject } from '@/lib/exportVideo'
import { projectDuration } from '@/lib/edit'
import { formatClock } from '@/lib/time'
import { setExportOpen } from '@/state/editor'
import { useEditor } from '@/state/hooks'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ExportDialog() {
  const open = useEditor((state) => state.exportOpen)
  const project = useEditor((state) => state.project)
  const assets = useEditor((state) => state.assets)
  const [label, setLabel] = useState('מוכן לייצוא')
  const [ratio, setRatio] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultSize, setResultSize] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const duration = projectDuration(project)
  const estimate = duration * ((8_000_000 + 192_000) / 8)

  const close = () => {
    abortRef.current?.abort()
    abortRef.current = null
    if (resultUrl) URL.revokeObjectURL(resultUrl)
    setResultUrl(null)
    setRunning(false)
    setRatio(0)
    setError(null)
    setLabel('מוכן לייצוא')
    setExportOpen(false)
  }

  const start = async () => {
    setError(null)
    setRunning(true)
    setRatio(0)
    if (resultUrl) URL.revokeObjectURL(resultUrl)
    setResultUrl(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const blob = await exportProject(
        project,
        assets,
        (progress) => {
          setRatio(progress.ratio)
          setLabel(progress.label)
        },
        controller.signal,
      )
      const url = URL.createObjectURL(blob)
      setResultUrl(url)
      setResultSize(blob.size)
      const link = document.createElement('a')
      const safe = project.name.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim() || 'retzef'
      link.href = url
      link.download = `${safe}.mp4`
      link.click()
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setError('הייצוא בוטל')
      } else {
        setError(caught instanceof Error ? caught.message : 'הייצוא נכשל')
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setExportOpen(true) : close())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>ייצוא ליוטיוב</DialogTitle>
          <DialogDescription>
            MP4 עם H.264 ו-AAC, 1920×1080, 30fps. הקידוד רץ במחשב, בלי שרת.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md bg-muted/60 px-2 py-1.5">
              <dt className="text-muted-foreground">אורך</dt>
              <dd dir="ltr" className="font-mono">{formatClock(duration)}</dd>
            </div>
            <div className="rounded-md bg-muted/60 px-2 py-1.5">
              <dt className="text-muted-foreground">גודל משוער</dt>
              <dd dir="ltr" className="font-mono">{formatBytes(estimate)}</dd>
            </div>
          </dl>
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {resultUrl && (
            <div className="space-y-1">
              <video src={resultUrl} controls className="aspect-video w-full rounded-md bg-black" />
              <p className="text-xs text-muted-foreground">הקובץ ירד ({formatBytes(resultSize)}). אפשר גם לנגן אותו כאן.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            סגירה
          </Button>
          {running ? (
            <Button type="button" variant="destructive" onClick={() => abortRef.current?.abort()}>
              ביטול
            </Button>
          ) : (
            <Button type="button" onClick={() => void start()} disabled={duration <= 0}>
              התחלת ייצוא
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
