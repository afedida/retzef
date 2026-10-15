import { useState } from 'react'
import { ClipCreatorFields } from '@/components/CreatorBar'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { clipEnd } from '@/lib/edit'
import { displayTrackName, he, type MessageKey } from '@/lib/i18n'
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
  applyTemplate,
  assignLut,
  easeLane,
  exportSrtFile,
  importLutText,
  importSrtText,
  jumpCutSelected,
  patchClip,
  removeSelectedClip,
  removeVolumeKeys,
  setCaptionLanguage,
  setDuck,
  toggleTrackDuck,
  transcribeSelected,
} from '@/state/editor'
import { useEditor, useT } from '@/state/hooks'
import { cn } from '@/lib/utils'
import type { BlendMode, Clip, Ease, TextAlign, TextAnimation, TextFont, TransitionKind } from '@/types'

const FONTS: { id: TextFont; label: string }[] = [
  { id: 'heebo', label: 'Heebo' },
  { id: 'rubik', label: 'Rubik' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'frank', label: 'Frank Ruhl' },
]

const ALIGNS: { id: TextAlign; label: MessageKey }[] = [
  { id: 'start', label: 'inspect.alignStart' },
  { id: 'center', label: 'inspect.alignCenter' },
  { id: 'end', label: 'inspect.alignEnd' },
]

const ANIMS: { id: TextAnimation; label: MessageKey }[] = [
  { id: 'none', label: 'inspect.animNone' },
  { id: 'fade', label: 'inspect.animFade' },
  { id: 'slide', label: 'inspect.animSlide' },
]

const TRANSITIONS: { id: TransitionKind | 'none'; label: MessageKey }[] = [
  { id: 'none', label: 'inspect.transNone' },
  { id: 'crossfade', label: 'inspect.transCross' },
  { id: 'dip', label: 'inspect.transDip' },
  { id: 'slide', label: 'inspect.transSlide' },
]

function named<T extends string>(items: { id: T; label: string }[], tr: (key: MessageKey) => string) {
  return items.map((item) => ({ id: item.id, label: item.label in he ? tr(item.label as MessageKey) : item.label }))
}

export function Inspector({ className }: { className?: string }) {
  const t = useT()
  const project = useEditor((state) => state.project)
  const assets = useEditor((state) => state.assets)
  const selectedClipId = useEditor((state) => state.selectedClipId)
  const clip = project.clips.find((item) => item.id === selectedClipId) ?? null
  const asset = assets.find((item) => item.id === clip?.assetId) ?? null
  const track = project.tracks.find((item) => item.id === clip?.trackId) ?? null

  return (
    <aside className={cn('flex min-h-0 flex-col border-s bg-card/40', className)}>
      <div className="flex items-center justify-between px-3 py-3">
        <h2 className="text-sm font-semibold">{t('inspect.title')}</h2>
        <Button type="button" size="sm" variant="secondary" onClick={() => addTextClip()}>
          {t('inspect.addText')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        <SliderField
          label={t('inspect.master')}
          value={Math.round(project.masterVolume * 100)}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => liveMaster(value / 100)}
        />
        <Separator className="my-4" />
        {!clip && (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t('inspect.pickClip')}</p>
            <p>{t('inspect.newTextHint')}</p>
          </div>
        )}
        {clip && (
          <div className="space-y-4">
            <div>
              <p className="truncate text-sm font-medium">{clip.text ? t('inspect.captions') : asset?.name ?? t('inspect.missing')}</p>
              <p className="text-[11px] text-muted-foreground">{track ? displayTrackName(track.id, track.name) : clip.trackId}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                key={`${clip.id}:start:${clip.start.toFixed(3)}`}
                label={t('inspect.start')}
                value={clip.start}
                onCommit={(value) => commitClipStart(clip.id, value)}
              />
              <NumberField
                key={`${clip.id}:end:${clipEnd(clip).toFixed(3)}`}
                label={t('inspect.end')}
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
                  label={t('inspect.speed')}
                  value={clip.speed}
                  min={0.25}
                  max={4}
                  step={0.05}
                  suffix="x"
                  onChange={(value) => liveSpeed(clip.id, value)}
                />
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={clip.preservePitch !== false}
                    onChange={(event) => {
                      patchClip(clip.id, { preservePitch: event.target.checked })
                      endGesture()
                    }}
                  />
                  {t('inspect.pitch')}
                </label>
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
                  label={t('inspect.volume')}
                  value={Math.round(clip.volume * 100)}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(value) => liveVolume(clip.id, value / 100)}
                />
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={addVolumeKeyAtPlayhead}>
                    {t('inspect.volumeKey')}
                  </Button>
                  {clip.volumeKeys.length > 0 && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeVolumeKeys(clip.id)}>
                      {t('inspect.clearKeys')}
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
                    {t('inspect.duckOther')}
                  </label>
                )}
              </>
            )}
            <SliderField
              label={clip.text ? t('inspect.fadeInText') : t('inspect.fadeIn')}
              value={clip.fadeIn}
              min={0}
              max={Math.max(0.1, clip.duration)}
              step={0.05}
              suffix="s"
              onChange={(value) => liveFade(clip.id, 'fadeIn', value)}
            />
            <SliderField
              label={clip.text ? t('inspect.fadeOutText') : t('inspect.fadeOut')}
              value={clip.fadeOut}
              min={0}
              max={Math.max(0.1, clip.duration)}
              step={0.05}
              suffix="s"
              onChange={(value) => liveFade(clip.id, 'fadeOut', value)}
            />
            <Separator />
            <ClipCreatorFields clip={clip} />
            <Tools clip={clip} />
            <Button type="button" variant="destructive" size="sm" onClick={removeSelectedClip}>
              {t('inspect.deleteClip')}
            </Button>
          </div>
        )}
      </div>
    </aside>
  )
}

