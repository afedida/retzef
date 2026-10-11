import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { clipEnd } from '@/lib/edit'
import {
  addTextClip,
  addVolumeKeyAtPlayhead,
  commitClipEnd,
  commitClipStart,
  endGesture,
  liveColor,
  liveFade,
  liveKen,
  liveMaster,
  liveSpeed,
  liveText,
  liveTransition,
  liveVolume,
  removeSelectedClip,
  removeVolumeKeys,
  toggleTrackDuck,
} from '@/state/editor'
import { useEditor } from '@/state/hooks'
import { cn } from '@/lib/utils'
import type { Clip, TextAlign, TextAnimation, TextFont, TransitionKind } from '@/types'

const FONTS: { id: TextFont; label: string }[] = [
  { id: 'heebo', label: 'Heebo' },
  { id: 'rubik', label: 'Rubik' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'frank', label: 'Frank Ruhl' },
]

const ALIGNS: { id: TextAlign; label: string }[] = [
  { id: 'start', label: 'התחלה' },
  { id: 'center', label: 'מרכז' },
  { id: 'end', label: 'סוף' },
]

const ANIMS: { id: TextAnimation; label: string }[] = [
  { id: 'none', label: 'בלי' },
  { id: 'fade', label: 'עמעום' },
  { id: 'slide', label: 'החלקה' },
]

const TRANSITIONS: { id: TransitionKind | 'none'; label: string }[] = [
  { id: 'none', label: 'בלי מעבר' },
  { id: 'crossfade', label: 'קרוספייד' },
  { id: 'dip', label: 'שקיעה לשחור' },
  { id: 'slide', label: 'החלקה' },
]

