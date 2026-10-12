import { useRef, useState } from 'react'
import { Film, Image as ImageIcon, Music, Plus, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatClock } from '@/lib/time'
import { getPlayhead, importFiles, loadSampleMedia, placeAsset, removeAsset } from '@/state/editor'
import { useEditor } from '@/state/hooks'
import { cn } from '@/lib/utils'
import type { Asset, MediaKind } from '@/types'

function kindLabel(kind: MediaKind): string {
  if (kind === 'video') return 'וידאו'
  if (kind === 'audio') return 'שמע'
  return 'תמונה'
}

function KindIcon({ kind }: { kind: MediaKind }) {
  if (kind === 'video') return <Film className="size-4" />
  if (kind === 'audio') return <Music className="size-4" />
  return <ImageIcon className="size-4" />
}

export function MediaBin({ className }: { className?: string }) {
  const assets = useEditor((state) => state.assets)
  const selectedAssetId = useEditor((state) => state.selectedAssetId)
  const importError = useEditor((state) => state.importError)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  return (
    <aside
      data-drop-zone
      className={cn('flex min-h-0 flex-col border-e bg-card/40', className)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const files = [...event.dataTransfer.files]
        if (files.length) void importFiles(files)
      }}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <div>
          <h2 className="text-sm font-semibold">ספריית מדיה</h2>
          <p className="text-[11px] text-muted-foreground">וידאו, שמע או תמונה</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
          <Upload />
          ייבוא
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,audio/*,image/*"
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            if (files.length) void importFiles(files)
            event.target.value = ''
          }}
        />
      </div>
      <div className="px-3 pb-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void loadSampleMedia().finally(() => setBusy(false))
          }}
        >
          {busy ? 'טוען דוגמה…' : 'טעינת מדיה לדוגמה'}
        </Button>
      </div>
      {importError && <p className="px-3 pb-2 text-xs text-destructive">{importError}</p>}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 px-3 pb-3">
          {assets.length === 0 && (
            <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
              גררו לכאן קבצים מהמחשב, או לחצו על ייבוא.
            </div>
          )}
          {assets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} selected={asset.id === selectedAssetId} />
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}

function AssetCard({ asset, selected }: { asset: Asset; selected: boolean }) {
  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-retzef-asset', asset.id)
        event.dataTransfer.setData('text/plain', `retzef-asset:${asset.id}`)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      onDoubleClick={() => placeAsset(asset.id, getPlayhead())}
      className={cn(
        'overflow-hidden rounded-lg border bg-background/60 text-start',
        selected && 'border-primary',
      )}
    >
      <div className="relative aspect-video bg-black">
        {asset.thumbnail ? (
          <img src={asset.thumbnail} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground">
            <KindIcon kind={asset.kind} />
          </div>
        )}
        <span className="absolute start-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px]">
          {kindLabel(asset.kind)}
        </span>
        {asset.kind !== 'image' && asset.duration > 0 && (
          <span dir="ltr" className="absolute end-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px]">
            {formatClock(asset.duration)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <p className="min-w-0 flex-1 truncate text-xs" title={asset.name}>
          {asset.name}
        </p>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="הוספה לציר" onClick={() => placeAsset(asset.id, getPlayhead())}>
          <Plus />
        </Button>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="מחיקת מדיה" onClick={() => void removeAsset(asset.id)}>
          <Trash2 />
        </Button>
      </div>
    </article>
  )
}
