import { useEffect } from 'react'
import { ExportDialog } from '@/components/ExportDialog'
import { Inspector } from '@/components/Inspector'
import { MediaBin } from '@/components/MediaBin'
import { Preview } from '@/components/Preview'
import { Timeline } from '@/components/Timeline'
import { TopBar } from '@/components/TopBar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { deleteSelectedMarker, downloadProjectFile, getState, importFiles, nudgeSelectedClip, placeMarker, redo, removeSelectedClip, rippleSelectedClip, seek, setPps, splitAtPlayhead, togglePlay, undo } from '@/state/editor'
import { useEditor } from '@/state/hooks'

const FRAME = 1 / 30

export function Editor() {
  const ready = useEditor((state) => state.ready)
  const pps = useEditor((state) => state.pps)

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
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      const typing = target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
        event.preventDefault()
        void downloadProjectFile()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') {
        event.preventDefault()
        redo()
        return
      }
      if (getState().exportOpen && !(event.ctrlKey || event.metaKey)) return
      if (typing) return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.code === 'KeyS') {
        splitAtPlayhead()
      } else if (event.code === 'Delete' || event.code === 'Backspace') {
        event.preventDefault()
        if (getState().selectedMarkerId && !getState().selectedClipId) deleteSelectedMarker()
        else if (event.shiftKey) rippleSelectedClip()
        else removeSelectedClip()
      } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault()
        const direction = event.code === 'ArrowLeft' ? -1 : 1
        nudgeSelectedClip(direction * (event.shiftKey ? 1 : FRAME))
      } else if (event.code === 'KeyM') {
        placeMarker()
      } else if (event.code === 'Home') {
        seek(0)
      } else if (event.code === 'Equal' || event.code === 'NumpadAdd') {
        setPps(pps * 1.2)
      } else if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
        setPps(pps / 1.2)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pps])

  if (!ready) {
    return <div className="grid h-dvh place-items-center text-sm text-muted-foreground">טוען את הפרויקט…</div>
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <MediaBin className="hidden lg:flex" />
        <div className="flex min-h-0 min-w-0 flex-col">
          <Preview />
          <Tabs defaultValue="media" className="max-h-56 shrink-0 border-t lg:hidden">
            <TabsList className="mx-2 mt-2">
              <TabsTrigger value="media">מדיה</TabsTrigger>
              <TabsTrigger value="inspector">מאפיינים</TabsTrigger>
            </TabsList>
            <TabsContent value="media" className="min-h-0">
              <MediaBin className="h-44 border-0" />
            </TabsContent>
            <TabsContent value="inspector" className="min-h-0">
              <Inspector className="h-44 border-0" />
            </TabsContent>
          </Tabs>
        </div>
        <Inspector className="hidden lg:flex" />
      </div>
      <Timeline />
      <ExportDialog />
    </div>
  )
}
