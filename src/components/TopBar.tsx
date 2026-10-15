import { useRef, type ReactNode } from 'react'
import {
  Archive,
  Download,
  FolderOpen,
  HardDrive,
  Keyboard,
  LayoutTemplate,
  Redo2,
  Save,
  Settings,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { projectDuration } from '@/lib/edit'
import { presetLabel } from '@/lib/i18n'
import { formatClock } from '@/lib/time'
import { EXPORT_PRESETS, presetById, type ExportPresetId } from '@/types'
import {
  cancelExport,
  downloadProjectFile,
  downloadProjectPackage,
  endGesture,
  live,
  loadAnyProjectFile,
  redo,
  setExportOpen,
  setExportPreset,
  setFolderOpen,
  setLanguage,
  setSettingsOpen,
  setShortcutOpen,
  setTemplateOpen,
  undo,
} from '@/state/editor'
import { useEditor, useT } from '@/state/hooks'
import type { Language } from '@/lib/i18n'

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

function LanguageToggle({ language }: { language: Language }) {
  const t = useT()
  const item = (id: Language, label: string) => (
    <button
      type="button"
      aria-pressed={language === id}
      className={`h-6 rounded-full px-2 text-[11px] ${language === id ? 'bg-[#094771] text-white' : 'text-muted-foreground'}`}
      onClick={() => setLanguage(id)}
    >
      {label}
    </button>
  )
  return (
    <div className="flex items-center rounded-full border border-border p-0.5" role="group" aria-label={t('language.label')}>
      {item('he', t('language.he'))}
      {item('en', t('language.en'))}
    </div>
  )
}

export function TopBar() {
  const t = useT()
  const language = useEditor((state) => state.language)
  const project = useEditor((state) => state.project)
  const canUndo = useEditor((state) => state.canUndo)
  const canRedo = useEditor((state) => state.canRedo)
  const fileRef = useRef<HTMLInputElement>(null)
  const duration = projectDuration(project)
  const preset = presetById(useEditor((state) => state.exportPreset))
  const job = useEditor((state) => state.exportJob)
  const exportOpen = useEditor((state) => state.exportOpen)

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-[#252526] px-3">
      <div className="flex items-center gap-2 pe-2">
        <div className="grid size-7 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          {t('app.mark')}
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">{t('app.name')}</div>
          <div className="text-[11px] text-muted-foreground">{t('app.tagline')}</div>
        </div>
      </div>
      <Input
        value={project.name}
        onChange={(event) => live((base) => ({ ...base, name: event.target.value }))}
        onBlur={() => endGesture()}
        className="max-w-56"
        aria-label={t('top.projectName')}
        spellCheck={false}
      />
      <div className="ms-1 flex items-center gap-1">
        <ToolButton label={t('top.undo')} disabled={!canUndo} onClick={undo}>
          <Undo2 />
        </ToolButton>
        <ToolButton label={t('top.redo')} disabled={!canRedo} onClick={redo}>
          <Redo2 />
        </ToolButton>
        <ToolButton label={t('top.folder')} onClick={() => setFolderOpen(true)}>
          <HardDrive />
        </ToolButton>
        <ToolButton label={t('top.templates')} onClick={() => setTemplateOpen(true)}>
          <LayoutTemplate />
        </ToolButton>
        <ToolButton label={t('top.shortcuts')} onClick={() => setShortcutOpen(true)}>
          <Keyboard />
        </ToolButton>
        <ToolButton label={t('top.settings')} onClick={() => setSettingsOpen(true)}>
          <Settings />
        </ToolButton>
        <ToolButton label={t('top.saveJson')} onClick={downloadProjectFile}>
          <Save />
        </ToolButton>
        <ToolButton label={t('top.savePackage')} onClick={() => void downloadProjectPackage()}>
          <Archive />
        </ToolButton>
        <ToolButton label={t('top.load')} onClick={() => fileRef.current?.click()}>
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
        <LanguageToggle language={language} />
        <select
          aria-label={t('top.aspect')}
          className="h-7 rounded-full border border-border bg-background px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring"
          value={preset.id}
          onChange={(event) => setExportPreset(event.target.value as ExportPresetId)}
        >
          {EXPORT_PRESETS.map((item) => (
            <option key={item.id} value={item.id}>
              {presetLabel(item.id)}
            </option>
          ))}
        </select>
        {job?.running && !exportOpen && (
          <button type="button" className="flex items-center gap-2 rounded-full border px-2 py-1 text-[11px]" onClick={() => setExportOpen(true)}>
            <span className="max-w-40 truncate">{job.label}</span>
            <span dir="ltr" className="font-mono text-[#50e6ff]">{Math.round(job.ratio * 100)}%</span>
            <span
              className="text-muted-foreground"
              onClick={(event) => {
                event.stopPropagation()
                cancelExport()
              }}
            >
              {t('top.cancel')}
            </span>
          </button>
        )}
        <div dir="ltr" className="font-mono text-xs text-muted-foreground tabular-nums">
          {formatClock(duration)}
        </div>
        <Button type="button" size="sm" disabled={duration <= 0} onClick={() => setExportOpen(true)}>
          <Download />
          {t('top.export')}
        </Button>
      </div>
    </header>
  )
}