function TextFields({ clip }: { clip: Clip }) {
  const t = useT()
  const text = clip.text
  if (!text) return null
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="overlay-text">{t('inspect.text')}</Label>
        <Textarea
          id="overlay-text"
          rows={3}
          value={text.content}
          onChange={(event) => liveText(clip.id, { content: event.target.value })}
          onBlur={() => endGesture()}
        />
      </div>
      <SelectField label={t('inspect.font')} value={text.font} options={FONTS} onChange={(font) => liveText(clip.id, { font })} />
      <SelectField label={t('inspect.align')} value={text.align} options={named(ALIGNS, t)} onChange={(align) => liveText(clip.id, { align })} />
      <SelectField
        label={t('inspect.animation')}
        value={text.animation}
        options={named(ANIMS, t)}
        onChange={(animation) => liveText(clip.id, { animation })}
      />
      {text.animation !== 'none' && (
        <SliderField
          label={t('inspect.animDuration')}
          value={text.animDuration}
          min={0.1}
          max={Math.max(0.2, clip.duration)}
          step={0.05}
          suffix="s"
          onChange={(value) => liveText(clip.id, { animDuration: value })}
        />
      )}
      <SliderField
        label={t('inspect.fontSize')}
        value={text.fontSize}
        min={24}
        max={160}
        step={1}
        suffix="px"
        onChange={(value) => liveText(clip.id, { fontSize: value })}
      />
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="overlay-color">{t('inspect.color')}</Label>
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
          {t('inspect.plate')}
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
          {t('inspect.stroke')}
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
          {t('inspect.shadow')}
        </label>
      </div>
      <SliderField
        label={t('inspect.x')}
        value={Math.round(text.x * 100)}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) => liveText(clip.id, { x: value / 100 })}
      />
      <SliderField
        label={t('inspect.y')}
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
  const t = useT()
  const ken = clip.kenBurns
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">{t('inspect.zoomPos')}</p>
      <SliderField label={t('inspect.zoomStart')} value={ken.scaleStart} min={1} max={3} step={0.05} suffix="x" onChange={(value) => liveKen(clip.id, { scaleStart: value })} />
      <SliderField label={t('inspect.zoomEnd')} value={ken.scaleEnd} min={1} max={3} step={0.05} suffix="x" onChange={(value) => liveKen(clip.id, { scaleEnd: value })} />
      <SliderField label={t('inspect.xStart')} value={Math.round(ken.xStart * 100)} min={0} max={100} suffix="%" onChange={(value) => liveKen(clip.id, { xStart: value / 100 })} />
      <SliderField label={t('inspect.xEnd')} value={Math.round(ken.xEnd * 100)} min={0} max={100} suffix="%" onChange={(value) => liveKen(clip.id, { xEnd: value / 100 })} />
      <SliderField label={t('inspect.yStart')} value={Math.round(ken.yStart * 100)} min={0} max={100} suffix="%" onChange={(value) => liveKen(clip.id, { yStart: value / 100 })} />
      <SliderField label={t('inspect.yEnd')} value={Math.round(ken.yEnd * 100)} min={0} max={100} suffix="%" onChange={(value) => liveKen(clip.id, { yEnd: value / 100 })} />
    </div>
  )
}

