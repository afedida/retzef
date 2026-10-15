import { useEffect, useState } from 'react'
import { Captions, Clapperboard, Film, History, Mic, SlidersHorizontal } from 'lucide-react'
import { ExportDialog } from '@/components/ExportDialog'
import { Inspector } from '@/components/Inspector'
import { MediaBin } from '@/components/MediaBin'
import { Preview } from '@/components/Preview'
import { HistoryPanel, LibraryPanel, RecordPanel, TranscriptPanel } from '@/components/StudioPanels'
import { Timeline } from '@/components/Timeline'
import { TopBar } from '@/components/TopBar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { presetById } from '@/types'
import { CreatorBar } from '@/components/CreatorBar'
import { FolderDialog, ShortcutDialog, TemplateDialog } from '@/components/ProjectDialogs'
import { matchShortcut, type ShortcutId } from '@/lib/shortcuts'
import { clearExportMarks, copySelection, deleteSelectedMarker, getState, groupSelection, importFiles, markInAtPlayhead, markOutAtPlayhead, nudgeSelectedClip, pasteSelection, placeMarker, redo, removeSelectedClip, rippleSelectedClip, saveActiveProject, seek, setPps, splitAtPlayhead, toggleLoop, togglePlay, undo, ungroupSelection } from '@/state/editor'
import { useEditor } from '@/state/hooks'

type PanelId = 'media' | 'inspect' | 'library' | 'transcript' | 'record' | 'history'

const PANELS: { id: PanelId; label: string; icon: typeof Film }[] = [
  { id: 'media', label: 'מדיה', icon: Film },
  { id: 'inspect', label: 'מאפיינים', icon: SlidersHorizontal },
  { id: 'library', label: 'כלים', icon: Clapperboard },
  { id: 'transcript', label: 'תמלול', icon: Captions },
  { id: 'record', label: 'הקלטה', icon: Mic },
  { id: 'history', label: 'גרסאות', icon: History },
]

function SidePanel({ panel }: { panel: PanelId }) {
  if (panel === 'inspect') return <Inspector className="min-h-0 flex-1 border-0" />
  if (panel === 'library') return <LibraryPanel />
  if (panel === 'transcript') return <TranscriptPanel />
  if (panel === 'record') return <RecordPanel />
  if (panel === 'history') return <HistoryPanel />
  return <MediaBin className="min-h-0 flex-1 border-0" />
}

export function Editor() {
  const ready = useEditor((state) => state.ready)
  const pps = useEditor((state) => state.pps)
  const shortcuts = useEditor((state) => state.shortcuts)
  const [panel, setPanel] = useState<PanelId>('media')

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types || ![...event.dataTransfer.types].includes('Files')) return
      event.preventDefault()
    }
    const onDrop = (event: DragEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('[data-drop-zone]')) return
      const files = [...(event.dataTransfer?.files ?? [])]
      if (!files.length) return
      event.preventDefault()
      void importFiles(files)
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [])

  useEffect(() => {
    const run = (action: ShortcutId) => {
      const fps = presetById(getState().exportPreset).fps
      if (action === 'save') void saveActiveProject()
      else if (action === 'undo') undo()
      else if (action === 'redo') redo()
      else if (action === 'copy') copySelection()
      else if (action === 'paste') pasteSelection()
      else if (action === 'group') groupSelection()
      else if (action === 'ungroup') ungroupSelection()
      else if (action === 'play') togglePlay()
      else if (action === 'split') splitAtPlayhead()
      else if (action === 'delete') {
        if (getState().selectedMarkerId && !getState().selectedClipId) deleteSelectedMarker()
        else removeSelectedClip()
      } else if (action === 'rippleDelete') rippleSelectedClip()
      else if (action === 'nudgeLeft') nudgeSelectedClip(-1 / fps)
      else if (action === 'nudgeRight') nudgeSelectedClip(1 / fps)
      else if (action === 'nudgeLeftSecond') nudgeSelectedClip(-1)
      else if (action === 'nudgeRightSecond') nudgeSelectedClip(1)
      else if (action === 'marker') placeMarker()
      else if (action === 'markIn') markInAtPlayhead()
      else if (action === 'markOut') markOutAtPlayhead()
      else if (action === 'loop') toggleLoop(!getState().project.loopRegion)
      else if (action === 'clearMarks') clearExportMarks()
      else if (action === 'goStart') seek(0)
      else if (action === 'zoomIn') setPps(pps * 1.2)
      else if (action === 'zoomOut') setPps(pps / 1.2)
    }
    const onKey = (event: KeyboardEvent) => {
      if (getState().shortcutCapture) return
      const target = event.target
      const typing = target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
      const inDialog = target instanceof HTMLElement && Boolean(target.closest('[role="dialog"]'))
      const action = matchShortcut(shortcuts, event, typing || inDialog)
      if (!action) return
      event.preventDefault()
      run(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pps, shortcuts])

  if (!ready) {
    return <div className="grid h-dvh place-items-center text-sm text-muted-foreground">טוען את הפרויקט…</div>
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <FolderDialog />
      <TemplateDialog />
      <ShortcutDialog />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="לוחות" className="flex w-12 shrink-0 flex-col items-center gap-1 border-e bg-[#1e1e1e] py-2">
          {PANELS.map((item) => {
            const Icon = item.icon
            const active = panel === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                aria-pressed={active}
                title={item.label}
                className={cn(
                  'grid size-8 place-items-center rounded-md text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring',
                  active && 'bg-[#094771] text-white',
                )}
                onClick={() => setPanel(item.id)}
              >
                <Icon className="size-4" />
              </button>
            )
          })}
        </nav>
        <div className="hidden w-80 shrink-0 border-e lg:flex">
          <SidePanel panel={panel} />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Preview />
          <Tabs value={panel} onValueChange={(value) => setPanel(value as PanelId)} className="max-h-64 shrink-0 border-t lg:hidden">
            <TabsList className="mx-2 mt-2 w-auto overflow-x-auto">
              {PANELS.map((item) => (
                <TabsTrigger key={item.id} value={item.id}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={panel} className="min-h-0">
              <div className="h-52">
                <SidePanel panel={panel} />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <CreatorBar />
      <Timeline />
      <ExportDialog />
    </div>
  )
}
