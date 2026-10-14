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
import { useEditor } from '@/state/hooks'
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
  const project = useEditor((state) => state.project)
  const guides = useEditor((state) => state.showGuides)
  const bypass = useEditor((state) => state.gradeBypass)
  const ranged = project.markIn != null && project.markOut != null && project.markOut - project.markIn >= 0.1

  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-[#1e1e1e] px-2 py-1.5">
      <span className="pe-1 text-[11px] font-medium text-muted-foreground">יוטיוב</span>
      <Mini label="כניסה" onClick={markInAtPlayhead} />
      <Mini label="יציאה" onClick={markOutAtPlayhead} />
      <Mini label="ניקוי טווח" onClick={clearExportMarks} />
      <Mini label="לולאה" pressed={project.loopRegion} onClick={() => toggleLoop(!project.loopRegion)} />
      <Mini label="מסגרת" pressed={guides} onClick={() => toggleGuides(!guides)} />
      <Mini label="לפני/אחרי" pressed={bypass} onClick={() => toggleGradeBypass(!bypass)} />
      <Mini label="פס התקדמות" pressed={project.progressBar} onClick={() => toggleProgressBar(!project.progressBar)} />
      <Mini label="פסי קולנוע" pressed={(project.letterbox ?? 0) > 0} onClick={() => toggleLetterbox((project.letterbox ?? 0) <= 0)} />
      <Mini label="מסך סיום" onClick={insertEndScreen} />
      <Mini label="זום ג'אמפ" onClick={jumpZoomTrack} />
      <Mini label="התאמת מוזיקה" onClick={fitMusicBed} />
      <Mini label="פיצול לרוחב" onClick={() => splitSelection('horizontal')} />
      <Mini label="פיצול לגובה" onClick={() => splitSelection('vertical')} />
      {ranged && (
        <span dir="ltr" className="font-mono text-[11px] text-[#50e6ff]">
          {project.markIn!.toFixed(1)}–{project.markOut!.toFixed(1)}s
        </span>
      )}
    </div>
  )
}

export function ClipCreatorFields({ clip }: { clip: Clip }) {
  const toggle = (patch: Partial<Clip>) => {
    patchClip(clip.id, patch)
    endGesture()
  }
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">קול ותמונה</p>
      {!clip.text && (
        <>
          <label className="block space-y-1 text-xs">
            <span className="flex justify-between">
              פאן
              <span dir="ltr" className="font-mono text-muted-foreground">{Math.round((clip.pan ?? 0) * 100)}</span>
            </span>
            <input
              type="range"
              min={-100}
              max={100}
              aria-label="פאן"
              value={Math.round((clip.pan ?? 0) * 100)}
              onChange={(event) => patchClip(clip.id, { pan: Number(event.target.value) / 100 })}
              onPointerUp={() => endGesture()}
              onKeyUp={() => endGesture()}
              className="w-full accent-[#0078d4]"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="flex justify-between">
              קרוספייד שמע
              <span dir="ltr" className="font-mono text-muted-foreground">{(clip.audioCrossfade ?? 0).toFixed(2)}s</span>
            </span>
            <input
              type="range"
              min={0}
              max={150}
              aria-label="קרוספייד שמע"
              value={Math.round((clip.audioCrossfade ?? 0) * 100)}
              onChange={(event) => patchClip(clip.id, { audioCrossfade: Number(event.target.value) / 100 })}
              onPointerUp={() => endGesture()}
              onKeyUp={() => endGesture()}
              className="w-full accent-[#0078d4]"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={clip.voice === true} onChange={(event) => toggle({ voice: event.target.checked })} />
            ליטוש קול
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={clip.gate === true} onChange={(event) => toggle({ gate: event.target.checked })} />
            גייט רעש
          </label>
          <div className="flex flex-wrap gap-2">
            <Mini label="הפרדת שמע" onClick={detachSelectedAudio} />
            <Mini label="ג'י-קאט" onClick={jCutSelected} />
            <Mini label="אל-קאט" onClick={lCutSelected} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Mini label="היפוך אופקי" pressed={clip.flipH} onClick={() => toggleFlip('h')} />
            <Mini label="היפוך אנכי" pressed={clip.flipV} onClick={() => toggleFlip('v')} />
            <Mini label={`סיבוב ${clip.rotation ?? 0}°`} onClick={rotateSelected} />
          </div>
        </>
      )}
      {clip.text && (
        <div className="flex flex-wrap gap-2">
          <Mini label="כתוביות למטה" onClick={() => anchorCaption('bottom')} />
          <Mini label="כתוביות במרכז" onClick={() => anchorCaption('middle')} />
          <Mini label="כתוביות למעלה" onClick={() => anchorCaption('top')} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Mini label="העתקת מאפיינים" onClick={copyAttributes} />
        <Mini label="הדבקת מאפיינים" onClick={pasteAttributes} />
      </div>
    </div>
  )
}
