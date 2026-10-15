import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { exportWindow } from '@/lib/creator'
import { presetLabel } from '@/lib/i18n'
import { projectDuration } from '@/lib/edit'
import { formatRealtime } from '@/lib/exportSpeed'
import { formatClock } from '@/lib/time'
import { beginExport, cancelExport, dismissExportResult, setExportOpen, setExportPreset } from '@/state/editor'
import { useEditor, useT } from '@/state/hooks'
import { EXPORT_PRESETS, presetById } from '@/types'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ExportDialog() {
  const t = useT()
  const open = useEditor((state) => state.exportOpen)
  const project = useEditor((state) => state.project)
  const presetId = useEditor((state) => state.exportPreset)
  const job = useEditor((state) => state.exportJob)
  const preset = presetById(presetId)
  const timeline = projectDuration(project)
  const range = exportWindow(project)
  const duration = range.duration
  const estimate = duration * ((preset.videoBitrate + 192_000) / 8)
  const running = job?.running === true

  const close = () => {
    if (!running) dismissExportResult()
    setExportOpen(false)
  }

  return (
    <Dialog open={open} modal={false} onOpenChange={(next) => (next ? setExportOpen(true) : close())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('export.title')}</DialogTitle>
          <DialogDescription>{t('export.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">{t('export.format')}</span>
            <select
              className="h-8 w-full rounded-md border bg-background px-2 text-sm"
              value={presetId}
              disabled={running}
              onChange={(event) => setExportPreset(event.target.value as typeof presetId)}
            >
              {EXPORT_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {presetLabel(item.id)} · {item.width}×{item.height}
                </option>
              ))}
            </select>
          </label>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md bg-muted/60 px-2 py-1.5">
              <dt className="text-muted-foreground">{range.ranged ? t('export.range') : t('export.length')}</dt>
              <dd dir="ltr" className="font-mono">{formatClock(duration)}{range.ranged ? ` / ${formatClock(timeline)}` : ''}</dd>
            </div>
            <div className="rounded-md bg-muted/60 px-2 py-1.5">
              <dt className="text-muted-foreground">{t('export.estimate')}</dt>
              <dd dir="ltr" className="font-mono">{formatBytes(estimate)}</dd>
            </div>
            <div className="rounded-md bg-muted/60 px-2 py-1.5">
              <dt className="text-muted-foreground">{t('export.speed')}</dt>
              <dd dir="ltr" className="font-mono">{formatRealtime(job?.speed ?? 0)}</dd>
            </div>
          </dl>
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round((job?.ratio ?? 0) * 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{job?.label ?? t('export.ready')}</p>
          </div>
          {job?.error && <p className="text-sm text-destructive">{job.error}</p>}
          {job?.savedToDisk && <p className="text-sm">{t('export.savedChosen')}</p>}
          {job?.resultUrl && (
            <div className="space-y-1">
              <video src={job.resultUrl} controls className="aspect-video w-full rounded-md bg-black" />
              <p className="text-xs text-muted-foreground">{t('export.downloaded', { size: formatBytes(job.resultSize) })}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            {running ? t('export.keepEditing') : t('export.close')}
          </Button>
          {running ? (
            <Button type="button" variant="destructive" onClick={cancelExport}>
              {t('export.cancel')}
            </Button>
          ) : (
            <Button type="button" onClick={() => void beginExport()} disabled={duration <= 0}>
              {t('export.start')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
