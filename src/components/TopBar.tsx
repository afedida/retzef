import { useRef, type ReactNode } from 'react'
import {
  Archive,
  Download,
  FolderOpen,
  Redo2,
  Save,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { projectDuration } from '@/lib/edit'
import { formatClock } from '@/lib/time'
import { EXPORT_PRESETS, presetById, type ExportPresetId } from '@/types'
import {
  downloadProjectFile,
  downloadProjectPackage,
  endGesture,
  live,
  loadAnyProjectFile,
  redo,
  setExportOpen,
  setExportPreset,
  undo,
} from '@/state/editor'
import { useEditor } from '@/state/hooks'

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function TopBar() {
  const project = useEditor((state) => state.project)
  const canUndo = useEditor((state) => state.canUndo)
  const canRedo = useEditor((state) => state.canRedo)
  const fileRef = useRef<HTMLInputElement>(null)
  const duration = projectDuration(project)
  const preset = presetById(useEditor((state) => state.exportPreset))

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-[#252526] px-3">
      <div className="flex items-center gap-2 pe-2">
        <div className="grid size-7 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          ר
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">רצף</div>
          <div className="text-[11px] text-muted-foreground">עורך וידאו</div>
        </div>
      </div>
      <Input
        value={project.name}
        onChange={(event) => live((base) => ({ ...base, name: event.target.value }))}
        onBlur={() => endGesture()}
        className="max-w-56"
        aria-label="שם הפרויקט"
        spellCheck={false}
      />
      <div className="ms-1 flex items-center gap-1">
        <ToolButton label="בטל (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 />
        </ToolButton>
        <ToolButton label="בצע שוב (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
          <Redo2 />
        </ToolButton>
        <ToolButton label="שמירת JSON" onClick={downloadProjectFile}>
          <Save />
        </ToolButton>
        <ToolButton label="שמירת חבילה עם מדיה" onClick={() => void downloadProjectPackage()}>
          <Archive />
        </ToolButton>
        <ToolButton label="טעינת JSON או חבילה" onClick={() => fileRef.current?.click()}>
          <FolderOpen />
        </ToolButton>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json,.zip,application/zip"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void loadAnyProjectFile(file)
            event.target.value = ''
          }}
        />
      </div>
      <div className="ms-auto flex items-center gap-2">
        <select
          aria-label="יחס תמונה"
          className="h-7 rounded-full border border-border bg-background px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring"
          value={preset.id}
          onChange={(event) => setExportPreset(event.target.value as ExportPresetId)}
        >
          {EXPORT_PRESETS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <div dir="ltr" className="font-mono text-xs text-muted-foreground tabular-nums">
          {formatClock(duration)}
        </div>
        <Button type="button" size="sm" disabled={duration <= 0} onClick={() => setExportOpen(true)}>
          <Download />
          ייצוא MP4
        </Button>
      </div>
    </header>
  )
}
