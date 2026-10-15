import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { directoryPickerSupported } from '@/lib/folderStore'
import { shortcutLabel, templatePartLabel } from '@/lib/i18n'
import {
  PREMIERE_SHORTCUTS,
  SHORTCUT_IDS,
  cloneBindings,
  findConflict,
  formatBinding,
  rebind,
  type Chord,
  type ShortcutId,
} from '@/lib/shortcuts'
import { TEMPLATE_PARTS, templateDocument, type TemplatePart } from '@/lib/userTemplates'
import {
  applyShortcutBindings,
  applyStoredTemplate,
  deleteStoredTemplate,
  importShortcutText,
  importTemplateText,
  openFolderProject,
  openRecentFolder,
  renameStoredTemplate,
  resetShortcutBindings,
  saveCurrentTemplate,
  saveProjectToFolder,
  setFolderOpen,
  setShortcutCapture,
  setLanguage,
  setSettingsOpen,
  setShortcutOpen,
  setTemplateOpen,
  shortcutFileText,
} from '@/state/editor'
import { useEditor, useT } from '@/state/hooks'
import type { Language } from '@/lib/i18n'

function saveText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function FolderDialog() {
  const t = useT()
  const open = useEditor((state) => state.folderOpen)
  const recent = useEditor((state) => state.recentFolders)
  const linked = useEditor((state) => state.folderName)
  const supported = directoryPickerSupported()
  return (
    <Dialog open={open} onOpenChange={setFolderOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('folder.title')}</DialogTitle>
          <DialogDescription>{t('folder.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {linked && <p className="text-[#50e6ff]">{t('folder.linked', { name: linked })}</p>}
          {!supported && (
            <p className="rounded-md bg-muted/60 px-2 py-1.5 text-muted-foreground">
              {t('folder.unsupported')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!supported} onClick={() => void saveProjectToFolder()}>
              {t('folder.save')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!supported} onClick={() => void openFolderProject()}>
              {t('folder.open')}
            </Button>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('folder.recent')}</p>
            {recent.length === 0 && <p className="text-xs text-muted-foreground">{t('folder.empty')}</p>}
            {recent.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-md border px-2 py-1">
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <Button type="button" size="sm" variant="ghost" disabled={!supported} onClick={() => void openRecentFolder(item.id)}>
                  {t('folder.openItem')}
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setFolderOpen(false)}>
            {t('folder.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TemplateDialog() {
  const t = useT()
  const open = useEditor((state) => state.templateOpen)
  const templates = useEditor((state) => state.templates)
  const suggested = t('template.newName')
  const [customName, setCustomName] = useState<string | null>(null)
  const name = customName ?? suggested
  const [parts, setParts] = useState<TemplatePart[]>(['intro', 'outro', 'logo', 'captionStyle', 'tracks', 'preset'])
  const [error, setError] = useState<string | null>(null)
  const toggle = (part: TemplatePart) => {
    setParts((current) => (current.includes(part) ? current.filter((item) => item !== part) : [...current, part]))
  }
  return (
    <Dialog open={open} onOpenChange={setTemplateOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('templates.title')}</DialogTitle>
          <DialogDescription>{t('templates.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input aria-label={t('templates.name')} value={name} onChange={(event) => setCustomName(event.target.value)} />
          <div className="grid grid-cols-2 gap-2 text-xs">
            {TEMPLATE_PARTS.map((part) => (
              <label key={part} className="flex items-center gap-2">
                <input type="checkbox" checked={parts.includes(part)} onChange={() => toggle(part)} />
                {templatePartLabel(part)}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void saveCurrentTemplate(name, parts)}>
              {t('templates.save')}
            </Button>
            <label className="inline-flex">
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  void file.text().then((text) => {
                    try {
                      importTemplateText(text)
                      setError(null)
                    } catch {
                      setError(t('templates.badFile'))
                    }
                  })
                }}
              />
              <span className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs">{t('templates.import')}</span>
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="max-h-56 space-y-2 overflow-auto">
            {templates.length === 0 && <p className="text-xs text-muted-foreground">{t('templates.empty')}</p>}
            {templates.map((template) => (
              <div key={template.id} className="space-y-1 rounded-md border px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={t('templates.rename', { name: template.name })}
                    defaultValue={template.name}
                    className="h-7"
                    onBlur={(event) => void renameStoredTemplate(template.id, event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button type="button" size="sm" onClick={() => applyStoredTemplate(template.id)}>
                    {t('templates.newProject')}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => saveText(`${template.name}.retzef-template.json`, templateDocument(template))}>
                    {t('templates.export')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void deleteStoredTemplate(template.id)}>
                    {t('templates.delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setTemplateOpen(false)}>
            {t('templates.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ShortcutDialog() {
  const t = useT()
  const open = useEditor((state) => state.shortcutOpen)
  const bindings = useEditor((state) => state.shortcuts)
  const [listen, setListen] = useState<ShortcutId | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  useEffect(() => {
    if (!listen) return
    setShortcutCapture(true)
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        setListen(null)
        setShortcutCapture(false)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const chord: Chord = { code: event.code, mod: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey }
      const hit = findConflict(bindings, listen, chord)
      if (hit) {
        setConflict(t('shortcuts.conflict', { label: shortcutLabel(hit) }))
        return
      }
      const next = rebind(bindings, listen, chord, 0)
      if (next.ok) {
        applyShortcutBindings(next.bindings)
        setConflict(null)
        setListen(null)
        setShortcutCapture(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      setShortcutCapture(false)
    }
  }, [listen, bindings, t])
  return (
    <Dialog open={open} onOpenChange={setShortcutOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={resetShortcutBindings}>
            {t('shortcuts.reset')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => applyShortcutBindings(cloneBindings(PREMIERE_SHORTCUTS))}>
            {t('shortcuts.premiere')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => saveText('retzef-shortcuts.json', shortcutFileText())}>
            {t('shortcuts.export')}
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                void file.text().then((text) => {
                  if (!importShortcutText(text)) setConflict(t('shortcuts.badFile'))
                  else setConflict(null)
                })
              }}
            />
            <span className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs">{t('shortcuts.import')}</span>
          </label>
        </div>
        {listen && <p className="text-xs text-[#50e6ff]">{t('shortcuts.listen', { label: shortcutLabel(listen) })}</p>}
        {conflict && <p className="text-xs text-destructive">{conflict}</p>}
        <div className="max-h-72 space-y-1 overflow-auto">
          {SHORTCUT_IDS.map((id) => (
            <div key={id} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{shortcutLabel(id)}</span>
              <span dir="ltr" className="font-mono text-muted-foreground">
                {formatBinding(bindings[id])}
              </span>
              <Button type="button" size="sm" variant={listen === id ? 'secondary' : 'ghost'} onClick={() => setListen(id)}>
                {t('shortcuts.assign')}
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setShortcutOpen(false)}>
            {t('shortcuts.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SettingsDialog() {
  const t = useT()
  const open = useEditor((state) => state.settingsOpen)
  const language = useEditor((state) => state.language)
  const choose = (next: Language) => setLanguage(next)
  return (
    <Dialog open={open} onOpenChange={setSettingsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('language.settings')}</DialogTitle>
          <DialogDescription>{t('language.hint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('language.ui')}</p>
          <div className="flex gap-2" role="group" aria-label={t('language.label')}>
            <Button type="button" size="sm" variant={language === 'he' ? 'secondary' : 'outline'} aria-pressed={language === 'he'} onClick={() => choose('he')}>
              {t('language.he')}
            </Button>
            <Button type="button" size="sm" variant={language === 'en' ? 'secondary' : 'outline'} aria-pressed={language === 'en'} onClick={() => choose('en')}>
              {t('language.en')}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>
            {t('action.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