export function Inspector({ className }: { className?: string }) {
  const project = useEditor((state) => state.project)
  const assets = useEditor((state) => state.assets)
  const selectedClipId = useEditor((state) => state.selectedClipId)
  const clip = project.clips.find((item) => item.id === selectedClipId) ?? null
  const asset = assets.find((item) => item.id === clip?.assetId) ?? null
  const track = project.tracks.find((item) => item.id === clip?.trackId) ?? null

  return (
    <aside className={cn('flex min-h-0 flex-col border-s bg-card/40', className)}>
      <div className="flex items-center justify-between px-3 py-3">
        <h2 className="text-sm font-semibold">מאפיינים</h2>
        <Button type="button" size="sm" variant="secondary" onClick={() => addTextClip()}>
          הוספת טקסט
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        <SliderField
          label="עוצמת מאסטר"
          value={Math.round(project.masterVolume * 100)}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => liveMaster(value / 100)}
        />
        <Separator className="my-4" />
        {!clip && (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>בחרו קליפ על הציר כדי לערוך מהירות, צבע, מעבר או כתוביות.</p>
            <p>טקסט חדש נוחת בנקודת הניגון. מסלולי טקסט נוספים נפתחים מהציר.</p>
          </div>
        )}
        {clip && (
          <div className="space-y-4">
            <div>
              <p className="truncate text-sm font-medium">{clip.text ? 'כתוביות' : asset?.name ?? 'מדיה חסרה'}</p>
              <p className="text-[11px] text-muted-foreground">{track?.name ?? clip.trackId}</p>
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
            {asset?.kind === 'video' && (
              <>
                <Separator />
                <SliderField
                  label="מהירות"
                  value={clip.speed}
                  min={0.25}
                  max={4}
                  step={0.05}
                  suffix="x"
                  onChange={(value) => liveSpeed(clip.id, value)}
                />
                <p className="text-[11px] text-muted-foreground">הגובה של הצליל משתנה עם המהירות.</p>
              </>
            )}
            {!clip.text && asset && asset.kind !== 'audio' && (
              <>
                <KenFields clip={clip} />
                <ColorFields clip={clip} />
              </>
            )}
            {!clip.text && asset?.kind === 'video' && <TransitionFields clip={clip} />}
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
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={addVolumeKeyAtPlayhead}>
                    נקודת עוצמה
                  </Button>
                  {clip.volumeKeys.length > 0 && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeVolumeKeys(clip.id)}>
                      ניקוי נקודות
                    </Button>
                  )}
                </div>
                {clip.volumeKeys.length > 0 && (
                  <p dir="ltr" className="font-mono text-[11px] text-muted-foreground">
                    {clip.volumeKeys.map((key) => `${Math.round(key.time * 100)}% ${Math.round(key.value * 100)}`).join(' · ')}
                  </p>
                )}
                {track?.type === 'audio' && (
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={track.duck}
                      onChange={(event) => toggleTrackDuck(track.id, event.target.checked)}
                    />
                    הנמכה כשיש שמע במסלול אחר
                  </label>
                )}
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
      <SelectField label="גופן" value={text.font} options={FONTS} onChange={(font) => liveText(clip.id, { font })} />
      <SelectField label="יישור" value={text.align} options={ALIGNS} onChange={(align) => liveText(clip.id, { align })} />
      <SelectField
        label="אנימציה"
        value={text.animation}
        options={ANIMS}
        onChange={(animation) => liveText(clip.id, { animation })}
      />
      {text.animation !== 'none' && (
        <SliderField
          label="משך אנימציה"
          value={text.animDuration}
          min={0.1}
          max={Math.max(0.2, clip.duration)}
          step={0.05}
          suffix="s"
          onChange={(value) => liveText(clip.id, { animDuration: value })}
        />
      )}
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
      <div className="flex flex-wrap gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={text.plate}
            onChange={(event) => {
              liveText(clip.id, { plate: event.target.checked })
              endGesture()
            }}
          />
          לוחית רקע
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={text.stroke}
            onChange={(event) => {
              liveText(clip.id, { stroke: event.target.checked })
              endGesture()
            }}
          />
          קו מתאר
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={text.shadow}
            onChange={(event) => {
              liveText(clip.id, { shadow: event.target.checked })
              endGesture()
            }}
          />
          צל
        </label>
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

function KenFields({ clip }: { clip: Clip }) {
  const ken = clip.kenBurns
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">זום ומיקום</p>
      <SliderField label="זום התחלה" value={ken.scaleStart} min={1} max={3} step={0.05} suffix="x" onChange={(value) => liveKen(clip.id, { scaleStart: value })} />
      <SliderField label="זום סיום" value={ken.scaleEnd} min={1} max={3} step={0.05} suffix="x" onChange={(value) => liveKen(clip.id, { scaleEnd: value })} />
      <SliderField label="אופקי התחלה" value={Math.round(ken.xStart * 100)} min={0} max={100} suffix="%" onChange={(value) => liveKen(clip.id, { xStart: value / 100 })} />
      <SliderField label="אופקי סיום" value={Math.round(ken.xEnd * 100)} min={0} max={100} suffix="%" onChange={(value) => liveKen(clip.id, { xEnd: value / 100 })} />
      <SliderField label="אנכי התחלה" value={Math.round(ken.yStart * 100)} min={0} max={100} suffix="%" onChange={(value) => liveKen(clip.id, { yStart: value / 100 })} />
      <SliderField label="אנכי סיום" value={Math.round(ken.yEnd * 100)} min={0} max={100} suffix="%" onChange={(value) => liveKen(clip.id, { yEnd: value / 100 })} />
    </div>
  )
}

function ColorFields({ clip }: { clip: Clip }) {
  const color = clip.color
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">צבע</p>
      <SliderField label="בהירות" value={color.brightness} min={-1} max={1} step={0.05} suffix="" onChange={(value) => liveColor(clip.id, { brightness: value })} />
      <SliderField label="ניגודיות" value={color.contrast} min={0} max={2} step={0.05} suffix="" onChange={(value) => liveColor(clip.id, { contrast: value })} />
      <SliderField label="רווייה" value={color.saturation} min={0} max={2} step={0.05} suffix="" onChange={(value) => liveColor(clip.id, { saturation: value })} />
    </div>
  )
}

function TransitionFields({ clip }: { clip: Clip }) {
  const kind = clip.transition?.kind ?? 'none'
  return (
    <div className="space-y-3">
      <SelectField
        label="מעבר כניסה"
        value={kind}
        options={TRANSITIONS}
        onChange={(next) => {
          if (next === 'none') liveTransition(clip.id, null)
          else liveTransition(clip.id, { kind: next, duration: clip.transition?.duration ?? 0.5 })
          endGesture()
        }}
      />
      {clip.transition && (
        <SliderField
          label="משך מעבר"
          value={clip.transition.duration}
          min={0.1}
          max={2}
          step={0.05}
          suffix="s"
          onChange={(value) => liveTransition(clip.id, { kind: clip.transition!.kind, duration: value })}
        />
      )}
    </div>
  )
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <select
        className="h-8 w-full rounded-md border bg-background px-2 text-sm"
        value={value}
        onChange={(event) => {
          onChange(event.target.value as T)
          endGesture()
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
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
