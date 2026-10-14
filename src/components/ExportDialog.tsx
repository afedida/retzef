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
import { pickMp4Stream } from '@/lib/saveFile'
import { exportWindow } from '@/lib/creator'
import { projectDuration } from '@/lib/edit'
import { formatClock } from '@/lib/time'
import { setExportOpen, setExportPreset } from '@/state/editor'
import { useEditor } from '@/state/hooks'
import { EXPORT_PRESETS, presetById } from '@/types'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ExportDialog() {
  const open = useEditor((state) => state.exportOpen)
  const project = useEditor((state) => state.project)
  const assets = useEditor((state) => state.assets)
  const presetId = useEditor((state) => state.exportPreset)
  const preset = presetById(presetId)
  const [label, setLabel] = useState('מוכן לייצוא')
  const [ratio, setRatio] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultSize, setResultSize] = useState(0)
  const [savedToDisk, setSavedToDisk] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const timeline = projectDuration(project)
  const range = exportWindow(project)
  const duration = range.duration
  const estimate = duration * ((preset.videoBitrate + 192_000) / 8)

  const close = () => {
    abortRef.current?.abort()
    abortRef.current = null
    if (resultUrl) URL.revokeObjectURL(resultUrl)
    setResultUrl(null)
    setSavedToDisk(false)
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
    setSavedToDisk(false)
    const controller = new AbortController()
    abortRef.current = controller
    const safe = project.name.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim() || 'retzef'
    let stream: Awaited<ReturnType<typeof pickMp4Stream>> = null
    try {
      stream = await pickMp4Stream(`${safe}.mp4`)
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setRunning(false)
        return
      }
      stream = null
    }
    try {
      const result = await exportProject(
        project,
        assets,
        (progress) => {
          setRatio(progress.ratio)
          setLabel(progress.label)
        },
        controller.signal,
        { preset: presetId, stream },
      )
      if (result.blob) {
        const url = URL.createObjectURL(result.blob)
        setResultUrl(url)
        setResultSize(result.blob.size)
        const link = document.createElement('a')
        link.href = url
        link.download = `${safe}.mp4`
        link.click()
      } else {
        setSavedToDisk(true)
      }
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
            MP4 עם H.264 ו-AAC. אם הדפדפן מאפשר, הקובץ נכתב ישר לדיסק. אחרת הוא יורד בסוף.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">פורמט</span>
            <select
              className="h-8 w-full rounded-md border bg-background px-2 text-sm"
              value={presetId}
              disabled={running}
              onChange={(event) => setExportPreset(event.target.value as typeof presetId)}
            >
              {EXPORT_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} · {item.width}×{item.height}
                </option>
              ))}
            </select>
          </label>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md bg-muted/60 px-2 py-1.5">
              <dt className="text-muted-foreground">{range.ranged ? 'טווח ייצוא' : 'אורך'}</dt>
              <dd dir="ltr" className="font-mono">{formatClock(duration)}{range.ranged ? ` / ${formatClock(timeline)}` : ''}</dd>
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
          {savedToDisk && <p className="text-sm">הקובץ נשמר במיקום שבחרת.</p>}
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
