import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { addTextClip, commitClipEnd, commitClipStart, endGesture, liveFade, liveText, liveVolume, removeSelectedClip } from '@/state/editor'
import { useEditor } from '@/state/hooks'
import { cn } from '@/lib/utils'
import { clipEnd } from '@/lib/edit'
import type { Clip } from '@/types'

export function Inspector({ className }: { className?: string }) {
  const project = useEditor((state) => state.project)
  const assets = useEditor((state) => state.assets)
  const selectedClipId = useEditor((state) => state.selectedClipId)
  const clip = project.clips.find((item) => item.id === selectedClipId) ?? null
  const asset = assets.find((item) => item.id === clip?.assetId) ?? null

  return (
    <aside className={cn('flex min-h-0 flex-col border-s bg-card/40', className)}>
      <div className="flex items-center justify-between px-3 py-3">
        <h2 className="text-sm font-semibold">מאפיינים</h2>
        <Button type="button" size="sm" variant="secondary" onClick={addTextClip}>
          הוספת טקסט
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        {!clip && (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>בחרו קליפ על הציר כדי לערוך עוצמה, עמעום או כתוביות.</p>
            <p>טקסט חדש נוחת בנקודת הניגון, ל-3 שניות, עם «שלום, זה רצף».</p>
          </div>
        )}
        {clip && (
          <div className="space-y-4">
            <div>
              <p className="truncate text-sm font-medium">{clip.text ? 'כתוביות' : asset?.name ?? 'מדיה חסרה'}</p>
              <p className="text-[11px] text-muted-foreground">{clip.trackId}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                key={`${clip.id}:start:${clip.start.toFixed(3)}`}
                label="התחלה"
                value={clip.start}
                onCommit={(value) => commitClipStart(clip.id, value)}
              />
              <NumberField
                key={`${clip.id}:end:${clipEnd(clip).toFixed(3)}`}
                label="סיום"
                value={clipEnd(clip)}
                onCommit={(value) => commitClipEnd(clip.id, value)}
              />
            </div>
            {clip.text && <TextFields clip={clip} />}
            {!clip.text && asset && asset.kind !== 'image' && (
              <div dir="ltr" className="text-[11px] text-muted-foreground">
                in {clip.inPoint.toFixed(2)}s · source {asset.duration.toFixed(2)}s
              </div>
            )}
            {!clip.text && (
              <>
                <Separator />
                <SliderField
                  label="עוצמה"
                  value={Math.round(clip.volume * 100)}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(value) => liveVolume(clip.id, value / 100)}
                />
              </>
            )}
            <SliderField
              label={clip.text ? 'עמעום כניסה' : 'פייד אין'}
              value={clip.fadeIn}
              min={0}
              max={Math.max(0.1, clip.duration)}
              step={0.05}
              suffix="s"
              onChange={(value) => liveFade(clip.id, 'fadeIn', value)}
            />
            <SliderField
              label={clip.text ? 'עמעום יציאה' : 'פייד אאוט'}
              value={clip.fadeOut}
              min={0}
              max={Math.max(0.1, clip.duration)}
              step={0.05}
              suffix="s"
              onChange={(value) => liveFade(clip.id, 'fadeOut', value)}
            />
            <Button type="button" variant="destructive" size="sm" onClick={removeSelectedClip}>
              מחיקת הקליפ
            </Button>
          </div>
        )}
      </div>
    </aside>
  )
}

function TextFields({ clip }: { clip: Clip }) {
  const text = clip.text
  if (!text) return null
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="overlay-text">טקסט</Label>
        <Textarea
          id="overlay-text"
          dir="rtl"
          rows={3}
          value={text.content}
          onChange={(event) => liveText(clip.id, { content: event.target.value })}
          onBlur={() => endGesture()}
        />
      </div>
      <SliderField
        label="גודל גופן"
        value={text.fontSize}
        min={24}
        max={160}
        step={1}
        suffix="px"
        onChange={(value) => liveText(clip.id, { fontSize: value })}
      />
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="overlay-color">צבע</Label>
        <input
          id="overlay-color"
          type="color"
          value={toHex(text.color)}
          onChange={(event) => {
            liveText(clip.id, { color: event.target.value })
            endGesture()
          }}
          className="h-8 w-14 cursor-pointer rounded border bg-transparent"
        />
      </div>
      <SliderField
        label="מיקום אופקי"
        value={Math.round(text.x * 100)}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) => liveText(clip.id, { x: value / 100 })}
      />
      <SliderField
        label="מיקום אנכי"
        value={Math.round(text.y * 100)}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) => liveText(clip.id, { y: value / 100 })}
      />
    </div>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix: string
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <Label>{label}</Label>
        <span dir="ltr" className="font-mono text-muted-foreground">
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}
          {suffix}
        </span>
      </div>
      <Slider
        dir="ltr"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => {
          if (next !== undefined) onChange(next)
        }}
        onValueCommit={() => endGesture()}
      />
    </div>
  )
}

function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState(value.toFixed(2))
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        dir="ltr"
        inputMode="decimal"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const next = Number(text)
          if (Number.isFinite(next)) onCommit(next)
          else setText(value.toFixed(2))
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </div>
  )
}

function toHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color
  return '#ffffff'
}
