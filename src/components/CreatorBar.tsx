import { Button } from '@/components/ui/button'
import {
  anchorCaption,
  clearExportMarks,
  copyAttributes,
  detachSelectedAudio,
  endGesture,
  fitMusicBed,
  insertEndScreen,
  jCutSelected,
  jumpZoomTrack,
  lCutSelected,
  markInAtPlayhead,
  markOutAtPlayhead,
  pasteAttributes,
  patchClip,
  rotateSelected,
  splitSelection,
  toggleFlip,
  toggleGradeBypass,
  toggleGuides,
  toggleLetterbox,
  toggleLoop,
  toggleProgressBar,
} from '@/state/editor'
import { useEditor, useT } from '@/state/hooks'
import type { Clip } from '@/types'

function Mini({
  label,
  pressed,
  onClick,
}: {
  label: string
  pressed?: boolean
  onClick: () => void
}) {
  return (
    <Button type="button" size="sm" variant={pressed ? 'secondary' : 'outline'} aria-pressed={pressed} onClick={onClick}>
      {label}
    </Button>
  )
}

export function CreatorBar() {
  const t = useT()
  const project = useEditor((state) => state.project)
  const guides = useEditor((state) => state.showGuides)
  const bypass = useEditor((state) => state.gradeBypass)
  const ranged = project.markIn != null && project.markOut != null && project.markOut - project.markIn >= 0.1

  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-[#1e1e1e] px-2 py-1.5">
      <span className="pe-1 text-[11px] font-medium text-muted-foreground">{t('creator.youtube')}</span>
      <Mini label={t('creator.markIn')} onClick={markInAtPlayhead} />
      <Mini label={t('creator.markOut')} onClick={markOutAtPlayhead} />
      <Mini label={t('creator.clearRange')} onClick={clearExportMarks} />
      <Mini label={t('creator.loop')} pressed={project.loopRegion} onClick={() => toggleLoop(!project.loopRegion)} />
      <Mini label={t('creator.guides')} pressed={guides} onClick={() => toggleGuides(!guides)} />
      <Mini label={t('creator.beforeAfter')} pressed={bypass} onClick={() => toggleGradeBypass(!bypass)} />
      <Mini label={t('creator.progress')} pressed={project.progressBar} onClick={() => toggleProgressBar(!project.progressBar)} />
      <Mini label={t('creator.letterbox')} pressed={(project.letterbox ?? 0) > 0} onClick={() => toggleLetterbox((project.letterbox ?? 0) <= 0)} />
      <Mini label={t('creator.endScreen')} onClick={insertEndScreen} />
      <Mini label={t('creator.jumpZoom')} onClick={jumpZoomTrack} />
      <Mini label={t('creator.fitMusic')} onClick={fitMusicBed} />
      <Mini label={t('creator.splitH')} onClick={() => splitSelection('horizontal')} />
      <Mini label={t('creator.splitV')} onClick={() => splitSelection('vertical')} />
      {ranged && (
        <span dir="ltr" className="font-mono text-[11px] text-[#50e6ff]">
          {project.markIn!.toFixed(1)}–{project.markOut!.toFixed(1)}s
        </span>
      )}
    </div>
  )
}

export function ClipCreatorFields({ clip }: { clip: Clip }) {
  const t = useT()
  const toggle = (patch: Partial<Clip>) => {
    patchClip(clip.id, patch)
    endGesture()
  }
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">{t('creator.soundPicture')}</p>
      {!clip.text && (
        <>
          <label className="block space-y-1 text-xs">
            <span className="flex justify-between">
              {t('creator.pan')}
              <span dir="ltr" className="font-mono text-muted-foreground">{Math.round((clip.pan ?? 0) * 100)}</span>
            </span>
            <input
              type="range"
              min={-100}
              max={100}
              aria-label={t('creator.pan')}
              value={Math.round((clip.pan ?? 0) * 100)}
              onChange={(event) => patchClip(clip.id, { pan: Number(event.target.value) / 100 })}
              onPointerUp={() => endGesture()}
              onKeyUp={() => endGesture()}
              className="w-full accent-[#0078d4]"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="flex justify-between">
              {t('creator.crossfade')}
              <span dir="ltr" className="font-mono text-muted-foreground">{(clip.audioCrossfade ?? 0).toFixed(2)}s</span>
            </span>
            <input
              type="range"
              min={0}
              max={150}
              aria-label={t('creator.crossfade')}
              value={Math.round((clip.audioCrossfade ?? 0) * 100)}
              onChange={(event) => patchClip(clip.id, { audioCrossfade: Number(event.target.value) / 100 })}
              onPointerUp={() => endGesture()}
              onKeyUp={() => endGesture()}
              className="w-full accent-[#0078d4]"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={clip.voice === true} onChange={(event) => toggle({ voice: event.target.checked })} />
            {t('creator.voice')}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={clip.gate === true} onChange={(event) => toggle({ gate: event.target.checked })} />
            {t('creator.gate')}
          </label>
          <div className="flex flex-wrap gap-2">
            <Mini label={t('creator.detach')} onClick={detachSelectedAudio} />
            <Mini label={t('creator.jcut')} onClick={jCutSelected} />
            <Mini label={t('creator.lcut')} onClick={lCutSelected} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Mini label={t('creator.flipH')} pressed={clip.flipH} onClick={() => toggleFlip('h')} />
            <Mini label={t('creator.flipV')} pressed={clip.flipV} onClick={() => toggleFlip('v')} />
            <Mini label={t('creator.rotate', { degrees: clip.rotation ?? 0 })} onClick={rotateSelected} />
          </div>
        </>
      )}
      {clip.text && (
        <div className="flex flex-wrap gap-2">
          <Mini label={t('creator.capBottom')} onClick={() => anchorCaption('bottom')} />
          <Mini label={t('creator.capMiddle')} onClick={() => anchorCaption('middle')} />
          <Mini label={t('creator.capTop')} onClick={() => anchorCaption('top')} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Mini label={t('creator.copyAttr')} onClick={copyAttributes} />
        <Mini label={t('creator.pasteAttr')} onClick={pasteAttributes} />
      </div>
    </div>
  )
}
