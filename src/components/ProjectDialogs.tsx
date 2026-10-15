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
import {
  PREMIERE_SHORTCUTS,
  SHORTCUT_IDS,
  SHORTCUT_LABELS,
  cloneBindings,
  findConflict,
  formatBinding,
  rebind,
  type Chord,
  type ShortcutId,
} from '@/lib/shortcuts'
import { TEMPLATE_PARTS, TEMPLATE_PART_LABELS, templateDocument, type TemplatePart } from '@/lib/userTemplates'
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
  setShortcutOpen,
  setTemplateOpen,
  shortcutFileText,
} from '@/state/editor'
import { useEditor } from '@/state/hooks'

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
  const open = useEditor((state) => state.folderOpen)
  const recent = useEditor((state) => state.recentFolders)
  const linked = useEditor((state) => state.folderName)
  const supported = directoryPickerSupported()
  return (
    <Dialog open={open} onOpenChange={setFolderOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>תיקיית פרויקט</DialogTitle>
          <DialogDescription>
            הפרויקט נשמר כ־retzef.json יחד עם קבצי המדיה, ומתעדכן אוטומטית. בלי תמיכה בדפדפן נשארת השמירה המקומית וההורדה של JSON או zip.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {linked && <p className="text-[#50e6ff]">מקושר עכשיו: {linked}</p>}
          {!supported && (
            <p className="rounded-md bg-muted/60 px-2 py-1.5 text-muted-foreground">
              הדפדפן הזה לא מציע בחירת תיקייה. השמירה האוטומטית נשארת בתוך הדפדפן.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!supported} onClick={() => void saveProjectToFolder()}>
              שמירה לתיקייה
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!supported} onClick={() => void openFolderProject()}>
              פתיחת תיקייה
            </Button>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">פרויקטים אחרונים</p>
            {recent.length === 0 && <p className="text-xs text-muted-foreground">אין עדיין תיקיות שמורות.</p>}
            {recent.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-md border px-2 py-1">
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <Button type="button" size="sm" variant="ghost" disabled={!supported} onClick={() => void openRecentFolder(item.id)}>
                  פתיחה
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setFolderOpen(false)}>
            סגירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TemplateDialog() {
  const open = useEditor((state) => state.templateOpen)
  const templates = useEditor((state) => state.templates)
  const [name, setName] = useState('תבנית חדשה')
  const [parts, setParts] = useState<TemplatePart[]>(['intro', 'outro', 'logo', 'captionStyle', 'tracks', 'preset'])
  const [error, setError] = useState<string | null>(null)
  const toggle = (part: TemplatePart) => {
    setParts((current) => (current.includes(part) ? current.filter((item) => item !== part) : [...current, part]))
  }
  return (
    <Dialog open={open} onOpenChange={setTemplateOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>תבניות</DialogTitle>
          <DialogDescription>שומרים פתיח, סיום, לוגו, סגנון כתוביות, מסלולים או פורמט, ופותחים מהם פרויקט חדש.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input aria-label="שם התבנית" value={name} onChange={(event) => setName(event.target.value)} />
          <div className="grid grid-cols-2 gap-2 text-xs">
            {TEMPLATE_PARTS.map((part) => (
              <label key={part} className="flex items-center gap-2">
                <input type="checkbox" checked={parts.includes(part)} onChange={() => toggle(part)} />
                {TEMPLATE_PART_LABELS[part]}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void saveCurrentTemplate(name, parts)}>
              שמירת תבנית
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
                      setError('קובץ התבנית לא תקין')
                    }
                  })
                }}
              />
              <span className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs">ייבוא</span>
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="max-h-56 space-y-2 overflow-auto">
            {templates.length === 0 && <p className="text-xs text-muted-foreground">אין תבניות שמורות.</p>}
            {templates.map((template) => (
              <div key={template.id} className="space-y-1 rounded-md border px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`שם ${template.name}`}
                    defaultValue={template.name}
                    className="h-7"
                    onBlur={(event) => void renameStoredTemplate(template.id, event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button type="button" size="sm" onClick={() => applyStoredTemplate(template.id)}>
                    פרויקט חדש
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => saveText(`${template.name}.retzef-template.json`, templateDocument(template))}>
                    ייצוא
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void deleteStoredTemplate(template.id)}>
                    מחיקה
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setTemplateOpen(false)}>
            סגירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ShortcutDialog() {
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
        setConflict(`הצירוף כבר שמור ל«${SHORTCUT_LABELS[hit]}»`)
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
  }, [listen, bindings])
  return (
    <Dialog open={open} onOpenChange={setShortcutOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>קיצורי מקלדת</DialogTitle>
          <DialogDescription>אפשר להחליף כל פעולה. צירוף תפוס נשאר אצל הפעולה הקודמת עד שמשחררים אותו.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={resetShortcutBindings}>
            איפוס
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => applyShortcutBindings(cloneBindings(PREMIERE_SHORTCUTS))}>
            פריסט פרימייר
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => saveText('retzef-shortcuts.json', shortcutFileText())}>
            ייצוא
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
                  if (!importShortcutText(text)) setConflict('קובץ הקיצורים לא תקין')
                  else setConflict(null)
                })
              }}
            />
            <span className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs">ייבוא</span>
          </label>
        </div>
        {listen && <p className="text-xs text-[#50e6ff]">הקישו צירוף חדש עבור {SHORTCUT_LABELS[listen]}. Escape מבטל.</p>}
        {conflict && <p className="text-xs text-destructive">{conflict}</p>}
        <div className="max-h-72 space-y-1 overflow-auto">
          {SHORTCUT_IDS.map((id) => (
            <div key={id} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{SHORTCUT_LABELS[id]}</span>
              <span dir="ltr" className="font-mono text-muted-foreground">
                {formatBinding(bindings[id])}
              </span>
              <Button type="button" size="sm" variant={listen === id ? 'secondary' : 'ghost'} onClick={() => setListen(id)}>
                הקצאה
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setShortcutOpen(false)}>
            סגירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
