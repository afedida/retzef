import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { getLanguage, lookLabel } from '@/lib/i18n'
import { LOOKS } from '@/lib/looks'
import { formatClock } from '@/lib/time'
import {
  addAdjustment,
  applyLook,
  clearBeats,
  cutFillers,
  cutWord,
  downloadChapters,
  endGesture,
  freezeFrame,
  getPlayhead,
  importFiles,
  liveTransition,
  markBeats,
  nestSelection,
  placeAsset,
  placeMic,
  reframeShorts,
  refreshVersions,
  rememberVersion,
  restoreVersion,
  seek,
  selectClip,
  setCaptionStyle,
  setMask,
  setTrackArmed,
  togglePortrait,
  toggleReverse,
  unnestSelection,
} from '@/state/editor'
import { useEditor, useT } from '@/state/hooks'
import type { TransitionKind } from '@/types'

function Panel({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <aside className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="border-b px-3 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">{children}</div>
    </aside>
  )
}

function Swatch({ kind }: { kind: TransitionKind }) {
  const motion =
    kind === 'slide'
      ? 'group-hover:translate-x-3'
      : kind === 'dip'
        ? 'group-hover:opacity-0'
        : 'group-hover:opacity-30'
  return (
    <span className="relative block h-8 overflow-hidden rounded-md bg-[#1b1b1b]">
      <span className={`absolute inset-y-1 start-1 w-6 rounded-sm bg-[#0e639c] transition-all duration-300 ${motion}`} />
      <span className="absolute inset-y-1 end-1 w-6 rounded-sm bg-[#5c2e91] opacity-80" />
    </span>
  )
}