function ColorFields({ clip }: { clip: Clip }) {
  const t = useT()
  const color = clip.color
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">{t('inspect.colorTitle')}</p>
      <SliderField label={t('inspect.brightness')} value={color.brightness} min={-1} max={1} step={0.05} suffix="" onChange={(value) => liveColor(clip.id, { brightness: value })} />
      <SliderField label={t('inspect.contrast')} value={color.contrast} min={0} max={2} step={0.05} suffix="" onChange={(value) => liveColor(clip.id, { contrast: value })} />
      <SliderField label={t('inspect.saturation')} value={color.saturation} min={0} max={2} step={0.05} suffix="" onChange={(value) => liveColor(clip.id, { saturation: value })} />
    </div>
  )
}

function TransitionFields({ clip }: { clip: Clip }) {
  const t = useT()
  const kind = clip.transition?.kind ?? 'none'
  return (
    <div className="space-y-3">
      <SelectField
        label={t('inspect.transIn')}
        value={kind}
        options={named(TRANSITIONS, t)}
        onChange={(next) => {
          if (next === 'none') liveTransition(clip.id, null)
          else liveTransition(clip.id, { kind: next, duration: clip.transition?.duration ?? 0.5 })
          endGesture()
        }}
      />
      {clip.transition && (
        <SliderField
          label={t('inspect.transDuration')}
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
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <Label>{label}</Label>
        <span dir="ltr" className="font-mono text-muted-foreground">
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}
          {suffix ?? ''}
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

const BLENDS: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'inspect.blendNormal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'darken', label: 'Darken' },
]

const EASES: { id: Ease; label: MessageKey }[] = [
  { id: 'linear', label: 'inspect.easeLinear' },
  { id: 'easeIn', label: 'inspect.easeIn' },
  { id: 'easeOut', label: 'inspect.easeOut' },
  { id: 'easeInOut', label: 'inspect.easeInOut' },
]

function Tools({ clip }: { clip: Clip }) {
  const t = useT()
  const project = useEditor((state) => state.project)
  const assets = useEditor((state) => state.assets)
  const language = useEditor((state) => state.captionLanguage)
  const lane = useEditor((state) => state.lane)
  const hasImage = assets.some((asset) => asset.kind === 'image')
  const readFile = (accept: string, onText: (name: string, text: string) => void) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      void file.text().then((text) => onText(file.name, text))
    }
    input.click()
  }
  return (
    <div className="space-y-3">
      <Separator />
      <p className="text-xs font-medium">{t('inspect.layer')}</p>
      {!clip.text && (
        <>
          <SliderField label={t('inspect.opacity')} value={Math.round((clip.opacity ?? 1) * 100)} min={0} max={100} suffix="%" onChange={(value) => patchClip(clip.id, { opacity: value / 100 })} />
          <SelectField label={t('inspect.blend')} value={clip.blend ?? 'normal'} options={named(BLENDS, t)} onChange={(blend) => patchClip(clip.id, { blend })} />
          <SliderField label={t('inspect.corners')} value={Math.round((clip.frame?.radius ?? 0) * 100)} min={0} max={100} suffix="%" onChange={(value) => patchClip(clip.id, { frame: { ...clip.frame, radius: value / 100 } })} />
          <SliderField label={t('inspect.border')} value={clip.borderWidth ?? 0} min={0} max={24} step={1} suffix="px" onChange={(value) => patchClip(clip.id, { borderWidth: value })} />
          <div className="grid grid-cols-2 gap-2">
            <SliderField label="X" value={clip.frame?.x ?? 0} min={0} max={1} step={0.01} onChange={(value) => patchClip(clip.id, { frame: { ...clip.frame, x: value } })} />
            <SliderField label="Y" value={clip.frame?.y ?? 0} min={0} max={1} step={0.01} onChange={(value) => patchClip(clip.id, { frame: { ...clip.frame, y: value } })} />
            <SliderField label={t('inspect.width')} value={clip.frame?.w ?? 1} min={0.05} max={1} step={0.01} onChange={(value) => patchClip(clip.id, { frame: { ...clip.frame, w: value } })} />
            <SliderField label={t('inspect.height')} value={clip.frame?.h ?? 1} min={0.05} max={1} step={0.01} onChange={(value) => patchClip(clip.id, { frame: { ...clip.frame, h: value } })} />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={clip.chroma?.enabled === true}
              onChange={(event) => {
                patchClip(clip.id, { chroma: { ...clip.chroma, enabled: event.target.checked } })
                endGesture()
              }}
            />
            {t('inspect.chroma')}
          </label>
          {clip.chroma?.enabled && (
            <SliderField
              label={t('inspect.chromaThreshold')}
              value={clip.chroma.threshold}
              min={0.05}
              max={1}
              step={0.01}
              onChange={(value) => patchClip(clip.id, { chroma: { ...clip.chroma, threshold: value } })}
            />
          )}
          <SelectField
            label="LUT"
            value={clip.lutId ?? 'none'}
            options={[{ id: 'none', label: t('inspect.noLut') }, ...project.luts.map((lut) => ({ id: lut.id, label: lut.name }))]}
            onChange={(lutId) => assignLut(lutId === 'none' ? null : lutId)}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => readFile('.cube,text/plain', (name, text) => importLutText(name, text))}>
            {t('inspect.importLut')}
          </Button>
        </>
      )}
      <SelectField
        label={t('inspect.keyEase')}
        value={clip.keys?.[lane]?.[0]?.ease ?? clip.volumeKeys[0]?.ease ?? 'linear'}
        options={named(EASES, t)}
        onChange={(ease) => easeLane(ease)}
      />
      <p className="text-[11px] text-muted-foreground">{t('inspect.keyEaseHint', { lane: t(({ volume: 'timeline.volume', opacity: 'timeline.opacity', scale: 'timeline.scale', x: 'timeline.x', y: 'timeline.y' } as const)[lane]) })}</p>
      {clip.assetId && (
        <>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={clip.denoise === true} onChange={(event) => { patchClip(clip.id, { denoise: event.target.checked }); endGesture() }} />
            {t('inspect.denoise')}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={clip.normalize === true} onChange={(event) => { patchClip(clip.id, { normalize: event.target.checked }); endGesture() }} />
            {t('inspect.normalize')}
          </label>
          <Button type="button" size="sm" variant="outline" onClick={() => void jumpCutSelected()}>
            {t('inspect.silence')}
          </Button>
        </>
      )}
      <Separator />
      <p className="text-xs font-medium">{t('inspect.autoCaptions')}</p>
      <SelectField
        label={t('inspect.captionLang')}
        value={language}
        options={[
          { id: 'hebrew', label: t('inspect.hebrew') },
          { id: 'english', label: t('inspect.english') },
        ]}
        onChange={(value) => setCaptionLanguage(value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={!clip.assetId} onClick={() => void transcribeSelected()}>
          {t('inspect.transcribe')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => readFile('.srt,text/plain', (_name, text) => importSrtText(text))}>
          {t('inspect.importSrt')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={exportSrtFile}>
          {t('inspect.exportSrt')}
        </Button>
      </div>
      <Separator />
      <p className="text-xs font-medium">{t('inspect.templates')}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => applyTemplate('lower')}>{t('inspect.lower')}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => applyTemplate('intro')}>{t('inspect.intro')}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => applyTemplate('outro')}>{t('inspect.outro')}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => applyTemplate('rect')}>{t('inspect.rect')}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => applyTemplate('ellipse')}>{t('inspect.ellipse')}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => applyTemplate('star')}>{t('inspect.star')}</Button>
        <Button type="button" size="sm" variant="outline" disabled={!hasImage} onClick={() => applyTemplate('watermark')}>{t('inspect.watermark')}</Button>
      </div>
      <Separator />
      <p className="text-xs font-medium">{t('inspect.duckTitle')}</p>
      <SliderField label={t('inspect.duckAmount')} value={Math.round((project.duckAmount ?? 0.72) * 100)} min={0} max={100} suffix="%" onChange={(value) => setDuck({ duckAmount: value / 100 })} />
      <SliderField label={t('inspect.attack')} value={project.duckAttack ?? 0.08} min={0} max={1} step={0.01} suffix="s" onChange={(value) => setDuck({ duckAttack: value })} />
      <SliderField label={t('inspect.release')} value={project.duckRelease ?? 0.28} min={0} max={1.5} step={0.01} suffix="s" onChange={(value) => setDuck({ duckRelease: value })} />
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
        onBlur={(event) => {
          const next = Number(event.currentTarget.value)
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