export function LibraryPanel() {
  const t = useT()
  const clip = useEditor((state) => state.project.clips.find((item) => item.id === state.selectedClipId) ?? null)
  const setTransition = (kind: TransitionKind | null) => {
    if (!clip) return
    liveTransition(clip.id, kind ? { kind, duration: 0.5 } : null)
    endGesture()
  }
  return (
    <Panel title={t('studio.library')} hint={t('studio.libraryHint')}>
      <div>
        <p className="mb-1 text-[11px] text-muted-foreground">{t('studio.looks')}</p>
        <div className="grid grid-cols-3 gap-1">
          {LOOKS.map((look) => (
            <button
              key={look.id}
              type="button"
              className="rounded-full border border-border px-2 py-1 text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => applyLook(look.id)}
            >
              {lookLabel(look.id)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-[11px] text-muted-foreground">{t('studio.transitions')}</p>
        <div className="grid grid-cols-3 gap-1">
          {(['crossfade', 'dip', 'slide'] as TransitionKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className="group rounded-md border border-border p-1 text-[11px] hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setTransition(kind)}
            >
              <Swatch kind={kind} />
              <span className="mt-1 block">{kind === 'crossfade' ? t('studio.crossfade') : kind === 'dip' ? t('studio.dip') : t('studio.slide')}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" variant="secondary" onClick={() => void freezeFrame()}>
          {t('studio.freeze')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={toggleReverse}>
          {clip?.reverse ? t('studio.unreverse') : t('studio.reverse')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={reframeShorts}>
          9:16
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => void markBeats()}>
          {t('studio.beats')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={clearBeats}>
          {t('studio.clearBeats')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" variant="secondary" onClick={() => setMask('ellipse')}>
          {t('studio.ellipseMask')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setMask('vignette')}>
          {t('studio.vignette')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMask('none')}>
          {t('studio.noMask')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={togglePortrait}>
          {clip?.portrait ? t('studio.unportrait') : t('studio.portrait')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={addAdjustment}>
          {t('studio.adjustment')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" variant="secondary" onClick={() => setCaptionStyle('karaoke')}>
          {t('studio.karaoke')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setCaptionStyle('pop')}>
          {t('studio.pop')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setCaptionStyle('plain')}>
          {t('studio.plainCaptions')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setTrackArmed(true)}>
          {t('studio.trackText')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" variant="secondary" onClick={nestSelection}>
          {t('studio.nest')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={unnestSelection}>
          {t('studio.unnest')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={downloadChapters}>
          {t('studio.chapters')}
        </Button>
      </div>
    </Panel>
  )
}

export function TranscriptPanel() {
  const t = useT()
  const project = useEditor((state) => state.project)
  const clips = project.clips.filter((clip) => clip.text).sort((a, b) => a.start - b.start)
  const selected = useEditor((state) => state.selectedClipId)
  const words = clips.flatMap((clip) => clip.words.map((word, index) => ({ clip, word, index })))
  return (
    <Panel title={t('studio.transcript')} hint={t('studio.transcriptHint')}>
      <Button type="button" size="sm" onClick={cutFillers}>
        {t('studio.removeFillers')}
      </Button>
      {!words.length && <p className="text-xs text-muted-foreground">{t('studio.noWords')}</p>}
      <div className="flex flex-wrap gap-1">
        {words.map(({ clip, word, index }) => (
          <span key={`${clip.id}-${index}`} className="inline-flex items-center rounded-full border border-border bg-background">
            <button
              type="button"
              className={`rounded-full px-2 py-0.5 text-xs focus-visible:ring-2 focus-visible:ring-ring ${clip.id === selected ? 'text-[#50e6ff]' : ''}`}
              onClick={() => {
                selectClip(clip.id)
                seek(clip.start + word.start)
              }}
            >
              {word.text}
            </button>
            <button type="button" className="px-1 text-xs text-muted-foreground" aria-label={t('studio.deleteWord', { word: word.text })} onClick={() => cutWord(clip.id, index)}>
              ×
            </button>
          </span>
        ))}
      </div>
    </Panel>
  )
}

export function RecordPanel() {
  const t = useT()
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null)
  const [label, setLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      recorder?.stream.getTracks().forEach((track) => track.stop())
    }
  }, [recorder])

  const start = async (kind: 'mic' | 'cam' | 'screen') => {
    setError(null)
    try {
      const stream =
        kind === 'mic'
          ? await navigator.mediaDevices.getUserMedia({ audio: true })
          : kind === 'cam'
            ? await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      const media = new MediaRecorder(stream)
      const chunks: Blob[] = []
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      media.onstop = () => {
        const type = media.mimeType || (kind === 'mic' ? 'audio/webm' : 'video/webm')
        const blob = new Blob(chunks, { type })
        const name = kind === 'mic' ? t('studio.fileMic') : kind === 'cam' ? t('studio.fileCam') : t('studio.fileScreen')
        const file = new File([blob], name, { type })
        void importFiles([file]).then((assets) => {
          const asset = assets[0]
          if (!asset) return
          if (kind === 'mic') placeMic(asset.id, getPlayhead())
          else placeAsset(asset.id, getPlayhead())
        })
        stream.getTracks().forEach((track) => track.stop())
        setRecorder(null)
        setLabel(null)
      }
      media.start()
      setRecorder(media)
      setLabel(kind === 'mic' ? t('studio.recMic') : kind === 'cam' ? t('studio.recCam') : t('studio.recScreen'))
    } catch {
      setError(t('studio.blocked'))
    }
  }

  return (
    <Panel title={t('studio.record')} hint={t('studio.recordHint')}>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {label && <p className="text-xs text-[#50e6ff]">{label}</p>}
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" disabled={!!recorder} onClick={() => void start('mic')}>
          {t('studio.mic')}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={!!recorder} onClick={() => void start('cam')}>
          {t('studio.cam')}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={!!recorder} onClick={() => void start('screen')}>
          {t('studio.screen')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!recorder}
          onClick={() => recorder?.stop()}
        >
          {t('studio.stop')}
        </Button>
      </div>
    </Panel>
  )
}

export function HistoryPanel() {
  const t = useT()
  const versions = useEditor((state) => state.versions)
  useEffect(() => {
    void refreshVersions()
  }, [])
  return (
    <Panel title={t('studio.versions')} hint={t('studio.versionsHint')}>
      <Button type="button" size="sm" onClick={() => void rememberVersion(true)}>
        {t('studio.saveVersion')}
      </Button>
      {!versions.length && <p className="text-xs text-muted-foreground">{t('studio.noVersions')}</p>}
      <ul className="space-y-1">
        {versions.map((version) => (
          <li key={version.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <div className="min-w-0">
              <div className="truncate text-xs">{version.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {formatClock(version.project.clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0))} ·{' '}
                {new Date(version.savedAt).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={() => restoreVersion(version.id)}>
              {t('studio.restore')}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
